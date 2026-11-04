// Claude Code transcripts: <root>/<project>/<session>.jsonl, subagents under <session>/subagents/**.jsonl.
// Rules (measured by the slice 0 prototype):
//  - usage repeats once per content block, so one message.id is one request and the LAST line wins;
//  - every subagent file under the session directory counts once, linked or not;
//  - usage.iterations entries of type advisor_message are other-model calls: a side bucket, never top-level usage;
//  - skill loads come from Skill tool calls, never from attributionSkill (it is sticky per message).
import { basename, dirname, join, relative, sep } from "node:path";
import { assertSafeSpec, projectLine, sha256Short } from "../project.mjs";
import { jsonlObjects, listDirs, listFiles, mtimeMs, realpathOrNull, span, toIso, walk } from "../jsonl.mjs";
import { addUsage, inc, incTool, isNum, orderModels, round6, sortKeys } from "../agg.mjs";

export const format = "claude-jsonl";
export const version = 1;
export const costSource = "cost-state record in the transcript";

const USAGE = {
  input_tokens: true, output_tokens: true, cache_read_input_tokens: true, cache_creation_input_tokens: true,
};
export const spec = {
  type: true, subtype: true, uuid: true, timestamp: true, requestId: true,
  message: {
    id: true, model: true, role: true,
    usage: { ...USAGE, iterations: { ...USAGE, type: true, model: true } },
    content: { type: true, id: true, name: true, tool_use_id: true, is_error: true, input: { skill: true, subagent_type: true, effort: true } },
  },
  attachment: { type: true, hookEvent: true, stdout: "LEN" },
  totalCostUSD: true,
};
assertSafeSpec(spec, "claude-jsonl");

const hasJsonl = (name) => name.endsWith(".jsonl");

export function describe(root, file) {
  const rel = relative(root, file).split(sep);
  if (rel.length !== 2 || !hasJsonl(rel[1])) return null;
  return { file, session_id: basename(file, ".jsonl"), project: rel[0], mtimeMs: mtimeMs(file) };
}

export function discover(root) {
  const out = [];
  for (const project of listDirs(root)) {
    for (const file of listFiles(join(root, project), hasJsonl)) out.push(describe(root, file));
  }
  return out.filter(Boolean);
}

function usageFields(u) {
  return { input: u.input_tokens, output: u.output_tokens, cache_read: u.cache_read_input_tokens, cache_write: u.cache_creation_input_tokens };
}

export function read(desc) {
  const sink = new Set();
  const sessionDir = join(dirname(desc.file), desc.session_id, "subagents");
  const files = [desc.file];
  const seenFiles = new Set([realpathOrNull(desc.file) ?? desc.file]);
  for (const sub of walk(sessionDir, hasJsonl)) {
    const key = realpathOrNull(sub) ?? sub;
    if (!seenFiles.has(key)) {
      seenFiles.add(key);
      files.push(sub);
    }
  }

  const requests = new Map(); // message id -> last usage-bearing line
  let anonymous = 0;
  const toolNames = new Map(); // tool_use id -> tool name; also the "counted once" set
  const errorsDone = new Set();
  const tools = {}, skills = {}, agents = {}, hookBytes = {};
  const seenHooks = new Set(), seenCompactions = new Set();
  const stamps = [];
  let cost = null;

  files.forEach((file, index) => {
    for (const raw of jsonlObjects(file)) {
      const line = projectLine(raw, spec, sink);
      const ts = toIso(line.timestamp);
      if (ts) stamps.push(ts);
      const message = line.message;

      // "<synthetic>" fails the identifier shape check, so test the raw value against the constant only.
      const synthetic = raw.message?.model === "<synthetic>";
      if (line.type === "assistant" && message?.usage && !synthetic) {
        const id = message.id ?? (line.requestId ? `req:${line.requestId}` : line.uuid ? `uuid:${line.uuid}` : `anon:${anonymous++}`);
        requests.set(id, { model: message.model, usage: message.usage });
      }
      for (const block of Array.isArray(message?.content) ? message.content : []) {
        if (block.type === "tool_use" && block.id && !toolNames.has(block.id)) {
          const name = block.name ?? "_unknown";
          toolNames.set(block.id, name);
          incTool(tools, name, false);
          if (name === "Skill" && block.input?.skill) inc(skills, block.input.skill);
          if (name === "Agent" || name === "Task") {
            const entry = (agents[block.input?.subagent_type ?? "_unknown"] ??= { dispatches: 0, effort: {} });
            entry.dispatches += 1;
            inc(entry.effort, block.input?.effort ?? "n/a");
          }
        }
        if (block.type === "tool_result" && block.is_error === true && toolNames.has(block.tool_use_id) && !errorsDone.has(block.tool_use_id)) {
          errorsDone.add(block.tool_use_id);
          tools[toolNames.get(block.tool_use_id)][1] += 1;
        }
      }
      if (line.type === "system" && line.subtype === "compact_boundary" && line.uuid) seenCompactions.add(line.uuid);
      const attachment = line.attachment;
      if (attachment?.type === "hook_success" && line.uuid && !seenHooks.has(line.uuid)) {
        seenHooks.add(line.uuid);
        if (isNum(attachment.stdout)) inc(hookBytes, attachment.hookEvent ?? "_unknown", attachment.stdout);
      }
      if (index === 0 && line.type === "cost-state" && isNum(line.totalCostUSD)) cost = line.totalCostUSD;
    }
  });

  const models = {}, side = {};
  for (const { model, usage } of requests.values()) {
    addUsage(models, model ?? "_unknown", usageFields(usage));
    for (const it of usage.iterations ?? []) {
      if (it.type === "advisor_message") addUsage(side, it.model ?? "_unknown", usageFields(it));
    }
  }
  const { start, end } = span(stamps);
  return {
    session_id: desc.session_id, project: sha256Short(desc.project), start, end,
    models: orderModels(models), side_usage: orderModels(side),
    cost_usd: cost === null ? null : round6(cost),
    tools: sortKeys(tools), skills: sortKeys(skills), agents: sortKeys(agents),
    compactions: seenCompactions.size, hook_bytes: sortKeys(hookBytes),
    dropped: [...sink].sort(),
  };
}
