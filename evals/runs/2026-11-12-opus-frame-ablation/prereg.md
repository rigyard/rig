# Preregistration: does one sentence of the rig frame make Claude Opus fix fewer call sites?

Written 2026-11-12 after calibration (32 vanilla trials, `calibration-plan.md`) and before any ablation trial. Locked files and their sha256 are in `SHA256SUMS` (this file included). Every number below is a run-local choice, `example - do not ship as a rig threshold`, unless it says `derive-from`.

## Question

Earlier run (`../rigstack`, opus, fx4b, 6 trials per arm): vanilla 5/6, rig 1/6, rig with `/craft` 0/6. Transcripts suggest rig narrowed the fix to the reported site. Which text in the rig arm causes that, and does it hold on real tasks? This run tests one candidate sentence.

## Candidates (rig arm tree `arms/rig/project/.claude`, rig main `2dbce75`)

Sentences that push toward a minimal or local change:

- `rules/rig-frame.md:5` "1. State the user's goal in your words and the smallest change that meets it." Always loaded.
- `skills/craft/hub.md:19` "...and, if the task ships a change, the smallest change you expect to meet it." Loaded only after the hub is read.
- `skills/craft/hub.md:45` "**Laziness Protocol.** ... Bias to deletion and the smallest change that solves the problem."
- `skills/principle-laziness-protocol/SKILL.md:3` (description) and `:12` "**Minimize the diff.** Make the smallest change that solves the problem."
- `skills/craft/playbooks/bug-fix.md:5` "The smallest change the evidence justifies ships, nothing more."
- `skills/craft/playbooks/autonomous-run.md:7` "Each iteration makes the smallest change the evidence justifies".
- `skills/craft/playbooks/refactoring.md:10` "The smallest change that reaches the target shape ships".

Pick: `rules/rig-frame.md:5`. Reasons. (1) The frame is the only rig text the model loads in every session. The rig arm delivers no `CLAUDE.md`, and all 58 skills carry `disable-model-invocation: true`, so no skill description is in the model's listing. (2) The hub was opened in 0 of 24 rig-arm trials without `/craft` (rigstack results), so every other candidate was out of context in those trials, and `rig` still scored 1/6 on fx4b. No other always-loaded sentence asks for a minimal change.

Not ablated, so not excluded: frame line 3 ("Verify on the real artifact"), line 4 ("Report with evidence per claim and an uncertainties section"), the first line of the trigger list, and the model rule `rules/pstack-models.md`.

## Arms (arms differ only by the delivered rig config; the prompt is the same)

- `vanilla`: a fresh copy of the fixture, no `.claude/`, no `CLAUDE.md`.
- `rig`: vanilla plus `.claude/{agents,skills,rules}` of `arms/rig/project`, byte-identical to `../rigstack/arms/rig/project` (`arms/rig/manifest-project.txt` equals `../rigstack/arms/rig/manifest-project.txt`, 122 files). It contains the one byte change of the earlier run: the frame names `.claude/skills/...` and not `~/.claude/skills/...`, because the real home is denied.
- `rig-ablated`: `rig` with line 5 of `rules/rig-frame.md` ended at "your words". Proof: `diff -r arms/rig/project arms/rig-ablated/project` prints one hunk, `5c5`, `< 1. State the user's goal in your words and the smallest change that meets it.` and `> 1. State the user's goal in your words.` `diff arms/rig/manifest-project.txt arms/rig-ablated/manifest-project.txt` differs in the one line of `rig-frame.md` (121 other files equal).

Interpretation choice. The brief says "that one sentence removed". Removing the whole line would also remove "State the user's goal in your words", which is not the suspect and could change behavior by itself. The ablation removes only the clause "and the smallest change that meets it", so the two arms differ in the suspect text alone.

Isolation (as in the rigstack runner): `claude -p` 2.1.322, `--setting-sources project,local --strict-mcp-config`, real `~/.claude` and `~/.agents` denied for Read and Bash, `ANTHROPIC_*` and `CLAUDE_CONFIG_DIR` dropped from the child env, no session persistence. The runner stops the batch when a file under the real user config becomes newer than the batch marker.

## Tasks

