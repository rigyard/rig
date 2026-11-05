// lib/state/txn.ts — internal to state. apply.lock and the journaled executor shared by apply and undo.

import { readFileSync } from "node:fs";
import path from "node:path";
import { appendState, writeHome, writeState } from "../fs.ts";
import { backupRel, journalRel } from "./journal.ts";
import { encodeInstalled, INSTALLED, observe, sameSig, sigOf } from "./observe.ts";

export const RIG_VERSION = "0.1.0";
const LOCK = "apply.lock";
/** Ops that change file bytes. adopt and forget change only installed.json. */
export const MUTATING = new Set(["create", "update", "patch-cells", "insert-markers", "remove-to-backup"]);

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

function readLock(world) {
  try {
    return JSON.parse(readFileSync(path.join(world.env.state, LOCK), "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return { gone: true };
    return null;
  }
}

/** O_EXCL-style lock holding pid and run id. A lock whose pid is dead is stale and replaced once. @returns error */
export function takeLock(world, ctx, run): object | null {
  const bytes = Buffer.from(`${JSON.stringify({ pid: process.pid, run })}\n`);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      writeState(LOCK, bytes, ctx, { exclusive: true });
      return null;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
    const holder = readLock(world);
    if (holder?.gone) continue;
    if (holder && !alive(holder.pid)) {
      writeState(LOCK, null, ctx);
      continue;
    }
    break;
  }
  const holder = readLock(world);
  return {
    code: "E_LOCKED",
    message: `another rig run holds ${path.join(world.env.state, LOCK)} (pid ${holder?.pid ?? "unknown"}, run ${holder?.run ?? "unknown"})`,
    path: LOCK,
  };
}

export function releaseLock(world, ctx, run) {
  const holder = readLock(world);
  if (holder && holder.pid === process.pid && holder.run === run) writeState(LOCK, null, ctx);
}

/** RIG_TEST_ABORT_AFTER=<n>, read only when RIG_TEST=1: SIGKILL self once n mutations are done. */
function abortAfter() {
  if (process.env.RIG_TEST !== "1") return null;
  const v = process.env.RIG_TEST_ABORT_AFTER;
  return v !== undefined && /^\d+$/.test(v) ? Number(v) : null;
}

const setEntry = (entries, tilde, e) => {
  if (e === null) delete entries[tilde];
  else entries[tilde] = e;
};

/**
 * Write ops through journal/<run>.jsonl. Per mutating op: before-sig check, pre-image into backups/<run>/,
 * intent line (fsync), before-sig re-check, writeHome. Then installed.json (atomic) and the commit line.
 * On an error the run records done ops in installed.json, appends an abort line and returns the error.
 * @returns changed counts ops whose effect is recorded
 */
export function execute(world, ctx, t: {run: string, cmd: string, ops: object[], entries: Record<string, object>}): {changed: number, error?: object} {
  const journal = journalRel(t.run);
  const entries = { ...t.entries };
  const stopAt = abortAfter();
  const maybeAbort = (n) => {
    if (stopAt !== null && n === stopAt) process.kill(process.pid, "SIGKILL");
  };
  appendState(journal, JSON.stringify({ type: "run", run: t.run, cmd: t.cmd, rig: RIG_VERSION }), ctx);
  let mutations = 0;
  let done = 0;
  let seq = 0;
  let pending = null;
  try {
    for (const op of t.ops) {
      seq++;
      const before = { sha: op.before_sha, mode: op.before_mode };
      const o = observe(op.path, ctx);
      if (o.error) throw Object.assign(new Error(o.error.message), { code: o.error.code, path: op.path });
      if (!sameSig(sigOf(o), before)) throw changedUnder(op.path);
      const mutates = MUTATING.has(op.op);
      const backup = mutates && o.bytes ? backupRel(t.run, o.tilde) : null;
      if (backup) writeState(backup, o.bytes, ctx, { mode: 0o600 });
      appendState(journal, JSON.stringify({
        type: "intent", seq, path: o.tilde, op: op.op, kind: op.kind,
        before_sha: op.before_sha, before_mode: op.before_mode, after_sha: op.after_sha, after_mode: op.after_mode,
        backup, entry_before: op.entry_before, entry_after: op.entry_after,
      }), ctx);
      if (mutates) {
        maybeAbort(mutations);
        if (!sameSig(sigOf(observe(op.path, ctx)), before)) throw changedUnder(op.path);
        pending = op;
        writeHome(o.tilde, op.op === "remove-to-backup" ? null : op.next, op.after_mode ?? undefined, ctx);
        pending = null;
        mutations++;
      }
      setEntry(entries, o.tilde, op.entry_after);
      done++;
    }
    maybeAbort(mutations);
  } catch (e) {
    if (pending) {
      const o = observe(pending.path, ctx);
      if (!o.error && sameSig(sigOf(o), { sha: pending.after_sha, mode: pending.after_mode })) {
        setEntry(entries, o.tilde, pending.entry_after);
        done++;
      }
    }
    const error = { code: e.code?.startsWith?.("E_") ? e.code : "E_INTERNAL", message: e.message, path: e.path ?? pending?.path };
    writeState(INSTALLED, encodeInstalled({ schema: 1, entries }), ctx);
    appendState(journal, JSON.stringify({ type: "abort", seq, reason: error.code }), ctx);
    return { changed: done, error };
  }
  writeState(INSTALLED, encodeInstalled({ schema: 1, entries }), ctx);
  appendState(journal, JSON.stringify({ type: "commit", run: t.run, ops: t.ops.length }), ctx);
  return { changed: t.ops.length };
}

function changedUnder(p) {
  return Object.assign(new Error(`${p} changed between plan and write`), { code: "E_CHANGED_UNDER", path: p });
}
