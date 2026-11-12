// scripts/evals-history.ts — the schema, the reader and the privacy scan for evals/. The format is described in
// evals/README.md. test/evals-history.test.ts pins every rule here against the committed files.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Time, token and cost fields of a cell. Seconds, tokens and USD. null means the harness did not report the value. */
export const METRIC_FIELDS = [
  "total_cost_usd", "mean_duration_s", "median_duration_s", "mean_input_tokens", "mean_output_tokens", "mean_cache_read_tokens", "mean_cache_write_tokens",
] as const;
export type MetricField = (typeof METRIC_FIELDS)[number];
export type MetricValues = Record<MetricField, number | null>;

export type Cell = Partial<MetricValues> & {
  schema: 1;
  kind: "cell";
  run: string;
  date: string;
  rig_commit: string | null;
  unit: string;
  arm: string;
  harness: string;
  harness_version: string;
  model: string;
  effort: string;
  fixture: string;
  fixture_sha256: string;
  grader_sha256: string;
  k: number;
  n: number;
  mean_cost_usd: number;
  mean_turns: number;
  mean_score?: number;
  score_max?: number;
  note?: string;
};

/** Backfills the metric fields of an earlier cell line. It names the run and the cell key, and carries only the metric fields. */
export type Metrics = MetricValues & {
  schema: 1;
  kind: "metrics";
  run: string;
  unit: string;
  arm: string;
  harness: string;
  model: string;
  effort: string;
  fixture: string;
};

export type Judge = {
  schema: 1;
  kind: "judge";
  run: string;
  date: string;
  judge_set: string;
  model: string;
  subset: string;
  n: number;
  pairs: number | null;
  auc: number;
  auc_ci95: [number, number];
  pair_acc: number | null;
  cases_sha256: string;
  note?: string;
};

export type Line = Cell | Judge | Metrics;

export type Summary = {
  schema: 1;
  run: string;
  date: string;
  kind: "experiment" | "judge";
  title: string;
  question: string;
  prereg: {
    file: string;
    original_sha256: string;
    stored_sha256: string;
    redactions: string[];
    amendments?: { file: string; original_sha256: string; stored_sha256: string; redactions: string[] }[];
  } | null;
  analysis: { file: string; origin: "analyzer" | "backfill"; redactions?: string[] };
  lines: number;
  usable_trials: number | null;
  verdict: { label: string; text: string };
  notes: string[];
};

export const VERDICT_LABELS = ["claim-allowed", "hypothesis-supported", "hypothesis-contradicted", "no-claim", "descriptive"];

