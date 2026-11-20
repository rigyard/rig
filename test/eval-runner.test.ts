import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import {
  aggregateCells,
  analyzeRun,
  fisherExact,
  generateMockTrials,
  mean,
  median,
  newcombeDifference,
  parseSuite,
  promoteToEvidence,
  type Suite,
} from "../scripts/eval-runner.ts";

describe("eval runner statistics", () => {
  test("mean and median calculations", () => {
    assert.equal(mean([]), null);
    assert.equal(median([]), null);
    assert.equal(mean([10, 20, 30]), 20);
    assert.equal(median([10, 20, 30]), 20);
    assert.equal(median([10, 20, 30, 40]), 25);
    assert.equal(mean([10, null, 20]), 15);
  });

  test("newcombeDifference computes valid confidence intervals", () => {
    // Exact equal pass rates: interval must be symmetric around 0
    const [low, high] = newcombeDifference(5, 10, 5, 10);
    assert.ok(low < 0 && high > 0);
    assert.equal(low.toFixed(3), (-high).toFixed(3));

    // Full success vs full failure: interval strictly positive
    const [posLow, posHigh] = newcombeDifference(10, 10, 0, 10);
    assert.ok(posLow > 0.5);
    assert.equal(posHigh, 1);
  });

  test("fisherExact matches known hypergeometric tables", () => {
    // Identical distributions: p-value must be 1.0
    assert.equal(fisherExact(5, 5, 5, 5), 1);

    // Extreme split: [[10, 0], [0, 10]] p-value must be very small
    const p = fisherExact(10, 0, 0, 10);
    assert.ok(p < 0.0001, `expected p < 0.0001, got ${p}`);
  });
});

describe("eval suite parsing", () => {
  test("parses a valid suite JSON", () => {
    const raw = JSON.stringify({
      name: "sample-suite",
      title: "Sample Title",
      question: "Sample Question?",
      unit: "rule:sample",
      arms: ["none", "rule"],
      fixtures: [{ id: "fx1", prompt: "Fix bug." }],
      matrix: [{ harness: "claude", model: "sonnet" }],
      trials_per_cell: 5,
    });
    const s = parseSuite(raw);
    assert.equal(s.name, "sample-suite");
    assert.equal(s.arms.length, 2);
    assert.equal(s.arms[0].name, "none");
    assert.equal(s.fixtures.length, 1);
    assert.equal(s.trials_per_cell, 5);
  });

  test("throws on missing required fields", () => {
    assert.throws(() => parseSuite("{}"), /missing required string: name/);
    assert.throws(() => parseSuite(JSON.stringify({ name: "x" })), /missing non-empty array: arms/);
  });
});

describe("aggregation and analysis", () => {
  const suite: Suite = {
    name: "test-suite",
    title: "Test Suite",
    question: "Does it help?",
    unit: "rule:test",
    arms: [{ name: "none" }, { name: "rule" }],
    fixtures: [{ id: "fx1", prompt: "Fix it." }],
    matrix: [{ harness: "claude", model: "sonnet", effort: "default" }],
    trials_per_cell: 5,
  };

  test("mock trials and aggregation generate valid cell lines", () => {
    const trials = generateMockTrials(suite, 5);
    assert.equal(trials.length, 10); // 2 arms * 1 fixture * 1 model * 5 trials

    const cells = aggregateCells("2026-11-19-test", "2026-11-19", suite.unit, trials, {
      fx1: { fixture_sha256: "1".repeat(64), grader_sha256: "2".repeat(64) },
    });
    assert.equal(cells.length, 2); // 2 cells: arm none and arm rule
    assert.equal(cells[0].n, 5);
    assert.equal(cells[1].n, 5);
    assert.equal(cells[0].fixture_sha256, "1".repeat(64));
    assert.ok(typeof cells[0].mean_cost_usd === "number");
  });

  test("analyzeRun returns structured verdict and decision text", () => {
    const trials = generateMockTrials(suite, 5);
    const cells = aggregateCells("2026-11-19-test", "2026-11-19", suite.unit, trials, {});
    const { verdict, analysisText } = analyzeRun(suite, cells);

    assert.ok(["hypothesis-supported", "hypothesis-contradicted", "no-claim", "descriptive"].includes(verdict.label));
    assert.ok(analysisText.includes("claude/sonnet [fx1]"));
  });
});

describe("promoteToEvidence", () => {
  test("updates evidence.json cleanly", () => {
    const dir = mkdtempSync(join(tmpdir(), "eval-ev-"));
    const file = join(dir, "evidence.json");
    try {
      promoteToEvidence(file, "pstack/how", "helps", "evals/runs/test-run", "2026-11-19", ["claude-sonnet-5-5"]);
      const read = JSON.parse(readFileSync(file, "utf8"));
      assert.equal(read.schema, 1);
      assert.deepEqual(read.units["pstack/how"], {
        status: "helps",
        source: "evals/runs/test-run",
        models: ["claude-sonnet-5-5"],
        date: "2026-11-19",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
