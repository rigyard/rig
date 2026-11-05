// lib/state.ts — public: plan, apply, undo
// internals: lib/state/observe.ts, journal.mjs, recover.mjs, txn.mjs, diff.mjs
//
// Cell, block, json-element and keep_header entries need targets.patch. It is injected as opts.patch
// (or world.patch) so this module does not import lib/targets.ts.

import type { World } from "./world.ts";
import type { RigError } from "./stack.ts";
import type { Desired } from "./targets.ts";
import type { DesiredEntry } from "./targets.ts";
import type { Finding } from "./gate.ts";

export type OpName = "create"|"update"|"patch-cells"|"adopt"|"insert-markers"|"remove-to-backup"|"forget"|"block";
export type Op = {
  op: OpName;
  kind: "owned"|"cells"|"block"|"json-element";
  /** "~/"-relative */
  path: string;
  harness: string;
  unit: string;
  /** "sha256:<hex>" of the whole file; null when absent */
  before_sha: string | null;
  before_mode: number | null;
  /** null for a remove */
  after_sha: string | null;
  after_mode: number | null;
  /** bytes to write; null for adopt, forget, block, remove-to-backup */
  next: Uint8Array | null;
  entry_before: InstalledEntry | null;
  entry_after: InstalledEntry | null;
  /** set when op is "block" */
  error?: RigError;
  /** per-cell or unified diff shown by plan */
  diff?: string;
};
/** installed: the installed.json entries the plan derived from, rebuilt in memory over any interrupted journal. */
export type Plan = {ops: Op[], findings: Finding[], blocked: boolean, interrupted: string[], installed: Record<string, InstalledEntry>};

// schema: installed.json
export type Installed = {schema: 1, entries: Record<string, InstalledEntry>};
export type InstalledEntry = {kind: "owned"|"cells"|"block"|"json-element", sha256?: string, mode?: number, digest?: string, markers?: boolean,
  marker?: string, pointer?: string, id?: string, unit: string, run: string};
// schema: journal/<run-id>.jsonl
export type JournalLine = {type: "run", run: string, cmd: string, rig: string}
  | {type: "intent", seq: number, path: string, op: OpName, kind: string, before_sha: string | null, before_mode: number | null,
  after_sha: string | null, after_mode: number | null, backup: string | null,
  entry_before: InstalledEntry | null, entry_after: InstalledEntry | null}
  | {type: "commit", run: string, ops: number} | {type: "abort", seq: number, reason: string} | {type: "recovered", by: string};

import { lstatSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { log, writeHome, writeState } from "./fs.ts";
import { unifiedDiff } from "./state/diff.ts";
import { backupRel, listJournals, newRunId, readJournal, RUN_RE } from "./state/journal.ts";
import {
  blockDigest, cellsDigest, fsCtx, hex, jsonDigest, observe, readInstalled, sameSig, sha, sigOf,
} from "./state/observe.ts";
import { recover, simulate } from "./state/recover.ts";
import { execute, releaseLock, takeLock } from "./state/txn.ts";

const err = (code, message, p) => ({ code, message, path: p });
/** "~/"-form of a path for output; a path outside HOME stays as given. */
function tildeOf(home, p) {
  const rel = path.relative(home, p);
  return path.isAbsolute(p) && rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? `~/${rel.split(path.sep).join("/")}` : p;
}

function mkOp(name, kind, o, e, f) {
  return {
    op: name, kind, path: o.tilde, harness: e?.harness ?? "", unit: e?.unit ?? f.entry_before?.unit ?? "",
    before_sha: o.sha, before_mode: o.sha === null ? null : o.mode,
    after_sha: f.after ? f.after.sha : o.sha, after_mode: f.after ? f.after.mode : o.sha === null ? null : o.mode,
    next: f.next ?? null, entry_before: f.entry_before ?? null, entry_after: f.entry_after ?? null,
    ...(f.error ? { error: f.error } : {}), ...(f.diff ? { diff: f.diff } : {}),
  };
}
const blockOp = (kind, o, e, entryBefore, error, diff) =>
  mkOp("block", kind, o, e, { entry_before: entryBefore, error, diff, after: { sha: null, mode: null } });

function currentDigest(kind, current) {
  if (current === null || current === undefined) return null;
  if (kind === "cells") return cellsDigest(current);
  if (kind === "block") return blockDigest(current);
  return jsonDigest(current);
}
function desiredDigest(e) {
  if (e.kind === "cells") return cellsDigest(e.values);
  if (e.kind === "block") return blockDigest(e.bytes);
  return jsonDigest(e.value);
}

function cellDiff(p, current, values) {
  const key = (c) => `${c.surface}/${c.key}/${c.element}`;
  const cur = new Map((current ?? []).map((c) => [key(c), c.value]));
  const lines = values.filter((c) => cur.get(key(c)) !== c.value).map((c) => `${p} ${key(c)}: ${JSON.stringify(cur.get(key(c)) ?? null)} -> ${JSON.stringify(c.value)}`);
  return `${lines.join("\n")}\n`;
}

function planOwned(e, o, ent, patch) {
  let bytes = e.bytes;
  if (e.keep_header) {
    if (!patch) return blockOp("owned", o, e, ent, err("E_INTERNAL", "keep_header needs a patch function", o.tilde));
    const r = patch(o.bytes, e);
    if (r.error) return blockOp("owned", o, e, ent, r.error);
    bytes = r.next;
  }
  bytes = Buffer.from(bytes);
  // A unit file's mode can carry the file type bits of stat (0o100644); state compares and journals permission bits.
  const mode = (e.mode ?? 0o644) & 0o7777;
  const want = { sha: sha(bytes), mode };
  const entryAfter = { kind: "owned", sha256: hex(bytes), mode, unit: e.unit, run: null };
  if (ent && ent.kind !== "owned") return blockOp("owned", o, e, ent, err("E_DRIFT", `${o.tilde} is recorded as ${ent.kind}, desired as owned`, o.tilde));
  const recorded = ent ? { sha: `sha256:${ent.sha256}`, mode: ent.mode } : null;
  const cur = sigOf(o);
  if (cur.sha === null) {
    if (ent) return blockOp("owned", o, e, ent, err("E_DRIFT", `managed file ${o.tilde} was removed`, o.tilde));
    return mkOp("create", "owned", o, e, { next: bytes, after: want, entry_after: entryAfter });
  }
  if (sameSig(cur, want)) {
    if (ent && sameSig(recorded, want)) return null;
    return mkOp("adopt", "owned", o, e, { entry_before: ent, entry_after: entryAfter });
  }
  if (!ent) {
    const why = cur.sha === want.sha ? `mode ${cur.mode.toString(8)} differs from ${mode.toString(8)}` : "bytes differ";
    return blockOp("owned", o, e, ent, err("E_ADOPT_MISMATCH", `${o.tilde} exists and is not managed: ${why}`, o.tilde), unifiedDiff(o.tilde, o.bytes, bytes));
  }
  if (!sameSig(cur, recorded)) {
    return blockOp("owned", o, e, ent, err("E_DRIFT", `${o.tilde} changed since rig wrote it`, o.tilde), unifiedDiff(o.tilde, o.bytes, bytes));
  }
  return mkOp("update", "owned", o, e, { next: bytes, after: want, entry_before: ent, entry_after: entryAfter, diff: unifiedDiff(o.tilde, o.bytes, bytes) });
}

function planPatched(e, o, ent, patch) {
  if (!patch) return blockOp(e.kind, o, e, ent, err("E_INTERNAL", `${e.kind} entries need a patch function`, o.tilde));
  if (e.kind === "cells" && o.sha === null && (e.surfaces ?? []).every((s) => s.kind === "frontmatter")) return null;
  if (ent && ent.kind !== e.kind) return blockOp(e.kind, o, e, ent, err("E_DRIFT", `${o.tilde} is recorded as ${ent.kind}, desired as ${e.kind}`, o.tilde));
  const r = patch(o.bytes, e);
  if (r.error) return blockOp(e.kind, o, e, ent, r.error);
  const have = currentDigest(e.kind, r.current);
  const want = desiredDigest(e);
  const next = Buffer.from(r.next);
  const writes = !(o.bytes && Buffer.compare(next, o.bytes) === 0);
  const mode = o.sha === null ? 0o644 : o.mode;
  const f = { entry_before: ent, entry_after: { kind: e.kind, digest: want, unit: e.unit, run: null } };
  if (e.kind === "cells") f.entry_after.markers = (e.surfaces ?? []).some((s) => s.markers === true);
  if (e.kind === "block") f.entry_after.marker = e.marker;
  if (e.kind === "json-element") Object.assign(f.entry_after, { pointer: e.pointer, id: e.id });
  const write = (name) => mkOp(name, e.kind, o, e, { ...f, next, after: { sha: sha(next), mode } });
  const diff = e.kind === "cells" ? cellDiff(o.tilde, r.current, e.values) : unifiedDiff(o.tilde, o.bytes, next);
  if (!ent) {
    if (have === want) return writes ? write("insert-markers") : mkOp("adopt", e.kind, o, e, f);
    if (have === null && e.kind !== "cells") return write(o.sha === null ? "create" : "update");
    return blockOp(e.kind, o, e, ent, err("E_ADOPT_MISMATCH", `${o.tilde}: current values differ from the render`, o.tilde), diff);
  }
  if (have !== ent.digest) return blockOp(e.kind, o, e, ent, err("E_DRIFT", `${o.tilde}: values changed since rig wrote them`, o.tilde), diff);
  if (want !== ent.digest) return write(e.kind === "cells" ? "patch-cells" : "update");
  if (writes) return write(r.markers === "inserted" ? "insert-markers" : "update");
  return null;
}

function planRemoval(ent, o, patch) {
  const e = { unit: ent.unit };
  if (ent.kind === "owned") {
    if (o.sha === null) return mkOp("forget", "owned", o, e, { entry_before: ent });
    if (sameSig(sigOf(o), { sha: `sha256:${ent.sha256}`, mode: ent.mode })) {
      return mkOp("remove-to-backup", "owned", o, e, { entry_before: ent, after: { sha: null, mode: null } });
    }
    return blockOp("owned", o, e, ent, err("E_DRIFT", `${o.tilde} changed since rig wrote it; it is no longer desired`, o.tilde));
  }
  if (ent.kind === "cells") return mkOp("forget", "cells", o, e, { entry_before: ent });
  if (!patch) return blockOp(ent.kind, o, e, ent, err("E_INTERNAL", `${ent.kind} removal needs a patch function`, o.tilde));
  const r = patch(o.bytes, { kind: ent.kind, path: o.abs, marker: ent.marker, pointer: ent.pointer, id: ent.id, unit: ent.unit, remove: true });
  if (r.error) return blockOp(ent.kind, o, e, ent, r.error);
  const have = currentDigest(ent.kind, r.current);
  if (have === null) return mkOp("forget", ent.kind, o, e, { entry_before: ent });
  if (have !== ent.digest) return blockOp(ent.kind, o, e, ent, err("E_DRIFT", `${o.tilde}: region changed since rig wrote it`, o.tilde));
  const next = Buffer.from(r.next);
  return mkOp("update", ent.kind, o, e, { entry_before: ent, next, after: { sha: sha(next), mode: o.mode } });
}

/**
 * Observe current bytes of every desired and installed path, then derive ops. Read-only: never recovers,
 * never logs. An interrupted journal is simulated (installed entries rebuilt in memory) and named in .interrupted;
 * .installed holds those entries.
 */
export function plan(desired: {entries: Map<string, object>}, gated: {findings: object[], blocked: boolean}, world: object, opts: {filter?: (e: object) => boolean, patch?: Function} = {}) {
  const ctx = fsCtx(world);
  const patch = opts.patch ?? world.patch;
  const sim = simulate(world, ctx);
  const installed = sim.entries;
  const ops = [];
  for (const c of sim.conflicts) {
    ops.push({ op: "block", kind: "owned", path: c.path, harness: "", unit: "", before_sha: null, before_mode: null, after_sha: null,
      after_mode: null, next: null, entry_before: null, entry_after: null, error: c });
  }
  const seen = new Set();
  for (const [key, e] of desired.entries) {
    if (opts.filter && !opts.filter(e)) continue;
    const o = observe(e.path ?? key, ctx);
    if (o.error) {
      const shown = tildeOf(world.env.home, String(e.path ?? key));
      seen.add(shown);
      ops.push(blockOp(e.kind, { tilde: shown, sha: null, mode: null }, e, installed[shown] ?? null, { ...o.error, path: shown }));
      continue;
    }
    if (seen.has(o.tilde)) {
      ops.push(blockOp(e.kind, o, e, null, err("E_INTERNAL", `two desired entries for ${o.tilde}`, o.tilde)));
      continue;
    }
    seen.add(o.tilde);
    const ent = installed[o.tilde] ?? null;
    ops.push(e.kind === "owned" ? planOwned(e, o, ent, patch) : planPatched(e, o, ent, patch));
  }
  if (!opts.filter) {
    for (const [tilde, ent] of Object.entries(installed)) {
      if (seen.has(tilde)) continue;
      const o = observe(tilde, ctx);
      if (o.error) ops.push(blockOp(ent.kind, { tilde, sha: null, mode: null }, { unit: ent.unit }, ent, o.error));
      else ops.push(planRemoval(ent, o, patch));
    }
  }
  const out = ops.filter(Boolean);
  return {
    ops: out,
    findings: gated?.findings ?? [],
    blocked: Boolean(gated?.blocked) || out.some((x) => x.op === "block"),
    interrupted: sim.interrupted,
    installed,
  };
}

const LITTER = /^\..+\.rig-tmp$/;

/** Remove *.rig-tmp files left by a killed run: in the dirs of known HOME paths and in the state root. */
function sweep(world, ctx, homePaths) {
  const dirs = new Set();
  for (const p of homePaths) {
    const o = observe(p, ctx);
    if (!o.error) dirs.add(path.dirname(o.abs));
  }
  for (const d of dirs) {
    let names = [];
    try {
      names = readdirSync(d);
    } catch {
      continue;
    }
    for (const n of names) {
      if (!LITTER.test(n)) continue;
      try {
        writeHome(path.join(d, n), null, undefined, ctx);
      } catch (e) {
        if (!e.code?.startsWith?.("E_")) throw e;
      }
    }
  }
  for (const sub of ["", "journal"]) {
    let names = [];
    try {
      names = readdirSync(path.join(world.env.state, sub));
    } catch {
      continue;
    }
    for (const n of names) if (LITTER.test(n)) writeState(sub ? `${sub}/${n}` : n, null, ctx);
  }
}

/** A failed log line must not hide a committed run. */
function safeLog(event, ctx) {
  try {
    log(event, ctx);
  } catch {
    // the journal already holds the run
  }
}

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
const conflictError = (code, list) => ({
  code, message: list.map((c) => `${c.path}: ${c.message}`).join("\n"), path: list[0]?.path,
});

/**
 * Recover, check the plan is fresh, then write every op through the journal. With undo, the only path that
 * writes HOME files (writeHome); observe calls writeHome only with {check: true}.
 */
export function apply(planned: {ops: object[], blocked: boolean, interrupted: string[]}, world: object): {run: string | null, changed: number, replan?: boolean, error?: object} {
  const ctx = fsCtx(world);
  const run = newRunId(world);
  const locked = takeLock(world, ctx, run);
  if (locked) return { run: null, changed: 0, error: locked };
  try {
    const rec = recover(world, run);
    sweep(world, ctx, [...rec.paths, ...planned.ops.map((o) => o.path), ...Object.keys(readInstalled(world).entries)]);
    if (rec.conflicts.length) return { run: null, changed: 0, error: conflictError("E_RECOVERY_CONFLICT", rec.conflicts) };
    if (!sameSet(rec.runs, planned.interrupted ?? [])) return { run: null, changed: 0, replan: true };
    if (planned.blocked) return { run: null, changed: 0 };
    const ops = planned.ops.filter((o) => o.op !== "block").map((o) => ({ ...o, entry_after: o.entry_after && { ...o.entry_after, run } }));
    if (!ops.length) return { run: null, changed: 0 };
    const r = execute(world, ctx, { run, cmd: "apply", ops, entries: readInstalled(world).entries });
    safeLog({ event: "apply", run, changed: r.changed, ...(r.error ? { error: r.error.code } : {}) }, ctx);
    return { run, changed: r.changed, ...(r.error ? { error: r.error } : {}) };
  } finally {
    releaseLock(world, ctx, run);
  }
}

function readBackup(world, run, tilde) {
  const p = path.join(world.env.state, backupRel(run, tilde));
  try {
    if (!lstatSync(p).isFile()) return null;
    return readFileSync(p);
  } catch {
    return null;
  }
}

/**
 * Restore one run's pre-images, newest op first. Journaled as a new run. No pack gate.
 * Any conflicting path stops the undo before the first write; conflicts lists every such path.
 */
export function undo(runId: string, world: object): {run: string | null, restored: number, conflicts: object[]} {
  const ctx = fsCtx(world);
  if (typeof runId !== "string" || !RUN_RE.test(runId)) {
    return { run: null, restored: 0, conflicts: [err("E_UNDO_CONFLICT", `not a run id: ${String(runId)}`)] };
  }
  const run = newRunId(world);
  const locked = takeLock(world, ctx, run);
  if (locked) return { run: null, restored: 0, conflicts: [locked] };
  try {
    const rec = recover(world, run);
    if (rec.conflicts.length) return { run: null, restored: 0, conflicts: rec.conflicts };
    const j = listJournals(world).find((x) => x.run === runId);
    if (!j) return { run: null, restored: 0, conflicts: [err("E_UNDO_CONFLICT", `no journal for run ${runId}`)] };
    const jr = readJournal(j);
    if (jr.corrupt) return { run: null, restored: 0, conflicts: [err("E_UNDO_CONFLICT", `journal ${runId}: ${jr.corrupt}`)] };
    const committed = jr.closed === "commit";
    const conflicts = [];
    const ops = [];
    for (const it of [...jr.intents].reverse()) {
      const o = observe(it.path, ctx);
      if (o.error) {
        conflicts.push(err("E_CONTAINMENT", o.error.message, it.path));
        continue;
      }
      if (o.tilde !== it.path) {
        conflicts.push(err("E_CONTAINMENT", `journal path is not normalised: ${it.path}`, it.path));
        continue;
      }
      const cur = sigOf(o);
      const before = { sha: it.before_sha, mode: it.before_mode };
      const after = { sha: it.after_sha, mode: it.after_mode };
      if (!sameSig(cur, after)) {
        // an aborted or recovered run may hold intents that never reached disk
        if (!committed && sameSig(cur, before)) continue;
        conflicts.push(err("E_UNDO_CONFLICT", `${it.path} no longer has the after hash of run ${runId}`, it.path));
        continue;
      }
      const unit = it.entry_before?.unit ?? it.entry_after?.unit ?? "";
      const f = { entry_before: it.entry_after, entry_after: it.entry_before };
      const e = { unit };
      if (sameSig(before, after)) ops.push(mkOp(it.entry_before ? "adopt" : "forget", it.kind, o, e, f));
      else if (it.before_sha === null) ops.push(mkOp("remove-to-backup", it.kind, o, e, { ...f, after: { sha: null, mode: null } }));
      else {
        const b = readBackup(world, runId, it.path);
        if (!b || sha(b) !== it.before_sha) {
          conflicts.push(err("E_UNDO_CONFLICT", `the backup of ${it.path} in run ${runId} is missing or changed`, it.path));
          continue;
        }
        ops.push(mkOp(cur.sha === null ? "create" : "update", it.kind, o, e, { ...f, next: b, after: before }));
      }
    }
    if (conflicts.length) return { run: null, restored: 0, conflicts };
    if (!ops.length) return { run: null, restored: 0, conflicts: [] };
    const r = execute(world, ctx, { run, cmd: "undo", ops, entries: readInstalled(world).entries });
    safeLog({ event: "undo", run, of: runId, restored: r.changed, ...(r.error ? { error: r.error.code } : {}) }, ctx);
    return { run, restored: r.changed, conflicts: r.error ? [r.error] : [] };
  } finally {
    releaseLock(world, ctx, run);
  }
}
