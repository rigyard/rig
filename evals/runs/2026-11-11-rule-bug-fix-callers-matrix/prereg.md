# Preregistration: one bug-fix rule across harnesses and models

Written before any matrix trial. Preparation probes (listed under Probe evidence) are excluded from all analysis. The earlier Claude-only run (`results/main`, `prereg.md` one level up) is a separate experiment and is not pooled.

## Question and decision

Question: does a one-sentence bug-fixing rule, delivered only as the work dir's project instruction file, change the pass rate of each configuration on two bug-fix fixtures, and does the effect differ across harnesses and models?

Decision rule, per configuration (written now, applied by `analyze-matrix.ts`). The primary statistic is the pooled rule-minus-none pass-rate difference over the two fixtures, with a stratified bootstrap 95% CI.

1. Not discriminating: pooled none-arm pass rate >= 90%, or the rule arm and the none arm are both 0% pooled. No claim, whatever the CI says.
2. Otherwise "rule helps" if the CI lower bound is above 0. "Rule hurts" if the CI upper bound is below 0. Otherwise "no claim".
3. A configuration with fewer than 3 usable trials in any fixture x arm cell reports "insufficient".

Everything else is descriptive. In particular the cross-configuration table has no preregistered between-config test. Eight configs at 95% each is a family of eight, so one "rule helps" label among them is exploratory evidence. Replicate before promoting it.

Power note (inference, not measured): with n = 5 per cell the pooled arms have 10 trials each. The CI excludes 0 only for large effects, roughly 0.4 or more. A null here is not evidence of no effect.

## Configurations

Eight configurations. Model names resolved from rig's tier table (`rig/models/tiers.json`) and checked against `codex debug models` and `agy models`.

| Config key | Harness | Model id sent | Effort | How effort is set |
| --- | --- | --- | --- | --- |
| claude-opus-default | Claude Code 2.1.322 | `claude-opus-5-5` | default | no `--effort` flag |
| claude-sonnet-medium | Claude Code | `claude-sonnet-5-5` | medium | `--effort medium` |
| agy-flash-medium | agy 1.5.5 | `gemini-3.8-flash-medium` | medium | effort is part of the model id |
| agy-flash-high | agy | `gemini-3.8-flash-high` | high | effort is part of the model id |
| codex-sol-medium | codex-cli 0.167.0 | `gpt-6.1-sol` | medium | `-c model_reasoning_effort="medium"` |
| codex-terra-medium | codex | `gpt-6.1-terra` | medium | same |
| codex-luna-medium | codex | `gpt-6-luna` | medium | same |
| codex-luna-high | codex | `gpt-6-luna` | high | same |

Name resolution. The catalog holds three families per name: sol = gpt-6.1-sol, gpt-6-sol, gpt-5.6-sol; terra = gpt-6.1-terra, gpt-5.6-terra; luna = gpt-6-luna, gpt-5.6-luna. The rig tier table maps strong = gpt-6.1-sol, fast = gpt-6.1-terra, cheap = gpt-6-luna. Those three are used. This is an assumption about what the requester meant by "sol", "terra" and "luna". All three resolved, so no configuration is skipped.

## Arms

Two arms, same prompt and flags in both. They differ only by one file in the work dir, created before launch:

- rule: the instruction file holds exactly this text, 187 chars with a trailing newline, sha256 `4e8c5d3f01c69c929959d1d9e19c5e77ce0c8fac49459fa38930994f51db42ff` (the runner refuses to start if it changes): `When fixing a bug: list every caller of the code you will change. Write a failing reproducer, then fix the root cause where all callers route through, not only the path the report names.`
- none: no instruction file.

Instruction file per harness: Claude `CLAUDE.md`; codex `AGENTS.md`; agy `AGENTS.md`. agy loads `GEMINI.md`, `AGENTS.md` and `.agents/rules/*.md` from the project (all three seen in probe A1). `AGENTS.md` is used so two harnesses share one file name.

There is no placebo arm in this matrix. The earlier run covered the placebo contrast on Claude Sonnet.

## Isolation and permissions per harness

User-level instructions, skills and rules must not reach the model. Each harness gets the narrowest mechanism that probes showed to work.

