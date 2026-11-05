// The text of `rig stats`: aggregates the store lines of the window per harness, plus the alias resolution history.
// A field that no session supplied prints as n/a; it is never summed as 0.
import { isNum } from "./agg.mjs";

const fmt = (n) => (isNum(n) ? String(n) : "n/a");
const pct = (n) => (isNum(n) ? `${(n * 100).toFixed(1)}%` : "n/a");
const USAGE_FIELDS = ["input", "output", "cache_read", "cache_write"];

/** Fraction of input served from cache. Codex input_tokens already includes cached tokens. */
export function cacheHit(readerId, m) {
  if (readerId.startsWith("codex-rollout")) {
    return isNum(m.input) && isNum(m.cache_read) && m.input > 0 ? m.cache_read / m.input : null;
  }
  if (!isNum(m.input) || !isNum(m.cache_read) || !isNum(m.cache_write)) return null;
  const denominator = m.input + m.cache_read + m.cache_write;
  return denominator > 0 ? m.cache_read / denominator : null;
}

function addOpt(a, b) {
  return isNum(b) ? (isNum(a) ? a + b : b) : a;
}

function mergeUsage(into, entry) {
  const out = into ?? { requests: 0 };
  for (const f of USAGE_FIELDS) if (isNum(entry[f])) out[f] = addOpt(out[f], entry[f]);
  out.requests += entry.requests ?? 0;
  return out;
}

function aggregate(lines) {
  const agg = {
    sessions: lines.length, models: {}, side: {}, cost: null, costSessions: 0, tools: {},
    skills: null, agents: null, compactions: null, hooks: null,
  };
  for (const line of lines) {
    for (const [k, v] of Object.entries(line.models ?? {})) agg.models[k] = mergeUsage(agg.models[k], v);
    for (const [k, v] of Object.entries(line.side_usage ?? {})) agg.side[k] = mergeUsage(agg.side[k], v);
    if (isNum(line.cost_usd)) {
      agg.cost = addOpt(agg.cost, line.cost_usd);
      agg.costSessions += 1;
    }
    for (const [k, [calls, errors]] of Object.entries(line.tools ?? {})) {
      const t = (agg.tools[k] ??= { calls: 0, errors: 0 });
      t.calls += calls;
      t.errors = isNum(t.errors) && isNum(errors) ? t.errors + errors : null;
    }
    if (line.skills) {
      agg.skills ??= {};
      for (const [k, n] of Object.entries(line.skills)) agg.skills[k] = (agg.skills[k] ?? 0) + n;
    }
    if (line.agents) {
      agg.agents ??= {};
      for (const [k, v] of Object.entries(line.agents)) {
        const a = (agg.agents[k] ??= { dispatches: 0, effort: {} });
        a.dispatches += v.dispatches;
        for (const [e, n] of Object.entries(v.effort ?? {})) a.effort[e] = (a.effort[e] ?? 0) + n;
      }
    }
    agg.compactions = addOpt(agg.compactions, line.compactions);
    if (line.hook_bytes) {
      agg.hooks ??= {};
      for (const [k, n] of Object.entries(line.hook_bytes)) agg.hooks[k] = (agg.hooks[k] ?? 0) + n;
    }
  }
  return agg;
}

function usageRow(readerId, name, m) {
  return `    ${name}  requests ${fmt(m.requests)}  input ${fmt(m.input)}  output ${fmt(m.output)}  cache_read ${fmt(m.cache_read)}  cache_write ${fmt(m.cache_write)}  cache_hit ${pct(cacheHit(readerId, m))}`;
}

/** A Claude model id names its alias family: `opus` resolves to `claude-opus-<version>`. */
const ALIAS_FAMILY = /^claude-([a-z]+)-/;

/** Per alias family, the model ids the window's sessions ran, oldest first, with the first and last day seen. */
function aliasHistory(group) {
  const families = new Map();
  for (const line of group) {
    const first = (line.start ?? line.end ?? "").slice(0, 10);
    const last = (line.end ?? line.start ?? "").slice(0, 10);
    for (const id of Object.keys(line.models ?? {})) {
      const family = ALIAS_FAMILY.exec(id)?.[1];
      if (!family || !first) continue;
      const ids = families.get(family) ?? families.set(family, new Map()).get(family);
      const span = ids.get(id) ?? { first, last };
      if (first < span.first) span.first = first;
      if (last > span.last) span.last = last;
      ids.set(id, span);
    }
  }
  if (!families.size) return "n/a";
  return [...families.keys()].sort().map((family) => {
    const ids = [...families.get(family)].sort(([x, a], [y, b]) => (a.first < b.first ? -1 : a.first > b.first ? 1 : x < y ? -1 : 1));
    return `${family} ${ids.map(([id, d]) => `${id} (${d.first}${d.last === d.first ? "" : ` to ${d.last}`})`).join(" -> ")}`;
  }).join("; ");
}

