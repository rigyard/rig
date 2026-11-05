// Small aggregation helpers shared by the readers. A field that no record
// supplied stays absent: nothing here turns "missing" into 0.
const USAGE_FIELDS = ["input", "output", "cache_read", "cache_write"];

export const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/** Add one request's usage to `map[model]`. `fields` may lack any key. */
export function addUsage(map, model, fields) {
  const entry = (map[model] ??= { requests: 0 });
  for (const f of USAGE_FIELDS) if (isNum(fields[f])) entry[f] = (entry[f] ?? 0) + fields[f];
  entry.requests += 1;
}

/** Canonical key order for a model entry. */
export function orderModels(map) {
  const out = {};
  for (const model of Object.keys(map).sort()) {
    const e = map[model];
    const ordered = {};
    for (const f of USAGE_FIELDS) if (isNum(e[f])) ordered[f] = e[f];
    ordered.requests = e.requests;
    out[model] = ordered;
  }
  return out;
}

export function inc(map, key, by = 1) {
  map[key] = (map[key] ?? 0) + by;
}

export function incTool(map, name, isError) {
  const entry = (map[name] ??= [0, 0]);
  entry[0] += 1;
  if (isError) entry[1] += 1;
}

export function sortKeys(map) {
  const out = {};
  for (const key of Object.keys(map).sort()) out[key] = map[key];
  return out;
}

export function round6(n) {
  return Math.round(n * 1e6) / 1e6;
}

/** A harness that gives no error flag: calls are known, errors are not. */
export function incCalls(map, name) {
  const entry = (map[name] ??= [0, null]);
  entry[0] += 1;
}
