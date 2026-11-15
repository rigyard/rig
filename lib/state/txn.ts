// lib/state/txn.ts — internal to state. apply.lock and the journaled executor shared by apply and undo.

import { readFileSync } from "node:fs";
import path from "node:path";
import { appendState, fsyncAll, installHome, stageHome, writeHome, writeState } from "../fs.ts";
import { backupRel, journalRel } from "./journal.ts";
import { encodeInstalled, INSTALLED, observe, sameSig, sigOf } from "./observe.ts";
import type { Op } from "../state.ts";

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

/** RIG_TEST_ABORT_AFTER, read only when RIG_TEST=1: SIGKILL self once n renames are done, or after a named step. */
function abortAt(): string | null {
  if (process.env.RIG_TEST !== "1") return null;
  return process.env.RIG_TEST_ABORT_AFTER ?? null;
}

const setEntry = (entries, tilde, e) => {
  if (e === null) delete entries[tilde];
  else entries[tilde] = e;
};
const beforeSig = (op: Op) => ({ sha: op.before_sha, mode: op.before_mode });
type Observed = Exclude<ReturnType<typeof observe>, {error: object}>;
type Step = {op: Op, o: Observed, staged: ReturnType<typeof stageHome> | null};

/**
 * Write ops through journal/<run>.jsonl as one batch, so each durability step is one fsyncAll, not one fsync per op:
 *  1. before-sig check of every op; the first mismatch ends the batch, and the ops before it still run
 *  2. the journal with the run line and every intent, durable before HOME changes        (RIG_TEST_ABORT_AFTER=journal)
 *  3. pre-images into backups/<run>/ and a temp file next to each target                  (staged)
 *  4. one fsyncAll over the backups and the temp files
 *  5. per op in plan order: before-sig re-check, then rename, or unlink for a remove     (<n renames done>)
 *     that also prunes the dirs the unlink leaves empty and queues the nearest surviving dir for the sync
 *  6. one fsyncAll over the dirs whose entries changed, then installed.json (atomic)      (installed)
 *  7. the commit line
 * On an error the run removes the temp files it did not rename, records done ops in installed.json, appends an
 * abort line with the seqs of the done ops and returns the error.
 * @returns changed counts ops whose effect is recorded
 */
export function execute(world, ctx, t: {run: string, cmd: string, ops: object[], entries: Record<string, object>}): {changed: number, error?: object} {
  const journal = journalRel(t.run);
  const entries = { ...t.entries };
  const stopAt = abortAt();
  const maybeAbort = (at: number | string) => {
    if (stopAt === String(at)) process.kill(process.pid, "SIGKILL");
  };
  const batch: Step[] = [];
  let stop = null;
  for (const op of t.ops as Op[]) {
    try {
      const o = observe(op.path, ctx);
      if ("error" in o) throw Object.assign(new Error(o.error.message), { code: o.error.code, path: op.path });
      if (!sameSig(sigOf(o), beforeSig(op))) throw changedUnder(op.path);
      batch.push({ op, o, staged: null });
    } catch (e) {
      stop = e;
      break;
    }
  }
  const lines = [{ type: "run", run: t.run, cmd: t.cmd, rig: RIG_VERSION }, ...batch.map(({ op, o }, i) => ({
    type: "intent", seq: i + 1, path: o.tilde, op: op.op, kind: op.kind,
    before_sha: op.before_sha, before_mode: op.before_mode, after_sha: op.after_sha, after_mode: op.after_mode,
    backup: MUTATING.has(op.op) && o.bytes ? backupRel(t.run, o.tilde) : null, entry_before: op.entry_before, entry_after: op.entry_after,
  }))];
  writeState(journal, Buffer.from(lines.map((l) => `${JSON.stringify(l)}\n`).join("")), ctx, { exclusive: true });
  maybeAbort("journal");
  let mutations = 0;
  const done: number[] = [];
  let seq = 0;
  let pending: Step | null = null;
  const dirs = new Set<string>();
  try {
    const files = [];
    const backupDirs = new Set<string>();
    for (const [i, b] of batch.entries()) {
      seq = i + 1;
      if (!MUTATING.has(b.op.op)) continue;
      if (b.o.bytes) {
        const w = writeState(backupRel(t.run, b.o.tilde), b.o.bytes, ctx, { mode: 0o600, sync: false });
        files.push(w.abs);
        for (const d of w.dirs) backupDirs.add(d);
      }
      if (b.op.op !== "remove-to-backup") {
        const staged = stageHome(b.o.tilde, b.op.next!, b.op.after_mode ?? undefined, ctx);
        files.push(staged.tmp);
        b.staged = staged;
      }
    }
    maybeAbort("staged");
    fsyncAll(files, [...backupDirs]);
    for (const [i, b] of batch.entries()) {
      seq = i + 1;
      if (MUTATING.has(b.op.op)) {
        maybeAbort(mutations);
        if (!sameSig(sigOf(observe(b.op.path, ctx)), beforeSig(b.op))) throw changedUnder(b.op.path);
        pending = b;
        if (b.staged) {
          for (const d of b.staged.dirs) dirs.add(d);
          installHome(b.staged, ctx);
          b.staged = null;
        } else {
          const { dir } = writeHome(b.o.tilde, null, undefined, ctx, { sync: false, prune: true });
          dirs.add(dir!);
        }
        pending = null;
        mutations++;
      }
      setEntry(entries, b.o.tilde, b.op.entry_after);
      done.push(seq);
    }
    maybeAbort(mutations);
    if (stop) {
      seq = batch.length + 1;
      throw stop;
    }
  } catch (e) {
    if (pending) {
      const o = observe(pending.op.path, ctx);
      if (!("error" in o) && sameSig(sigOf(o), { sha: pending.op.after_sha, mode: pending.op.after_mode })) {
        setEntry(entries, o.tilde, pending.op.entry_after);
        done.push(seq);
      }
    }
    for (const b of batch) if (b.staged) discard(b.staged.tmp, ctx);
    fsyncAll([], [...dirs]);
    const error = { code: e.code?.startsWith?.("E_") ? e.code : "E_INTERNAL", message: e.message, path: e.path ?? pending?.op.path };
    writeState(INSTALLED, encodeInstalled({ schema: 1, entries }), ctx);
    appendState(journal, JSON.stringify({ type: "abort", seq, reason: error.code, done }), ctx);
    return { changed: done.length, error };
  }
  fsyncAll([], [...dirs]);
  writeState(INSTALLED, encodeInstalled({ schema: 1, entries }), ctx);
  maybeAbort("installed");
  appendState(journal, JSON.stringify({ type: "commit", run: t.run, ops: t.ops.length }), ctx);
  return { changed: t.ops.length };
}

/** Remove a temp file the run did not rename. One that containment refuses stays for the sweep of a later run. */
function discard(tmp: string, ctx: object) {
  try {
    writeHome(tmp, null, undefined, ctx, { sync: false });
  } catch (e) {
    if (!(e as NodeJS.ErrnoException).code?.startsWith("E_")) throw e;
  }
}

function changedUnder(p) {
  return Object.assign(new Error(`${p} changed between plan and write`), { code: "E_CHANGED_UNDER", path: p });
}