type Check = (value: unknown) => boolean;
const SHA = /^[0-9a-f]{64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const RUN = /^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*$/;
const UNIT = /^(rule:[a-z0-9][a-z0-9-]*|[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*(@[0-9a-f]{7,40})?)$/;
const WORD = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;

const text: Check = (v) => typeof v === "string" && v.trim() !== "" && v === v.trim();
const match = (re: RegExp): Check => (v) => typeof v === "string" && re.test(v);
const count = (min: number): Check => (v) => typeof v === "number" && Number.isInteger(v) && v >= min;
const real = (min: number, max: number): Check => (v) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const orNull = (check: Check): Check => (v) => v === null || check(v);
const isDate: Check = (v) => {
  if (typeof v !== "string" || !DATE.test(v)) return false;
  const time = new Date(`${v}T00:00:00Z`).getTime();
  return !Number.isNaN(time) && new Date(time).toISOString().startsWith(v);
};
const interval: Check = (v) => Array.isArray(v) && v.length === 2 && real(0, 1)(v[0]) && real(0, 1)(v[1]) && v[0] <= v[1];

const metric: Check = orNull(real(0, 1e9));
const METRIC_CHECKS = Object.fromEntries(METRIC_FIELDS.map((field) => [field, metric])) as Record<MetricField, Check>;

const COMMON = { schema: (v: unknown) => v === 1, run: match(RUN), date: isDate };
const CELL: Record<keyof Cell, Check> = {
  ...COMMON,
  kind: (v) => v === "cell",
  rig_commit: orNull(match(/^[0-9a-f]{7,40}$/)),
  unit: match(UNIT),
  arm: match(WORD),
  harness: match(WORD),
  harness_version: match(WORD),
  model: match(WORD),
  effort: match(WORD),
  fixture: match(WORD),
  fixture_sha256: match(SHA),
  grader_sha256: match(SHA),
  k: count(0),
  n: count(1),
  mean_cost_usd: real(0, 1000),
  mean_turns: real(0, 100000),
  mean_score: real(0, 1e6),
  score_max: count(1),
  ...METRIC_CHECKS,
  note: text,
};
const METRICS: Record<keyof Metrics, Check> = {
  schema: COMMON.schema,
  run: COMMON.run,
  kind: (v) => v === "metrics",
  unit: match(UNIT),
  arm: match(WORD),
  harness: match(WORD),
  model: match(WORD),
  effort: match(WORD),
  fixture: match(WORD),
  ...METRIC_CHECKS,
};
const JUDGE: Record<keyof Judge, Check> = {
  ...COMMON,
  kind: (v) => v === "judge",
  judge_set: match(WORD),
  model: match(WORD),
  subset: match(WORD),
  n: count(1),
  pairs: orNull(count(1)),
  auc: real(0, 1),
  auc_ci95: interval,
  pair_acc: orNull(real(0, 1)),
  cases_sha256: match(SHA),
  note: text,
};
const OPTIONAL = new Set(["note"]);
const CELL_OPTIONAL = new Set(["note", "mean_score", "score_max", ...METRIC_FIELDS]);
const NONE = new Set<string>();

function checkFields(value: unknown, spec: Record<string, Check>, optional: Set<string> = OPTIONAL): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return ["not a JSON object"];
  const record = value as Record<string, unknown>;
  const errors: string[] = [];
  for (const [field, check] of Object.entries(spec)) {
    if (!(field in record)) {
      if (!optional.has(field)) errors.push(`missing field ${field}`);
    } else if (!check(record[field])) errors.push(`bad value for ${field}`);
  }
  for (const field of Object.keys(record)) if (!(field in spec)) errors.push(`unknown field ${field}`);
  return errors;
}

/** Problems with one parsed history line. An empty list means the line is valid. */
export function validateLine(value: unknown): string[] {
  const kind = typeof value === "object" && value !== null ? (value as { kind?: unknown }).kind : undefined;
  if (kind !== "cell" && kind !== "judge" && kind !== "metrics") return ["kind must be cell, judge or metrics"];
  const errors = checkFields(value, kind === "cell" ? CELL : kind === "judge" ? JUDGE : METRICS, kind === "cell" ? CELL_OPTIONAL : kind === "judge" ? OPTIONAL : NONE);
  if (errors.length) return errors;
  const line = value as Line;
  if (line.kind !== "metrics" && !line.run.startsWith(`${line.date}-`)) errors.push("run must start with the date");
  if (line.kind === "cell") {
    if (line.k > line.n) errors.push("k is larger than n");
    const missing = METRIC_FIELDS.filter((field) => !(field in line));
    if (missing.length > 0 && missing.length < METRIC_FIELDS.length) errors.push(`metric fields come together: missing ${missing.join(", ")}`);
    if (("mean_score" in line) !== ("score_max" in line)) errors.push("mean_score and score_max come together");
    else if (line.mean_score !== undefined && line.score_max !== undefined && line.mean_score > line.score_max) errors.push("mean_score is larger than score_max");
  }
  if (line.kind === "judge" && line.pairs !== null && line.pairs * 2 !== line.n) errors.push("pairs must be n / 2");
  return errors;
}

const PREREG_FILE = { original_sha256: match(SHA), stored_sha256: match(SHA), redactions: (r: unknown) => Array.isArray(r) && r.every(text) };
const PREREG: Record<string, Check> = {
  file: match(/^prereg\.md$/),
  ...PREREG_FILE,
  amendments: (a) => Array.isArray(a) && a.length > 0 && a.every((x) => checkFields(x, { file: match(/^prereg-amendment-\d+\.md$/), ...PREREG_FILE }).length === 0),
};

const SUMMARY: Record<keyof Summary, Check> = {
  schema: COMMON.schema,
  run: COMMON.run,
  date: isDate,
  kind: (v) => v === "experiment" || v === "judge",
  title: text,
  question: text,
  prereg: orNull((v) => checkFields(v, PREREG, new Set(["amendments"])).length === 0),
  analysis: (v) =>
    checkFields(v, { file: match(/^analysis\.txt$/), origin: (o) => o === "analyzer" || o === "backfill", redactions: (r) => Array.isArray(r) && r.length > 0 && r.every(text) }, new Set(["redactions"])).length === 0,
  lines: count(1),
  usable_trials: orNull(count(1)),
  verdict: (v) => checkFields(v, { label: (l) => VERDICT_LABELS.includes(l as string), text }).length === 0,
  notes: (v) => Array.isArray(v) && v.every(text),
};

export function validateSummary(value: unknown): string[] {
  const errors = checkFields(value, SUMMARY);
  if (errors.length) return errors;
  const summary = value as Summary;
  if (!summary.run.startsWith(`${summary.date}-`)) errors.push("run must start with the date");
  return errors;
}

/** The identity of the cell that a cell line or a metrics line names. */
export function cellKey(line: Cell | Metrics): string {
  return ["cell", line.run, line.unit, line.arm, line.harness, line.model, line.effort, line.fixture].join("|");
}

/** The identity of one history line. Two lines with the same key are a duplicate. */
export function lineKey(line: Line): string {
  if (line.kind === "cell") return cellKey(line);
  if (line.kind === "metrics") return `metrics|${cellKey(line).slice("cell|".length)}`;
  return [line.kind, line.run, line.judge_set, line.model, line.subset].join("|");
}

const hasMetrics = (cell: Cell): boolean => METRIC_FIELDS.some((field) => field in cell);

/** Parse history.jsonl. Throws with the line number of the first line that is not valid JSON or fails the schema. */
export function parseHistory(content: string): Line[] {
  const lines: Line[] = [];
  const seen = new Set<string>();
  const cells = new Map<string, Cell>();
  content.split("\n").forEach((raw, index) => {
    if (raw === "") return;
    const where = `history line ${index + 1}`;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Error(`${where}: not valid JSON`);
    }
    const errors = validateLine(value);
    if (errors.length) throw new Error(`${where}: ${errors.join("; ")}`);
    const line = value as Line;
    const key = lineKey(line);
    if (seen.has(key)) throw new Error(`${where}: duplicate of an earlier line (${key})`);
    seen.add(key);
    if (line.kind === "cell") cells.set(key, line);
    if (line.kind === "metrics") {
      const target = cells.get(cellKey(line));
      if (!target) throw new Error(`${where}: metrics line has no earlier cell line (${cellKey(line)})`);
      if (hasMetrics(target)) throw new Error(`${where}: cell already carries the metric fields inline (${cellKey(line)})`);
    }
    lines.push(line);
  });
  return lines;
}

