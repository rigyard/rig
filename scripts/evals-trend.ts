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

import { fileURLToPath, pathToFileURL } from "node:url";
import { readHistory, type Cell, type Line } from "./evals-history.ts";

export type Status = "first run" | "noise" | "DROP" | "RISE";
export type Row = { key: string[]; previous: Cell | null; latest: Cell; status: Status };

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

/** One row per group. Within a group, runs are ordered by date, then by position in the file. */
export function trend(lines: Line[]): Row[] {
  const groups = new Map<string, Cell[]>();
  for (const line of lines) {
    if (line.kind !== "cell") continue;
    const key = [line.unit, line.arm, line.harness, line.model, line.effort, line.fixture, line.fixture_sha256, line.grader_sha256].join("\u0000");
    groups.set(key, [...(groups.get(key) ?? []), line]);
  }
  return [...groups.entries()].map(([key, cells]) => {
    const ordered = cells.map((cell, index) => ({ cell, index })).sort((a, b) => a.cell.date.localeCompare(b.cell.date) || a.index - b.index);
    const latest = ordered[ordered.length - 1]!.cell;
    const previous = ordered.length > 1 ? ordered[ordered.length - 2]!.cell : null;
    return { key: key.split("\u0000"), previous, latest, status: previous ? compare(previous, latest) : "first run" };
  });
}

const rate = (c: Cell): string => `${c.k}/${c.n}`;

export function render(rows: Row[], judgeLines: number): string {
  const head = ["unit", "arm", "harness", "model", "effort", "fixture", "fixture/grader sha", "previous", "latest", "status"];
  const body = rows.map((row) => {
    const note = row.previous && row.previous.harness_version !== row.latest.harness_version ? ` (harness ${row.previous.harness_version} -> ${row.latest.harness_version})` : "";
    const [fixtureSha, graderSha] = row.key.slice(6).map((sha) => sha.slice(0, 8));
    return [...row.key.slice(0, 6), `${fixtureSha}/${graderSha}`, row.previous ? rate(row.previous) : "-", rate(row.latest), `${row.status}${note}`];
  });
  const widths = head.map((title, i) => Math.max(title.length, ...body.map((r) => r[i]!.length)));
  const format = (cells: string[]): string => cells.map((cell, i) => cell.padEnd(widths[i]!)).join("  ").trimEnd();
  const flagged = rows.filter((r) => r.status === "DROP" || r.status === "RISE").length;
  return [
    "pass rate k/n, latest run vs previous run of the same group",
    "flag rule: DROP or RISE when the 95% Wilson intervals of the two runs do not overlap",
    "",
    format(head),
    ...body.map(format),
    "",
    `${rows.length} groups, ${flagged} flagged. ${judgeLines} judge lines not trended.`,
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
