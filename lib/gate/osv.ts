// refreshOsv: the only writer of cache/osv/<ecosystem>.json, which the cve check reads. It asks OSV about the
// dependencies in a pack's lockfiles and caches the advisories per manifest digest. It holds no network code:
// the caller passes the transport, so tests inject one and lib/lock.ts owns the real one.
//
// Per lockfile the cache entry is all or nothing. Any failed request writes nothing for that file, so the cve
// check keeps blocking on the missing result. A lockfile with no parser is reported and never cached.
import { createHash } from "node:crypto";
import { writeState } from "../fs.ts";
import { ecosystemOf } from "./cve.ts";
import type { Finding } from "../gate.ts";
import type { World } from "../world.ts";

/** POST when `body` is set, else GET. Resolves to the response text and throws on any failure. */
export type FetchFn = (url: string, body?: string) => Promise<string>;
type Dep = { name: string; version: string };
type Advisory = { id: string; severity: string };
type Lockfile = { pack: string; path: string; bytes: Uint8Array };

export const OSV_API = "https://api.osv.dev/v1";
const BATCH_SIZE = 1000;
const MAX_PAGES = 20;
const DETAIL_PARALLEL = 8;

const asRecord = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** @returns the name and version of every installed package in a package-lock.json of lockfileVersion 2 or 3 */
export function parseNpmLock(bytes: Uint8Array): Dep[] | string {
  let lock: Record<string, unknown>;
  try {
    lock = asRecord(JSON.parse(Buffer.from(bytes).toString("utf8")));
  } catch {
    return "it is not valid JSON";
  }
  if (lock.lockfileVersion !== 2 && lock.lockfileVersion !== 3) return `lockfileVersion ${JSON.stringify(lock.lockfileVersion ?? null)} is not 2 or 3`;
  const seen = new Set<string>();
  const deps: Dep[] = [];
  for (const [key, raw] of Object.entries(asRecord(lock.packages))) {
    const entry = asRecord(raw);
    if (key === "" || entry.link === true || typeof entry.version !== "string") continue;
    const marker = "node_modules/";
    const at = key.lastIndexOf(marker);
    const name = typeof entry.name === "string" ? entry.name : at === -1 ? "" : key.slice(at + marker.length);
    const id = `${name}@${entry.version}`;
    if (name === "" || seen.has(id)) continue;
    seen.add(id);
    deps.push({ name, version: entry.version });
  }
  return deps.sort((a, b) => (a.name + a.version < b.name + b.version ? -1 : 1));
}

/** Lockfile base name to its parser. The cve check knows more manifests than this table parses. */
const PARSERS: Record<string, (bytes: Uint8Array) => Dep[] | string> = { "package-lock.json": parseNpmLock };

const WEIGHTS = {
  AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 },
  AC: { L: 0.77, H: 0.44 },
  UI: { N: 0.85, R: 0.62 },
  CIA: { H: 0.56, L: 0.22, N: 0 },
} as const;

const roundUp = (x: number): number => {
  const n = Math.round(x * 100000);
  return n % 10000 === 0 ? n / 100000 : (Math.floor(n / 10000) + 1) / 10;
};

/** @returns the CVSS v3 base score of a vector, or null for any other CVSS version or a malformed vector */
export function cvss3Score(vector: string): number | null {
  const parts = vector.split("/");
  if (!/^CVSS:3\.[01]$/.test(parts[0] ?? "")) return null;
  const m = Object.fromEntries(parts.slice(1).map((p) => p.split(":") as [string, string]));
  const scopeChanged = m.S === "C";
  if (m.S !== "C" && m.S !== "U") return null;
  const av = (WEIGHTS.AV as Record<string, number>)[m.AV];
  const ac = (WEIGHTS.AC as Record<string, number>)[m.AC];
  const ui = (WEIGHTS.UI as Record<string, number>)[m.UI];
  const pr = ({ N: 0.85, L: scopeChanged ? 0.68 : 0.62, H: scopeChanged ? 0.5 : 0.27 } as Record<string, number>)[m.PR];
  const [c, i, a] = [m.C, m.I, m.A].map((k) => (WEIGHTS.CIA as Record<string, number>)[k]);
  if ([av, ac, ui, pr, c, i, a].some((w) => w === undefined)) return null;
  const iss = 1 - (1 - c) * (1 - i) * (1 - a);
  const impact = scopeChanged ? 7.52 * (iss - 0.029) - 3.25 * (iss - 0.02) ** 15 : 6.42 * iss;
  if (impact <= 0) return 0;
  const exploitability = 8.22 * av * ac * pr * ui;
  return roundUp(Math.min(scopeChanged ? 1.08 * (impact + exploitability) : impact + exploitability, 10));
}

const bandOf = (score: number): string => (score >= 9 ? "critical" : score >= 7 ? "high" : score >= 4 ? "moderate" : "low");

/**
 * The severity label of an OSV vulnerability record, one of the four the cache format names or "unknown":
 * `database_specific.severity` when it names a known level (medium reads as moderate),
 * else the highest CVSS v3 score band, else "unknown" (the cve check treats unknown as high).
 */
