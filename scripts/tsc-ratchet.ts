// scripts/tsc-ratchet.ts — the typecheck gate. Runs tsc over tsconfig.json (strict) and compares the error count with
// tsc-baseline.json. More errors than the baseline fails; equal or fewer passes and prints the delta per code.
// A tsc that did not run, or an error without a file location (config, no inputs), always fails.
//
// Usage: node scripts/tsc-ratchet.ts [--update]   --update writes the current counts as the new baseline

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

export type Counts = { total: number; byCode: Record<string, number> };
export type Verdict = { ok: boolean; lines: string[]; counts: Counts };

const LOCATED = /^.+\(\d+,\d+\): error (TS\d+):/;
const ANY_ERROR = /\berror (TS\d+):/;

/** Error counts by code from `tsc --pretty false` output, plus the error lines that carry no file location. */
export function countErrors(output: string): { counts: Counts; unlocated: string[] } {
  const byCode: Record<string, number> = {};
  const unlocated: string[] = [];
  let total = 0;
  for (const line of output.split("\n")) {
    const located = line.match(LOCATED);
    if (located) {
      byCode[located[1]] = (byCode[located[1]] ?? 0) + 1;
      total++;
    } else if (ANY_ERROR.test(line)) unlocated.push(line.trim());
  }
  const sorted = Object.fromEntries(Object.entries(byCode).sort(([a], [b]) => a.localeCompare(b)));
  return { counts: { total, byCode: sorted }, unlocated };
}

/** Compare one tsc run with the baseline. status: the tsc exit code, null when it did not exit normally. */
export function judge(baseline: Counts, output: string, status: number | null): Verdict {
  const { counts, unlocated } = countErrors(output);
  const lines: string[] = [];
  const fail = (why: string): Verdict => ({ ok: false, lines: [...lines, `tsc ratchet: FAIL: ${why}`], counts });
  if (status === null) return fail("tsc did not run to completion");
  if (unlocated.length) return fail(`errors without a file location:\n  ${unlocated.join("\n  ")}`);
  if (status === 0 && counts.total > 0) return fail(`tsc exited 0 but printed ${counts.total} errors`);
  if (status !== 0 && counts.total === 0) return fail(`tsc exited ${status} with no error lines:\n${output.trim()}`);
  const delta = counts.total - baseline.total;
  lines.push(`tsc ratchet: ${counts.total} errors, baseline ${baseline.total} (delta ${delta > 0 ? "+" : ""}${delta})`);
  const codes = [...new Set([...Object.keys(baseline.byCode), ...Object.keys(counts.byCode)])].sort();
  for (const code of codes) {
    const was = baseline.byCode[code] ?? 0;
    const now = counts.byCode[code] ?? 0;
    if (now !== was) lines.push(`  ${code}: ${was} -> ${now} (${now > was ? "+" : ""}${now - was})`);
  }
  if (delta > 0) return fail(`${delta} more errors than the baseline; fix them, or type the new code`);
  if (delta < 0) lines.push("tsc ratchet: below the baseline; lower it with: node scripts/tsc-ratchet.ts --update");
  return { ok: true, lines, counts };
}

function main(): void {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const baselineUrl = new URL("../tsc-baseline.json", import.meta.url);
  const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
  const run = spawnSync(process.execPath, [tsc, "-p", root, "--pretty", "false"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (run.error) throw run.error;
  const output = `${run.stdout}${run.stderr}`;
  if (process.argv.includes("--update")) {
    const { counts, unlocated } = countErrors(output);
    if (unlocated.length) throw new Error(`tsc ratchet: not writing a baseline over unlocated errors:\n${unlocated.join("\n")}`);
    writeFileSync(baselineUrl, `${JSON.stringify(counts, null, 2)}\n`);
    console.log(`tsc ratchet: baseline set to ${counts.total} errors`);
    return;
  }
  const baseline: Counts = JSON.parse(readFileSync(baselineUrl, "utf8"));
  const verdict = judge(baseline, output, run.status);
  for (const line of verdict.lines) (verdict.ok ? console.log : console.error)(line);
  process.exitCode = verdict.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
