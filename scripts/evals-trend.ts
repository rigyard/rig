// scripts/evals-trend.ts — prints the pass-rate trend of evals/history.jsonl.
//
// Usage: node scripts/evals-trend.ts [path/to/history.jsonl]
//
// Cells are grouped by (unit, arm, harness, model, effort, fixture, fixture_sha256, grader_sha256). A changed fixture
// or grader hash starts a new group: the two runs did not measure the same thing. For each group the latest run is
// compared with the previous run of the same group. A change is flagged DROP or RISE only when the two 95% Wilson score intervals
// do not overlap. That is a conservative bar: with small k it stays quiet on differences that look large. A group
// with one run prints "first run". Exit code 0 unless the history file is missing or fails the schema (then 2).
// Judge lines are not trended.
//
// Cost, duration and tokens are compared as means. History keeps no per-trial values for them, so there is no
// significance test. A mean that moves by more than LARGE_CHANGE, with at least LARGE_MIN_N trials in both runs, is
// labelled "large change". Metrics lines that backfill older cells are joined to their cells first.

import { fileURLToPath, pathToFileURL } from "node:url";
import { cellsWithMetrics, readHistory, type Cell, type Line } from "./evals-history.ts";

export type Status = "first run" | "noise" | "DROP" | "RISE";
export type MetricName = "cost" | "duration" | "tokens";
export type Change = { metric: MetricName; previous: number | null; latest: number | null; relative: number | null; large: boolean };
export type Row = { key: string[]; previous: Cell | null; latest: Cell; status: Status; changes: Change[] };

/**
 * A mean must move by more than this fraction of the previous mean to be labelled a large change. In the trial-level
 * data that these thresholds were set from (36 groups of 5 to 15 trials), the coefficient of variation of a trial's cost
 * had median 0.13 and 90th percentile 0.33. For duration it was 0.15 and 0.47, for total tokens 0.24 and 0.41. With 5
 * trials in both runs, the standard error of the relative difference of two means is CV * sqrt(2 / 5): 0.21 for cost,
 * 0.30 for duration and 0.26 for tokens at the 90th percentile. A change of 50% is more than 1.6 of those standard errors for
 * the noisiest tenth of the groups and far above them for the rest.
 */
export const LARGE_CHANGE = 0.5;
export const LARGE_MIN_N = 5;

const Z = 1.96;

