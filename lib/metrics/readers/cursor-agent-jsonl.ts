// Cursor agent transcripts, one session each: <root>/*/agent-transcripts/<id>.jsonl, or <id>/<id>.jsonl with the
// session's subagent files in <id>/subagents/*.jsonl (the layout current Cursor writes). Each subagent file counts once.
// Cursor writes no token or cost data here: the reader keeps invocation counts (assistant turns, as
// requests per model), model mix when a model field exists, and tool calls. It never reads
// chats/** or any .db file: discovery only globs the patterns above. Skill uses are the skills the user attaches by
// hand and read or shell calls whose path or command points into an installed skill dir.
import { basename, dirname, join, relative, sep } from "node:path";
import { statSync } from "node:fs";
import { assertSafeSpec, projectLine, sha256Short, units } from "../project.ts";
import { NO_REFS } from "../unit-paths.ts";
import type { UnitRefs } from "../unit-paths.ts";
import { jsonlObjects, listDirs, listFiles, mtimeMs, span, toIso } from "../jsonl.ts";
import { addUsage, inc, incCalls, orderModels, sortKeys } from "../agg.ts";

export const format = "cursor-agent-jsonl";
export const version = 2;
export const costSource = null;

export const spec = {
  role: true, type: true, timestamp: true, model: true,
  message: {
    role: true, model: true,
    content: {
      type: true, name: true,
      text: units({ startsWith: "<manually_attached_skills>", within: /^Path: .*$/gm }),
      input: { path: units(), command: units() },
    },
  },
};
assertSafeSpec(spec, "cursor-agent-jsonl");

const PATH_TOOLS = new Set(["Read", "ReadFile", "Shell"]);
const isTranscript = (name) => name.endsWith(".jsonl");

export function describe(root, file) {
  const rel = relative(root, file).split(sep);
  if (rel[1] !== "agent-transcripts" || !isTranscript(rel.at(-1))) return null;
  const id = basename(file, ".jsonl");
  if (rel.length === 3) return { file, session_id: id, project: rel[0], mtimeMs: mtimeMs(file), subagents: null };
  if (rel.length !== 4 || rel[2] !== id) return null;
  const subagents = join(dirname(file), "subagents");
  const newest = Math.max(mtimeMs(file), ...listFiles(subagents, isTranscript).map(mtimeMs));
  return { file, session_id: id, project: rel[0], mtimeMs: newest, subagents };
}

export function discover(root) {
  const out = [];
  for (const project of listDirs(root)) {
    const dir = join(root, project, "agent-transcripts");
    for (const file of listFiles(dir, isTranscript)) out.push(describe(root, file));
    for (const id of listDirs(dir)) for (const file of listFiles(join(dir, id), (n) => n === `${id}.jsonl`)) out.push(describe(root, file));
  }
  return out.filter(Boolean);
}

export function read(desc, refs: UnitRefs = NO_REFS) {
  const sink = new Set();
  const models = {}, tools = {}, skills = {}, stamps = [];
  const files = [desc.file, ...(desc.subagents ? listFiles(desc.subagents, isTranscript) : [])];
  for (const raw of files.flatMap((f) => [...jsonlObjects(f)])) {
    const line = projectLine(raw, spec, sink, refs);
    const ts = toIso(line.timestamp);
    if (ts) stamps.push(ts);
    const role = line.role ?? line.message?.role;
    if (role === "assistant") addUsage(models, line.model ?? line.message?.model ?? "_unknown", {});
    for (const block of Array.isArray(line.message?.content) ? line.message.content : []) {
      if (block.type === "tool_use") {
        incCalls(tools, block.name ?? "_unknown");
        if (PATH_TOOLS.has(block.name)) for (const unit of [...(block.input?.path ?? []), ...(block.input?.command ?? [])]) inc(skills, unit);
      } else if (block.type === "text" && role === "user") {
        for (const unit of block.text ?? []) inc(skills, unit);
      }
    }
  }
  let { start, end } = span(stamps);
  if (!start) {
    const st = statSync(desc.file, { throwIfNoEntry: false });
    if (st) {
      start = toIso(st.birthtimeMs || st.mtimeMs);
      end = toIso(st.mtimeMs);
    }
  }
  return {
    session_id: desc.session_id, project: sha256Short(desc.project), start, end,
    models: orderModels(models), side_usage: {}, cost_usd: null,
    tools: sortKeys(tools), skills: sortKeys(skills), agents: null, compactions: null, hook_bytes: null,
    dropped: [...sink].sort(),
  };
}
