# Preregistration: does the bug-fix rule generalize to real bugs?

Written before any trial of this run. No `claude` process has been started for this run. The only runs so far are plumbing checks with a stub binary that never calls a model. Earlier results (results/main, the two synthetic fixtures) are not part of this run's primary analysis.

## Question and decision rule

Question: the rule below went 30/30 against none 15/30 on two synthetic fixtures. Does a one-sentence bug-fix rule, delivered only as the work dir's project CLAUDE.md, still raise Sonnet's pass rate on real bugs from this repo's history, against a neutral placebo?

Decision rule (final, written now): "the rule generalizes" only if the 95% stratified-bootstrap CI of the pooled (rule minus placebo) pass-rate difference over the NEW fixtures alone (after the ceiling exclusion below) excludes 0 on the positive side. A CI that excludes 0 on the negative side is reported as "rule hurts on the new fixtures" and is not a "generalizes" claim. Anything else is "no claim". The replication fixtures, rule minus none, placebo minus none, cost, turns and behavior coding are descriptive only and cannot be promoted to a claim.

## Arms (project `CLAUDE.md` in the work dir only; same prompt and flags in all arms)

- rule (verbatim, unchanged from the earlier run; 186 chars, 34 words, 187 bytes with the trailing newline, sha256 of the file text 4e8c5d3f01c69c929959d1d9e19c5e77ce0c8fac49459fa38930994f51db42ff):
  `When fixing a bug: list every caller of the code you will change. Write a failing reproducer, then fix the root cause where all callers route through, not only the path the report names.`
- placebo (new; 187 chars, 29 words, +0.5% chars and -14.7% words against the rule, sha256 with trailing newline 3985bd275db8d1c605e53291a9949f1930b3a0b322ec7d30423e433e383f6517):
  `When writing replies and summaries for the user: use plain words, short sentences and the second person, and avoid exclamation marks, emoji, filler openers and the word please everywhere.`
- none: no CLAUDE.md.

### Placebo choice (the orchestrator signs this off; see the checklist below)

The last placebo was 12.8% shorter and told the agent to keep helpers in the same file as their caller, which plausibly steered fixes toward local edits. Three candidates, each written as a house rule and each within +-5% of the rule's 186 characters (176.7 to 195.3):

- A (187 chars, +0.5%, 29 words): the placebo above, about the tone of replies and summaries.
- B (192 chars, +3.2%, 36 words): `When writing commit messages: use the imperative mood and keep the subject under 72 characters. Start it with a lowercase type such as fix or docs, then a colon, and end no line with a period.`
- C (189 chars, +1.6%, 32 words): `When naming branches or writing changelog entries: use kebab-case branch names with a type prefix such as fix/ or docs/. Write each entry as one past-tense sentence that ends with a period.`

Neutrality checklist, fixed before choosing. A candidate must pass every item.

1. No instruction about code structure, file layout, scope, testing, debugging, verification, process, or how many places to change.
2. Names no action on the work tree or with a tool (commit, create a branch, create or edit a file). It can only change how the agent words text it writes anyway.
3. Contains none of these words, which belong to the rule's topic: fix, bug, test, caller, root, cause, reproduce, path, file, function, helper, module, scope, verify, debug, check.
4. Length within +-5% of the rule in characters and within +-15% in words.
5. Cannot change any string that a hidden test pins. It applies to the agent's replies, not to strings in code.
6. Reads as a plausible project CLAUDE.md house rule.

Result. A passes 1 to 6. B fails 2 (a commit-message rule invites `git commit`, and the allowed tools include git) and 3 (the word "fix"). C fails 2 (a changelog rule invites creating or editing a CHANGELOG file, and a branch rule invites `git branch`) and 3 ("fix/"). A is chosen. Residual risk, stated up front: any text in the context window can change behavior in ways no checklist sees, so placebo-minus-none is reported and a placebo effect is still possible. The exposure check measures the real token cost of each file.

## Fixtures and graders (frozen after this file is written)

