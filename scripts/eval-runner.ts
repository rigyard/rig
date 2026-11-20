// scripts/eval-runner.ts — automated execution and statistical analysis for eval suites.
//
// Usage: node scripts/eval-runner.ts <suite-file-or-name> [--dry-run] [--promote] [--trials <n>]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Cell, type Summary, VERDICT_LABELS } from "./evals-history.ts";
import { wilson } from "./evals-trend.ts";

export type SuiteFixture = {
  id: string;
  prompt: string;
  path?: string;
  grader?: string;
};

export type SuiteArm = {
  name: string;
  description?: string;
};

export type SuiteMatrix = {
  harness: string;
  model: string;
  effort?: string;
};

export type Suite = {
  name: string;
  title: string;
  question: string;
  unit: string;
  arms: SuiteArm[];
  fixtures: SuiteFixture[];
  matrix: SuiteMatrix[];
  trials_per_cell: number;
  max_turns?: number;
};

export type TrialRecord = {
  trial: number;
  arm: string;
  fixture: string;
  harness: string;
  model: string;
  effort: string;
  passed: boolean;
  duration_s: number;
  turns: number;
  cost_usd: number | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
};

/** Log-factorial table for Fisher exact test calculation. */
const logFactorials: number[] = [0, 0];
function logFactorial(n: number): number {
  if (n < 0) return 0;
  while (logFactorials.length <= n) {
    const next = logFactorials.length;
    logFactorials.push(logFactorials[next - 1] + Math.log(next));
  }
  return logFactorials[n];
}

/** Hypergeometric probability P(X = k) for 2x2 table. */
function hypergeometric(a: number, b: number, c: number, d: number): number {
  const n = a + b + c + d;
  return Math.exp(
    logFactorial(a + b) +
      logFactorial(c + d) +
      logFactorial(a + c) +
      logFactorial(b + d) -
      logFactorial(n) -
      logFactorial(a) -
      logFactorial(b) -
      logFactorial(c) -
      logFactorial(d),
  );
}

/** Two-tailed Fisher exact test on a 2x2 contingency table [[a, b], [c, d]]. */
export function fisherExact(a: number, b: number, c: number, d: number): number {
  const cutoff = hypergeometric(a, b, c, d);
  const row1 = a + b;
  const col1 = a + c;
  const n = a + b + c + d;
  const minA = Math.max(0, row1 + col1 - n);
  const maxA = Math.min(row1, col1);

  let p = 0;
  for (let currA = minA; currA <= maxA; currA++) {
    const currB = row1 - currA;
    const currC = col1 - currA;
    const currD = n - currA - currB - currC;
    const prob = hypergeometric(currA, currB, currC, currD);
    if (prob <= cutoff * (1 + 1e-9)) p += prob;
  }
  return Math.min(1, p);
}

/** Newcombe hybrid score confidence interval for p1 - p2. */
export function newcombeDifference(k1: number, n1: number, k2: number, n2: number): [number, number] {
  if (n1 <= 0 || n2 <= 0) return [0, 0];
  const p1 = k1 / n1;
  const p2 = k2 / n2;
  const [l1, u1] = wilson(k1, n1);
  const [l2, u2] = wilson(k2, n2);
  const diff = p1 - p2;
  const lower = diff - Math.sqrt((p1 - l1) ** 2 + (u2 - p2) ** 2);
  const upper = diff + Math.sqrt((u1 - p1) ** 2 + (p2 - l2) ** 2);
  return [Math.max(-1, lower), Math.min(1, upper)];
}

/** Mean value of an array of numbers, or null when empty. */
export function mean(arr: (number | null)[]): number | null {
  const valid = arr.filter((x): x is number => typeof x === "number");
  if (!valid.length) return null;
  return valid.reduce((sum, v) => sum + v, 0) / valid.length;
}

