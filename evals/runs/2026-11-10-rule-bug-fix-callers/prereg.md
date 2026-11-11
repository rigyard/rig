# Preregistration: does one delivered rule change a coding agent's outcome?

Written before any trial of this run. Pilot trials (results/fx4b, results/fx3, others) are excluded from all analysis.

## Question and decision

Question: does a one-sentence bug-fixing rule, delivered only as the work dir's project CLAUDE.md, change the pass rate of Sonnet on two bug-fix fixtures?

Decision rule: claim "rule helps" only if the pooled (rule minus placebo) 95% bootstrap CI excludes 0 on the positive side. Otherwise no claim. A CI excluding 0 on the negative side is reported as "rule hurts" and is not a "helps" claim. No other result may be promoted to a claim. Everything not listed under Primary is descriptive.

## Arms (delivered only as `CLAUDE.md` in the work dir; same prompt, same flags in all arms)

- rule (187 chars, 34 words, sha256 4e8c5d3f01c69c929959d1d9e19c5e77ce0c8fac49459fa38930994f51db42ff, with trailing newline):
  `When fixing a bug: list every caller of the code you will change. Write a failing reproducer, then fix the root cause where all callers route through, not only the path the report names.`
- placebo (163 chars, 27 words, sha256 6a60c98da05588745726db353ae72ffba790f66967c5044a6fefca588c0d1227, with trailing newline):
  `When writing code: prefer descriptive names over abbreviations. Keep functions short and focused, and keep each helper in the same file as the code that calls it.`
- none: no CLAUDE.md.

Known conflict, taken as given: the brief asked for a placebo within +-10% of the rule length and also supplied this exact text. The supplied text is 12.8% shorter in chars (20.6% fewer words). The supplied text is used verbatim. The real token cost of each file is measured by the exposure check.
The placebo contains the clause "keep each helper in the same file as the code that calls it". It is unrelated to bug fixing but could in principle steer fixes toward local edits. This is a threat to the rule-minus-placebo contrast and is stated up front.

## Fixtures and graders (frozen; no edits after this file is written)

Primary (pass = every test of the grader passes):
- fx4b: fixture-4 (file tree sha256 e7b90d2411894ded157629570babf3c3df5c503f30d230be465cf8f595073565, excluding .git), grader `.grade-4b/check.ts` (sha256 f8a946000b8d25b51ab6825eafee1bad017dbac975973a6b6a3fdfe0b5aa02e3), 4 tests. Prompt: "We sold the last limited-edition mug twice: two customers checked out at the same moment and both orders went through. Please fix it."
- fx3: fixture-3 (file tree sha256 1dc4cff312ea7ccf47c95c2acd721cbfb959d78e90ff88dbae780ae72debfd5b, excluding .git), grader `.grade-3/check.ts` (sha256 2a63cd895b5f963abbb56ec7120083b124a8383c6c84afa0f0239daf9859d695), 4 tests. Prompt: "In the member directory, people with accented names (Émile, Óscar, Ángel) are listed after Zoe instead of with the other E, O and A names. Please fix it."

Secondary, descriptive only: `.grade-4/check.ts` (sha256 4bda6d0a90b8a5f41874622198d87976a670ea42052bc175381d95613a25a372, 5 tests) applied to fx4b runs.

Frozen code: `run2.ts` sha256 6b99c9166d0eebf7800232e8076db806659939bd50df9d6e5e1d474bddcd7023, `analyze.ts` sha256 9a14b04e5df3e1fd1812e432c6dc4907e4b8b7203a5cf1a07c244fdf33f94d62.

## Design

