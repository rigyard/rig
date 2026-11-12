# Preregistration H-A: does pstack's /create-formal-verification-skill help an agent find implicit-state-machine bugs?

Written 2026-11-11, before any trial. No `claude` process has run for this hypothesis. Throwaway experiment. All paths are under `.../hyp/audit/`. This replaces the narrower H-P (fix task), whose told arm mostly built TLA+ and never edited code (`../results/HP/analysis.txt`).

## Claim and testable form

Claim (Lauren Tan, pstack, quoting Steve Ruiz's prompt "find all of the implicit state machines in my app"): use `/create-formal-verification-skill` "to model these state machines, one skill per subsystem."

Testable form. On one subsystem with planted implicit-state-machine bugs, an agent that starts with `/create-formal-verification-skill ` and the audit task FINDS more of the planted bugs than an agent given the same task text with no skill. A bug counts as found only with the right location and an executable repro whose event sequence is confirmed by a monitor (see Grader).

Limit stated up front. One fixture, one model, 5 bugs. A "not supported" result says no difference was detected at n = 8 in this setup. It does not say the skill is useless for other subsystems or at a larger budget.

## Arms

Both arms use the same flags, the same fixture copy, the same work-dir layout and the same allowlist. Only the skill folder and the prompt prefix differ.

- told: `.claude/skills/create-formal-verification-skill/` is present. Prompt = `/create-formal-verification-skill ` + task text.
- none: no skill folder. Prompt = task text.

The skill is the byte-identical copy from H-P (`../skills/create-formal-verification-skill/SKILL.md`, 5626 bytes, sha256 30ef0ac27612ecd16fdc081112113221d673053cef3f8603db11932193861211; plugin repo HEAD de8ee15dd1194627d21eb5fcd41cb1873208dabb). It has `disable-model-invocation: true`, so only the slash command starts it. In H-P all 8 told runs were exposed (token excess), 0 by tool call. The two references `../statechart/SKILL.md` and `/maintain-formal-verification-skill` dangle, as in H-P.

## Prompt, verbatim (task text)

`Find all of the implicit state machines in this code and every way they can reach an impossible or inconsistent state. Write your findings to FINDINGS.md, one finding per bug, each under a heading `## 1`, `## 2` and so on, with a `Location:` line that gives the file and line (for example `Location: src/foo.ts:42`) and the concrete sequence of events that triggers it. For each finding n, also save a short script `repro/n.ts` that drives the code through that sequence and runs with `node repro/n.ts`. Leave the code under src/ as it is.`

The told prompt is the same text with the prefix `/create-formal-verification-skill ` (one space). The first sentence follows Steve Ruiz's prompt. The rest fixes the output format, so the grader can read it. The text has no meta words and no bug list. `run-audit.ts selfcheck` asserts that told = prefix + none and that the text and the fixture contain none of the words eval, test, judge, experiment, rubric, score, compare, benchmark, candidate, arena, audit.

## Model, flags, allowlist, budgets

`--model sonnet`. `--max-turns 40` (the skill is long-running; H-P told runs used a mean of 26.5 turns of 30 and 2 of 8 hit the limit). `--max-budget-usd 6` per trial. Per-trial wall budget 1500 s (25 min), then SIGKILL. A killed, max-turns or max-budget trial is graded on what is on disk. It is not a missing trial.

Permissions, identical in both arms: `--permission-mode bypassPermissions`, plus `--disallowedTools` with `Bash(git push *)`, `Bash(gh *)`, `Bash(sudo *)`, `Read(~/.claude/**)`, `Edit(~/.claude/**)`, `Write(~/.claude/**)`, `Bash(*~/.claude*)`, `Bash(*$HOME/.claude*)` and `Bash(*<HOME>/.claude*)`. There is no `--allowedTools` list. Why: the Claude Code docs state that `.claude` is a protected path, that `permissions.allow` rules do not pre-approve protected-path writes, and that only `bypassPermissions` allows them. H-P used an allowlist plus `acceptEdits`, and every told-arm write to `.claude/skills/**` was denied (6 Write denials, 67 Bash denials from compound commands, `python3`, `shasum`, `rm`, `cp -r`). So an allowlist cannot be made to work for the skill's deliverable. The probe reads `permissionMode` from the init event and fails unless it is `bypassPermissions` in both arms. The Bash deny patterns on `~/.claude` are best effort. The user's `~/.claude/skills` holds pstack skills, including `create-verification-skill` and `maintain-formal-verification-skill`, which a none run could read. The runner records `homeClaudeTouched` from the tool-call inputs, and the exposure rule below treats a none trial that read them as contaminated.

`--setting-sources project,local --strict-mcp-config --no-session-persistence`, subscription login (API key variables removed). Java 25 is installed. TLC (`tla2tools.jar`) is not, so a told run that chooses TLA+ downloads it with `curl` (open in both arms).

Work dirs: `$WORK_DIR/<slug>/job-hub`, with `WORK_DIR` outside the repo tree (`run-plan.md` sets it). The answer key, the monitor and the grader live only under `audit/grader/` and `audit/validation/`. They are never copied into a work dir. The grader runs after the trial, in a fresh temp copy of the pristine fixture. It takes only `FINDINGS.md` and `repro/` from the work dir, so an edit to `src/` changes nothing.

## Fixture: `fixture/job-hub` (frozen)

Tree sha256 037436f59b70d72e2cf2e84a10ad9f34c0a7cda4767837b8033addecb10ae5d4 (method: `find . -type f -not -path './.git/*' | sort | xargs shasum -a 256 | shasum -a 256`). TypeScript, `node >=22.18`, no dependencies, 5 source files (`types.ts`, `groups.ts`, `jobs.ts`, `hub.ts`, `demo.ts`) and 233 lines, plus README. No comments. No clock or timers: `hub.tick(ms)` is a virtual clock, so every run is deterministic. The README gives the API, the six events, and the intended behaviour (leases, retries, final states, cancel, group finish). It names no bug.

The implicit state machines. A job is a status string moved by five handlers and two clock scans (`queued, leased, waiting, done, cancelled, dead`, plus a `cancelRequested` flag and a retry time). A group is `pending`, `sealed` and `finished`. A slot counter ties them together.

Five planted bugs, of graded subtlety. Grader-only. Lines refer to the pristine fixture.

1. B1, retry re-enters a final state (`src/jobs.ts:85`, with `:70-71`). A cancel on a `waiting` job sets `cancelled` but leaves the retry time. The `release` scan checks only the retry time, so the next tick makes the cancelled job `queued` again. Sequence: submit, pull, nack, cancel, tick 5000. Monitor tag B1: a job left a final status.
2. B2, stale completion after a lease timeout (`src/jobs.ts:57`, `src/hub.ts:32`). `ack` ignores the attempt number that `nack` checks. Sequence: submit, pull w1, tick 31000, tick 5000, pull w1 (attempt 2), ack attempt 1. The job completes while attempt 2 still runs. Monitor tag B2: an ack with a non-current attempt completed a leased job. Any ack with a wrong attempt number also fires it, so the shortest repro is 3 events.
3. B3, missing guard on out-of-order events (`src/hub.ts:36`). A `job.cancel` for an unknown job is dropped, so a later `job.submitted` queues a job whose cancel was already delivered. Sequence: cancel, submit, pull. Monitor tag B3: a job with a delivered cancel got a lease.
4. B4, counter drift on duplicate delivery (`src/jobs.ts:38`). `enroll` runs even when the job already exists, so a duplicate `job.submitted` raises the group `pending` counter twice and the group can never finish. Sequence: the same submit twice. Monitor tag B4: `pending` differs from the number of non-final jobs in the group.
5. B5, two-flag combination reachable but invalid (`src/groups.ts:14`). `maybeFinish` does not check `sealed`, so the group is `finished` and not `sealed` when its first jobs end, and it can then take new jobs. Sequence: submit in g, pull, ack. Monitor tag B5: `finished` without `sealed`, or with `pending` above 0.

Two decoys that look wrong and are correct.

- D1 (`src/jobs.ts:44-46`). `pull` skips ids in the queue whose job is no longer `queued` (a cancelled queued job leaves its id behind). Looks like a leak or a stale lease. Harmless, and `queued` jobs appear in the queue exactly once.
- D2 (`src/jobs.ts:72-74`). A cancel on a `leased` job only sets `cancelRequested`. Looks like a cancel that does nothing. The failure or expiry of that attempt then ends in `cancelled` (`fail`, `src/jobs.ts:15`), and an ack still ends in `done`, as the README says.

Proof that the decoys are correct (`validation/fixture-validation.txt`, `validation/fixture-validation-full-d7.txt`, no claude). `validation/make-variants.mjs` writes one overlay per bug fix and one with all five fixes; it fails unless each replacement matches once and the decoy code is byte-identical in the full-fix variant. `validation/validate-fixture.mjs` runs the monitor, with all planted and 5 unplanted invariants, over (a) every event sequence up to length 6 from a 13-event alphabet (about 4.5 million sequences per variant) and (b) 100,000 random runs of up to 40 events from an 85-event alphabet.

| Variant | Exhaustive depth 6, tags fired | Fuzz tags |
| --- | --- | --- |
| pristine | B1 B2 B3 B4 B5 (shortest witnesses 6, 3, 3, 2, 2 events) | B1 B2 B3 B4 B5 |
| fix B1 only | B2 B3 B4 B5 | B2 B3 B4 B5 |
| fix B2 only | B1 B3 B4 B5 | B1 B3 B4 B5 |
| fix B3 only | B1 B2 B4 B5 | B1 B2 B4 B5 |
| fix B4 only | B1 B2 B3 B5 | B1 B2 B3 B5 |
| fix B5 only | B1 B2 B3 B4 | B1 B2 B3 B4 |
| all five fixed (decoys unchanged) | depth 7: none, 67,977,559 sequences | none (200,000 runs) |

Each fix removes exactly its own tag. With all five fixed, no invariant fires, so both decoys are correct against the invariants within those bounds. The bound is the limit of this proof (see risks).

## Grader (frozen)

Files: `grader/grade.mjs`, `grader/key.json`, `grader/monitor-core.mjs`, `grader/monitor.mjs`, `grader/replay.mjs` (sha256 in the table below).

1. Split `FINDINGS.md` into findings at headings that start with a number (`## 1`, `### Finding 2`). Read each finding's `Location:` line for `file.ts:line` tokens (a `line-line` range is allowed).
2. A finding's location matches bug k when a token lies in a range of `key.json` for k. A token with a file and no line matches by the function name in the key. Ranges are padded by about 5 lines and clipped at the decoys.
3. For finding n, copy `repro/` into a pristine fixture copy and run `node --import monitor.mjs repro/n.ts` (15 s limit). The monitor patches `Hub.prototype.deliver` and `tick`, checks the invariants after every public call, writes a tagged violation line first, then throws `INVARIANT <tag>`. It also writes the public call trace.
4. Replay. The trace is replayed in a fresh process that uses only `new Hub(slots)`, `deliver` and `tick`. A tag counts as confirmed only if it fires again. A repro that edits records directly (`hub.jobs.get(x).status = ...`) does not replay.
5. Bug k is found when one finding matches k by location AND confirms tag k. One finding credits at most one bug (the lowest number). A second finding for the same bug is a duplicate. After a B1 violation the monitor stops reporting B3, B4 and B5 for that run, because B1 corrupts the state those checks read.
6. Score = bugs found, 0 to 5. Secondary counts: total findings; unproven findings (not credited, not a duplicate); decoy-located findings (a location inside D1 or D2); lenient tags (planted tags confirmed by any repro, at any location).

Validation (`validation/grader-validation.txt`, 3 repeats each, stable, no claude):

| Answer | Expected | Got | Findings / unproven / decoy-located |
| --- | --- | --- | --- |
| empty FINDINGS.md | 0 | 0 | 0 / 0 / 0 |
| findings without repro files | 0 | 0 | 2 / 2 / 0 |
| hand-written perfect answer | 5 | 5 (B1-B5) | 5 / 0 / 0 |
| half answer (B1, B3 right; B2 repro shows nothing; B4 at a wrong location) | 2 | 2 (B1, B3) | 4 / 2 / 0 |
| decoy-only answer (D1, D2, with repros) | 0, 2 decoy hits | 0, 2 | 2 / 2 / 2 |
| repros that edit the state directly | 0 | 0 | 2 / 2 / 0 (one repro fires B4 once, replay does not confirm it) |
| right repro at wrong locations | 0 | 0 | 2 / 2 / 0 |
| one B1 repro cited at all five locations and a second finding | 1 | 1 (B1) | 2 / 1 / 0 |

The runner path was also run end to end against `stub-claude.mjs` (no model call): probe, 16 trials, grading, analysis. Stub output is deleted. `results/` is empty.

## Design

n = 8 per arm, 16 trials. Order: for n = 1..8 the two arms of the pair are queued together and the within-pair order alternates (odd n: told first). Up to 3 trials run at once. Run cap `RUN_CAP=20`, counted in `results/runs.log`: 16 planned trials, 2 stop-at-init probes and 2 retries. The code default of 20 is not raised.

Infra rule. A trial with no assistant turn and no result, or an `is_error` result with no assistant turn, is an infra failure and is retried once. A usage-limit failure stops the batch (exit code 3). Wait and resume. Never lower n.

Missing-trial rule. A trial that fails twice is `missing`. Missing trials are excluded and never imputed. Fewer than 6 usable trials in either arm means no verdict. Timeouts, `error_max_turns` and `error_max_budget_usd` are not missing. They are graded on the files on disk, because running out of budget is part of how the skill performs.

## Exposure check and delivery gate

`exposedFinal` is true when any of these holds: (1) a `Skill` tool call names the skill, (2) a tool call input contains `skills/create-formal-verification-skill`, (3) the string `A test checks the cases that someone thought to write` appears in the event stream, (4) the first assistant turn's input tokens exceed the none median by at least 703 (half of the skill size in bytes divided by 4). Recorded, not part of `exposedFinal`: `initHasSkill`.

Gate. Fewer than 6 of 8 told trials with `exposedFinal`, or any none trial with `exposedFinal` or the skill in init, means delivery failed. No verdict, no fallback delivery. Hygiene, read by hand: `leakedGrader` (a transcript mentions the grader or key paths), `homeClaudeTouched` (a tool call names the home `.claude` folder), other trial dirs seen. A none trial that read the user's `~/.claude/skills` formal-verification skills is contaminated and stops the analysis for review. Any other leak is reported, and the per-protocol analysis drops it.

## Primary metric and analysis

Mean planted bugs found per arm over all usable trials, as assigned. Difference told minus none. 95% percentile bootstrap CI, 10,000 resamples, seed 20261111 (mulberry32), resampling trials within each arm. Frozen code: `analyze-audit.mjs`.

Secondary, no decision weight: unproven findings per trial, decoy-located findings per trial, total findings, lenient tags (each with a bootstrap CI of the told minus none difference); cost per true finding = sum of trial cost over sum of bugs found, per arm, with a bootstrap CI (resamples with 0 bugs are dropped); the per-protocol difference (exposed told trials plus all none trials).

## Decision rule (written before data)

- H-A SUPPORTED if the CI of the mean-bugs difference lies entirely above 0 (lower bound > 0).
- H-A CONTRADICTED if it lies entirely below 0.
- Otherwise H-A NOT SUPPORTED: no detected difference at n = 8.
- Turn-limit reading. If the told arm ends in `error_max_turns` or `error_max_budget_usd` in at least half of its runs and finds fewer bugs, the finding is "the told arm does not finish inside 40 turns in this setup". It is not a claim about model checking at a larger budget.
- No delivery, or fewer than 6 usable trials per arm: no verdict.

## Power statement

With 8 per arm, a two-sided test at 80% power detects a difference of about 1.4 standard deviations of the per-trial bug count. If the standard deviation is about 1.2 bugs (an assumption, no pilot), that is a difference of about 1.7 bugs out of 5. Smaller real effects are invisible. A percentile bootstrap at n = 8 per arm is slightly too narrow, so a CI that just clears 0 is weaker than it looks. A null is weak evidence. One fixture and one model are a very small sample of subsystems.

## Threats and open risks

- Ceiling or floor. The fixture has not been run against any model, because no claude run was allowed. If the none arm finds 5 of 5 (or 0 of 5), there is no room to see a difference. The decision rule stays as written.
- Format risk. The grader reads `## n`, `Location:` and `repro/n.ts`. A run that writes another format scores 0 for that finding. The prompt states the format, but the skill's own text may pull the told arm elsewhere. `wrote findings` per arm is reported.
- The monitor is the oracle for "actually triggers". It checks only the planted invariants plus 5 unplanted ones, and the proof that the decoys are correct is bounded (length 7 exhaustive, 40-event fuzz). A real semantic problem outside those invariants shows up as an unproven finding, not as a found bug.
- B2 fires on any ack with a wrong attempt number. A run that spots the missing check but writes the 3-event sequence instead of the timeout race still counts.
- `bypassPermissions` gives both arms the whole machine. The answer key sits under the repo tree and is found only by a deliberate search. The work dir is outside the tree, and leaks are detected from the transcript, not prevented.
- Both arms can read the skill text at the user's home. The deny rules are best effort. Detection is by `homeClaudeTouched`.
- Told-arm budget. The skill asks for a model, a break check and a verify skill. It may use the 40 turns without writing `FINDINGS.md`. That is a real cost of the skill and is scored as such, with the reading rule above.
- Sonnet only, one fixture, 5 bugs, TypeScript.

## Uncertainties and assumptions

| Assumption | Score (1-10) | Why | Blast radius | Falsification probe, resolution |
| --- | --- | --- | --- | --- |
| `--permission-mode bypassPermissions` is accepted in `-p` mode and lets the told arm write `.claude/skills/**` | 6 | Docs say so, not run | Told arm penalised again as in H-P | Probe prints `permissionMode` from init; pilot told trial `permissionDenials` must be near 0 for writes under `.claude/` |
| The slash command delivers a `disable-model-invocation` skill in `-p` mode | 8 | H-P: 8 of 8 token-exposed | Whole H-A void | Probe plus pilot exposure signals |
| The none arm is neither at the floor nor at the ceiling on this fixture | 4 | Uncalibrated, Sonnet unknown | Verdict cannot separate arms | Read none distribution after the first 4 pairs; no change of design allowed |
| The monitor and key credit only real triggers | 8 | 8 hand-written answers, 100k fuzz, depth 7 proof | A found bug is lost or a false one is credited | Hand-read every FINDINGS.md and every repro of every trial next to the grade |
| Sonnet is a fair model for this claim | 5 | Argued in H-P, cheapest | Result may not transfer | None, stated as a limit |

Overall confidence that this design tests the stated claim fairly: 6 of 10. Better than H-P because the task is the claim (find, not fix) and the grader is deterministic and validated. The gaps are the uncalibrated fixture and the single subsystem.

## Frozen code and files

Every file under `audit/` except `results/` is listed in `SHA256SUMS` in this folder, including this file and `run-plan.md`. Key hashes at write time:

| File | sha256 |
| --- | --- |
| `run-audit.ts` | 6f9bd4e50457cc2e203793e54d53984af5b6740beb3a26d1d0388945297d664a |
| `analyze-audit.mjs` | df942138b5565c96fbd324c589f58c8ee553c4538f3b2334017045c1d2050939 |
| `grader/grade.mjs` | 178877ed1203f071cfec5344fd73d4e540e2e42fc988370f8b8980b9dc110947 |
| `grader/key.json` | b86a73528e314136691e77e0a8bc3b9abe711d1e52862b1b0023b9f31ab18612 |
| `grader/monitor-core.mjs` | 2042df4928a873c770f278d3ce0398338d38158c7740d129633206bb3d2c9025 |
| `grader/monitor.mjs` | d46db6b3704ef7764e6b6c6bf72ee3a4ca18f65a05bb4ab1599c4de6ac9657c8 |
| `grader/replay.mjs` | 9576ecaf03e8fd7a1345d2784dd0acf170f45c8b3251f705d9b52517d5fd02f4 |

Edit nothing after the first trial. A change after that point is a deviation and is reported as one.