const ranked = (map, count) => Object.entries(map).sort(([, a], [, b]) => count(b) - count(a)).map(([k, v]) => `${k} ${count(v)}`);

/**
 * @param {{since: string, cutoff: string, lines: object[], dropped: Map<string, Set<string>>, costSource: (reader: string) => string | null}} input
 */
export function renderReport({ since, cutoff, lines, dropped, costSource }) {
  const out = [`rig stats  window ${since} (from ${cutoff})`];
  const byHarness = new Map();
  for (const line of lines) {
    if (!byHarness.has(line.harness)) byHarness.set(line.harness, []);
    byHarness.get(line.harness).push(line);
  }
  if (!byHarness.size) out.push("no sessions in the window");
  for (const harness of [...byHarness.keys()].sort()) {
    const group = byHarness.get(harness);
    const readerId = group[0].reader ?? "";
    const a = aggregate(group);
    out.push("", `${harness}  [${readerId}]  ${a.sessions} session${a.sessions === 1 ? "" : "s"}`);
    out.push("  models");
    const names = Object.keys(a.models).sort();
    if (!names.length) out.push("    n/a");
    for (const name of names) out.push(usageRow(readerId, name, a.models[name]));
    if (Object.keys(a.side).length) {
      out.push("  side usage (calls outside the main conversation, not in the rows above)");
      for (const name of Object.keys(a.side).sort()) out.push(usageRow(readerId, name, a.side[name]));
    }
    out.push(`  alias history: ${aliasHistory(group)}`);
    const source = costSource(readerId);
    if (a.cost === null) out.push(`  cost: n/a${source ? "" : " (the harness records no cost)"}`);
    else out.push(`  cost: USD ${a.cost.toFixed(2)} (${source ?? "recorded"}; ${a.costSessions} of ${a.sessions} sessions have a cost)`);
    const toolNames = Object.keys(a.tools);
    if (!toolNames.length) out.push("  tools: none");
    else {
      const calls = toolNames.reduce((n, k) => n + a.tools[k].calls, 0);
      const known = toolNames.every((k) => isNum(a.tools[k].errors));
      const errors = known ? toolNames.reduce((n, k) => n + a.tools[k].errors, 0) : null;
      out.push(`  tools: ${calls} calls, error rate ${known && calls ? pct(errors / calls) : "n/a"}`);
      out.push(`    ${ranked(a.tools, (t) => t.calls).slice(0, 12).join(", ")}`);
    }
    out.push(`  skills: ${a.skills === null ? "n/a" : Object.keys(a.skills).length ? ranked(a.skills, (n) => n).join(", ") : "none"}`);
    if (a.agents === null) out.push("  agents: n/a");
    else {
      const rows = Object.entries(a.agents).sort(([x], [y]) => (x < y ? -1 : 1))
        .map(([k, v]) => `${k} ${v.dispatches} (effort ${Object.entries(v.effort).map(([e, n]) => `${e} ${n}`).join(", ") || "n/a"})`);
      out.push(`  agents: ${rows.join("; ") || "none"}`);
    }
    out.push(`  compactions: ${fmt(a.compactions)}`);
    out.push(`  hook output bytes: ${a.hooks === null ? "n/a" : Object.keys(a.hooks).length ? Object.entries(a.hooks).map(([k, n]) => `${k} ${n}`).join(", ") : "none"}`);
  }
  const drops = [...dropped.entries()].filter(([, set]) => set.size);
  if (drops.length) {
    out.push("", "dropped keys (not in the allowlist; names only, values never read)");
    for (const [harness, set] of drops) {
      const list = [...set].sort();
      out.push(`  ${harness}: ${list.slice(0, 40).join(", ")}${list.length > 40 ? `, and ${list.length - 40} more` : ""}`);
    }
  }
  return out.join("\n") + "\n";
}