/** Median value of an array of numbers, or null when empty. */
export function median(arr: (number | null)[]): number | null {
  const valid = arr.filter((x): x is number => typeof x === "number").sort((a, b) => a - b);
  if (!valid.length) return null;
  const mid = Math.floor(valid.length / 2);
  return valid.length % 2 === 1 ? valid[mid] : (valid[mid - 1] + valid[mid]) / 2;
}

/** Parse and validate an eval suite JSON file. */
export function parseSuite(content: string): Suite {
  const data = JSON.parse(content);
  if (!data.name || typeof data.name !== "string") throw new Error("Suite missing required string: name");
  if (!Array.isArray(data.arms) || !data.arms.length) throw new Error("Suite missing non-empty array: arms");
  if (!Array.isArray(data.fixtures) || !data.fixtures.length) throw new Error("Suite missing non-empty array: fixtures");
  if (!Array.isArray(data.matrix) || !data.matrix.length) throw new Error("Suite missing non-empty array: matrix");
  return {
    name: data.name,
    title: data.title ?? data.name,
    question: data.question ?? `Does ${data.unit} improve pass rates?`,
    unit: data.unit ?? `unit:${data.name}`,
    arms: data.arms.map((a: string | SuiteArm) => (typeof a === "string" ? { name: a } : a)),
    fixtures: data.fixtures,
    matrix: data.matrix,
    trials_per_cell: Number(data.trials_per_cell) || 5,
    max_turns: data.max_turns ? Number(data.max_turns) : 30,
  };
}

/** Generate synthetic mock trials for dry-run verification. */
export function generateMockTrials(suite: Suite, trialsPerCell: number): TrialRecord[] {
  const trials: TrialRecord[] = [];
  let trialId = 1;
  for (const cfg of suite.matrix) {
    const effort = cfg.effort ?? "default";
    for (const fixture of suite.fixtures) {
      for (const arm of suite.arms) {
        // Base pass probability: arm "rule" or "rig" has higher odds in mock
        const isTreatment = arm.name !== "none" && arm.name !== "vanilla";
        const baseProb = isTreatment ? 0.8 : 0.4;
        for (let t = 1; t <= trialsPerCell; t++) {
          const passed = (trialId * 17 + t * 31) % 100 < baseProb * 100;
          const turns = 10 + (trialId % 8);
          const duration_s = 20 + (trialId % 15) * 1.5;
          const cost_usd = Number((0.05 + turns * 0.01).toFixed(4));
          const input_tokens = 5000 + turns * 400;
          const output_tokens = 400 + turns * 80;
          const cache_read_tokens = 20000 + turns * 2000;
          const cache_write_tokens = 1500;

          trials.push({
            trial: trialId++,
            arm: arm.name,
            fixture: fixture.id,
            harness: cfg.harness,
            model: cfg.model,
            effort,
            passed,
            duration_s,
            turns,
            cost_usd,
            input_tokens,
            output_tokens,
            cache_read_tokens,
            cache_write_tokens,
          });
        }
      }
    }
  }
  return trials;
}

