// scripts/evals-trend.ts: which run-to-run changes it flags. A change is flagged only when the 95% Wilson intervals
// of the latest run and the previous run of the same group do not overlap.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { parseHistory, type Cell, type Line, type Metrics } from "../scripts/evals-history.ts";
import { LARGE_CHANGE, LARGE_MIN_N, render, trend, wilson } from "../scripts/evals-trend.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SHA = "a".repeat(64);
const OTHER_SHA = "c".repeat(64);

function cell(over: Partial<Cell> & Pick<Cell, "k" | "n" | "date">): Cell {
  return {
    schema: 1,
    kind: "cell",
    run: `${over.date}-fixture-run`,
    rig_commit: null,
    unit: "rule:fixture-unit",
    arm: "rule",
    harness: "claude-code",
    harness_version: "2.1.322",
    model: "claude-sonnet-5-5",
    effort: "default",
    fixture: "fx1",
    fixture_sha256: SHA,
    grader_sha256: SHA,
    mean_cost_usd: 0.1,
    mean_turns: 10,
    ...over,
  };
}

const METRICS = {
  total_cost_usd: 1, mean_duration_s: 40, median_duration_s: 38, mean_input_tokens: 10, mean_output_tokens: 3000,
  mean_cache_read_tokens: 100000, mean_cache_write_tokens: 7000,
};
const TOKENS = 10 + 3000 + 100000 + 7000;

const statusOf = (lines: Line[]): string[] => trend(lines).map((row) => row.status);

describe("wilson interval", () => {
  test("matches the textbook 95% bounds for 5/5 and 0/5", () => {
    const [low, high] = wilson(5, 5);
    assert.equal(low.toFixed(3), "0.566");
    assert.equal(high, 1);
    const [zeroLow, zeroHigh] = wilson(0, 5);
    assert.equal(zeroLow, 0);
    assert.equal(zeroHigh.toFixed(3), "0.434");
  });
});

describe("trend", () => {
  test("flags a drop when the intervals do not overlap", () => {
    const rows = trend([cell({ date: "2026-11-01", k: 15, n: 15 }), cell({ date: "2026-11-02", k: 3, n: 15 })]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.status, "DROP");
    assert.equal(rows[0]!.previous?.k, 15);
    assert.equal(rows[0]!.latest.k, 3);
  });

  test("flags a rise the same way", () => {
    assert.deepEqual(statusOf([cell({ date: "2026-11-01", k: 3, n: 15 }), cell({ date: "2026-11-02", k: 15, n: 15 })]), ["RISE"]);
  });

  test("does not flag a drop inside the run-to-run noise", () => {
    assert.deepEqual(statusOf([cell({ date: "2026-11-01", k: 8, n: 15 }), cell({ date: "2026-11-02", k: 6, n: 15 })]), ["noise"]);
    assert.deepEqual(statusOf([cell({ date: "2026-11-01", k: 5, n: 5 }), cell({ date: "2026-11-02", k: 3, n: 5 })]), ["noise"]);
  });

  test("handles a first run: no previous, no flag", () => {
    const rows = trend([cell({ date: "2026-11-01", k: 4, n: 5 })]);
    assert.equal(rows[0]!.status, "first run");
    assert.equal(rows[0]!.previous, null);
  });

  test("never compares groups that differ in model, effort, harness, arm, unit or fixture", () => {
    const base = cell({ date: "2026-11-01", k: 15, n: 15 });
    const worse = { date: "2026-11-02", k: 0, n: 15 };
    const others = [
      cell({ ...worse, model: "claude-opus-5-5" }),
      cell({ ...worse, effort: "high" }),
      cell({ ...worse, harness: "codex" }),
      cell({ ...worse, arm: "none" }),
      cell({ ...worse, unit: "rule:other-unit" }),
      cell({ ...worse, fixture: "fx2" }),
      cell({ ...worse, fixture_sha256: OTHER_SHA }),
      cell({ ...worse, grader_sha256: OTHER_SHA }),
    ];
    assert.deepEqual(statusOf([base, ...others]), Array(9).fill("first run"));
  });

  test("a changed fixture or grader hash starts a new group instead of a DROP against the old one", () => {
    const rows = trend([cell({ date: "2026-11-01", k: 15, n: 15 }), cell({ date: "2026-11-02", k: 0, n: 15, grader_sha256: OTHER_SHA })]);
    assert.deepEqual(rows.map((r) => r.status), ["first run", "first run"]);
  });

  test("orders runs by date, not by position in the file", () => {
    const rows = trend([cell({ date: "2026-11-02", k: 3, n: 15 }), cell({ date: "2026-11-01", k: 15, n: 15 })]);
    assert.equal(rows[0]!.latest.date, "2026-11-02");
    assert.equal(rows[0]!.status, "DROP");
  });

  test("compares the latest run with the previous run only", () => {
    const rows = trend([cell({ date: "2026-11-01", k: 15, n: 15 }), cell({ date: "2026-11-02", k: 3, n: 15 }), cell({ date: "2026-11-03", k: 3, n: 15 })]);
    assert.equal(rows[0]!.status, "noise");
  });

  test("ignores judge lines", () => {
    const judge: Line = { schema: 1, kind: "judge", run: "2026-11-01-judge-fixture", date: "2026-11-01", judge_set: "set", model: "pico", subset: "all", n: 10, pairs: null, auc: 0.8, auc_ci95: [0.6, 0.9], pair_acc: null, cases_sha256: SHA };
    assert.deepEqual(trend([judge]), []);
  });
});

