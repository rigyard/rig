# Preregistration: does a harness configured by rig do better than the vanilla harness?

Written before any trial of this run. Locked files and their sha256 are in `SHA256SUMS` (this file included). No trial has run. Three probe runs and one unplanned one-word call ran before this file (see Probes). Status of every number: a run-local choice, `example - do not ship as a rig threshold`, unless it says `derive-from`.

## Question and decision rule

Question: on the same model and the same organic task, does Claude Code configured by rig (default config at rig main `2dbce75`) pass hidden-test graders more often than Claude Code with no project config?

Decision rule (final), applied per model (opus, sonnet) and per fixture set (synthetic set A, real set B, see Fixtures):
1. A cell with fewer than 5 usable trials in the vanilla or rig arm makes the model `untested` for that set.
2. Ceiling: vanilla pooled pass rate >= 0.90 gives `ceiling, uninformative, no claim`. Floor: vanilla and rig pooled both <= 0.10 gives `floor, uninformative, no claim`. The rule reads the pooled arm rates, not the contrast.
3. `rig helps` only if the pooled (rig minus vanilla) stratified-bootstrap 95% CI has a lower bound > 0 on all trials AND on the leak-dropped sensitivity set. If only the all-trials CI clears 0, the report says `rig helps, fragile under the leak sensitivity`. `rig hurts` is the mirror case (upper bound < 0).
4. Otherwise `no claim`. A null is not evidence of no effect (see Power).
5. Product statement across models, per set: `rig helps` only if both models say `rig helps`. One model: `helps on <model> only`. Opposite signs: `mixed`.
6. Everything not listed here is descriptive and cannot be promoted: rig-told minus rig, rig-told minus vanilla, cost per pass, turns, wall time, per-fixture Fisher tests, exposure rates, the secondary grader `.grade-4`, and the all-fixtures pool.
7. Cost is reported next to any claim. A pass-rate gain with a cost-per-pass ratio rig/vanilla above 1 is reported as `helps at higher cost per pass`.

## Arms (arms differ only by the delivered rig config and the `/craft ` prefix)

- `vanilla`: a fresh copy of the fixture. No `CLAUDE.md`, no `.claude/`, no settings file.
- `rig`: vanilla plus the project units below. Same prompt.
- `rig-told`: the `rig` arm with the prompt prefixed by `/craft ` (the mode skill the rig frame tells the user to type). It separates "rig content helps" from "the agent did not route into it".

Rig arm contents. Built by `arms/rig/apply.sh plan` and `apply` from a `git archive` copy of rig main `2dbce75` (`arms/rig/repo`, `rig.json` sha256 59acfec0..., `rig.lock.json` sha256 8135c5a4...), into a fixture HOME (`arms/rig/home`) with HOME, XDG_CONFIG_HOME, XDG_STATE_HOME, XDG_DATA_HOME and RIG_ROOT pointed inside `arms/rig`. `plan`: exit 0, 313 changes, 0 blocks. `apply`: exit 0, 313 ops (`plan.txt`, `apply.txt`). The real `~/.claude` was not touched (a `find -newer` check after apply returned nothing).
Delivered by `build-rig-arm.sh`, the method of `mirrorProject` for claude (`test/helpers/mirror.ts`, `MIRROR_UNITS.claude`): `.claude/agents` (2 files: `poteto-agent`, `comment-sicko`), `.claude/skills` (58 skill dirs: the `craft` mode skill with hub, 23 playbooks and the adapter; 24 `principle-*` leaf skills; the pstack skills `how`, `why`, `architect`, `arena`, `swarm`, `interrogate`, `reflect`, `unslop`, `technical-writing`, `no-comments`, `tdd` and others; `deslop`, `control-cli`, `control-ui`; `cli-for-agents`; `office-hours`; `typescript-best-practices`), `.claude/rules` (`rig-frame.md`, the always-on frame; `pstack-models.md`, the model table), `.claude/commands` (none rendered). 122 files, `manifest-project.txt`. `.claude/` is added to the work dir's `.git/info/exclude`.
One byte change against the rendered tree: in `rules/rig-frame.md`, `~/.claude/` becomes `.claude/` (5 lines, `frame-rewrite.diff`). Reason: the frame names `~/.claude/skills/...`, which the real home would answer in a user install. Here the real home is denied in every arm, so the paths would dead-end. Every other file is byte-identical to the render (`manifest-rendered-claude.txt` differs from `manifest-project.txt` only on that file).

