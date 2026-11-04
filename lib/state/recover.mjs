// lib/state/recover.mjs — internal to state. Classify every intent of an open journal by the bytes on disk.

import { appendState, writeState } from "../fs.mjs";
import { backupRel, journalRel, listJournals, readJournal } from "./journal.mjs";
import { encodeInstalled, fsCtx, observe, readInstalled, sameSig, sigOf } from "./observe.mjs";

const conflict = (code, message, path) => ({ code, message, path });

/**
 * Read-only. Rebuild installed entries from one journal: an intent whose path holds after_sha is done
 * (entry_after), one that holds before_sha is not done (entry_before), anything else is a conflict.
 * @returns {{entries: Record<string, object>, done: number, notDone: number, conflicts: object[], warnings: string[], paths: string[]}}
 */
export function classify(entries, jr, ctx) {
  const next = { ...entries };
  const out = { entries: next, done: 0, notDone: 0, conflicts: [], warnings: [], paths: [] };
  if (jr.corrupt) out.conflicts.push(conflict("E_RECOVERY_CONFLICT", `journal ${jr.run}: ${jr.corrupt}`, journalRel(jr.run)));
  for (const it of jr.intents) {
    const o = observe(it.path, ctx);
    if (o.error) {
      out.conflicts.push(conflict("E_CONTAINMENT", o.error.message, it.path));
      continue;
    }
    if (o.tilde !== it.path) {
      out.conflicts.push(conflict("E_CONTAINMENT", `journal path is not normalised: ${it.path}`, it.path));
      continue;
    }
    if (it.backup !== null && it.backup !== backupRel(jr.run, it.path)) {
      out.warnings.push(`journal ${jr.run}: backup field of ${it.path} ignored`);
    }
    out.paths.push(o.abs);
    const cur = sigOf(o);
    let e;
    if (sameSig(cur, { sha: it.after_sha, mode: it.after_mode })) {
      out.done++;
      e = it.entry_after;
    } else if (sameSig(cur, { sha: it.before_sha, mode: it.before_mode })) {
      out.notDone++;
      e = it.entry_before;
    } else {
      out.conflicts.push(conflict("E_RECOVERY_CONFLICT", `${it.path} matches neither the before nor the after hash of run ${jr.run}`, it.path));
      continue;
    }
    if (e === null) delete next[it.path];
    else next[it.path] = e;
  }
  return out;
}

/** Read-only simulation for plan: installed entries as recovery would rebuild them, plus the open run ids. */
export function simulate(world, ctx = fsCtx(world)) {
  let entries = readInstalled(world).entries;
  const interrupted = [];
  const conflicts = [];
  for (const j of listJournals(world)) {
    const jr = readJournal(j);
    if (jr.closed) continue;
    interrupted.push(j.run);
    const c = classify(entries, jr, ctx);
    if (c.conflicts.length) {
      conflicts.push(...c.conflicts);
      break;
    }
    entries = c.entries;
  }
  return { entries, interrupted, conflicts };
}

/**
 * Close every journal without commit, abort or recovered. The caller holds apply.lock.
 * Any conflict stops recovery before installed.json or the journal changes.
 * @param {object} world @param {string} runId  the run doing the recovery
 * @returns {{done: number, notDone: number, conflicts: object[], warnings: string[], runs: string[], paths: string[]}}
 */
export function recover(world, runId) {
  const ctx = fsCtx(world);
  const out = { done: 0, notDone: 0, conflicts: [], warnings: [], runs: [], paths: [] };
  for (const j of listJournals(world)) {
    const jr = readJournal(j);
    if (jr.closed) continue;
    const c = classify(readInstalled(world).entries, jr, ctx);
    out.paths.push(...c.paths);
    out.warnings.push(...c.warnings);
    if (c.conflicts.length) {
      out.conflicts.push(...c.conflicts);
      return out;
    }
    writeState("installed.json", encodeInstalled({ schema: 1, entries: c.entries }), ctx);
    const line = JSON.stringify({ type: "recovered", by: runId });
    // an append after a torn line would merge with it; replace the journal without the torn bytes instead
    if (jr.torn) writeState(journalRel(j.run), Buffer.from(`${jr.text}${line}\n`), ctx);
    else appendState(journalRel(j.run), line, ctx);
    out.done += c.done;
    out.notDone += c.notDone;
    out.runs.push(j.run);
  }
  return out;
}