/** The cell lines, each with its metric fields: inline, or taken from the metrics line that names it. The input is not changed. */
export function cellsWithMetrics(lines: Line[]): Cell[] {
  const backfill = new Map<string, Metrics>();
  for (const line of lines) if (line.kind === "metrics") backfill.set(cellKey(line), line);
  return lines.flatMap((line) => {
    if (line.kind !== "cell") return [];
    const extra = backfill.get(cellKey(line));
    return [extra ? { ...line, ...Object.fromEntries(METRIC_FIELDS.map((field) => [field, extra[field]])) } : line];
  });
}

export function readHistory(path: string): Line[] {
  return parseHistory(readFileSync(path, "utf8"));
}

/** True when `next` only adds bytes after `previous`: the append-only rule. */
export function isAppendOnly(previous: string, next: string): boolean {
  return next.startsWith(previous);
}

/** The `usable_trials` an experiment summary must carry: the sum of `n` over its cell lines. A judge run says null. */
export function usableTrialsProblem(summary: Pick<Summary, "usable_trials">, lines: Line[]): string | null {
  const cells = lines.filter((l): l is Cell => l.kind === "cell");
  if (cells.length === 0) return summary.usable_trials === null ? null : `usable_trials is ${summary.usable_trials}, a judge run must say null`;
  const sum = cells.reduce((total, c) => total + c.n, 0);
  return summary.usable_trials === sum ? null : `usable_trials is ${summary.usable_trials}, the lines sum to ${sum}`;
}


function git(root: string, args: string[]): string | null {
  const run = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return run.status === 0 ? run.stdout : null;
}

/**
 * Why the git history of `file` is not append-only, or null when it is. Each committed version must be a prefix of
 * the next one and of the working tree. A shallow clone that shows one commit compares nothing, so that fails too.
 */
export function historyGitProblem(root: string, file = "evals/history.jsonl"): string | null {
  const log = git(root, ["log", "--reverse", "--format=%H", "--", file]);
  if (log === null) return "git log failed";
  const commits = log.split("\n").filter(Boolean);
  if (git(root, ["rev-parse", "--is-shallow-repository"])?.trim() === "true" && commits.length <= 1) {
    return `${file} has ${commits.length} commit in a shallow clone, so the append-only check compares nothing. Check out with fetch-depth: 0.`;
  }
  let previous = "";
  for (const sha of commits) {
    const version = git(root, ["show", `${sha}:${file}`]);
    if (version === null) return `${file} was deleted in ${sha}`;
    if (!isAppendOnly(previous, version)) return `commit ${sha} edited or removed an earlier history line`;
    previous = version;
  }
  return isAppendOnly(previous, readFileSync(join(root, file), "utf8")) ? null : "the working tree edited or removed a committed history line";
}