Not delivered, and whether it matters:
- Other harness outputs of the same apply (`.agents/skills`, `.codex`, `.cursor`, `.gemini`, `.omp`): irrelevant to Claude Code.
- Hooks and settings: rig renders none here (`rig.json` `metrics.session_hook` is false, so no `settings.json` is written). Nothing is lost.
- User scope versus project scope: rig installs at user scope, this run delivers at project scope. Claude Code lists the same skills and agents (init event, see Probes) and loads `.claude/rules/*.md` as always-on memory (the agent quoted `# rig frame` in the delegation probe). The skill listing, rule loading and agent routing are the same. A difference in rare cases (precedence of user over project config) is possible and not measured.
- `typescript-best-practices` has `paths: ["**/*.ts"]`, so Claude Code lists it only after a `.ts` file is touched. It is absent from the init skills list (57 of 58 listed) and expected to appear in the TypeScript fixtures. This is rig's own behavior.
- `~/.claude/...` strings inside skills other than the frame (for example `adapter.md`) are informational and unchanged.
- The eval's tool allowlist (below) denies commands the hub may suggest, such as `rg` or `npm`. It applies to all arms. It can cost rig more than vanilla. See Uncertainties.

## Prompts (verbatim; the work dir is named `storefront`, `member-directory` or `rig`)

Vanilla and rig send the text as is. rig-told sends `/craft ` plus the text.
- fx4b, sha256 140b68256a60c896233baf82facc0d13e870a4377fba1edd99bdbecb25533464 (with prefix e6fb72161df50bd5322c27516b197cb9de1e9392016c63a6a68536c06c096d6a): `We sold the last limited-edition mug twice: two customers checked out at the same moment and both orders went through. Please fix it.`
- fx3, sha256 a61cdedba069362c1923a1fc34fd7fb5a494ed063fe76c873b4bcbb6dc320056 (with prefix 7ff35f14d3f4f3e28acb8c936bcf49e01f633aaaad5c39d10131c83d17f4bbd5): `In the member directory, people with accented names (Émile, Óscar, Ángel) are listed after Zoe instead of with the other E, O and A names. Please fix it.`
- Set B prompts are the verbatim prompts of `gen/prereg.md` (they are in `run-stack.ts`, `FIX.d3`, `FIX.ab`, `FIX.st`): sha256 of the plain text d3 385c96e0..., ab 1490375e..., st e2a133b6....

## Fixtures and graders

Set A, synthetic, n = 6 per arm per model (primary):
- fx4b: `fixture-4`, tree sha256 (manifest method of `manifest-fixture-4.txt`) e7b90d2411894ded157629570babf3c3df5c503f30d230be465cf8f595073565, grader `.grade-4b/check.ts` sha256 f8a946000b8d25b51ab6825eafee1bad017dbac975973a6b6a3fdfe0b5aa02e3, 4 tests. Secondary `.grade-4/check.ts` 4bda6d0a90b8a5f41874622198d87976a670ea42052bc175381d95613a25a372, descriptive.
- fx3: `fixture-3`, tree sha256 1dc4cff312ea7ccf47c95c2acd721cbfb959d78e90ff88dbae780ae72debfd5b, grader `.grade-3/check.ts` sha256 2a63cd895b5f963abbb56ec7120083b124a8383c6c84afa0f0239daf9859d695, 4 tests.
Set B, real bugs from rig history, `added if ready`, n = 4 per arm per model, run only with `WITH_GEN=1`. `gen/SHA256SUMS` exists at the time of writing. Fixtures `gen/fixtures/{d3dc4ce,ab8d5ec,069847a}` (manifest sha256 in `manifest-gen-*.txt`), hidden tests through `gen/graders/grade.sh` (expected tests 51, 21, 3). Set B is its own set. It is never pooled into the decision of set A. The fixtures are the rig repo itself, so an agent that runs `rig apply` there would write to the real home. The runner guards this (Hygiene) and the allowlist cannot prevent it. The operator decides whether to run set B.
Graders live outside the work dir and are copied in after the run. The work dir sits in `<work-root>`, outside the real home, so no `CLAUDE.md` of a parent directory loads.