All three new fixtures are the parent tree of a real fix commit of github.com/rigyard/rig (main 2dbce75), exported with `git archive <sha>~1`, with `.git` absent, plus these removals: `.claude/` and `.github/` (so no project skill or CI file differs from the none arm's context). The work dir gets a fresh empty `git init` (no commit, no history). The fixtures contain no CLAUDE.md or AGENTS.md. No file in a fixture mentions the fix SHA or its PR number (grep checked). Test files that the fix commit changed stay in the fixture at their parent version, which holds none of the hidden tests, so the agent can run the existing suite. The grader copies the commit's version of those files over them. New test files of the commit are not in the fixture.

Pass = `node --test` over the hidden files exits 0 with exactly the expected number of tests and 0 failures. Grader script: `gen/graders/grade.sh <sha> <workdir>` (about 11 to 15 s per run on this machine, under the 60 s limit).

| key | fix commit | PR | files the fix touches | hidden test files | tests | parent tree | real fix | symptom-only variant |
|---|---|---|---|---|---|---|---|---|
| d3 | d3dc4ce | #45 | lib/targets/readset.ts (docs/design/rig-architecture.md) | test/cli-wiring.test.ts, test/placement.test.ts (commit versions) | 51 | 2 fail, 49 pass | 51 pass | fails: a filter in lib/commands/doctor.ts only passes the doctor test and fails the readSet test (50/51). A skip that ignores "rig writes this dir" fails the writable-dir test (50/51). |
| ab | ab8d5ec | #53 | lib/commands/doctor.ts | test/plan-apply.test.ts (commit version) | 21 | 2 fail, 19 pass | 21 pass | none found: the fix is one function with one caller, so every variant that fixes the symptom also fixes the root. Recorded, not hidden. |
| st | 069847a | #47 | lib/state.ts, new lib/state/migrate.ts (docs/guide/10-recipes-and-pitfalls.md) | test/migrate.test.ts, MODIFIED (see below) | 3 | 2 fail, 1 pass | 3 pass | an over-broad fix that converts an owned entry even when the person edited the file fails the edited-file test (2/3). Not a call-site variant. |

Deviation for st, stated up front: the commit's migrate.test.ts imports `kindChange` from the new module `lib/state/migrate.ts` and unit-tests it. A hidden test that imports a name the prompt cannot supply makes every honest fix fail. The grader keeps the three CLI-level tests (convert and apply, undo, edited file still blocks) and drops the `kindChange` import and its table test. The unmodified file is saved at gen/graders/069847a/original/test/migrate.test.ts. Behavior that the hidden tests pin and that the prompt names: see the prompts.

Candidates excluded (12 of 15 fix commits), with the reason:
- Hidden test pins exact new message text that no prompt can supply: 6acc5df (#50), 27a2bd5 (#67), fff0c05 (#48).
- The commit changed test/golden/first-seed.manifest (byte hashes of rendered output), so a fix passes only with byte-identical rendering: 16a7a49 (#71), 1043ca0 (#52), bd92587 (#49), 2bb099a (#44).
- Hidden test imports a new export or module: adae5ed (#39, joinLicenses and isLicenseFile), dd2627c (#60, gitEnv; it also asserts on git's own trace output, so it depends on the git version), aed38b8 (#28, isBinary and new binary fixtures), 521e795 (#46, HARNESS_OWNED and others in a test helper), 4e263ce (#56, new unit-paths module, reader version bumps, 432 changed lines).
- None needs a harness binary, the network or more than 60 s. Those were not the reasons.

Only three fixtures are kept, not four. A fourth would need a modified hidden test or a pinned string; neither is defensible. Two of the three kept fixtures are single-site fixes, so the "all callers route through" clause can matter on d3 (doctor and readSet) and st (plan, apply, undo) but probably not on ab.

### Prompts (organic symptom reports; no eval words, no fix location, no hidden-test text)

- d3: `rig doctor reports dozens of duplicate-skill errors and exits 1, but most of them are not real. It counts skill copies inside old Claude Code plugin cache versions that Claude no longer loads (those version folders hold a .orphaned_at file). Please fix it. Two live copies of a skill must still be reported as a duplicate, and copies under the plugin folder that rig writes itself must still count.`
- ab: `After rig apply, if I delete or hand-edit a file that rig manages, rig doctor prints the drift error for it and, right below, the line "managed files match installed.json and the render". Both cannot be true. Please fix it. A clean home should still print that line.`
- st: `Since the last update, rig plan blocks with "E_DRIFT <home>/.omp/agent/AGENTS.md is recorded as owned, desired as block". I applied rig a while ago and have not touched that file, and the only way out so far is editing installed.json by hand. Please make plan and apply work from this state, and make rig apply --undo of that run restore the old file. If I had edited that file myself, rig should keep refusing and leave it alone.`

Prompt design notes. d3 names `.orphaned_at` because the parent tree never mentions it and a fix cannot guess the marker; the sentence about the plugin folder rig writes itself states the hidden writable-dir test, a requirement that follow-up review found after the first fix. st states the undo and edited-file requirements for the same reason. These sentences make the tasks fairer and do not name a file or a function to change.

### Replication fixtures (earlier synthetic fixtures; unchanged paths)

- fx4b: <work-root>/fixture-4 (tree sha256 b1551d4c011c8763173d78a79af82f0bc6ee8b05f6e2174494964121b84780ea, `.git` excluded; method: sha256 of the sorted `shasum -a 256` lines of `find . -type f`), grader .grade-4b/check.ts (sha256 f8a946000b8d25b51ab6825eafee1bad017dbac975973a6b6a3fdfe0b5aa02e3), 4 tests. Prompt: `We sold the last limited-edition mug twice: two customers checked out at the same moment and both orders went through. Please fix it.` Secondary grader .grade-4/check.ts (4bda6d0a90b8a5f41874622198d87976a670ea42052bc175381d95613a25a372), descriptive.
- fx3: <work-root>/fixture-3 (tree sha256 b0915c208f90f7bf8194b07a79809a1b0b76a793bc9a4bc542003fdb13775d92, same method), grader .grade-3/check.ts (2a63cd895b5f963abbb56ec7120083b124a8383c6c84afa0f0239daf9859d695), 4 tests. Prompt: `In the member directory, people with accented names (Émile, Óscar, Ángel) are listed after Zoe instead of with the other E, O and A names. Please fix it.`
- The earlier prereg recorded other tree hashes (e7b90d24..., 1dc4ce...) by an unrecorded method. They cannot be re-derived, so the equality of these trees with the pilot trees rests on the copy, not on a hash. Replication cells are descriptive, so this does not touch the decision.

Frozen code: gen/run-gen.ts and gen/analyze-gen.ts (hashes in gen/SHA256SUMS). run-gen.ts is run2.ts with: five fixtures, the new placebo, `--max-turns 25`, trial timeout 480 s, run cap 150, work dir under the system temp dir, `git init` for the new fixtures, a `diff -ruN` patch instead of `git diff`, a hidden-test grader for the new fixtures, and a leak scan that also records `git log|show|reflog|blame`, `cd ..` and `../..` commands. `N_NEW` and `N_REPL` env overrides exist for the stub check only and stay unset in the real run.

## Design

- Model `sonnet`. `--max-turns 25`. `--permission-mode acceptEdits`. Allowed tools Bash(node|git|ls|cat|grep|find). `--no-session-persistence`. Isolation `--setting-sources project,local --strict-mcp-config`. Subscription login (API key env vars removed). Per-trial timeout 480 s.
- n: 12 per arm per new fixture (3 fixtures x 3 arms x 12 = 108 trials) and 5 per arm per replication fixture (2 x 3 x 5 = 30 trials). Planned total 138 runs. Hard cap 150 claude runs including retries, enforced by a counter in `results/runs.log`, so 12 runs are spare for infra retries. Total never exceeds 150.
- Order: for n = 1..12, for fixture in (d3, ab, st, 4b, 3) with the replication fixtures only while n <= 5, for arm in (rule, placebo, none). Interleaved round-robin. Up to 3 concurrent runs, each in its own work dir (fresh copy of the fixture, project dir name `rig` for the new fixtures).
- First chunk: 3 trials. Inspect records (tokens, exposure, grading, init, leak scan) before continuing.

## Primary analysis

- Pass rate per cell (k/n). Differences: rule minus placebo (decision), rule minus none (descriptive), placebo minus none (descriptive).
- Pool = the new fixtures that survive the ceiling rule. Pooled difference = total passes over total usable trials per arm.
- 95% percentile CI from a stratified bootstrap: resample trials with replacement within each fixture x arm cell at its own n, 10,000 resamples, seed 20261111 (mulberry32). Exact two-sided Fisher test per fixture (sum of tables with probability <= observed).
- Ceiling rule (declared now, because a new fixture's none-arm rate cannot be known in advance): a new fixture whose none arm passes >= 90% (11/12 or 12/12) is reported as ceiling and excluded from the primary pool. It stays in every descriptive table. The rule uses the none arm only, not the contrast. A fixture where every arm is near 0 (floor) is not excluded: it stays in the pool and adds little.
- Descriptive extras: cost per pass, turns, trials that end in `error_max_turns` and the pass rate among the others, secondary grader on fx4b, all-five pooled and replication-only pooled differences.
- With three new fixtures at n = 12 the pooled CI half-width is about 0.23 when the baseline rate is near 0.5. This design only detects a pooled difference of roughly 0.25 or more. A null result is not evidence of no effect.

## Exposure check (every trial)

Metric: first assistant turn input tokens (input + cache creation + cache read). Baseline: median of the none arm in the same fixture. A rule or placebo trial is exposed if metric >= baseline + 100. A none trial is clean if |metric - baseline| <= 50. A failing trial is reported by key and stays in the analysis. Also reported: the rule-versus-placebo token delta per fixture. A gap above 30 tokens is flagged and described, with no change to the analysis.

## Missing-trial and infra rules

- Infra failure: no result event and no assistant turns (crash, kill, timeout with no turns); or an error result with no assistant turns; or any error result (not error_max_turns) whose text matches usage limit / rate limit / overloaded / credit / 429 / 529.
- An infra failure is retried once. A second failure is recorded as missing (neither pass nor fail) and excluded from rates, with its key reported. If a cell has fewer than 8 usable trials after retries, the fixture's pooled contribution is still computed from what exists and the shortfall is reported.
- A limit-type failure stops the batch. Wait, then resume. Each attempt counts in runs.log toward the cap and is logged in `infra.log`. After resume the trial gets a fresh attempt. Every isError record is inspected by hand.
- A trial that has agent turns but ends in timeout or error_max_turns is graded as-is on the files it left (a real outcome, not infra). The rule arm may hit the turn limit more often because it writes a reproducer first. That cost is part of the rule's effect under a 25-turn budget, and the descriptive turn-limit table shows it.

## Hygiene checks

- prereg.md mtime precedes the first line of `runs.log`. Every locked file matches gen/SHA256SUMS before the first trial and after the last (`shasum -a 256 -c`).
- Hidden checks unread: the leak scan of every raw transcript for `.grade`, `grader.check`, `grade.sh`, `graders/`, `gen/variants`, `<work-dir>`, `<repo-parent>`, `<eval-scratch>` and the three fix SHAs, plus a manual grep afterwards. Any hit is reported with the trial's treatment.
- History: any Bash command with `git log|show|reflog|blame`, `cd ..` or `../..` is flagged. The work dir sits under the system temp dir, outside the real rig clone, and `.git` is a fresh repo with no commits.
- Siblings: any path of another trial's work dir (`/p<8hex>/`) in a transcript is flagged.
- Arms differ only by CLAUDE.md: init events diffed across arms after removing cwd, session id, uuid, socket path and memory path.

## Exploratory (no claims)

Behavior coding from transcripts and patches: reproducer first (a test or script run that fails before the first edit), sites changed against the reference fix sites (d3: readset.ts; ab: doctor.ts; st: state.ts plus migrate-like logic), caller search, turns and cost medians per arm.

## Uncertainties and assumptions

Scores are 1 to 10 for the assumption only. Facts checked in the repo or by running the graders are not scored.

| # | Assumption | Score | Why | Blast radius | Resolution and falsification probe |
|---|---|---|---|---|---|
| 1 | The placebo has no effect on fix quality. | 6 | The checklist removes the known confound (local-edit steering). It cannot rule out an effect of extra context. | The rule-minus-placebo contrast shifts by the placebo's own effect. | Placebo-minus-none is reported. Probe: if placebo minus none is large on a fixture where the placebo text cannot apply, a context effect exists. |
| 2 | The hidden tests grade the user's symptom and not unstated detail. | 5 | d3 pins a writable-dir edge and a readSet unit test, st pins undo. The prompts state them. A natural fix at the doctor only fails d3's readSet test. | A fixture can read as a pure "did the agent fix at the shared function" test. | Reported per fixture. Probe: a none-arm trial that fixes the symptom at the CLI and fails only the readSet test (variant already shown to exist). |
| 3 | Three fixtures, two single-site, are enough to say anything about real bugs. | 4 | Only 3 of 15 fix commits have tests that a symptom prompt can fairly target. | A positive result generalizes to this repo's bugs of this kind only. | Stated in the report. Open risk, no cheap probe. |
| 4 | None-arm rates stay below 90% on the new fixtures. | 5 | Real bugs in a 400-file repo are harder than the synthetic ones, but a clear prompt may be enough. | A ceiling fixture drops out of the pool and shrinks it to 24 per arm. | Ceiling rule is declared. Probe: the first 6 none trials of a fixture all pass. The analysis already handles it. |
| 5 | 25 turns and 480 s are enough for the rule arm to finish. | 6 | Earlier medians were 16 to 17 turns for the rule arm on small fixtures. This repo is bigger. | Turn-limit endings count as fails and can penalize the rule. | Descriptive turn-limit table. Probe: more than 20% of rule trials end in error_max_turns. |
| 6 | Model alias `sonnet` resolves to one model across the run window. | 7 | The earlier run recorded one model. | Mixed models blur the contrast. | Recorded from init events. |
| 7 | Concurrency 3 does not change grader results. | 7 | The same holds for the earlier run. The new graders spawn the rig CLI and take 11 to 15 s alone. | CPU contention can cause rare timeouts in the grader. | Grader timeout is 150 s inside the runner. Same across arms by interleaving. |

Overall confidence that this design answers the question it can answer (a pooled rule-minus-placebo difference of about 0.25 or more on three real fixtures): 6 of 10. Confidence that a null result means no effect: 2 of 10.

Next steps: the orchestrator signs off the placebo (A), the three-fixture set and the prompts. Then the first 3-trial chunk (see run-plan.md). `grill-me` is worth running on assumptions 2 and 3 before spending the runs.