export const ALLOWED_HOSTS = ["github.com"];
/** Directories under ~/ that every user of a tool or OS has and that name no person and no machine. Any other ~/ path is flagged. */
export const ALLOWED_HOME_DIRS = [".claude", ".codex", ".agents", ".cursor", ".config", ".cache", ".vscode", "Library"];
const PRIVATE_TLDS = ["local", "lan", "internal", "home", "corp", "intra"];
const FILE_EXTENSIONS = new Set(
  "ts tsx js mjs cjs json jsonl md txt yml yaml toml sh py rb go rs java kt swift c h cpp lock log csv html css xml sql".split(" "),
);

const URL_HOST = /\b[a-z][a-z0-9+.-]*:\/\/(?:[^\s/@]*@)?([^\s/:?#"'<>)\]\\]+)/gi;
const HOST_PORT = /(?<![\w.-])((?:[a-z0-9-]+\.)+[a-z][a-z0-9-]*|localhost):\d{1,5}(?!\w)/gi;
const LOCALHOST = /\blocalhost\b/i;
const PRIVATE_HOST = new RegExp(`(?<![\\w.-])((?:[a-z0-9-]+\\.)*[a-z0-9-]+\\.(?:${PRIVATE_TLDS.join("|")}))(?![\\w-]|\\.\\w)`, "gi");
const CLUSTER = new RegExp("k3" + "s|\\.ho" + "me\\.", "i");
const OCTET = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const IPV4 = new RegExp(`(?<![\\w.])${OCTET}(?:\\.${OCTET}){3}(?![\\w]|\\.\\w)`);
const IPV6_CANDIDATE = /(?<![\w:])(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}(?![\w:])/gi;
const WINDOWS_PATH = /(?<!\w)[a-z]:[\\/]{1,2}Users[\\/]/i;
const ABSOLUTE_PATH = new RegExp("(?<![\\w.~-])/(?:Users|home|private|tmp|var/folders|Volumes)(?![\\w-])");
const HOME_PATH = new RegExp(`(?<!\\w)~/(?!(?:${ALLOWED_HOME_DIRS.map((d) => d.replace(".", "\\.")).join("|")})(?![\\w.-]))`);

function isIpv6(candidate: string): boolean {
  const groups = candidate.split(":");
  const hex = (g: string): boolean => g === "" || /^[0-9a-f]{1,4}$/i.test(g);
  if (!groups.every(hex)) return false;
  const doubled = candidate.split("::").length - 1;
  if (doubled > 1 || candidate.includes(":::")) return false;
  if (doubled === 1) return groups.some((g) => g !== "") && groups.filter((g) => g !== "").length <= 7;
  return groups.length === 8 && groups.every((g) => g !== "");
}

/**
 * What the privacy gate rejects in a committed text, as one finding per class: URL hosts other than ALLOWED_HOSTS,
 * host:port pairs, localhost, hostnames under a private top-level name, IPv4 and IPv6 addresses, absolute local paths,
 * ~/ paths outside ALLOWED_HOME_DIRS, and cluster names. A bare hostname with no scheme, port or private suffix is not
 * detectable and passes.
 */
export function scanPrivacy(content: string): string[] {
  const findings = new Set<string>();
  for (const m of content.matchAll(URL_HOST)) {
    const host = (m[1] ?? "").toLowerCase();
    if (!ALLOWED_HOSTS.includes(host)) findings.add(`URL host ${host}`);
  }
  for (const m of content.matchAll(HOST_PORT)) {
    const host = (m[1] ?? "").toLowerCase();
    const tld = host.split(".").pop() ?? "";
    if (!ALLOWED_HOSTS.includes(host) && !FILE_EXTENSIONS.has(tld)) findings.add(`host:port ${host}`);
  }
  if (LOCALHOST.test(content)) findings.add("localhost");
  for (const m of content.matchAll(PRIVATE_HOST)) findings.add(`private host ${(m[1] ?? "").toLowerCase()}`);
  if (IPV4.test(content) || [...content.matchAll(IPV6_CANDIDATE)].some((m) => isIpv6(m[0]))) findings.add("IP address");
  if (ABSOLUTE_PATH.test(content) || WINDOWS_PATH.test(content)) findings.add("absolute local path");
  if (HOME_PATH.test(content)) findings.add("home path");
  if (CLUSTER.test(content)) findings.add("cluster name");
  return [...findings];
}