`tasks.json`: fx4b, `tox-dev__tox-3683`, `joke2k__django-environ-592`. Rule (frozen in `calibration-plan.md` before calibration): fx4b plus the first 4 tasks with exactly 1 pass of 2 vanilla trials, in `swerebench/candidates.tsv` order. Only two qualified, so the ablation has 3 tasks. No task was added. A 0/2 task with partial progress is not eligible by the same rule.

Calibration, vanilla, opus, 30 turns (`results/calibration.txt`, k of 2): virtualenv-3015 0, tox-3931 2, strands-1734 2, faker-2309 2, scim2-models-126 2, pypsa-1653 2, django-bird-239 2, marshmallow-2925 2, tox-3683 1, narwhals-3478 0, sqlglot-6991 0, pygraphistry-1107 2, ro-crate-py-248 2, jsonpickle-588 2, fusesoc-776 2, django-environ-592 1. Total cost 15.39 USD. 11 tasks sit at ceiling, 3 at floor, 2 qualify. With 2 trials a task with a true pass rate of 0.9 shows 1/2 about 18% of the time, so the two selected tasks may be easier than they look. Both tox-3683 calibration trials ended with `error_max_turns` (one still passed). The ablation reports the max-turns cut rate per arm.

Prompts. fx4b: `We sold the last limited-edition mug twice: two customers checked out at the same moment and both orders went through. Please fix it.` The SWE tasks use `swerebench/prompts/<id>.md` plus the line "The repo's tests run with `./run-tests [pytest args]` from the repo root." (amendment 1 of the calibration plan). The prompt sha256 as the runner sends it: fx4b `140b68256a60c896233baf82facc0d13e870a4377fba1edd99bdbecb25533464`, tox-3683 `0bd60a373d4733d84ede923998b0a01f562f1561fa17cac8c702a8c32303c10b`, django-environ-592 `7760b5ec423c01c8773bf6330d43071bf9ac915da7a05f300f7894bc6383ef69`.