## Models and effort

- `opus`: `--model opus`, no effort flag (the default effort). The alias resolves to the model in the init event, which is recorded.
- `sonnet`: `--model sonnet --effort medium`. The CLI (`claude --help`, 2.1.322) lists `--effort <level>`: low, medium, high, xhigh, max. The init event does not echo effort. Acceptance is proven by the absence of the warning that `--effort bogus` prints (`Unknown --effort value ... Valid values: low, medium, high, xhigh, max`), with empty stderr for `medium` in all three probes. The effect on the model is not observable from the stream.

## Design

- n = 6 per arm per fixture per model, set A: 3 arms x 2 fixtures x 2 models x 6 = 72 trials. Set B added: 3 x 3 x 2 x 4 = 72 more, 144 in all.
- Flags (all arms): `--output-format stream-json --verbose --model <m> [--effort medium] --max-turns 40 --max-budget-usd 6 --permission-mode acceptEdits --allowedTools Bash(node *) Bash(git *) Bash(ls *) Bash(cat *) Bash(grep *) Bash(find *) --disallowedTools <Read and Bash denies for the real ~/.claude and ~/.agents, absolute and tilde and $HOME forms> --no-session-persistence --setting-sources project,local --strict-mcp-config`. Subscription login. API key and relocation env variables, `ORCA_*` and `CLAUDE_CODE_PLUGIN_DIRS` removed from the child env. HOME is not changed (a fixture HOME breaks the login).
- Per-trial wall budget 1500 s (kill, then graded as is). Budget stop at $6 is graded as is and counted in the descriptive table.
- Order: for n, for model, for fixture, the arm order rotates by (n + cell index) mod 3, so every arm leads equally often. Concurrency 2.
- Run cap 90 (set A) or 160 (set B added) in `results/runs.log`, probes included (3 used). Spare runs are infra retries.
- Frozen code: `run-stack.ts` sha256 78bebe1f..., `analyze-stack.ts` sha256 72747d21..., `build-rig-arm.sh`, `arms/rig/apply.sh`.

## Primary analysis (per model, per set)

Pass = every grader test passes. Contrast = pooled (rig minus vanilla): total passes over total usable trials per arm, over the fixtures of the set. 95% percentile CI from a stratified bootstrap, resampling within each fixture x arm cell at its own n, B = 10,000, seed 20261112 (mulberry32). Sensitivity: the same with every leak trial dropped. Exact two-sided Fisher per fixture, descriptive. Power (inferred, normal approximation): with 12 usable trials per arm and a vanilla rate near 0.5 the CI half-width is about 0.28, so the design sees a difference of about +0.40 or more. Set B at 12 per arm pooled is the same.

Secondary, descriptive: rig-told minus rig (routing contrast) and rig-told minus vanilla with the same bootstrap. Cost per pass = total `total_cost_usd` of usable trials over passes, reported as a ratio rig/vanilla and rig-told/vanilla per model, plus mean cost, median turns and median wall time per arm. `total_cost_usd` includes subagents (see Probes).

## Exposure and leak checks (every trial)