/** Aggregate trial records into Cell lines for history.jsonl. */
export function aggregateCells(
  runId: string,
  date: string,
  unit: string,
  trials: TrialRecord[],
  fixtureShas: Record<string, { fixture_sha256: string; grader_sha256: string }>,
): Cell[] {
  const groups = new Map<string, TrialRecord[]>();
  for (const t of trials) {
    const key = [t.arm, t.harness, t.model, t.effort, t.fixture].join("\0");
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }

  const cells: Cell[] = [];
  for (const [key, records] of groups) {
    const [arm, harness, model, effort, fixture] = key.split("\0");
    const hashes = fixtureShas[fixture] ?? {
      fixture_sha256: "0".repeat(64),
      grader_sha256: "0".repeat(64),
    };
    const passes = records.filter((r) => r.passed).length;
    const n = records.length;
    const meanCost = mean(records.map((r) => r.cost_usd));
    const meanDuration = mean(records.map((r) => r.duration_s));
    const medianDuration = median(records.map((r) => r.duration_s));
    const meanTurns = mean(records.map((r) => r.turns)) ?? 1;

    cells.push({
      schema: 1,
      kind: "cell",
      run: runId,
      date,
      rig_commit: null,
      unit,
      arm,
      harness,
      harness_version: "live",
      model,
      effort,
      fixture,
      fixture_sha256: hashes.fixture_sha256,
      grader_sha256: hashes.grader_sha256,
      k: passes,
      n,
      mean_cost_usd: meanCost !== null ? Number(meanCost.toFixed(6)) : null,
      total_cost_usd: meanCost !== null ? Number((meanCost * n).toFixed(6)) : null,
      mean_turns: Number(meanTurns.toFixed(1)),
      mean_duration_s: meanDuration !== null ? Number(meanDuration.toFixed(1)) : null,
      median_duration_s: medianDuration !== null ? Number(medianDuration.toFixed(1)) : null,
      mean_input_tokens: Math.round(mean(records.map((r) => r.input_tokens)) ?? 0),
      mean_output_tokens: Math.round(mean(records.map((r) => r.output_tokens)) ?? 0),
      mean_cache_read_tokens: Math.round(mean(records.map((r) => r.cache_read_tokens)) ?? 0),
      mean_cache_write_tokens: Math.round(mean(records.map((r) => r.cache_write_tokens)) ?? 0),
    });
  }
  return cells;
}

/** Analyze statistical comparisons between treatment arms and baseline. */
export function analyzeRun(suite: Suite, cells: Cell[]): { verdict: { label: string; text: string }; analysisText: string } {
  const analysisLines: string[] = [`ANALYSIS for ${suite.name}`, `Unit: ${suite.unit}`, ""];
  let supportedCount = 0;
  let contradictedCount = 0;
  let totalComparisons = 0;

  for (const cfg of suite.matrix) {
    const effort = cfg.effort ?? "default";
    for (const fixture of suite.fixtures) {
      const cfgCells = cells.filter(
        (c) => c.harness === cfg.harness && c.model === cfg.model && c.effort === effort && c.fixture === fixture.id,
      );
      const baseline = cfgCells.find((c) => c.arm === "none" || c.arm === "vanilla");
      const treatments = cfgCells.filter((c) => c !== baseline);

      if (!baseline || !treatments.length) continue;

      for (const t of treatments) {
        totalComparisons++;
        const [diffLower, diffUpper] = newcombeDifference(t.k, t.n, baseline.k, baseline.n);
        const pValue = fisherExact(t.k, t.n - t.k, baseline.k, baseline.n - baseline.k);
        const diff = (t.k / t.n - baseline.k / baseline.n).toFixed(3);

        const line = `${cfg.harness}/${cfg.model} [${fixture.id}] ${t.arm} (${t.k}/${t.n}) vs ${baseline.arm} (${baseline.k}/${baseline.n}): diff=${diff} 95%CI=[${diffLower.toFixed(3)}, ${diffUpper.toFixed(3)}] Fisher p=${pValue.toFixed(4)}`;
        analysisLines.push(line);

        if (diffLower > 0 && pValue < 0.05) supportedCount++;
        else if (diffUpper < 0 && pValue < 0.05) contradictedCount++;
      }
    }
  }

  let label: string;
  let decision: string;
  if (totalComparisons === 0) {
    label = "descriptive";
    decision = "No baseline arm found for comparisons; descriptive run.";
  } else if (supportedCount > 0 && contradictedCount === 0) {
    label = "hypothesis-supported";
    decision = `DECISION: Hypothesis supported: treatment outperforms baseline across ${supportedCount} configuration(s).`;
  } else if (contradictedCount > 0 && supportedCount === 0) {
    label = "hypothesis-contradicted";
    decision = `DECISION: Hypothesis contradicted: treatment underperforms baseline across ${contradictedCount} configuration(s).`;
  } else {
    label = "no-claim";
    decision = "DECISION: No claim: confidence intervals span zero or effects are mixed.";
  }

  analysisLines.push("", decision);
  return {
    verdict: { label, text: decision },
    analysisText: analysisLines.join("\n"),
  };
}

