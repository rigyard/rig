// Cursor agent transcripts: <root>/*/agent-transcripts/*.jsonl, one session per file.
// Cursor writes no token or cost data here: the reader keeps invocation counts (assistant turns, as
// requests per model), model mix when a model field exists, and tool calls. It never reads
// chats/** or any .db file: discovery only globs the pattern above.
import { basename, join, relative, sep } from "node:path";
import { statSync } from "node:fs";
import { assertSafeSpec, projectLine, sha256Short } from "../project.mjs";
import { jsonlObjects, listDirs, listFiles, mtimeMs, span, toIso } from "../jsonl.mjs";
import { addUsage, incCalls, orderModels, sortKeys } from "../agg.mjs";

export const format = "cursor-agent-jsonl";
export const version = 1;
export const costSource = null;

export const spec = {
  role: true, type: true, timestamp: true, model: true,
  message: { role: true, model: true, content: { type: true, name: true } },
};
assertSafeSpec(spec, "cursor-agent-jsonl");

const isTranscript = (name) => name.endsWith(".jsonl");

export function describe(root, file) {
  const rel = relative(root, file).split(sep);
  if (rel.length !== 3 || rel[1] !== "agent-transcripts" || !isTranscript(rel[2])) return null;
  return { file, session_id: basename(file, ".jsonl"), project: rel[0], mtimeMs: mtimeMs(file) };
}

export function discover(root) {
  const out = [];
  for (const project of listDirs(root)) {
    for (const file of listFiles(join(root, project, "agent-transcripts"), isTranscript)) out.push(describe(root, file));
  }
  return out.filter(Boolean);
}

export function read(desc) {
  const sink = new Set();
  const models = {}, tools = {}, stamps = [];
  for (const raw of jsonlObjects(desc.file)) {
    const line = projectLine(raw, spec, sink);
    const ts = toIso(line.timestamp);
    if (ts) stamps.push(ts);
    const role = line.role ?? line.message?.role;
    if (role === "assistant") addUsage(models, line.model ?? line.message?.model ?? "_unknown", {});
    for (const block of Array.isArray(line.message?.content) ? line.message.content : []) {
      if (block.type === "tool_use") incCalls(tools, block.name ?? "_unknown");
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
    tools: sortKeys(tools), skills: null, agents: null, compactions: null, hook_bytes: null,
    dropped: [...sink].sort(),
  };
}