- Claude: `--setting-sources project,local --strict-mcp-config`, subscription login (API key variables removed), `ORCA_*` variables removed. Work dir `<work-parent>/wk-2026-11-11/p<hex>/<project>` has no ancestor instruction file. Built-in skills (19), builtin plugins and one inline plugin still load in both arms. Permissions: `--permission-mode acceptEdits`, allowed tools Bash(node|git|ls|cat|grep|find), `--max-turns 20`, `--no-session-persistence`.
- codex: per trial, a fresh `HOME` and a fresh `CODEX_HOME` inside the trial dir. `CODEX_HOME` holds one symlink, `auth.json`, to the real login file. Nothing is copied. The symlink is removed before the trial dir is deleted. Rig's own live helper points `CODEX_HOME` at the real `~/.codex`, so it does not hide the global `AGENTS.md`. This matrix does. Permissions: `-s workspace-write -c approval_policy="never"`. In that sandbox `.git` is read-only and `<tmp>` is writable. Work dirs live in `<work-parent>`, outside the writable `<tmp>` and `$TMPDIR` entries.
- agy: per trial, a fresh `HOME` whose only content is `Library/Keychains`, a symlink to the real keychain directory (the login lives in the macOS keychain, service "gemini"). agy then builds its own empty `<home>/.gemini`. A temp `HOME` without that symlink loses the login (probe-free check: `agy models` printed "Please sign in"). Permissions: `--dangerously-skip-permissions --sandbox`, `--print-timeout 290s`. The `--sandbox` flag adds terminal restrictions. agy has no turn cap flag.

Equality of arms: `buildCmd` ignores the arm. `prepare` writes the one file. The stub run showed instruction files present only in rule trials and identical argv across arms.

## Probe evidence (preparation only, excluded from data)

Budget used: codex 3, agy 3, Claude 2.

- codex, free check (`codex debug prompt-input`, no model): with real `CODEX_HOME` the model-visible input is 117,100 chars and names "rig frame" twice and "poteto" 15 times. With the isolated home it is 67,759 chars and names none of them. The project canary appears once in both.
- codex P1, `gpt-6.1-sol` medium, isolated, project `AGENTS.md` canary: quoted the canary, answered NONE for global instructions. Exit 0.
- codex P2, `gpt-6.1-terra` medium, none arm: created `hello.js` and ran it with node, exit 0. The rollout holds no "AGENTS.md instructions" block. `turn_context` says model `gpt-6.1-terra`, effort `medium`.
- codex P3, `gpt-6-luna` high, rule arm: same task, exit 0. The rollout holds the AGENTS.md block with the rule text. `turn_context` says `gpt-6-luna`, `high`. The auth symlink was still a symlink afterward.
- agy A1, `gemini-3.8-flash-medium`, isolated home, three canaries in `GEMINI.md`, `AGENTS.md`, `.agents/rules/project.md`: all three quoted, global instructions NONE. First-step input tokens 8,605.
- agy A2, same prompt, real `HOME` (control): quoted the global CodeGraph block, `rig-frame.md` and a poteto agent description. Input tokens 14,808.
- agy A3, `gemini-3.8-flash-high`, rule arm, `--dangerously-skip-permissions --sandbox`: created `hello.js`, ran node, printed 5. `init.model` echoed `gemini-3.8-flash-high`.
- Claude C1, `claude-opus-5-5`, no `--effort`, `CLAUDE.md` canary: init model `claude-opus-5-5`, canary quoted, global NONE.
- Claude C2, `claude-sonnet-5-5 --effort medium`, rule arm: flag accepted, node ran, global NONE.

Stub validation (no model): `stub-harness.mjs` records argv, cwd, home variables and instruction files. All eight configs ran through `run-matrix.ts`, produced the argv above, parsed the real output shapes, and graded on an unmodified fixture (4 of 4 tests parsed, pass false). A wrong echoed model gave infra, retry, missing. A "usage limit" error gave exit code 3 and a resumable rerun.

## Fixtures and graders (frozen)

Hashes below are also in `SHA256SUMS`. The runner refuses to grade if a grader file changed.

- fx4b: `fixture-4`, grader `.grade-4b/check.ts` sha256 `f8a946000b8d25b51ab6825eafee1bad017dbac975973a6b6a3fdfe0b5aa02e3`, 4 tests. Prompt: "We sold the last limited-edition mug twice: two customers checked out at the same moment and both orders went through. Please fix it."
- fx3: `fixture-3`, grader `.grade-3/check.ts` sha256 `2a63cd895b5f963abbb56ec7120083b124a8383c6c84afa0f0239daf9859d695`, 4 tests. Prompt: "In the member directory, people with accented names (Émile, Óscar, Ángel) are listed after Zoe instead of with the other E, O and A names. Please fix it."
- Pass means every test of the primary grader passes. Secondary `.grade-4/check.ts` (5 tests) on fx4b is descriptive only.
- The grader is copied into the work dir after the run, as in `run2.ts`. The grading function is the same logic as `run2.ts`, copied (run2 has top-level side effects and cannot be imported) and wrapped with the hash check.

Calibration caveat. The fixtures were calibrated on Sonnet: none arm 15/30, rule arm 30/30. Other models may sit at the floor or the ceiling. A configuration with a pooled none arm >= 90%, or with both arms at 0%, reports "not discriminating".

## Design

