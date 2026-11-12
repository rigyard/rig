# Preregistration: rig L2 pilot, pstack/principle-fix-root-causes

Written before any trial of this run. The two init-only probes (`results/probe-*-init.json`) ran before this file and made no model call.
Locked files and their sha256 are in `SHA256SUMS`. This file's own sha256 is printed by the last step of `run-plan.md`.
Status of every number below: a pilot-local choice, marked `example - do not ship as a rig threshold`, unless it says `derive-from`.

## Question

Does one pstack principle, delivered through rig's compiled `craft` mode skill, change the pass rate of Sonnet on two bug-fix tasks graded by hidden tests?

Unit under test: `pstack/principle-fix-root-causes` (concept doc, section "Evidence and retirement", L2).
Why this unit: the fixtures fail when an agent fixes only the reported site, which is the fault the principle names ("Check for the pattern, not just the instance"). One other leaf links to it (`principle-attack-the-premise`), so the masked arm needs one ack pair and builds. A leaf that no other leaf links to (for example `principle-test-behavior-not-implementation`) would need no ack, but it does not match these fixtures.
What is measured: the `craft` mode skill with the unit installed, against the same skill with the unit disabled. The principle reaches the model only if the hub's Principles index makes it open the leaf (the Bug fix playbook never names it). The result is therefore an effect of the unit on offer. The exposure check says how often it was taken up.

## Arms (built by rig, `rig plan` then `rig apply` into one fixture HOME each)

- `with`: the repo config at main `2dbce75`, unchanged. `rig plan`: exit 0, 313 changes, 0 blocks. `rig apply`: exit 0, 313 ops.
- `without`: the same config plus `"disable": ["pstack/principle-fix-root-causes"]`, and an `audit.allow.json` that acks the two `links` findings (both from `principle-attack-the-premise`, one per `~/.claude/skills` and `~/.agents/skills`). `rig plan`: first exit 1 with the two links blocks, then exit 0 with both acked, 310 changes, 0 blocks. `rig apply`: exit 0, 310 ops.
- Rendered trees differ only in `.claude/skills/principle-fix-root-causes/SKILL.md`, `.agents/skills/principle-fix-root-causes/SKILL.md` and `.agents/skills/principle-fix-root-causes/agents/openai.yaml` (`tree-diff.txt`). The frame, the hub, the craft skill, the playbooks and the model rules are byte-identical. No frame trigger or mode line names this unit, so no line changed. Config differs in `rig.json` (the `disable` entry) and `audit.allow.json`, which rig does not render.
- Both tree manifests: `manifest-with-home.txt` (sha256 `c800bc68580633c70da4319b62dffddffa50ae4a0d1cf7a26df05e19487d1ac3`), `manifest-without-home.txt` (sha256 `4b218d59b05ec520a67a64f2f1d2a7dab16db8f833ea005bff7a72c0d80a4250`).

## Delivery into a trial

Each trial's work dir is a fresh copy of the fixture plus the arm's rendered `.claude/agents`, `.claude/commands`, `.claude/skills`, `.claude/rules` copied as project units (the method of `mirrorProject` in `test/helpers/mirror.ts`; `run-pilot.ts` copies them itself because `mirrorProject` refuses a path inside the real home). `claude -p` runs with `--setting-sources project,local --strict-mcp-config` on the subscription login, so no user-level `~/.claude` content loads. HOME is not changed: a check with HOME set to a fixture HOME gave `loggedIn: false`.
Entry into the mode skill: the prompt is the organic task prefixed with `/craft ` (same prefix in both arms). Init probes: both arms list `craft`; `with` lists `principle-fix-root-causes` (76 skills), `without` does not (75 skills). The init events differ in nothing else once cwd, session id, uuid, socket and memory paths are removed.
Not proven by init: that the typed `/craft` reaches the skill body. Rig's own live lanes type it the same way (`test/live/mode.test.ts:128`, `test/live/first-seed.test.ts:204`). Each trial records whether `hub.md` was opened, and the first chunk checks it before the run continues.
Leak found and handled: the real `~/.claude/skills` holds byte-identical copies of `craft` and `principle-fix-root-causes`, and the rendered frame names `~/.claude/skills/...` paths. In `without` a model could read the unit from the real home. Both arms run with `--disallowedTools "Read(//<real home>/.claude/**)" "Read(~/.claude/**)"`. A `Bash(cat ...)` read is not blocked, so every tool call that names the unit is recorded (mask integrity below).

## Prompt (verbatim, same prefix in both arms; the work dir name is `storefront` or `member-directory`)

- fx4b, sha256 `e6fb72161df50bd5322c27516b197cb9de1e9392016c63a6a68536c06c096d6a`:
  `/craft We sold the last limited-edition mug twice: two customers checked out at the same moment and both orders went through. Please fix it.`
