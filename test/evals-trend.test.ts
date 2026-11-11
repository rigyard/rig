// scripts/evals-trend.ts: which run-to-run changes it flags. A change is flagged only when the 95% Wilson intervals
// of the latest run and the previous run of the same group do not overlap.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { parseHistory, type Cell, type Line } from "../scripts/evals-history.ts";
import { render, trend, wilson } from "../scripts/evals-trend.ts";

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

describe("report and CLI", () => {
  const history = (cells: Cell[]) => `${cells.map((c) => JSON.stringify(c)).join("\n")}\n`;

  test("the report names the flag rule, the flagged group and the harness version change", () => {
    const text = render(trend([cell({ date: "2026-11-01", k: 15, n: 15 }), cell({ date: "2026-11-02", k: 3, n: 15, harness_version: "2.2.0" })]), 0);
    assert.match(text, /Wilson/);
    assert.match(text, /15\/15\s+3\/15\s+DROP \(harness 2\.1\.322 -> 2\.2\.0\)/);
    assert.match(text, /1 groups, 1 flagged/);
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