- Config loaded: first assistant turn input tokens (input + cache creation + cache read) minus the vanilla median of the same model and fixture. A rig or rig-told trial is loaded if the delta is >= 500. The probe delta was +1125 tokens (derive-from: probe rig 19383 minus probe vanilla 18258). A vanilla trial is clean if |delta| <= 100. A failing trial is reported by key and stays in the analysis.
- Routing: for rig and rig-told, whether the transcript shows a successful `Read` or shell read of `skills/craft/hub.md`, `skills/craft/SKILL.md` or a playbook, by the session or by a subagent (events carry `parent_tool_use_id`). Exposure of rig-told is the hub-read rate. Also recorded: subagent spawns by type and model, and `subagent_stats` of the result event.
- Leak flag per trial: any Read, Bash, Grep or Glob call that names the real `~/.claude` or `~/.agents` in any form (`leakAttempts`; `leakSucceeded` when the call returned without error), plus the result event's `permission_denials`. Grader and scratch-path strings in the raw stream set `leakedGrader`. A trial with any of these is a leak trial. It stays in the primary analysis and is dropped in the sensitivity analysis.
- Sibling work dirs seen in a transcript are flagged.
- Vanilla integrity: a vanilla trial whose init lists `craft`, `poteto-agent` or `comment-sicko` is invalid and is retried as infra.

## Missing-trial and infra rules

An infra failure is: no result event and no assistant turns; an error result (not `error_max_turns`) with no assistant turns; or an error result matching usage limit, rate limit, overloaded, credit, 429 or 529. Retry once. A second failure is `missing`, excluded from rates, key reported. A limit failure stops the batch; wait, then resume; each attempt counts in the cap. A trial with agent turns that ends in timeout, `error_max_turns` or the budget stop is graded as is.

## Hygiene

Every locked file matches `SHA256SUMS` before the first trial and after the last. The prereg mtime precedes the first `runs.log` line after the probes. The runner stops the batch (exit 4, `guard.log`) when any file under the real `~/.claude/{agents,commands,rules,skills,settings.json,CLAUDE.md}` or `~/.agents` becomes newer than the batch marker, which would show a trial that ran `rig apply` against the real home. Every `infra.log` line and every `isError` record is read by hand. At least one transcript per arm, model and fixture is read end to end before the report.

## Mapping to `evals/history.jsonl`

One cell line per (arm, model, fixture) from `analyze-stack.ts` (`results/history-lines-<set>.jsonl`, with `RUN_ID`, `DATE`, `CLI_VERSION` placeholders to fill): `unit` `rig/default@2dbce75`, `harness` `claude-code`, `rig_commit` `2dbce75`, `arm` `none` (vanilla), `rig`, `told` (rig-told), `model` from the init event, `effort` `default` (opus) or `medium` (sonnet), `fixture` `fx4b`, `fx3` or `gen-<sha>`, `fixture_sha256` and `grader_sha256` as above, `k`, `n`, `mean_cost_usd`, `mean_turns`. The run directory gets `summary.json`, `analysis-<set>.txt` and this file. The verdict per model and set goes in `summary.json`. No absolute path goes in any of them.

## Probes (bounded, before this file)

