// lib/metrics.ts — public: stats, recordSession. Both go through the internal record().
import type { World } from "./world.ts";
// Store line fields beyond the doc's MetricsLine: `side_usage`, the same shape as `models`, for usage billed on calls
// outside the main conversation (Claude advisor iterations, omp model_usage records). Omitted when empty.
// Transcripts are the source; metrics.jsonl in the state root is the content-free store (decision 0021).
import { join, relative, isAbsolute } from "node:path";
import { statSync } from "node:fs";
import * as claude from "./metrics/readers/claude-jsonl.ts";
import * as codex from "./metrics/readers/codex-rollout.ts";
import * as omp from "./metrics/readers/omp-jsonl.ts";
import * as cursor from "./metrics/readers/cursor-agent-jsonl.ts";
import { record } from "./metrics/record.ts";
import { renderReport } from "./metrics/report.ts";
import { propose } from "./metrics/propose.ts";
import { readStore } from "./metrics/store.ts";
import { appendState, log, writeState } from "./fs.ts";
import { realpathOrNull } from "./metrics/jsonl.ts";

/** The write side of the store, the proposals and the log. Tests inject a temp-dir writer. */
export type Io = {append: (rel: string, text: string) => void, write: (rel: string, text: string) => void, log: (event: object) => void};
/** The default writer: lib/fs.ts with the World's write context, so every write stays under the state root. @returns {Io} */
const ioOf = (world) => ({
  append: (rel, text) => appendState(rel, text, world.ctx),
  write: (rel, text) => writeState(rel, Buffer.from(text, "utf8"), world.ctx),
  log: (event) => log(event, world.ctx),
});
/** A null world (hook mode after a failed load) has no state root: nothing to write to. @type {Io} */
const NO_IO = { append: () => {}, write: () => {}, log: () => {} };

/** Event lines carry codes and counts, never message text. Logging never throws. */
function safeLog(io, event) {
  try {
    io.log({ ts: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), ...event });
  } catch {
    // an unwritable state root must not break the caller
  }
}

const READERS = new Map([claude, codex, omp, cursor].map((reader) => [reader.format, reader]));
const readerId = (reader) => `${reader.format}@${reader.version}`;
const DEFAULT_SINCE = "30d";
const PROPOSALS_DIR = "proposals";
const MAX_HOOK_PAYLOAD_BYTES = 64 * 1024;
const UNIT_MS = { d: 86_400_000, h: 3_600_000, m: 60_000 };

class MetricsError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function parseSince(text) {
  const match = /^(\d+)([dhm])$/.exec(text);
  if (!match || Number(match[1]) === 0) throw new MetricsError("E_USAGE");
  return Number(match[1]) * UNIT_MS[match[2]];
}

const expandRoot = (home, root) => (root.startsWith("~/") ? join(home, root.slice(2)) : root);

/** The harnesses of `world` that name a transcript format with a reader. */
function transcriptTargets(world) {
  const out = [];
  for (const [harness, target] of world.targets ?? []) {
    const reader = READERS.get(target.transcripts?.format);
    if (reader) out.push({ harness, reader, root: expandRoot(world.env.home, target.transcripts.root) });
  }
  return out;
}

const sessionMatches = (desc, id) => desc.session_id === id || desc.session_id.endsWith(`-${id}`);

/**
 * rig stats. patch is null unless opts.suggest. With suggest, the text gains the proposal notes, and a non-empty
 * patch is also saved as proposals/<date>.patch under the state root. Nothing else is written; no config is edited.
 * `opts.units` is the composed stack's units (the command composes); `opts.now` (epoch ms) is for tests.
 * @param io injected writer; defaults to lib/fs.ts with world.ctx
 */
export function stats(world: object, opts: {since?: string, harness?: string, suggest?: boolean, units?: object[], now?: number} = {}, io: Io = ioOf(world)): {text: string, patch: string | null} {
  const nowMs = opts.now ?? Date.now();
  const since = opts.since ?? DEFAULT_SINCE;
  const cutoffMs = nowMs - parseSince(since);
  const state = world.env.state;
  const latest = readStore(state);
  const dropped = new Map();
  let read = 0, written = 0, failed = 0;

  for (const { harness, reader, root } of transcriptTargets(world)) {
    if (opts.harness && opts.harness !== harness) continue;
    for (const desc of reader.discover(root)) {
      if (desc.mtimeMs < cutoffMs) continue;
      try {
        const session = reader.read(desc);
        if (!session.end || Date.parse(session.end) < cutoffMs) continue;
        read += 1;
        for (const path of session.dropped) (dropped.get(harness) ?? dropped.set(harness, new Set()).get(harness)).add(path);
        if (record({ harness, reader: readerId(reader), session, source: "stats", latest, io }).written) written += 1;
      } catch (err) {
        failed += 1;
        safeLog(io, { event: "metrics.stats.session-error", harness, code: err?.code ?? "E_METRICS_READ" });
      }
    }
  }
  safeLog(io, { event: "metrics.stats", read, written, failed });

  const lines = [...latest.values()].filter((line) => {
    if (opts.harness && line.harness !== opts.harness) return false;
    const end = Date.parse(line.end ?? "");
    return Number.isFinite(end) && end >= cutoffMs;
  });
  const costSource = (id) => READERS.get(id.split("@")[0])?.costSource ?? null;
  const text = renderReport({ since, cutoff: new Date(cutoffMs).toISOString(), lines, dropped, costSource });
  if (!opts.suggest) return { text, patch: null };
  return suggest(world, { lines, units: opts.units ?? [], nowMs, text }, io);
}