describe("large change in cost, duration and tokens", () => {
  const run = (previous: Partial<Cell>, latest: Partial<Cell>, n = 8) =>
    trend([cell({ date: "2026-11-01", k: 4, n, ...METRICS, ...previous }), cell({ date: "2026-11-02", k: 4, n, ...METRICS, ...latest })])[0]!.changes;
  const byName = (changes: ReturnType<typeof run>) => Object.fromEntries(changes.map((c) => [c.metric, c]));

  test("the threshold is a 50% relative change on at least 5 trials per side", () => {
    assert.equal(LARGE_CHANGE, 0.5);
    assert.equal(LARGE_MIN_N, 5);
  });

  test("compares the latest mean with the previous mean for cost, duration and total tokens", () => {
    const changes = byName(run({}, { mean_cost_usd: 0.2, mean_duration_s: 60, mean_output_tokens: 3000 + 5000 }));
    assert.deepEqual(Object.keys(changes), ["cost", "duration", "tokens"]);
    assert.equal(changes.cost!.previous, 0.1);
    assert.equal(changes.cost!.latest, 0.2);
    assert.equal(changes.duration!.previous, 40);
    assert.equal(changes.duration!.latest, 60);
    assert.equal(changes.tokens!.previous, TOKENS);
    assert.equal(changes.tokens!.latest, TOKENS + 5000);
  });

  test("flags a change above 50% and stays quiet at or below it", () => {
    const up = byName(run({}, { mean_cost_usd: 0.1 * 1.51, mean_duration_s: 40 * 1.5, mean_cache_read_tokens: 100000 * 3 }));
    assert.equal(up.cost!.large, true);
    assert.equal(up.duration!.large, false, "exactly 50% is not above the threshold");
    assert.equal(up.tokens!.large, true);
    assert.ok(Math.abs(up.cost!.relative! - 0.51) < 1e-9);
    const down = byName(run({}, { mean_cost_usd: 0.04, mean_duration_s: 19 }));
    assert.equal(down.cost!.large, true);
    assert.ok(down.cost!.relative! < -0.5);
    assert.equal(down.duration!.large, true);
    assert.equal(byName(run({}, { mean_cost_usd: 0.14, mean_duration_s: 55 })).cost!.large, false);
  });

  test("does not flag when either side has fewer than 5 trials", () => {
    assert.equal(byName(run({}, { mean_cost_usd: 1 }, 4)).cost!.large, false);
    const mixed = trend([cell({ date: "2026-11-01", k: 4, n: 5, ...METRICS }), cell({ date: "2026-11-02", k: 4, n: 4, ...METRICS, mean_cost_usd: 1 })]);
    assert.equal(mixed[0]!.changes.find((c) => c.metric === "cost")!.large, false);
    const other = trend([cell({ date: "2026-11-01", k: 4, n: 4, ...METRICS }), cell({ date: "2026-11-02", k: 4, n: 5, ...METRICS, mean_cost_usd: 1 })]);
    assert.equal(other[0]!.changes.find((c) => c.metric === "cost")!.large, false);
    assert.equal(byName(run({}, { mean_cost_usd: 1 }, 5)).cost!.large, true);
  });

  test("a metric that a harness did not report is never flagged", () => {
    const changes = byName(run({}, { mean_duration_s: null, mean_cache_read_tokens: null }));
    assert.equal(changes.duration!.latest, null);
    assert.equal(changes.duration!.relative, null);
    assert.equal(changes.duration!.large, false);
    assert.equal(changes.tokens!.latest, null);
    assert.equal(changes.tokens!.large, false);
  });

  test("a cell without the fields has no duration or token change, and a first run has no previous", () => {
    const rows = trend([cell({ date: "2026-11-01", k: 4, n: 8 }), cell({ date: "2026-11-02", k: 4, n: 8, ...METRICS })]);
    const changes = byName(rows[0]!.changes);
    assert.equal(changes.duration!.previous, null);
    assert.equal(changes.duration!.large, false);
    const first = trend([cell({ date: "2026-11-01", k: 4, n: 8, ...METRICS })])[0]!;
    assert.deepEqual(first.changes.map((c) => c.previous), [null, null, null]);
    assert.deepEqual(first.changes.map((c) => c.large), [false, false, false]);
    assert.equal(byName(first.changes).tokens!.latest, TOKENS);
  });

  test("a backfilled metrics line joins its cell before the comparison", () => {
    const old = cell({ date: "2026-11-01", k: 4, n: 8 });
    const backfill: Metrics = {
      schema: 1, kind: "metrics", run: old.run, unit: old.unit, arm: old.arm, harness: old.harness, model: old.model, effort: old.effort,
      fixture: old.fixture, ...METRICS, mean_duration_s: 20,
    };
    const latest = cell({ date: "2026-11-02", k: 4, n: 8, ...METRICS, mean_duration_s: 40 });
    const rows = trend([old, backfill, latest]);
    assert.equal(rows.length, 1);
    const duration = byName(rows[0]!.changes).duration!;
    assert.equal(duration.previous, 20);
    assert.equal(duration.relative, 1);
    assert.equal(duration.large, true);
  });

  test("does not mix a different group's metrics: the unit, arm or fixture decides which cell a metrics line joins", () => {
    const a = cell({ date: "2026-11-01", k: 4, n: 8, arm: "none" });
    const b = cell({ date: "2026-11-01", k: 4, n: 8, arm: "rule" });
    const m: Metrics = { schema: 1, kind: "metrics", run: a.run, unit: a.unit, arm: "rule", harness: a.harness, model: a.model, effort: a.effort, fixture: a.fixture, ...METRICS, mean_duration_s: 99 };
    const rows = trend([a, b, m]);
    const durations = Object.fromEntries(rows.map((r) => [r.latest.arm, r.latest.mean_duration_s]));
    assert.deepEqual(durations, { none: undefined, rule: 99 });
  });
});