export function severityOf(vuln: unknown): string {
  const v = asRecord(vuln);
  const label = String(asRecord(v.database_specific).severity ?? "").toLowerCase();
  if (["critical", "high", "moderate", "low"].includes(label)) return label;
  if (label === "medium") return "moderate";
  const scores: number[] = [];
  for (const s of Array.isArray(v.severity) ? v.severity : []) {
    const { score } = asRecord(s);
    const n = typeof score === "string" ? (/^\d+(\.\d+)?$/.test(score) ? Number(score) : cvss3Score(score)) : null;
    if (n !== null && n <= 10) scores.push(n);
  }
  return scores.length === 0 ? "unknown" : bandOf(Math.max(...scores));
}

/** The ids of the vulnerabilities OSV lists for each dep, in the order of `deps`. */
async function queryIds(deps: Dep[], fetchFn: FetchFn): Promise<string[][]> {
  const ids: Set<string>[] = deps.map(() => new Set());
  let pending = deps.map((_, index) => ({ index, token: null as string | null }));
  for (let page = 0; pending.length > 0; page++) {
    if (page === MAX_PAGES) throw new Error(`OSV still had result pages after ${MAX_PAGES} rounds`);
    const next: typeof pending = [];
    for (let at = 0; at < pending.length; at += BATCH_SIZE) {
      const chunk = pending.slice(at, at + BATCH_SIZE);
      const queries = chunk.map(({ index, token }) => ({
        package: { name: deps[index].name, ecosystem: "npm" },
        version: deps[index].version,
        ...(token ? { page_token: token } : {}),
      }));
      const reply = asRecord(JSON.parse(await fetchFn(`${OSV_API}/querybatch`, JSON.stringify({ queries }))));
      const results = reply.results;
      if (!Array.isArray(results) || results.length !== chunk.length) throw new Error("OSV answered with the wrong number of results");
      results.forEach((r, k) => {
        const { vulns, next_page_token: token } = asRecord(r);
        for (const x of Array.isArray(vulns) ? vulns : []) {
          const id = asRecord(x).id;
          if (typeof id !== "string" || id === "") throw new Error("OSV listed a vulnerability without an id");
          ids[chunk[k].index].add(id);
        }
        if (typeof token === "string" && token !== "") next.push({ index: chunk[k].index, token });
      });
    }
    pending = next;
  }
  return ids.map((s) => [...s]);
}

/** Severity of each id, from one GET per id. OSV's batch answer carries ids only. */
async function severities(ids: string[], known: Map<string, string>, fetchFn: FetchFn): Promise<void> {
  const todo = ids.filter((id) => !known.has(id));
  for (let at = 0; at < todo.length; at += DETAIL_PARALLEL) {
    await Promise.all(todo.slice(at, at + DETAIL_PARALLEL).map(async (id) => {
      known.set(id, severityOf(JSON.parse(await fetchFn(`${OSV_API}/vulns/${encodeURIComponent(id)}`))));
    }));
  }
}

const note = (severity: Finding["severity"], f: Lockfile, evidence: string): Finding =>
  ({ check: "cve", severity, pack: f.pack, path: f.path, evidence, id: "", acked: false, stanza: null });

/**
 * Query OSV for the lockfiles among `files` and merge the answers into cache/osv/<ecosystem>.json of the state root.
 * Makes no request when no file is a known manifest. Never throws for a failed request or an unparsable lockfile:
 * those come back as findings (the file stays uncached, so the cve check blocks on it). A failed cache write throws.
 * @returns info and warn findings about the refresh, never a block
 */
export async function refreshOsv(world: Pick<World, "ctx" | "osv">, pack: string, files: { path: string; bytes: Uint8Array }[], fetchFn: FetchFn): Promise<{ findings: Finding[] }> {
  const findings: Finding[] = [];
  const fresh = new Map<string, Map<string, { advisories: Advisory[] }>>();
  const severityById = new Map<string, string>();
  for (const f of files.map((x) => ({ pack, ...x }))) {
    const eco = ecosystemOf(f.path);
    if (eco === null) continue;
    const base = f.path.slice(f.path.lastIndexOf("/") + 1);
    const parse = PARSERS[base];
    if (!parse) {
      findings.push(note("info", f, `no OSV parser for ${base} in v0, so nothing was queried; the cve check blocks on it until one exists`));
      continue;
    }
    const deps = parse(f.bytes);
    if (typeof deps === "string") {
      findings.push(note("info", f, `${base} was not queried: ${deps}; the cve check blocks on it`));
      continue;
    }
    try {
      const idsByDep = deps.length === 0 ? [] : await queryIds(deps, fetchFn);
      const ids = [...new Set(idsByDep.flat())].sort();
      await severities(ids, severityById, fetchFn);
      const digest = `sha256:${createHash("sha256").update(f.bytes).digest("hex")}`;
      const advisories = ids.map((id) => ({ id, severity: severityById.get(id) ?? "unknown" }));
      if (!fresh.has(eco)) fresh.set(eco, new Map());
      fresh.get(eco)?.set(digest, { advisories });
    } catch (err) {
      findings.push(note("warn", f, `OSV refresh failed: ${err instanceof Error ? err.message : String(err)}; nothing was cached, so the cve check blocks on ${base}`));
    }
  }
  for (const [eco, added] of fresh) {
    const old = asRecord(world.osv.get(eco));
    const results = old.schema === 1 ? asRecord(old.results) : {};
    const merged = { schema: 1, results: { ...results, ...Object.fromEntries(added) } };
    writeState(`cache/osv/${eco}.json`, Buffer.from(`${JSON.stringify(merged, null, 2)}\n`, "utf8"), world.ctx);
  }
  return { findings };
}