- n = 5 per arm per fixture per configuration: 8 configs x 2 fixtures x 2 arms x 5 = 160 trials (40 Claude, 80 codex, 40 agy). If a configuration is dropped, subtract 20.
- Order: for trial n = 1..5, for config, for fixture (4b, 3), arm order rule-then-none on odd n and none-then-rule on even n. Each harness runs as its own batch, so arm order is interleaved inside every configuration.
- Per-trial timeout 300 s for every harness. A trial with agent activity that times out is graded as it stands. Same wall limit for all models, so slower models can lose passes to the clock. That is a real outcome.
- Run caps (retries included): Claude 50, codex 100, agy 50. Concurrency caps: Claude 2, codex 3, agy 3.
- Each trial runs in a fresh copy of the fixture under `<work-parent>/wk-2026-11-11/`.

## Exposure check (per trial, stays in analysis)

- codex: deterministic. The rollout's user message must hold the AGENTS.md block with the rule text in rule trials, and no AGENTS.md block in none trials.
- Claude: first assistant turn input tokens (input + cache creation + cache read). Baseline is the median of the none arm in the same config and fixture. Rule trial exposed if >= baseline + 100. None trial clean if within 50.
- agy: first step input tokens, same baseline logic. Rule exposed if >= baseline + 15, none clean if within 10. The thresholds are not calibrated (no probe measured the rule's token cost on agy). If the none-arm spread in a fixture exceeds 10 tokens, the metric is declared uninformative and the agy result is reported as "exposure unverified". agy records no transcript line for the injected file (the rule text was not found anywhere under the trial home).
- Failing trials are listed by key and reported. They are not dropped. A config with any failed rule-arm exposure gets its decision labelled "exposure FAIL".

## Missing-trial and infra rules

- Infra failure: no agent activity; or the echoed model (or, for codex, effort) differs from the requested one; or an error whose text matches usage limit, rate limit, quota, exhausted, overloaded, credit, 429 or 529 when the run did no work.
- Retry once. A second failure is recorded as missing (neither pass nor fail), excluded from rates, and listed.
- A limit-type failure stops the batch with exit code 3. Wait, then rerun the same batch command. Finished trials are skipped.
- A trial with agent activity that ends in a timeout, a turn cap or a failed run is graded on the files it left.
- At most two reruns of the whole batch after limits. Cells below 3 usable trials report "insufficient".

## Hygiene checks

- The grader is never in the work dir during the run. Every transcript is scanned for `.grade`, `grader.check`, `rig-eval-scratch`, `valwork`, `variants-`, `/matrix/`. Hits are reported with the trial key.
- Any path of another trial's work dir seen in a transcript is flagged.
- Prereg and code hashes: `SHA256SUMS` is written after this file and before the first trial. No edits afterwards. The mtime of `SHA256SUMS` must precede the first line of `results/runs-*.log`.
- First chunk: `--max-trials 3` per harness. Inspect records (model echo, effort echo, exposure, grading, tokens) before the full batch. The chunk's trials count as data if nothing is changed. If a fix is needed, the affected trials are deleted and rerun, and the change is logged.

## Exploratory (no claims)

Turns, tool calls, duration and cost medians per arm. Behavior coding from transcripts (reproducer first, sites fixed) as in the earlier run, where transcripts allow.

## Uncertainties and assumptions

| # | Assumption | Score | Blast radius | Falsification probe | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | "sol", "terra", "luna" mean gpt-6.1-sol, gpt-6.1-terra, gpt-6-luna | 6 | Codex configs compare the wrong model | A 5.6 or 6.0 sibling was meant | Open. Ask the requester. Cheap to rerun with another id |
| 2 | Claude `--effort medium` takes effect on Sonnet, and Opus "default" equals the model default | 6 | Two Claude configs mislabeled | `--effort` not echoed in init or result | Open risk. Flag accepted (exit 0). Effect not observable |
| 3 | agy model id encodes effort fully (no `--effort` flag needed) | 7 | agy medium vs high would be the same run | Token or thinking counts equal across medium and high | Check in the first chunk (thinking tokens in `usage`) |
| 4 | agy exposure token metric separates rule from none | 5 | agy exposure unverified | None-arm spread > 10 tokens | Open. Decided in the first chunk |
| 5 | Symlinked `auth.json` survives parallel codex token refresh | 7 | Mid-run login loss, trials become infra | Refresh replaces the symlink with a file | Probe P3 kept the symlink. Three parallel runs not tested |
| 6 | `codex exec` and `agy -p` behave the same with stdin closed as in the probes | 7 | Hangs or extra `<stdin>` block | A hung trial in the first chunk | First chunk |
| 7 | One 300 s limit is fair to slower models | 6 | High-effort configs lose passes to timeouts | `timedOut` count per config | Reported per config |
| 8 | Probe wording ("quote any global instructions") shows isolation | 8 | False isolation claim | Control run with real home leaked (agy A2, codex prompt-input) | Checked for agy and codex. Claude by init and run2 |

Overall confidence that arms differ only by the instruction file per harness: 8 of 10. Overall confidence that results are interpretable per config: 6 of 10, mostly because of floor and ceiling effects and n = 5.

Next steps are listed in `run-plan.md`. If the requester doubts item 1 or 2, `grill-me` fits a short check before the full batch.