describe("report and CLI", () => {
  const history = (cells: Cell[]) => `${cells.map((c) => JSON.stringify(c)).join("\n")}\n`;

  test("the report names the flag rule, the flagged group and the harness version change", () => {
    const text = render(trend([cell({ date: "2026-11-01", k: 15, n: 15 }), cell({ date: "2026-11-02", k: 3, n: 15, harness_version: "2.2.0" })]), 0);
    assert.match(text, /Wilson/);
    assert.match(text, /15\/15\s+3\/15\s+DROP \(harness 2\.1\.322 -> 2\.2\.0\)/);
    assert.match(text, /1 groups, 1 flagged/);
  });

  test("the report prints cost, duration and tokens, previous to latest, and names a large change", () => {
    const text = render(
      trend([
        cell({ date: "2026-11-01", k: 4, n: 8, ...METRICS }),
        cell({ date: "2026-11-02", k: 4, n: 8, ...METRICS, mean_cost_usd: 0.3, mean_duration_s: 41, mean_cache_read_tokens: 250000 }),
      ]),
      0,
    );
    assert.match(text, /large change rule: a mean that moves by more than 50% with at least 5 trials in both runs/);
    assert.match(text, /not a significance test/);
    assert.match(text, /cost USD\s+duration s\s+tokens\s+large change/);
    assert.match(text, /0\.100 -> 0\.300 \(\+200%\)/);
    assert.match(text, /40\.0 -> 41\.0 \(\+3%\)/);
    assert.match(text, /110k -> 260k \(\+136%\)/);
    assert.match(text, /cost \+200%, tokens \+136%/);
    assert.match(text, /1 groups, 0 flagged\. 1 with a large change in cost, duration or tokens\./);
  });

  test("the report prints a dash for a group without a previous run or without the fields", () => {
    const text = render(trend([cell({ date: "2026-11-01", k: 4, n: 8 })]), 0);
    assert.match(text, /0\.100\s+-\s+-\s+-/);
    const unreported = render(trend([cell({ date: "2026-11-01", k: 4, n: 8, ...METRICS }), cell({ date: "2026-11-02", k: 4, n: 8, ...METRICS, mean_duration_s: null })]), 0);
    assert.match(unreported, /0\.100 -> 0\.100 \(\+0%\)\s+-\s+110k -> 110k \(\+0%\)\s+-/);
  });

  test("the report shows a score next to k/n for a cell that has one", () => {
    const text = render(trend([cell({ date: "2026-11-01", k: 1, n: 8, mean_score: 3.75, score_max: 5 })]), 0);
    assert.match(text, /1\/8 \(score 3\.75\/5\)/);
  });

  test("the report tells groups apart that differ only in fixture or grader hash", () => {
    const text = render(trend([cell({ date: "2026-11-01", k: 5, n: 5 }), cell({ date: "2026-11-02", k: 5, n: 5, fixture_sha256: OTHER_SHA, grader_sha256: OTHER_SHA })]), 0);
    assert.match(text, /fixture\/grader sha/);
    assert.match(text, /aaaaaaaa\/aaaaaaaa/);
    assert.match(text, /cccccccc\/cccccccc/);
    assert.match(text, /2 groups, 0 flagged/);
  });

  test("the CLI prints the trend and exits 0, and exits 2 on a history that fails the schema", () => {
    const dir = mkdtempSync(join(tmpdir(), "evals-trend-"));
    const good = join(dir, "history.jsonl");
    writeFileSync(good, history([cell({ date: "2026-11-01", k: 15, n: 15 }), cell({ date: "2026-11-02", k: 3, n: 15 })]));
    const ok = spawnSync(process.execPath, [join(ROOT, "scripts/evals-trend.ts"), good], { encoding: "utf8" });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /DROP/);

    const bad = join(dir, "bad.jsonl");
    writeFileSync(bad, history([cell({ date: "2026-11-01", k: 16, n: 15 })]));
    const failed = spawnSync(process.execPath, [join(ROOT, "scripts/evals-trend.ts"), bad], { encoding: "utf8" });
    assert.equal(failed.status, 2);
    assert.match(failed.stderr, /history line 1: k is larger than n/);
    assert.equal(parseHistory(history([cell({ date: "2026-11-01", k: 1, n: 2 })])).length, 1);
  });
});