- fx3, sha256 `7ff35f14d3f4f3e28acb8c936bcf49e01f633aaaad5c39d10131c83d17f4bbd5`:
  `/craft In the member directory, people with accented names (Émile, Óscar, Ángel) are listed after Zoe instead of with the other E, O and A names. Please fix it.`

## Fixtures and graders (frozen)

Primary, pass = every test of the grader passes:
- fx4b: `fixture-4` (manifest `pilot/manifest-fixture-4.txt`, sha256 `b1551d4c011c8763173d78a79af82f0bc6ee8b05f6e2174494964121b84780ea`, excluding .git), grader `.grade-4b/check.ts` (sha256 `f8a946000b8d25b51ab6825eafee1bad017dbac975973a6b6a3fdfe0b5aa02e3`), 4 tests.
- fx3: `fixture-3` (manifest sha256 `b0915c208f90f7bf8194b07a79809a1b0b76a793bc9a4bc542003fdb13775d92`), grader `.grade-3/check.ts` (sha256 `2a63cd895b5f963abbb56ec7120083b124a8383c6c84afa0f0239daf9859d695`), 4 tests.
Secondary, descriptive only: `.grade-4/check.ts` (sha256 `4bda6d0a90b8a5f41874622198d87976a670ea42052bc175381d95613a25a372`, 5 tests) on fx4b runs.
The manifest hashes use `find . -name .git -prune -o -type f | sort | shasum -a 256` per file, then a hash over that list. They are not the tree hashes of the earlier prereg, whose method is not recorded.
Calibration (earlier prereg, plain prompt with no `/craft`): Sonnet without any rule passed 8 of 15 on fx4b and 7 of 15 on fx3. Headroom under `/craft` is not assumed. It is checked on the `without` arm of this run.
Grading confound: the `without` arm's hub writes one line naming the missing skill (`packs/core/skills/craft/SKILL.md:14`). The graders import only `src/*.ts` of the work dir and run behavior tests (`.grade-4b/check.ts:3-6`, `.grade-3/check.ts:3-5`). They read no reply text, no comment, no git state. The line cannot change a grade. Exploratory behavior coding may see it, so it is read only after grading.

## Design

- Model: `sonnet`. The init event recorded `claude-sonnet-5-5` (both probes). Subscription login, API key variables removed from the child env, along with `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_PLUGIN_DIRS` and `ORCA_*`.
- n = 10 per arm per fixture = 40 trials. Order: for n = 1..10, for fixture in (4b, 3), for arm: `with` first when n is odd, `without` first when n is even. Up to 3 concurrent runs, each in its own work dir.
- Flags: `--output-format stream-json --verbose --model sonnet --max-turns 30 --permission-mode acceptEdits --allowedTools Bash(node *) Bash(git *) Bash(ls *) Bash(cat *) Bash(grep *) Bash(find *) --disallowedTools <two Read denies> --no-session-persistence --setting-sources project,local --strict-mcp-config`. The built-in Agent tool is not restricted, so the hub's delegation to `poteto-agent` can run.
- Per-trial timeout 900 s. Deviation from the earlier prereg (300 s), because `/craft` reads the hub and a playbook and may delegate.
- Hard cap 44 claude runs in `results/runs.log`, probes included (2 used). 40 trials leave 2 retries.
- Frozen code: `run-pilot.ts`, `analyze-pilot.ts`.

## Primary analysis

- Pass rate per cell (k/n). Difference = `with` minus `without`.
- 95% percentile CI from a stratified bootstrap: resample trials with replacement inside each fixture x arm cell at its own n, 10,000 resamples, fixed seed 20261111 (mulberry32). Pooled difference = total passes over total usable trials per arm.
- Exact Fisher test, two-sided, per fixture. At 10 per cell a 0/10 versus 10/10 split is the only way to reach p below 0.001, and a 5/10 versus 9/10 split gives p near 0.14. Fisher is descriptive per fixture. The decision uses the pooled CI.
- Cost per pass = total costUsd of usable trials in a cell over its passes. Ratio `with` / `without`. Descriptive, no CI.
- A cell with 10/10 or 0/10 has zero bootstrap variance, so its percentile CI is too narrow. Inference about the method.
- Power (inferred, normal approximation): with 20 trials per arm pooled and a `without` rate near 0.5, the 95% half-width of the difference is about 0.30. The pilot can see an effect of about +0.40 or more. A null is not evidence of no effect.

## Decision rule

1. A cell of fewer than 8 usable trials: `untested`, reason named.
2. `helps` if the pooled CI lower bound > 0. `hurts` if the upper bound < 0. These stand on the intent-to-treat contrast, whatever the exposure. If exposure is below 90% or the mask leaked in more than 10% of `without` trials, the report names it as a caveat. A leak or low exposure only dilutes the contrast.
3. Otherwise `no-effect` only if all four hold, which are the concept doc's four null-result questions:
   - exposure >= 90%: at least 90% of usable `with` trials opened `principle-fix-root-causes/SKILL.md` (a successful Read, or a shell command that printed it);
   - none-arm headroom held: the pooled `without` pass rate <= 0.80 (example - do not ship);
   - mask integrity: at most 10% of usable `without` trials read the unit's SKILL.md from any path;
   - power: the pooled CI lies inside +-0.25 (example - do not ship). This gate is an addition to the rule in the task brief. With n = 20 per arm it will rarely pass, so most nulls read `untested (underpowered)`.