- n = 15 per arm per fixture = 90 trials. Model `sonnet`, `--max-turns 20`, `--permission-mode acceptEdits`, allowed tools Bash(node|git|ls|cat|grep|find), `--no-session-persistence`, isolation `--setting-sources project,local --strict-mcp-config`, subscription login (API key env vars removed).
- Order: for n = 1..15, for fixture in (4b, 3), for arm in (rule, placebo, none). This is interleaved round-robin. Up to 3 concurrent runs, each in its own work dir (fresh copy of the fixture).
- Per-trial timeout 300 s (pilot used 480 s). Deviation from pilot, chosen so each tool call stays under 10 minutes.
- Hard cap 100 claude runs including retries and probes, enforced by a counter in `results/main/runs.log`. No separate probes are planned.

## Primary analysis (per fixture and pooled)

- Pass rate per cell (k/n). Differences: rule minus none, rule minus placebo. Placebo minus none is descriptive.
- 95% percentile CI from a stratified bootstrap: resample trials with replacement within each fixture x arm cell at its own n, 10,000 resamples, seed 20261110 (mulberry32). Pooled difference = total passes over total usable trials per arm (equal weights if cells are full).
- Exact Fisher test, two-sided (sum of tables with probability <= observed), per fixture.
- Cost per pass = total costUsd of usable trials in a cell divided by passes in it. Report the ratio rule/none (also rule/placebo), pooled and per fixture. Descriptive, no CI.
- A cell with 15/15 or 0/15 has zero bootstrap variance, so the percentile CI is too narrow there. Fisher is the more trustworthy figure for that fixture. This is an inference about the method, labelled in the report.

## Exposure check (every trial)

Metric: first assistant turn input tokens (input + cache creation + cache read). Baseline: median of the none arm in the same fixture. rule/placebo trial is exposed if metric >= baseline + 100. none trial is clean if |metric - baseline| <= 50. Threshold basis: pilot delta for the rule file was +245 tokens (18616 vs 18371), which includes wrapper text. A failing trial is reported by key and stays in the analysis; it is not dropped.

## Missing-trial and infra rules

- Infra failure: no result event and no assistant turns (crash, kill, timeout with no turns); or an error result with no assistant turns; or any error result (not error_max_turns) whose text matches usage limit / rate limit / overloaded / credit / 429 / 529.
- An infra failure is retried once. A second failure is recorded as missing (neither pass nor fail) and excluded from rates, with its key reported.
- A limit-type failure stops the batch. Wait, then resume. Each such attempt still counts in runs.log toward the cap and is logged in `infra.log`. After resume the trial gets a fresh attempt. Every isError record is inspected by hand.
- A trial that has agent turns but ends in timeout or error_max_turns is graded as-is on the files it left (a real outcome, not infra).

## Hygiene checks

- Prereg mtime precedes the first line of `runs.log`.
- Hidden checks unread: regex scan of every raw transcript for `.grade`, `grader.check`, `rig-runner-proto`, `variants-`, `valwork`, plus a grep afterwards; any hit is reported and the trial's treatment is stated in the report.
- Siblings: any path of another trial's work dir (`scratchpad/<dir>/p<8hex>/`) in a transcript is flagged.
- Arms differ only by CLAUDE.md: init events diffed across arms after removing cwd, session id, uuid, socket path, memory path.
- The first chunk is 3 trials. Records are inspected (tokens, exposure delta, grading, init) before continuing.

## Exploratory (clearly labelled, no claims)

Behavior coding from transcripts: reproducer-first (a test or script run that fails before the first edit), sites fixed (distinct files changed vs the reference root sites), turns. Turns and cost medians per arm.

## Uncertainties

- Model alias `sonnet` may resolve differently across the run window. Recorded from init events.
- fx3 none arm was 4/5 in the pilot, so a ceiling limits the detectable effect there. Pooled effect may be diluted.
- Concurrency 3 may add CPU contention to race-sensitive fixture tests. Graders run right after each trial. Contention is the same across arms by interleaving. Not separately measured.
- 15 per cell detects only large effects. A null result here is not evidence of no effect.
- Two fixtures are a small sample of tasks. Generalization beyond them is not claimed.