function suggest(world, { lines, units, nowMs, text }, io) {
  const { notes, patch } = propose({ lines, units, world });
  const out = [text, "suggestions (a proposed diff; rig applies nothing)"];
  out.push(...(notes.length ? notes.map((n) => `  ${n}`) : ["  none"]));
  if (patch === null) return { text: `${out.join("\n")}\n`, patch: null };
  const rel = `${PROPOSALS_DIR}/${new Date(nowMs).toISOString().slice(0, 10)}.patch`;
  io.write(rel, patch);
  safeLog(io, { event: "metrics.suggest", notes: notes.length });
  out.push(`  saved to ${rel} in the state root; apply it in the repo root with git apply, commit, then run rig apply`);
  return { text: `${out.join("\n")}\n`, patch };
}

function findByPath(world, transcriptPath) {
  const file = realpathOrNull(transcriptPath);
  if (!file || !statSync(file).isFile()) throw new MetricsError("E_TRANSCRIPT_PATH");
  for (const { harness, reader, root } of transcriptTargets(world)) {
    const rootReal = realpathOrNull(root);
    if (!rootReal) continue;
    const rel = relative(rootReal, file);
    if (rel.startsWith("..") || isAbsolute(rel)) continue;
    const desc = reader.describe(rootReal, file);
    if (desc) return { harness, reader, desc };
  }
  throw new MetricsError("E_TRANSCRIPT_PATH");
}

function findBySession(world, id) {
  for (const { harness, reader, root } of transcriptTargets(world)) {
    const desc = reader.discover(root).find((d) => sessionMatches(d, id));
    if (desc) return { harness, reader, desc };
  }
  throw new MetricsError("E_SESSION_NOT_FOUND");
}

function recordOne(world, { harness, reader, desc }, io) {
  const session = reader.read(desc);
  return record({ harness, reader: readerId(reader), session, source: "record", latest: readStore(world.env.state), io });
}

/**
 * rig stats --record. From stdin (hook mode: never throws, never prints, returns 0) or from a named session (by hand).
 * @param io injected writer; defaults to lib/fs.ts with world.ctx
 */
export function recordSession(world: object | null, input: {stdin: Uint8Array} | {session: string}, io: Io = world ? ioOf(world) : NO_IO): 0 | 1 {
  if ("session" in input) return recordByHand(world, input.session, io);
  try {
    if (!world) return 0;
    try {
      const payload = parseHookPayload(input.stdin);
      const found = findByPath(world, payload.transcript_path);
      if (!sessionMatches(found.desc, payload.session_id)) throw new MetricsError("E_SESSION_MISMATCH");
      recordOne(world, found, io);
    } catch (err) {
      safeLog(io, { event: "metrics.record.error", code: err?.code ?? "E_METRICS_RECORD" });
    }
  } catch {
    // hook mode never throws
  }
  return 0;
}

function parseHookPayload(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length > MAX_HOOK_PAYLOAD_BYTES) throw new MetricsError("E_HOOK_PAYLOAD");
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new MetricsError("E_HOOK_PAYLOAD");
  }
  if (typeof payload?.session_id !== "string" || typeof payload?.transcript_path !== "string" || !payload.session_id) {
    throw new MetricsError("E_HOOK_PAYLOAD");
  }
  return payload;
}

function recordByHand(world, id, io) {
  try {
    if (!world || typeof id !== "string" || !id) throw new MetricsError("E_USAGE");
    const found = findBySession(world, id);
    const { line, written } = recordOne(world, found, io);
    process.stdout.write(`${written ? "recorded" : "unchanged"} ${found.harness} ${line.session_id}\n`);
    return 0;
  } catch (err) {
    process.stderr.write(`rig stats --record: ${err?.code ?? "E_METRICS_RECORD"}\n`);
    return 1;
  }
}