/** 95% Wilson score interval for k successes in n trials. */
export function wilson(k: number, n: number): [number, number] {
  const p = k / n;
  const z2 = Z * Z;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (Z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

export function compare(previous: Cell, latest: Cell): Status {
  const [prevLow, prevHigh] = wilson(previous.k, previous.n);
  const [low, high] = wilson(latest.k, latest.n);
  if (high < prevLow) return "DROP";
  if (low > prevHigh) return "RISE";
  return "noise";
}

/** Mean input, output, cache read and cache write tokens of a cell, or null when any of the four is missing or not reported. */
function totalTokens(cell: Cell): number | null {
  const parts = [cell.mean_input_tokens, cell.mean_output_tokens, cell.mean_cache_read_tokens, cell.mean_cache_write_tokens];
  return parts.every((part): part is number => typeof part === "number") ? parts.reduce((sum, part) => sum + part, 0) : null;
}

const METRICS: { name: MetricName; value: (cell: Cell) => number | null }[] = [
  { name: "cost", value: (cell) => cell.mean_cost_usd },
  { name: "duration", value: (cell) => cell.mean_duration_s ?? null },
  { name: "tokens", value: totalTokens },
];

export function changes(previous: Cell | null, latest: Cell): Change[] {
  return METRICS.map(({ name, value }) => {
    const before = previous ? value(previous) : null;
    const after = value(latest);
    const relative = before !== null && after !== null && before > 0 ? (after - before) / before : null;
    const large = relative !== null && Math.abs(relative) > LARGE_CHANGE && previous!.n >= LARGE_MIN_N && latest.n >= LARGE_MIN_N;
    return { metric: name, previous: before, latest: after, relative, large };
  });
}

/** One row per group. Within a group, runs are ordered by date, then by position in the file. */
export function trend(lines: Line[]): Row[] {
  const groups = new Map<string, Cell[]>();
  for (const line of cellsWithMetrics(lines)) {
    const key = [line.unit, line.arm, line.harness, line.model, line.effort, line.fixture, line.fixture_sha256, line.grader_sha256].join("\u0000");
    groups.set(key, [...(groups.get(key) ?? []), line]);
  }
  return [...groups.entries()].map(([key, cells]) => {
    const ordered = cells.map((cell, index) => ({ cell, index })).sort((a, b) => a.cell.date.localeCompare(b.cell.date) || a.index - b.index);
    const latest = ordered[ordered.length - 1]!.cell;
    const previous = ordered.length > 1 ? ordered[ordered.length - 2]!.cell : null;
    return { key: key.split("\u0000"), previous, latest, status: previous ? compare(previous, latest) : "first run", changes: changes(previous, latest) };
  });
}

const rate = (c: Cell): string => (c.mean_score === undefined ? `${c.k}/${c.n}` : `${c.k}/${c.n} (score ${c.mean_score}/${c.score_max})`);

const percent = (relative: number): string => `${relative >= 0 ? "+" : ""}${Math.round(relative * 100)}%`;
const FORMAT: Record<MetricName, (value: number) => string> = {
  cost: (value) => value.toFixed(3),
  duration: (value) => value.toFixed(1),
  tokens: (value) => (value >= 1000 ? `${Math.round(value / 1000)}k` : String(Math.round(value))),
};

function changeCell(change: Change): string {
  const show = FORMAT[change.metric];
  if (change.latest === null) return "-";
  if (change.previous === null) return show(change.latest);
  return `${show(change.previous)} -> ${show(change.latest)}${change.relative === null ? "" : ` (${percent(change.relative)})`}`;
}

function table(head: string[], body: string[][]): string[] {
  const widths = head.map((title, i) => Math.max(title.length, ...body.map((r) => r[i]!.length)));
  const format = (cells: string[]): string => cells.map((cell, i) => cell.padEnd(widths[i]!)).join("  ").trimEnd();
  return [format(head), ...body.map(format)];
}

export function render(rows: Row[], judgeLines: number): string {
  const passBody = rows.map((row, index) => {
    const note = row.previous && row.previous.harness_version !== row.latest.harness_version ? ` (harness ${row.previous.harness_version} -> ${row.latest.harness_version})` : "";
    const [fixtureSha, graderSha] = row.key.slice(6).map((sha) => sha.slice(0, 8));
    return [String(index + 1), ...row.key.slice(0, 6), `${fixtureSha}/${graderSha}`, row.previous ? rate(row.previous) : "-", rate(row.latest), `${row.status}${note}`];
  });
  const spendBody = rows.map((row, index) => {
    const flags = row.changes.filter((c) => c.large).map((c) => `${c.metric} ${percent(c.relative!)}`);
    return [
      String(index + 1), row.key[0]!, row.key[1]!, row.key[3]!, row.key[4]!, row.key[5]!,
      row.previous ? `${row.previous.n} -> ${row.latest.n}` : String(row.latest.n),
      ...row.changes.map(changeCell), flags.length ? flags.join(", ") : "-",
    ];
  });
  const flagged = rows.filter((r) => r.status === "DROP" || r.status === "RISE").length;
  const large = rows.filter((r) => r.changes.some((c) => c.large)).length;
  return [
    "pass rate k/n, latest run vs previous run of the same group",
    "flag rule: DROP or RISE when the 95% Wilson intervals of the two runs do not overlap",
    "",
    ...table(["#", "unit", "arm", "harness", "model", "effort", "fixture", "fixture/grader sha", "previous", "latest", "status"], passBody),
    "",
    "mean cost (USD per trial), duration (seconds per trial) and tokens (input + output + cache read + cache write per trial), previous run -> latest run",
    `large change rule: a mean that moves by more than ${LARGE_CHANGE * 100}% with at least ${LARGE_MIN_N} trials in both runs. This is not a significance test: history keeps no per-trial values.`,
    "",
    ...table(["#", "unit", "arm", "model", "effort", "fixture", "n", "cost USD", "duration s", "tokens", "large change"], spendBody),
    "",
    `${rows.length} groups, ${flagged} flagged. ${large} with a large change in cost, duration or tokens. ${judgeLines} judge lines not trended.`,
  ].join("\n");
}

function main(): void {
  const path = process.argv[2] ?? fileURLToPath(new URL("../evals/history.jsonl", import.meta.url));
  let lines: Line[];
  try {
    lines = readHistory(path);
  } catch (error) {
    console.error(`evals-trend: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
    return;
  }
  console.log(render(trend(lines), lines.filter((l) => l.kind === "judge").length));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