Fixture and grader hashes: `hashes.json`, produced by `hashes.sh` (sha256 of the sorted `sha256  ./path` lines of every file under the directory, `.git` excluded; for fx4b the earlier run's values). Graders: fx4b `.grade-4b/check.ts` (4 tests, all must pass), SWE `graders/<id>/grade.sh <workdir>` (exit 0 passes). Graders are run by the runner and are not read by the experimenter.

## Design

- n = 6 per arm per task, 3 arms, 3 tasks: 54 trials. Model alias `opus` (reported as `claude-opus-5-5`), default effort, `--max-turns 30` (the earlier run used 40 for fx4b), `--max-budget-usd 6`, `--permission-mode acceptEdits`, 1500 s per trial, concurrency 2.
- Allowlist, identical in all arms: `node`, `git`, `ls`, `cat`, `grep`, `find`; for SWE tasks also `./run-tests`, `python`, `python3`, the instance venv python, `rg`, `head`, `tail`, `wc`, `diff`, `sed -n`. Reads of the graders, the gold patches and the dataset rows are denied.
- Order: round-robin by trial number, then task, with the arm order rotated by (trial number + task index) so that no arm always runs first.
- Cap: 130 runs in `results/runs.log` across calibration and ablation. Used before this file: 36 (32 calibration, 4 discarded pilot). The ablation needs 54, so 40 remain for infra retries.

## Outcome, statistics and decision rule

Outcome: pass = grader exit 0 on the final work tree, graded after the run. A trial cut by `error_max_turns` is graded on its tree and counts as a normal fail or pass.

Primary: pooled (rig-ablated minus rig) pass-rate difference over the primary tasks. Secondary: pooled (rig minus vanilla). Pooled rate = passes over trials summed over tasks. CI: stratified bootstrap, strata = task x arm, trials resampled within a stratum, 10,000 resamples, fixed seed 20261112 (mulberry32, one stream), percentile 95% interval (sorted draws at index floor(0.025 B) and floor(0.975 B) - 1). Per-task differences carry the same bootstrap CI. Everything else (rig-ablated minus vanilla, per-task numbers, cost, turns, time, tokens, files changed, routing) is descriptive.

Decision rule, applied by `analyze.ts` and printed as `DECISION:`:
1. A task whose rig or rig-ablated cell has fewer than 5 usable trials is dropped from the primary and the secondary. No task left: `untested`.
2. Ceiling: pooled rig and pooled rig-ablated both >= 0.90: `not separable, no claim`. Floor: both <= 0.10: `not separable, no claim`.
3. "the sentence causes the drop" only if the primary CI lower bound is > 0 on all trials and on the leak-dropped sensitivity set. If only the all-trials bound is > 0 the report says so and calls it fragile.
4. Primary CI upper bound < 0: removing the sentence lowers the pass rate. Otherwise `no claim` (a null is not evidence that the sentence is harmless).
5. The secondary contrast is read separately: a "drop" of rig against vanilla is shown only if its CI upper bound is < 0. Without a shown drop, rule 3 explains nothing about a drop.

Missing trials. Infra: a result event with `is_error` and either `terminal_reason` api_error, or zero cost with zero turns, or no assistant turn (the limit-cut quarantine). It is retried once. A second infra result makes the trial `missing`, and it is not retried again. A message about a usage or rate limit stops all launches. The analysis then runs on the completed trials and is labelled PARTIAL. A grader exit code other than 0 or 1 is regraded once, then the trial is `missing`.

Exposure. First-turn input tokens (input plus cache read plus cache write of the first assistant event of the main session) against the vanilla median on the same task: `rig` and `rig-ablated` count as loaded at +500 or more. `rig` minus `rig-ablated` is expected near +10 tokens, which would show the sentence in one arm only. A vanilla trial more than 100 tokens off its median is flagged. The stream also gives: hub opened, bug-fix playbook, laziness skill, frame file read, subagent spawns, `./run-tests` calls, files and hunks changed (diff against the fixture, taken before grading), permission denials.

Leak flags. A trial is leak-flagged when a tool input (not tool output) names the graders, the gold or dataset folders, `rigstack`, `ablation`, `grade.sh`, `f2p.txt`, or the real `~/.claude` or `~/.agents`. Flagged trials stay in the primary and are dropped in the sensitivity. The calibration shows one such flag (a denied read of the agent's own spilled tool output under `~/.claude/projects`), so flags can be false positives.

## Uncertainties and assumptions

- A1. Line 5 is the cause of the rig drop (5/10). Probe: rig-ablated passes fx4b as often as rig. This run tests it. Open risk: lines 3 and 4 or the mere presence of a frame could cause it. A null would leave those untested.
- A2. Removing the clause alone is a clean ablation (7/10). Probe: first-turn tokens of `rig` minus `rig-ablated` near +10. Checked in the analysis.
- A3. The fx4b result of the earlier run reproduces under 30 turns and the allowlist of this run (6/10). Probe: vanilla on fx4b at 5/6 or 4/6 here. Open risk until the data are in.
- A4. The two SWE tasks carry signal (4/10). Selection used 2 trials per task. Probe: all three arms at 6/6 or 0/6 on a task makes it uninformative. Reported per task.
- A5. 18 trials per arm are enough (3/10). A CI half-width near 0.25 means only a large effect shows. A null is therefore weak.
- A6. The vanilla arm is not contaminated by rig content (9/10). Probe: vanilla init skills 19 and first-turn tokens within 100 of the median. Checked in the analysis.
Overall confidence that this run answers the question: 4/10, for the power reason in A5.

## Locked files

`run-ablation.ts`, `analyze.ts`, `hashes.sh`, `hashes.json`, `tasks.json`, `calibration-plan.md`, `results/calibration.json`, `results/calibration.txt`, `arms/rig/manifest-project.txt`, `arms/rig-ablated/manifest-project.txt`, `prereg.md`, and `../swerebench/SHA256SUMS`. Check: `shasum -a 256 -c SHA256SUMS` and, for the trees, `(cd arms/rig/project && find . -type f | LC_ALL=C sort | while read -r f; do printf '%s  %s\n' "$(shasum -a 256 "$f" | cut -d' ' -f1)" "$f"; done) | diff - arms/rig/manifest-project.txt` (same for `rig-ablated`).
