# Preregistration H-G: does gstack's /investigate help Opus on bug-fix tasks?

Written 2026-11-10T22:10Z, before any trial. No `claude` process has run for this hypothesis. Throwaway experiment. All paths are under `.../scratchpad/rig-runner-proto/hyp/`.

## Claim and testable form

Claim (Garry Tan, gstack): "I removed /investigate because Opus 5.5 does it better without it."

Testable form. On bug-fix fixtures, a TOLD arm (gstack `investigate` installed as a project skill, prompt starts with `/investigate `) does not pass more often than a NONE arm (same prompt without the slash command, no skill), and the TOLD arm costs more per pass.

Skill source: gstack commit `b4068209809315ab1578c78e33e73512b29749ca`, directory `investigate/` (SKILL.md plus `sections/*.md`).

## Arms

Both arms use the same flags, the same fixture copy and the same work-dir layout. Only the skill folder and the prompt prefix differ.

- told: `.claude/skills/investigate/` (copy of `skills/investigate/`) is present. Prompt = `/investigate ` + task text.
- none: no skill folder. Prompt = task text.

`.claude/` is in each work dir's `.git/info/exclude` in both arms. The told prompt is built in code as the prefix plus the none prompt (`toldPrompt` in `run-hyp.ts`), and `selfcheck` asserts it.

## Prompts, verbatim (task text)

- fx4b: `We sold the last limited-edition mug twice: two customers checked out at the same moment and both orders went through. Please fix it.`
- fx3: `In the member directory, people with accented names (Émile, Óscar, Ángel) are listed after Zoe instead of with the other E, O and A names. Please fix it.`

Told prompts are the same text with the prefix `/investigate ` (one space, no other change).

## Model and flags

`--model opus` (alias; the resolved model id is recorded from every init event and reported; if it is not an Opus 5.5 id that is stated as a deviation from the claim). `--max-turns 30`, `--permission-mode acceptEdits`, `--allowedTools "Bash(node *)" "Bash(git *)" "Bash(ls *)" "Bash(cat *)" "Bash(grep *)" "Bash(find *)"`, `--no-session-persistence`, `--setting-sources project,local --strict-mcp-config`, subscription login (API key variables removed from the child environment). Per-trial timeout 600 s. Work dirs are under `scratchpad/wh/`, outside `rig-runner-proto`.

## The standalone investigate copy (a deviation, reported with the result)

The gstack skill calls gstack bins (`gstack-skill-start`, `gstack-skill-end`, `gstack-question-*`, `gstack-learnings-*`, `gstack-config`, `gstack-skill-contract`, the freeze helper) and reads a shared preamble. None of these exist on this machine (`~/.claude/skills/gstack` is absent). `hyp/build-investigate.mjs` builds the copy from the pinned git blob. Every edit asserts its anchor. The full diff is `investigate.diff`. The log of removals is `investigate-removals.log`. The classes of change are:

| Class | What was removed or changed | Lines of the 384-line source |
| --- | --- | --- |
| Frontmatter | `preamble-tier`, and the `contract`, `hooks` (freeze-check hooks) and `gbrain` blocks. Kept `name`, `version`, `description`, `allowed-tools`, `triggers`. | 1 + 54 |
| Shared preamble | Section that reads `sections/preamble.md` (AskUserQuestion format, voice, writing, completeness rules). The preamble file is not installed. | part of 78 |
| Preamble, Question Tuning, Telemetry | `gstack-skill-start`, `gstack-question-preference`, `gstack-question-log`, `gstack-skill-end` calls | part of 78 |
| Done means | The paragraph about `gstack-skill-contract check` and `waive`. The two "Done means" bullets stay. | 2 |
| Prior Learnings | The whole section (`gstack-config`, `gstack-learnings-search`, a cross-project AskUserQuestion). | 39 |
| Scope Lock | The freeze availability check, acquire and release bash blocks, and the FREEZE_AVAILABLE branch. Added one line, "Result of the availability check: `FREEZE_UNAVAILABLE`", so the kept branch "If FREEZE_UNAVAILABLE: Skip scope lock. Edits are unrestricted." is the real behavior without the helper. | 25 removed, 1 added |
| Report | The Scope Lock cleanup sentence, the `gstack-learnings-log` call and the whole "Capture Learnings" section. The DEBUG REPORT block stays. | 2 + 33 |
| Section paths | 6 Read paths changed from `~/.claude/skills/gstack/investigate/sections/` to `.claude/skills/investigate/sections/`. The six section files are installed byte-identical to the source. | 6 |

Unchanged and verbatim: Iron Law, Arguments, Section index, How to work (three lessons and three guards), the Recipes STOP blocks, the DEBUG REPORT format, Important Rules, and all six section files (`race.md` and `blast-radius.md` are the ones that matter for these fixtures). The diff has 183 removed non-blank lines and 7 added lines (1 Scope Lock line and the 6 path rewrites). `grep` finds no `~/.claude`, `$HOME`, `.gstack` or `bin/` in the copy. The two survivors of the word "gstack" are the description string "(gstack)" and the added Scope Lock line.

