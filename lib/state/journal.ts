// lib/state/journal.ts — internal to state. Run ids, journal listing, strict line parsing.
// Journal text is data only: parsed with JSON.parse, validated field by field, never executed or used as a format.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export const OPS = new Set(["create", "update", "patch-cells", "adopt", "insert-markers", "remove-to-backup", "forget", "block"]);
export const KINDS = new Set(["owned", "cells", "block", "json-element"]);
export const RUN_RE = /^\d{8}T\d{6}\.\d{3}Z-[1-9]\d*$/;
const FILE_RE = /^(\d{8}T\d{6}\.\d{3}Z-([1-9]\d*))\.jsonl$/;
const SHA_RE = /^sha256:[0-9a-f]{64}$/;
const HEX_RE = /^[0-9a-f]{64}$/;

export const journalRel = (run) => `journal/${run}.jsonl`;
/** The backup path is always derived from the run id and the path, never read from a journal. */
export const backupRel = (run, tilde) => `backups/${run}/${tilde.slice(2)}`;

/** @returns oldest first */
export function listJournals(world): {run: string, seq: number, file: string}[] {
  const dir = path.join(world.env.state, "journal");
  let names;
  try {
    names = readdirSync(dir);
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
  const out = [];
  for (const n of names) {
    const m = FILE_RE.exec(n);
    if (m) out.push({ run: m[1], seq: Number(m[2]), file: path.join(dir, n) });
  }
  return out.sort((a, b) => a.seq - b.seq);
}

/** "<UTC time to the millisecond>-<sequence>", the sequence one more than the highest existing journal number. */
export function newRunId(world, now = new Date()) {
  const seq = Math.max(0, ...listJournals(world).map((j) => j.seq)) + 1;
  const t = now.toISOString().replace(/[-:]/g, "");
  return `${t}-${seq}`;
}

const isMode = (m) => Number.isInteger(m) && m >= 0 && m <= 0o7777;
const shaOrNull = (s) => s === null || (typeof s === "string" && SHA_RE.test(s));

function validEntry(e) {
  if (e === null) return true;
  if (typeof e !== "object" || Array.isArray(e) || !KINDS.has(e.kind)) return false;
  for (const [k, v] of Object.entries(e)) {
    if (!["string", "number", "boolean"].includes(typeof v)) return false;
    if (k === "sha256" && !HEX_RE.test(v)) return false;
    if (k === "digest" && !SHA_RE.test(v)) return false;
    if (k === "mode" && !isMode(v)) return false;
  }
  return true;
}

function validIntent(l) {
  return (
    Number.isInteger(l.seq) &&
    typeof l.path === "string" && l.path.startsWith("~/") && l.path.length < 4096 && !l.path.includes("\0") &&
    OPS.has(l.op) && l.op !== "block" && KINDS.has(l.kind) &&
    shaOrNull(l.before_sha) && shaOrNull(l.after_sha) &&
    (l.before_sha === null ? l.before_mode === null : isMode(l.before_mode)) &&
    (l.after_sha === null ? l.after_mode === null : isMode(l.after_mode)) &&
    validEntry(l.entry_before) && validEntry(l.entry_after)
  );
}

/**
 * Parse one journal. A torn final line (no newline) is dropped: its intent was never followed by a mutation.
 * @returns
 *   done: the seqs that an abort or recovered line names as done; null when the line has none (older rig)
 *   text: the journal without its torn line
 */
export function readJournal(j): {run: string, cmd: string | null, intents: object[], closed: string | null, done: Set<number> | null, corrupt: string | null, torn: boolean, text: string} {
  const text = readFileSync(j.file, "utf8");
  const lines = text.split("\n");
  const torn = lines.pop() !== "";
  const out = { run: j.run, cmd: null, intents: [], closed: null, done: null as Set<number> | null, corrupt: null, torn, text: torn ? lines.map((l) => `${l}\n`).join("") : text };
  for (const [i, raw] of lines.entries()) {
    let l;
    try {
      l = JSON.parse(raw);
    } catch {
      l = null;
    }
    if (!l || typeof l !== "object") {
      out.corrupt = `line ${i + 1} is not JSON`;
      continue;
    }
    if (l.type === "run") out.cmd = typeof l.cmd === "string" ? l.cmd : null;
    else if (l.type === "intent") {
      if (validIntent(l)) out.intents.push(l);
      else out.corrupt = `line ${i + 1} is not a valid intent`;
    } else if (l.type === "commit" || l.type === "abort" || l.type === "recovered") {
      out.closed = l.type;
      if (l.done === undefined) continue;
      if (Array.isArray(l.done) && l.done.every(Number.isInteger)) out.done = new Set(l.done);
      else out.corrupt = `line ${i + 1} has a done field that is not a list of seqs`;
    } else out.corrupt = `line ${i + 1} has an unknown type`;
  }
  return out;
}