4. Otherwise `untested`, with every failed condition listed.
Nothing else may be promoted to a claim. Everything not listed under Primary is descriptive.

## Exposure check and mask integrity (every trial)

- Source: the raw stream-json events. A trial is exposed if a tool call whose input names `principle-fix-root-causes/SKILL.md` has a tool result without `is_error`. Calls inside subagents count (their events carry `parent_tool_use_id`).
- `with` trials: exposure rate as above, split by work-dir copy and real-home copy.
- `without` trials: the same test is a mask leak. A call that names the unit and failed (the expected `Read` of the missing project copy) is recorded as an attempt, not a leak.
- Also recorded: whether `craft/SKILL.md`, `craft/hub.md` and `playbooks/bug-fix.md` were opened, and every tool call that names a real-home `.claude` path.

## Missing-trial and infra rules

- Infra failure: no result event and no assistant turns; or an error result with no assistant turns; or any error result (not `error_max_turns`) whose text matches usage limit / rate limit / overloaded / credit / 429 / 529.
- Retry once. A second failure is recorded as missing (neither pass nor fail), excluded from rates, key reported. The cap leaves 2 retries in all, so a third infra failure leaves its trial missing with no retry.
- A limit-type failure stops the batch. Wait, then resume. Each attempt counts toward the cap and is logged in `infra.log`.
- A trial with agent turns that ends in timeout or `error_max_turns` is graded as-is on the files it left. It is a real outcome.
- Trials missing in only one arm of a pair are not paired off. The analysis stays stratified by cell. If any cell ends below 8 usable trials, rule 1 applies.

## Hygiene checks (run by `analyze-pilot.ts`, inspected by hand for each flag)

- Prereg mtime precedes the first trial line of `runs.log`. The two probe lines predate the prereg and are the only earlier entries.
- Hidden checks unread: a scan of every raw transcript for `.grade`, `grader.check`, `rig-runner-proto`, `variants-`, `valwork`, `rig-eval-scratch`, `/pilot/arms`. Any hit is reported with the trial's treatment.
- Sibling work dirs of other trials seen in a transcript are flagged.
- Init events diffed across arms: skills minus the unit identical, agents identical.
- First chunk: 4 trials (fx4b and fx3, both arms, n = 1). Before the run continues, inspect: `hub.md` opened in all four, exposure per arm, real-home touches, cost and duration, the grader's verdict, and the final reply of a `without` trial for the missing-skill line. If `hub.md` was not opened, the prompt did not reach the mode skill: stop and report.

## Evidence row

Outcome to ledger row (`evidence.json`, key `pstack/principle-fix-root-causes`), per the concept doc, L0:
- `helps`, `hurts`, `no-effect`: `{"status": <status>, "source": "<path of results/analysis.txt>", "models": ["claude-sonnet-5-5"], "date": "<date of the last trial>"}`. `models` comes from the init events.
- `untested`: `{"status": "untested"}`. The reasons stay in the report, not in the row. An `untested` row needs no `source`.
- The row records Sonnet on two small fixtures with the unit on offer through `craft`. It is not a claim about other models or other tasks. A PR that sets the row carries the report in its description. A `helps` from this run is not a promotion by itself. `safety` is not an outcome of this run.

## Exploratory (no claims)

Reproducer-first (a failing test or script run before the first edit), distinct files changed against the reference root sites, turns and cost medians per arm, whether the `without` arm wrote the missing-skill line, which other principles each arm read.

## Uncertainties

| Uncertainty | Why | Resolution |
| --- | --- | --- |
| The typed `/craft` reaches the skill in `-p` mode | Init lists the skill. Only a transcript shows the hub opened. | First chunk check |
| Exposure is low | The playbook never names the unit. The hub says to read a leaf only for a principle the model applies. | Reported as exposure. Low exposure caps the result at `helps`, `hurts` or `untested`. |
| `/craft` raises the `without` pass rate to the ceiling | Calibration used the plain prompt | Headroom gate, reported |
| A `without` trial reads the unit from the real home through Bash | The Read denies do not cover `cat` | Recorded per trial, sensitivity row drops those trials |
| 900 s timeout clips long `/craft` runs | Unknown run length | Timed-out trials are graded as-is and flagged |
| Model alias `sonnet` resolves differently during the run | The alias can move | Init model recorded per trial |
| Two fixtures, one model, one prompt each | Small sample | No claim beyond these |
| Concurrency 3 adds CPU contention to race-sensitive tests | Not measured | Same in both arms by interleaving |
