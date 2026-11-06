// Codex rollouts: <root>/**/rollout-*.jsonl, one session per file.
// Rules (measured by the slice 0 prototype):
//  - input_tokens already includes cached tokens, so the cache hit rate is cached / input;
//  - cache write is always 0 and there is no cost: both stay absent (n/a);
//  - token_count events repeat, so a repeat of the same running total is skipped, and lines of
//    forked history (ordinal below subagent_history_start_ordinal) are skipped;
//  - skill uses are the <skill> blocks Codex injects for an explicit $name, and shell calls whose command points into an
//    installed skill dir (how Codex reads a skill it picks itself).
import { basename, relative, sep } from "node:path";
import { assertSafeSpec, projectLine, units } from "../project.ts";
import { NO_REFS } from "../unit-paths.ts";
import type { UnitRefs } from "../unit-paths.ts";
import { jsonlObjects, mtimeMs, span, toIso, walk } from "../jsonl.ts";
import { addUsage, inc, incCalls, isNum, orderModels, sortKeys } from "../agg.ts";

export const format = "codex-rollout";
export const version = 2;
export const costSource = null;

const TOKENS = { input_tokens: true, cached_input_tokens: true, output_tokens: true, total_tokens: true };
export const spec = {
  type: true, timestamp: true, ordinal: true,
  payload: {
    type: true, id: true, cwd: "HASH", model: true, name: true, call_id: true, subagent_history_start_ordinal: true,
    info: { total_token_usage: TOKENS, last_token_usage: TOKENS },
    collaboration_mode: { settings: { model: true } },
    arguments: units(), input: units(),
    content: { type: true, text: units({ startsWith: "<skill>", within: /<path>[^<\n]*<\/path>/g }) },
  },
};
assertSafeSpec(spec, "codex-rollout");

const SHELL_CALLS = new Set(["exec", "exec_command", "shell"]);
const isRollout = (path) => /rollout-.*\.jsonl$/.test(basename(path));

export function describe(root, file) {
  if (relative(root, file).split(sep)[0] === ".." || !isRollout(file)) return null;
  return { file, session_id: basename(file, ".jsonl"), mtimeMs: mtimeMs(file) };
}

export function discover(root) {
  return walk(root, isRollout).map((file) => describe(root, file));
}

export function read(desc, refs: UnitRefs = NO_REFS) {
  const sink = new Set();
  const models = {}, tools = {}, skills = {}, calls = new Set(), injected = new Set(), stamps = [];
  let sessionId = desc.session_id, project = null, startOrdinal = null;
  let model = null, lastKey = null, compactions = 0;

  for (const raw of jsonlObjects(desc.file)) {
    const line = projectLine(raw, spec, sink, refs);
    const ts = toIso(line.timestamp);
    if (ts) stamps.push(ts);
    const payload = line.payload ?? {};

    if (line.type === "session_meta") {
      sessionId = payload.id ?? sessionId;
      project = payload.cwd ?? project;
      startOrdinal = payload.subagent_history_start_ordinal ?? null;
    } else if (line.type === "turn_context") {
      model = payload.model ?? payload.collaboration_mode?.settings?.model ?? model;
    } else if (line.type === "compacted") {
      compactions += 1;
    } else if (line.type === "response_item" && (payload.type === "function_call" || payload.type === "custom_tool_call")) {
      if (payload.call_id && !calls.has(payload.call_id)) {
        calls.add(payload.call_id);
        incCalls(tools, payload.name ?? "_unknown");
        if (SHELL_CALLS.has(payload.name)) for (const unit of [...(payload.arguments ?? []), ...(payload.input ?? [])]) inc(skills, unit);
      }
    } else if (line.type === "response_item" && payload.type === "message" && Array.isArray(payload.content)) {
      if (payload.id && injected.has(payload.id)) continue;
      if (payload.id) injected.add(payload.id);
      for (const block of payload.content) for (const unit of block.text ?? []) inc(skills, unit);
    } else if (line.type === "event_msg" && payload.type === "token_count" && payload.info) {
      if (startOrdinal !== null && isNum(line.ordinal) && line.ordinal < startOrdinal) continue;
      const total = payload.info.total_token_usage ?? {};
      const key = [total.input_tokens, total.output_tokens, total.cached_input_tokens, total.total_tokens].join(",");
      if (key === lastKey) continue;
      lastKey = key;
      const last = payload.info.last_token_usage ?? {};
      addUsage(models, model ?? "_unknown", { input: last.input_tokens, output: last.output_tokens, cache_read: last.cached_input_tokens });
    }
  }

  const { start, end } = span(stamps);
  return {
    session_id: sessionId, project, start, end, models: orderModels(models), side_usage: {}, cost_usd: null,
    tools: sortKeys(tools), skills: sortKeys(skills), agents: null, compactions, hook_bytes: null,
    dropped: [...sink].sort(),
  };
}
