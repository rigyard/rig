// omp sessions: <root>/**/*.jsonl, one session per file.
// Rules (measured by the slice 0 prototype): omp records its own cost per message and logs side calls as
// model_usage records. A side call goes to the side bucket. Lines dedupe by their own id.
import { basename, dirname, relative, sep } from "node:path";
import { assertSafeSpec, projectLine, sha256Short } from "../project.mjs";
import { jsonlObjects, mtimeMs, span, toIso, walk } from "../jsonl.mjs";
import { addUsage, inc, incTool, isNum, orderModels, round6, sortKeys } from "../agg.mjs";

export const format = "omp-jsonl";
export const version = 1;
export const costSource = "recorded by the harness per call";

const USAGE = { input: true, output: true, cacheRead: true, cacheWrite: true, cost: { total: true } };
export const spec = {
  type: true, id: true, timestamp: true, customType: true, model: true,
  usage: USAGE, details: { name: true },
  message: { role: true, model: true, toolName: true, isError: true, usage: USAGE },
};
assertSafeSpec(spec, "omp-jsonl");

const isSession = (path) => path.endsWith(".jsonl");

export function describe(root, file) {
  if (relative(root, file).split(sep)[0] === ".." || !isSession(file)) return null;
  return { file, session_id: basename(file, ".jsonl"), project: basename(dirname(file)), mtimeMs: mtimeMs(file) };
}

export function discover(root) {
  return walk(root, isSession).map((file) => describe(root, file));
}

const fields = (u) => ({ input: u.input, output: u.output, cache_read: u.cacheRead, cache_write: u.cacheWrite });

export function read(desc) {
  const sink = new Set();
  const models = {}, side = {}, tools = {}, skills = {}, seen = new Set(), stamps = [];
  let cost = null, compactions = 0;
  const addCost = (usage) => {
    if (isNum(usage.cost?.total)) cost = (cost ?? 0) + usage.cost.total;
  };

  for (const raw of jsonlObjects(desc.file)) {
    const line = projectLine(raw, spec, sink);
    const ts = toIso(line.timestamp);
    if (ts) stamps.push(ts);
    if (line.id) {
      if (seen.has(line.id)) continue;
      seen.add(line.id);
    }
    const message = line.message;
    if (line.type === "message" && message?.role === "assistant" && message.usage) {
      addUsage(models, message.model ?? "_unknown", fields(message.usage));
      addCost(message.usage);
    } else if (line.type === "message" && message?.role === "toolResult") {
      incTool(tools, message.toolName ?? "_unknown", message.isError === true);
    } else if (line.type === "model_usage" && line.usage) {
      addUsage(side, line.model ?? "_unknown", fields(line.usage));
      addCost(line.usage);
    } else if (line.type === "custom_message" && line.customType === "skill-prompt") {
      inc(skills, line.details?.name ?? "_unknown");
    } else if (line.type === "compaction") {
      compactions += 1;
    }
  }

  const { start, end } = span(stamps);
  return {
    session_id: desc.session_id, project: sha256Short(desc.project), start, end,
    models: orderModels(models), side_usage: orderModels(side),
    cost_usd: cost === null ? null : round6(cost),
    tools: sortKeys(tools), skills: sortKeys(skills), agents: null, compactions, hook_bytes: null,
    dropped: [...sink].sort(),
  };
}