Three runs plus one unplanned call. `probe vanilla` and `probe rig` (sonnet medium, fx4b prompt) were killed at the first assistant event. `probe deleg` was a full run (`/craft` prompt, max 12 turns, $3 budget). The unplanned call was `claude -p hi --effort bogus` in `<tmp>` with the user's normal config: one trivial model call, not part of any arm, run to read the effort warning.
- Vanilla has none of rig's units: init lists 19 built-in skills and 6 agents. The intersection with the 58 rig skill dirs is empty. `poteto-agent` and `comment-sicko` are absent. First-turn tokens 18258.
- Rig has all of them: 76 skills (the 19 plus 57 of 58 rig dirs, the 58th is the path-scoped skill above) and 8 agents, `poteto-agent` and `comment-sicko` among them. First-turn tokens 19383 (+1125). The frame is loaded: the agent quoted `# rig frame`. Init events differ in nothing else (tools, plugins, MCP servers, model `claude-sonnet-5-5`, `apiKeySource` none).
- `/craft` prefix: the first-turn tokens of the delegation probe were 20129, 746 above the rig probe. The prompt text accounts for about 65 of them, the craft `SKILL.md` for about 375 more, and the rest is wrapper text. The injection is inferred from that. It is not visible in the stream. Uptake of the hub is measured per trial.
- Delegation under isolation works: the `poteto-agent` project agent was spawned (`subagent_stats.by_type.poteto-agent` 1, no refusal), ran 3 tool calls, and returned. Its tool calls appear in the stream with `parent_tool_use_id`. The deny rules hold inside the subagent: `ls ~/.claude/skills` was denied (`permission_denied`, listed in the result's `permission_denials`). A Read outside the project was refused as not granted. Nested sessions therefore inherit the isolation flags.
- Cost accounting: `total_cost_usd` ($0.0886) equals the `modelUsage` cost of one model. Its token totals (cache creation 23,889) exceed the parent's own `usage` (cache creation 9,405), so the subagent's tokens are inside the total. The stream's per-message usage is incomplete for subagents, so the result event is the source.

## Uncertainties and assumptions

| # | Assumption | Score | Why | Blast radius | Resolution and falsification probe |
|---|---|---|---|---|---|
| 1 | Without a typed `/craft`, the agent rarely routes into the hub, so `rig` is close to "frame plus skill list" | 6 | The frame tells the user, not the model, to type it, and `craft` has `disable-model-invocation`. Not observed on a full task. | `rig` minus vanilla measures little of rig's content. | The first chunk reads hub-open rates. Probe: more than 50% of organic `rig` trials open the hub. |
| 2 | The typed `/craft` expands the skill body in `-p` mode | 6 | Inferred from +681 unexplained tokens, no event shows it. | `rig-told` equals `rig` plus a prompt prefix and the routing contrast is void. | The first chunk checks hub reads in `rig-told`. Probe: rig-told hub-open rate is not above rig's. |
| 3 | The path rewrite in the frame does not change behavior beyond making the paths resolve | 7 | Five lines, same text otherwise. | Small. | `frame-rewrite.diff` is locked. |
| 4 | The tool allowlist (no `rg`, no `npm`, no shell outside node/git/ls/cat/grep/find) does not favor vanilla | 5 | The hub tells the agent to use `rg`, a todo list and subagents, and some of it is denied. | Can show as a rig penalty that real users would not see. | Per-trial denial counts from `permission_denials`. Probe: more than 30% of rig trials have a denial that vanilla trials do not. |
| 5 | Project-level rules and skills behave as user-level ones | 7 | Same listing and loading in the init event and the quote. Precedence rules differ in theory. | Unknown, likely small. | Open risk, no cheap probe. |
| 6 | n = 6 per cell detects only large effects | 8 | Arithmetic above. | A null is uninformative. | Reported as such. |
| 7 | The `--effort medium` flag changes the model's effort | 6 | Accepted without warning, not observable in the stream. | Sonnet cells could run at the default effort. | Probe: median thinking-token counts of sonnet runs sit below those of opus runs on the same fixture. Open risk. |
| 8 | The `$6` budget stop and 25-minute wall budget rarely end a rig trial | 5 | The hub fans out to subagents with more tokens. | Truncated rig trials are graded as fails and count against rig. | Descriptive table of stops by arm. |
| 9 | Set B tasks that run `rig` do not touch the real home | 4 | The allowlist permits `node *`. | A trial can write to the real `~/.claude`. | The guard stops the batch after the trial that did it. It does not prevent the write. |

Overall confidence that this design answers the question it can answer (a pooled rig minus vanilla difference of about 0.40 or more, per model, on two synthetic fixtures): 6 of 10. Confidence that a null means no effect: 2 of 10.

Next steps: sign-off on the arms, the path rewrite and the decision rule, then the first 3-trial chunk (see `run-plan.md`). `grill-me` is worth running on assumptions 1, 2 and 4 before spending the runs.