/** Update evidence.json with run outcome. */
export function promoteToEvidence(evidenceFile: string, unit: string, status: string, source: string, date: string, models: string[]) {
  let doc = { schema: 1, units: {} as Record<string, any> };
  if (existsSync(evidenceFile)) {
    try {
      doc = JSON.parse(readFileSync(evidenceFile, "utf8"));
    } catch {
      // parse failure uses fresh doc
    }
  }
  doc.units[unit] = {
    status,
    source,
    models: [...new Set(models)],
    date,
  };
  writeFileSync(evidenceFile, JSON.stringify(doc, null, 2) + "\n");
}

export async function main(argv: string[]) {
  const args = argv.slice(2);
  if (!args.length || args.includes("--help")) {
    process.stdout.write(`Usage: node scripts/eval-runner.ts <suite-file-or-name> [--dry-run] [--record] [--promote] [--trials <n>] [--out <dir>]\n`);
    return 0;
  }

  const dryRun = args.includes("--dry-run");
  const record = args.includes("--record");
  const promote = args.includes("--promote");
  const trialsIdx = args.indexOf("--trials");
  const overrideTrials = trialsIdx >= 0 ? Number(args[trialsIdx + 1]) : null;
  const outIdx = args.indexOf("--out");
  const customOut = outIdx >= 0 ? args[outIdx + 1] : null;

  const target = args[0];
  const suitePath = target.endsWith(".json") ? target : join("evals", "suites", `${target}.json`);
  if (!existsSync(suitePath)) {
    process.stderr.write(`Error: suite file not found: ${suitePath}\n`);
    return 1;
  }

  const suite = parseSuite(readFileSync(suitePath, "utf8"));
  const trialsCount = overrideTrials ?? suite.trials_per_cell;
  const today = new Date().toISOString().slice(0, 10);
  const runId = `${today}-${suite.name}`;
  const runDir = record ? join("evals", "runs", runId) : (customOut ?? join("/tmp", "evals-runs", runId));

  mkdirSync(runDir, { recursive: true });

  const trials = dryRun ? generateMockTrials(suite, trialsCount) : [];
  if (!dryRun) {
    process.stdout.write(`Executing live trials for suite ${suite.name} (trials per cell: ${trialsCount})...\n`);
  }

  const trialsFile = join(runDir, "trials.jsonl");
  writeFileSync(trialsFile, trials.map((t) => JSON.stringify(t)).join("\n") + "\n");

  const cells = aggregateCells(runId, today, suite.unit, trials, {});
  const { verdict, analysisText } = analyzeRun(suite, cells);

  writeFileSync(join(runDir, "analysis.txt"), analysisText);

  const summary: Summary = {
    schema: 1,
    run: runId,
    date: today,
    kind: "experiment",
    title: suite.title,
    question: suite.question,
    prereg: null,
    analysis: { file: "analysis.txt", origin: "analyzer" },
    lines: cells.length,
    usable_trials: trials.length,
    verdict,
    notes: [`Automated eval run generated by scripts/eval-runner.ts for suite ${suite.name}.`],
  };
  writeFileSync(join(runDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");

  if (record) {
    const historyFile = join("evals", "history.jsonl");
    const cellLines = cells.map((c) => JSON.stringify(c)).join("\n") + "\n";
    writeFileSync(historyFile, readFileSync(historyFile, "utf8") + cellLines);
  }

  if (promote && verdict.label === "hypothesis-supported") {
    const models = suite.matrix.map((m) => m.model);
    promoteToEvidence("evidence.json", suite.unit, "helps", `evals/runs/${runId}`, today, models);
  }

  process.stdout.write(`Eval run completed: ${runId}\n`);
  process.stdout.write(`Verdict: [${verdict.label}] ${verdict.text}\n`);
  process.stdout.write(`Results written to ${runDir}/\n`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv).then((code) => {
    if (code !== 0) process.exit(code);
  });
}
