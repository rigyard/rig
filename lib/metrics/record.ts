// record(): turn one reader result into a MetricsLine and append it unless the store already holds the same fact.
import { STORE_FILE, keyOf } from "./store.ts";
import { isNum } from "./agg.ts";

export const MAX_LINE_BYTES = 4096;

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const sameFact = (a, b) => {
  const { source: _a, ...restA } = a;
  const { source: _b, ...restB } = b;
  return stable(restA) === stable(restB);
};

const sumOpt = (a, b) => (isNum(a) && isNum(b) ? a + b : isNum(a) ? a : isNum(b) ? b : null);

// Each folder merges entry `from` into entry `into` and says how heavy an entry is.
const FOLDERS = {
  tools: {
    weight: (e) => e[0],
    fold: (into = [0, 0], e) => [into[0] + e[0], into[1] === null || e[1] === null ? null : into[1] + e[1]],
  },
  skills: { weight: (e) => e, fold: (into = 0, e) => into + e },
  hook_bytes: { weight: (e) => e, fold: (into = 0, e) => into + e },
  agents: {
    weight: (e) => e.dispatches,
    fold: (into = { dispatches: 0, effort: {} }, e) => {
      const effort = { ...into.effort };
      for (const [k, n] of Object.entries(e.effort)) effort[k] = (effort[k] ?? 0) + n;
      return { dispatches: into.dispatches + e.dispatches, effort };
    },
  },
  models: { weight: (e) => e.requests, fold: foldUsage },
  side_usage: { weight: (e) => e.requests, fold: foldUsage },
};

function foldUsage(into = { requests: 0 }, e) {
  const out = {};
  for (const f of ["input", "output", "cache_read", "cache_write"]) {
    const v = sumOpt(into[f], e[f]);
    if (v !== null) out[f] = v;
  }
  out.requests = into.requests + e.requests;
  return out;
}

const byteLength = (line) => Buffer.byteLength(JSON.stringify(line)) + 1;

/** Keep the largest entries of each map and fold the rest into `_other` until the line fits. */
export function fitLine(line) {
  while (byteLength(line) >= MAX_LINE_BYTES) {
    let field = null;
    let fieldBytes = -1;
    for (const name of Object.keys(FOLDERS)) {
      const map = line[name];
      if (!map || !Object.keys(map).some((k) => k !== "_other")) continue;
      const bytes = JSON.stringify(map).length;
      if (bytes > fieldBytes) {
        field = name;
        fieldBytes = bytes;
      }
    }
    if (!field) return line; // nothing left to fold
    const folder = FOLDERS[field];
    const map = line[field];
    const keys = Object.keys(map).filter((k) => k !== "_other");
    keys.sort((a, b) => folder.weight(map[a]) - folder.weight(map[b]) || (a < b ? 1 : -1));
    map._other = folder.fold(map._other, map[keys[0]]);
    delete map[keys[0]];
  }
  return line;
}

export function buildLine(harness, readerId, session, source) {
  const line = {
    schema: 1, harness, session_id: session.session_id, project: session.project ?? null, source,
    start: session.start ?? null, end: session.end ?? null, reader: readerId,
    models: session.models,
  };
  if (session.side_usage && Object.keys(session.side_usage).length) line.side_usage = session.side_usage;
  Object.assign(line, {
    cost_usd: session.cost_usd, tools: session.tools, skills: session.skills, agents: session.agents,
    compactions: session.compactions, hook_bytes: session.hook_bytes,
  });
  return fitLine(line);
}

/**
 * The only writer of metrics.jsonl. `latest` is the in-memory last-line-per-key map of the store and is kept in step.
 * `io.append(rel, text)` does one O_APPEND write; the text ends in a newline.
 */
export function record({ harness, reader, session, source, latest, io }): {line: object, written: boolean} {
  const line = buildLine(harness, reader, session, source);
  const key = keyOf(harness, line.session_id);
  const previous = latest.get(key);
  if (previous && sameFact(previous, line)) return { line: previous, written: false };
  io.append(STORE_FILE, JSON.stringify(line) + "\n");
  latest.set(key, line);
  return { line, written: true };
}