Consequences, stated before data.

- The told arm gets fewer tokens than real gstack, so its cost is a lower bound on the cost of the real skill. A told cost ratio above 1 is therefore conservative. A ratio at or below 1 does not show that real gstack is cheap.
- The skill's AskUserQuestion stops (3-strike rule, more than 5 files) cannot be answered in `-p` mode. This is a property of the harness, equal to what a headless gstack user would see.
- `/investigate` is invoked as a slash command, not a Skill tool call. How `claude -p "/investigate ..."` delivers the body is checked by the delivery gate below.

## Fixtures and graders (frozen)

Both are the calibrated fixtures from the earlier run, copied unchanged. Hashes match that run's `prereg.md`. They were calibrated on Sonnet, not Opus. The Sonnet none-arm pilot (n=5 each) passed 4/5 on fx3 and 3/5 on fx4b.

| Fixture | Tree sha256 (files except `.git`; `find . -type f -not -path './.git/*' \| sort \| xargs shasum -a 256 \| shasum -a 256`) | Grader sha256 | Tests |
| --- | --- | --- | --- |
| fx4b `fixtures/storefront` | e7b90d2411894ded157629570babf3c3df5c503f30d230be465cf8f595073565 | `graders/storefront/check.ts` f8a946000b8d25b51ab6825eafee1bad017dbac975973a6b6a3fdfe0b5aa02e3 | 4 |
| fx3 `fixtures/member-directory` | 1dc4cff312ea7ccf47c95c2acd721cbfb959d78e90ff88dbae780ae72debfd5b | `graders/member-directory/check.ts` 2a63cd895b5f963abbb56ec7120083b124a8383c6c84afa0f0239daf9859d695 | 4 |

A trial passes when all four graded tests pass. The hidden check is copied into the work dir after the run, run with `node --test`, and removed.

Grader validation (`validation-HG-fx3.txt`, `validation-HG-fx4b.txt`, 20 repeats per variant, all stable): no change fails (fx4b 1 of 4 tests pass, fx3 2 of 4); the reference root fix and an alternative fix pass 4 of 4; the symptom-only fix fails (fx4b 3 of 4, fx3 1 of 4). Variants come from the earlier run's `variants-3` and `variants-4`.

## Design

- n = 8 per arm per fixture, 2 fixtures, 2 arms = 32 trials.
- Order. For n = 1..8, for each fixture (fx4b, fx3), the two arms of that pair are queued together. The within-pair order alternates with n (odd n: told first; even n: none first). Up to 3 trials run at once, each in its own fresh copy of the fixture.
- Run cap `RUN_CAP=38` in the command environment, counted in `results/HG/runs.log`: 32 planned trials, 2 stop-at-init probes (one per arm) and 4 retries. The runner's built-in default of 60 is not used.
- Infra rules. An infra failure is a run with no result and no assistant turn, or an error result with no assistant turn, or a limit-type error (usage limit, rate limit, overloaded, credit, 429, 529). It is retried once. A second failure is recorded as missing and excluded. A limit-type failure stops the batch and the batch resumes later. A trial that has assistant turns but ends in timeout or `error_max_turns` is graded as it stands.

## Exposure check and delivery gate

The brief defines exposure as a Skill tool call or a read under the skill folder. A slash command is expanded by the CLI and may leave neither in the event stream, and the first user prompt may not be echoed either. So this preregistration extends the definition twice. Both extensions are reported as deviations from the brief.

Per told trial, these signals are recorded separately. `exposedFinal` means any of the first four is true.

1. `skillCall`. A `Skill` tool call whose input names `investigate` (the brief's definition).
2. `skillRead`. A non-Skill tool call whose input contains `skills/investigate` (the brief's definition).
3. `markerSeen`. The string `NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST` appears anywhere in the event stream (extension 1).
4. Token excess. The first assistant turn's input tokens exceed the median of the none arm in the same fixture by at least 950 tokens, which is half of the SKILL.md size (7602 bytes) divided by 4 (extension 2). This is the one signal that measures slash delivery directly, because the expansion goes into the first user turn. The skill's name and description in the skill listing add well under 950 tokens, so listing alone cannot trigger it.

Recorded but not part of `exposedFinal`: `initHasSkill`, whether the init event lists `investigate` among skills or slash commands.

Delivery gate. If fewer than 6 of 8 told trials in any fixture have `exposedFinal`, or any none trial has `exposedFinal` or lists the skill in init, the delivery failed. No verdict is then allowed. No fallback delivery (such as pasting the skill into CLAUDE.md) is added. Trials from a failed delivery are reported and excluded.

Permission denials. Every trial records `permissionDenials` (the result event's `permission_denials` and tool results that report a permission error). The count per arm is reported. A told-arm excess means the allowlist may explain a gap, and the result is read with that in mind.

## Primary metrics and analysis

All usable trials are analysed as assigned (intent to treat). Per-protocol (told trials with `exposedFinal`, plus all none trials) is a sensitivity analysis.

1. Pass rate per arm and fixture. Difference told minus none, pooled over fixtures. 95% percentile CI from a stratified bootstrap (resample within each fixture and arm cell at its own n; 10,000 resamples; seed 20261110, mulberry32). Per fixture: difference, bootstrap CI and two-sided Fisher exact p.
2. Cost per pass = total `total_cost_usd` of all usable trials in the arm divided by the passes in the arm. Ratio told over none, pooled, and per fixture. Descriptive, no CI. If an arm has zero passes: told zero and none more gives ratio infinity; none zero and told more gives ratio 0; both zero gives "undefined".

Code that does this is frozen as `analyze-hyp.mjs` (`node analyze-hyp.mjs HG`).

## Decision rule (written before data)

- H-G REJECTED if the pooled pass-rate difference CI lower bound is above 0 (told passes more).
- H-G REJECTED on cost if the pass-rate condition holds and the pooled cost-per-pass ratio told/none is 1 or less.
- H-G SUPPORTED if the CI lower bound is 0 or below AND the ratio is above 1. The only permitted wording is "not contradicted at n = 8". It is absence of a detected benefit, not evidence of zero effect.
- Ceiling clause. A fixture is at ceiling if the none arm passes at least 7 of 8. If every fixture is at ceiling, the pass-rate half cannot fail, so the outcome is "NOT TESTABLE on pass rate". The cost ratio is then descriptive only and no "supported" claim is made. If one fixture is at ceiling, the pooled rule applies and the report names the ceiling fixture.
- If the delivery gate failed, or cost per pass is undefined in both arms, there is no verdict.
- Nothing else is promoted to a claim. Turns, duration, files changed and behavior coding from transcripts are descriptive.

## Power statement

With 8 per arm per fixture (16 per arm pooled), a two-sided test at 80% power detects only large pass-rate differences, about 0.4 to 0.5 in absolute terms near a 50% pass rate. A null result is therefore weak. A CI that includes 0 can also include a benefit of 0.3 or more. Two fixtures are a small sample of tasks, and no generalization beyond them is claimed.

## Threats and open risks

- Ceiling. Sonnet passed 4/5 and 3/5 without help. Opus is probably higher, so the pass-rate half of the rule may be uninformative. This is why the ceiling clause exists.
- Fixtures were calibrated on Sonnet. The Opus pass rates are unknown.
- The skill copy is not the shipped skill (see the deviation table). Its cost is a lower bound.
- `claude -p "/investigate ..."` may not deliver the skill as a user would see it in an interactive session. The delivery gate guards this.
- The 30-turn limit can cut a told run that follows the skill's longer protocol. Max-turns hits are reported per arm.
- The `opus` alias may resolve to a model other than the one in the claim. The resolved id is reported.
- Three trials run at once. CPU contention may affect the race fixture (fx4b) equally in both arms because the pairs run together.
- A transcript may reveal the work-dir path (`scratchpad/wh/p<hex>/`) and sibling work dirs. The hygiene scan flags both.

## Uncertainties and assumptions

| Assumption | Score (1-10) | Why | Blast radius | Falsification probe, resolution |
| --- | --- | --- | --- | --- |
| `claude -p "/investigate ..."` expands the project skill | 5 | Not run yet; cannot run now | Whole H-G is void | Stop-at-init probe (init lists the skill) and the first told trial's exposure signals. Open risk until then |
| Opus none-arm is not at ceiling on these fixtures | 4 | Sonnet baseline was already 3/5 and 4/5 | Pass-rate half uninformative | Read none-arm k/n after the first 4 pairs; the clause is already fixed |
| Removing the preamble and learnings steps does not change the debugging method | 7 | Diff reviewed; removed text is telemetry, state and style | Told effect could differ from real gstack | `investigate.diff` is the audit trail |
| n = 8 per cell can show anything | 3 | See the power statement | Any null | Reported as "not contradicted" only |

Overall confidence that this design tests the stated claim fairly: 5 of 10. The weak points are ceiling and delivery, and both have a pre-declared handling.

## Frozen code and files (sha256, taken before any trial)

| File | sha256 |
| --- | --- |
| `run-hyp.ts` (runner, derived from `../run2.ts`) | 71e7e907cb0ce00bc894ac12094d5957daea21cc978c5aa2aa8d6642d97a0637 |
| `analyze-hyp.mjs` (preregistered analysis) | c8277749a484ba018a18ccaa685016df29cbd16241b9e733952200cd14a77c0c |
| `validate-hp.mjs` (grader validation, no claude) | ad007e0be69a06c25f8868c87f5033784996c4d2d52a5329bcfa1a59c1f973eb |
| `stub-claude.mjs` (plumbing check only, no model) | 5ef7a372e4b5d04591f619612d8c0c45a668636d35fef5658588530c0a32dc7e |

`SHA256SUMS` in this folder lists every frozen file, including both preregistrations. Edit nothing after the first trial. A change after that point is a deviation and is reported as one.
