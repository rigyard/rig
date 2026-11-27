# rig v0 program plan

Status (2026-11-27): delivered. #14 and the later v0 PRs are merged.

This plan cuts the rest of rig v0 into small PRs for the rig maintainers and the agents that build rig.
The rule is that every PR proves itself. rig seeds its output, and a real harness that runs headless confirms the behaviour.
PRs #1 to #13 are merged, and #14 (`render`) is open.
The order is `seedkit`, #14, `wiring`, `pstack`, `openspec`, `checks`, `models-cmd`, `scope`, `stats` and `product`. `records` runs beside them.
pstack and OpenSpec come right after the plumbing, because they are the hardest paths.

## How to read this

One box is one unit of work. Every box names the evidence that checks it. A nested box is a sub-step of the box above it. Check a box only when its evidence exists, a file, a log line, a TAP file, a test run, or a SHA. The body is a how-to. The appendices explain and record.

`<pstack>` is the locked pstack plugin folder, `~/.claude/plugins/cache/<marketplace>/pstack/0.15.36/`. The program runs `<pstack>/skills/poteto-mode/playbooks/autopilot-full.md`. The operator granted push and `--admin` merge. The orchestrator merges every PR, and owners never merge. No PR in this plan stops at merge-ready as an operator item.

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

This plan adapts the playbook skeleton in these ways:

- Claude Code runs the program, not Cursor. No cloud VM, Bugbot or `control-ui` exists here. Each lane runs in its own git worktree on the operator's machine.
- The live block is the seed test. Each lane is one named case in `test/live/<pr-id>.test.ts`. The case uses `liveTest` and `runHarness` from `test/helpers/live.ts`, so it runs only with `RIG_LIVE=1`. Without the variable, `node --test` reports it as skipped, and CI stays offline.
- A case seeds rig output into a fixture HOME and drives one real harness headless. Claude Code runs in a scratch repo through a project-level mirror, with the normal login. omp runs with `PI_CODING_AGENT_DIR` set to the fixture agent dir. Codex and Cursor run in scratch workspaces in read-only modes. The boot recipe has the exact commands.
- A lane saves a TAP or JSON file instead of a screenshot. rig is a CLI and has no screen.
- A PR runs fewer than ten lanes when ten distinct harness scenarios do not exist. Its live block says why.
- The perf metric is `rig plan` wall time on the fixture HOME, with an absolute budget of 1 s. Before `wiring`, `rig plan` stops at a stub, so `seedkit` and #14 time their own module entry points and say so. Docs PRs write "Not applicable" in each perf box.
- Every budget in this plan is a first value with no measurement behind it. The first owner that measures records the trunk median in the decision trail, and later PRs gate against that median.
- No PR changes a UI interaction, so no PR is review-gated.
- `/deslop` from `cursor-team-kit` is not installed here. Owners run `<pstack>/skills/no-comments/SKILL.md` and the self-adversarial pass of their dispatch brief instead.
- Done-check ids such as S2.10 refer to `docs/plan/v0-slices.md`. Section numbers refer to `docs/design/rig-architecture.md`.

## Program checklist

### Arm the program

- [ ] State the protocol and this plan to the operator, then stop. Start execution only on the operator's explicit go.
- [ ] Read these from trunk at program start. Re-read them at every tick.
  - [ ] `git show origin/main:docs/plan/v0-prs.md`
  - [ ] `git show origin/main:docs/design/rig-architecture.md`, sections 1 to 13.
  - [ ] `git show origin/main:docs/plan/v0-slices.md`, the done-checks that the unit boxes cite.
  - [ ] `git show origin/main:docs/assumptions-and-open-questions.md`
  - [ ] `<pstack>/skills/poteto-mode/playbooks/autopilot-full.md`. pstack is not in this repository, so the locked plugin copy stands in for trunk.
  - [ ] `<pstack>/skills/swarm/SKILL.md`
  - [ ] `<pstack>/skills/poteto-mode/playbooks/opening-a-pr.md`
  - [ ] `<pstack>/skills/benchmark-checklist/SKILL.md` and `<pstack>/skills/show-me-your-work/SKILL.md`
  - [ ] Control skill. Claude Code has none for a CLI here. The driver is `test/helpers/live.ts` plus `test/helpers/mirror.ts` from `seedkit`.
- [ ] On the operator's go, arm the audit tick as `/loop 1h` with the tick prompt below. Never leave the cadence to memory.
- [ ] Use this tick prompt, verbatim. "Re-read the execution playbook from trunk. Audit the operation against it and fix drift in this tick. Probe every active lane and judge progress by side effects only. Stand down a stuck lane and dispatch its replacement now. Then post a short status message to the operator in chat only when the audit found a tracked change that no earlier status message reported, such as a PR opened, a code-ready head, a round launched or closed, a verdict, a merge, a stuck agent and the action taken, a blocker added or cleared, or a decision only the operator can make. Name every such change and nothing else. Do not repeat a table, the merged list, or an unchanged blocker. If the audit found none, end the turn with no reply text. Either way, log this tick's row in your decision trail. The row names the items reported, or none."
- [ ] On the operator's hold or stand-down, send every owner a zero-writes order at once.

### Spawn owners

- [ ] Spawn one owner per PR with the full lifecycle the execution playbook names. Each owner gets its section of this plan, the user's goal, and the dispatch contract of the orchestrator's rules.
- [ ] Follow this dependency graph. Start dependent work only after its parent merges.
  - [ ] `seedkit` is independent and first. It branches from `main`.
  - [ ] #12 and #13 merged before the kit existed. `seedkit` carries their seed cases.
  - [ ] #14 keeps its code head. Its owner adds the live cases after `seedkit` merges, then rebases.
  - [ ] `wiring` after #14.
  - [ ] `pstack` after `wiring`.
  - [ ] `openspec` after `pstack`.
  - [ ] `checks` after `pstack`. It runs in parallel with `openspec`, `models-cmd`, `scope` and `stats`.
  - [ ] `models-cmd` after `openspec`.
  - [ ] `scope` after `models-cmd`.
  - [ ] `stats` after `scope`.
  - [ ] `product` after `stats` and `checks`.
  - [ ] `records` after this plan PR, because both edit `docs/README.md`. It runs in parallel with every code PR.
- [ ] Hold the file boundaries. A shared file changes only in PRs that the graph orders, in this order.
  - [ ] `lib/commands.ts` changes only in `wiring`. `wiring` moves each handler into `lib/commands/<command>.ts`, so each later PR owns one handler file.
  - [ ] `lib/commands/doctor.ts` changes in `wiring`, `pstack`, `openspec`, `models-cmd` and `scope`.
  - [ ] `lib/commands/pin.ts` changes in `pstack`, then `checks`.
  - [ ] `lib/state/**` and `lib/state.ts` change in `wiring`, `models-cmd` and `stats`.
  - [ ] `lib/targets/**` and `lib/targets.ts` change in #14, `pstack`, `models-cmd`, `scope` and `stats`.
  - [ ] `lib/world/**` and `lib/world.ts` change only in `product`. `lib/stack.ts` changes only in `scope`.
  - [ ] `lib/commands/apply.ts` changes in `wiring`, then `scope`. `lib/commands/pack.ts` and `lib/lock/**` change only in `checks`.
  - [ ] `lib/gate/**` and `lib/gate.ts` change only in `checks`. A PR that needs a gate change rebases on `checks` first.
  - [ ] `targets/*.json` changes only in #14. #14 sets every v0 field from the probe verdicts.
  - [ ] `packs/core/**` changes in #14, `pstack` and `openspec`. `rig.lock.json` changes in `wiring`, `pstack` and `openspec`, and each of them reseals the core tree hash.
  - [ ] `providers/*.json` change in `pstack`, `openspec` and `product`.
  - [ ] `rig.json` changes in `pstack` and `product`.
  - [ ] `test/helpers/mirror.ts` changes in `seedkit`, then only in a PR that the graph orders after the last PR that edited it.
  - [ ] `docs/**` changes only in this plan PR and `records`.
- [ ] Hold the review gate. No PR changes an interaction, so none waits for an operator review.

### PR mechanics, for every PR

- [ ] Resolve the forge once. Default to `gh`. If `command -v origin` succeeds and Origin can resolve the repository, use `origin pr` for every PR operation. Record any fallback to `gh`. Never require `gt`.
- [ ] Open the PR ready, never draft, per **Opening a PR**, with `gh pr create --base main`. Open its `## Why` with the user's goal.
- [ ] Run `node --test` and the leak grep of the dispatch brief once before the PR-facing push. Push with hooks on. The repository has no lint or typecheck step yet.
- [ ] Run the self-adversarial pass before each commit and `<pstack>/skills/no-comments/SKILL.md` before review.
- [ ] Triage every review thread per `<pstack>/skills/poteto-mode/references/bugbot-triage.md`. No Bugbot check runs on this repository.
- [ ] Commit normally. Decision 0023 makes repository commits unsigned. Never run `git stash`.
- [ ] Rebase onto current trunk before the code-ready report and babysit. Keep that merge base in fix rounds. Rebase again only at merge prep, on a `git merge-tree` conflict with trunk, on a CI failure that comes from a change on trunk, or when a known concurrent change to the same files lands.

### Verdict and merge, for every PR

- [ ] A full swarm runs once, at the code-ready head. Another full swarm runs only for new behavior, a redesign, or a large new diff. A rebase, a merge-conflict resolution, or a minor fix gets a single verifier at the new head, and a wording-only change gets none. Run each full swarm per `<pstack>/skills/swarm/SKILL.md`. One gates lane runs `node --test` and the leak grep. The live lanes come from the PR's **Verify, live** block. The perf lane comes from its **Verify, perf** block. Two or more audit lanes, each with its own focus, read the diff and the receipts and distrust the PR body. The root audits the receipts in the merge-ready report before the verdict.
- [ ] Judge every finding by the execution playbook's blocking rule. The verdict is clean when none blocks. A failure on trunk behavior in a lane marked `Regression lane against trunk.` is recorded against trunk and does not block the PR. A new head gets a fresh verdict, except for results that stay valid under the patch-id rule in `<pstack>/skills/poteto-mode/playbooks/shipping.md`.
- [ ] A live lane that fails on a harness login, a rate limit or a quota gives no verdict. The root reruns it once and records the cause. A second such failure stops the PR at merge-ready and goes to the operator.
- [ ] The orchestrator merges with `gh pr merge <number> --squash --admin` only after a clean verdict at the exact head SHA and green CI on that head. Before the merge, it compares `git patch-id` at the verdict SHA with the head. When the patches differ only in tests, docs or lint config, a lane result stands. Otherwise a single verifier runs at the new head first. Owners never merge.

### Boot recipe, for every live lane

Each live lane runs in its own git worktree at the PR head, on the operator's machine. No cloud VM exists in Claude Code. The lane's test case is the driver.

- [ ] `git fetch origin <head-branch> && git worktree add "$TMPDIR/rig-lane-<pr-id>-<n>" <head SHA>`. Run every later step inside that worktree.
- [ ] Export `RIG_LIVE=1`, `DO_NOT_TRACK=1` and `OPENSPEC_TELEMETRY=0`. Write `node --version` and the version line of each harness CLI that the lane uses to `versions.txt`.
- [ ] Record the sha256 of `~/.claude/settings.json`, `~/.claude/plugins/installed_plugins.json`, `~/.codex/config.toml` and `~/.omp/agent/config.yml`. Compare them after the lane. A changed hash fails the lane, because no lane may write into the real harness config.
- [ ] Run only the lane's case, in the foreground. `set -o pipefail; node --test --test-name-pattern '<case>' test/live/<pr-id>.test.ts | tee <slug>; echo "exit=${PIPESTATUS[0]}"`.
- [ ] Each case builds a fixture HOME with `makeFixtureHome`, runs `bin/rig.ts` or the module under test with `HOME` set to it, then drives one harness.
  - [ ] Claude Code. `mirrorProject` copies the `.claude/` units of the fixture HOME into a scratch git repo. `claude -p --max-turns <n> --output-format json` runs in that repo with the normal login.
  - [ ] omp. `PI_CODING_AGENT_DIR=<fixture>/.omp/agent omp -p --mode json`, with stdin closed.
  - [ ] Codex. `mirrorProject` writes `AGENTS.md` and `.agents/skills/` into a scratch workspace. `codex exec -s read-only --ephemeral --ignore-user-config --json -C <workspace>`.
  - [ ] Cursor. `cursor-agent -p --mode ask --trust --workspace <workspace> --output-format json`, plus `--plugin-dir <fixture>/.cursor/plugins/local/rig` where the lane says so.
- [ ] A case reads a Claude transcript only for tool names, file paths and usage fields. It never copies message text into an artifact.
- [ ] Save every artifact, the TAP file, the harness JSON and `versions.txt`, to `/tmp/swarm-<pr-id>/worker-<n>/`. Return the paths with the report.

## Build the live seed kit and seed what merged without it (seedkit)

**Depends on.** None. It branches from `main`, which already holds #12 (state) and #13 (world).

**Files.**

- [ ] Create `test/helpers/mirror.ts`.
- [ ] Create `test/live/seedkit.test.ts`, `test/live/state.test.ts` and `test/live/world.test.ts`.
- [ ] Edit `test/helpers.test.ts`.

**Build.**

- [ ] `mirrorProject(home, harness, dir)` in `test/helpers/mirror.ts` copies the units of one harness from a fixture HOME into a scratch project. Claude units go to `<dir>/.claude/`. Codex units go to `<dir>/AGENTS.md` and `<dir>/.agents/skills/`. Cursor units go to `<dir>/.cursor/`.
- [ ] `scratchRepo()` makes a temp git repo. `mirrorProject` and `scratchRepo` refuse any path inside the real HOME, through `assertOutsideHomeDotDirs`.
- [ ] `harnessArgv(harness, prompt, opts)` returns the headless argv per harness from the probe (i) verdicts. omp gets a closed stdin.
- [ ] `realConfigHashes()` returns the sha256 of the four real config files that the boot recipe names.
- [ ] Seed cases for #12 and #13, which merged before this kit existed. The cases call `apply`, `undo`, `loadWorld` and `compose` directly, because the CLI is not wired before `wiring`.

**You see.**

- [ ] `RIG_LIVE=1 node --test test/live/*.test.ts` prints `# pass 10` and `# fail 0`.
- [ ] `node --test` without `RIG_LIVE` prints the ten live cases as skipped, with the reason from `LIVE_SKIP_REASON`.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `test/helpers.test.ts` gains cases for `mirrorProject` (copies only the named harness units) and for the refusal inside the real HOME. Run `node --test test/helpers.test.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `sonnet high` at the PR head. Each lane follows the boot recipe and runs one case of `test/live/`.

- [ ] Lane 1. Regression lane against trunk. Case `claude sees a mirrored command` in `seedkit.test.ts`. A hand-written `rigseed-cmd.md` goes into a fixture HOME, `mirrorProject` copies it, and `claude -p "/rigseed-cmd"` runs. Trunk has no mirror helper, so the lane records that and gates head. Save `seedkit-claude.tap`. Pass when the reply holds the sentinel token and the four real config hashes are unchanged.
- [ ] Lane 2. Case `omp sees a fixture agent dir` in `seedkit.test.ts`. A sentinel command goes into `<fixture>/.omp/agent/commands/`, and `omp -p` runs it with `PI_CODING_AGENT_DIR` set. Save `seedkit-omp.tap`. Pass when the JSON output holds the sentinel token.
- [ ] Lane 3. Case `codex reads a mirrored AGENTS.md` in `seedkit.test.ts`. The workspace `AGENTS.md` holds a sentinel line, and `codex exec -s read-only` quotes it. Save `seedkit-codex.tap`. Pass when the quoted line equals the sentinel line.
- [ ] Lane 4. Case `cursor reads a mirrored project rule` in `seedkit.test.ts`. A `.cursor/rules/rigseed.mdc` with `alwaysApply: true` holds a sentinel, and `cursor-agent -p --mode ask` quotes it. Save `seedkit-cursor.tap`. Pass when the reply holds the sentinel token.
- [ ] Lane 5. Case `state seeds a command that claude runs` in `state.test.ts`. `apply` from #12 writes `~/.claude/commands/rigseed.md` into the fixture HOME from a hand-built `Desired`, and the mirror runs it. Save `state-claude.tap`. Pass when the reply holds the sentinel token.
- [ ] Lane 6. Case `undo removes what claude saw` in `state.test.ts`. Apply, mirror, run, then `undo(runId)`, mirror again, run again. Save `state-undo.tap`. Pass when the second reply lacks the sentinel and the fixture tree hash equals the hash before the run.
- [ ] Lane 7. Case `crash, recover, omp sees one copy` in `state.test.ts`. A child apply with `RIG_TEST_ABORT_AFTER=1` dies, the next `apply` recovers, and `omp -p` lists the skills in `<fixture>/.omp/agent/skills/` whose name starts with `rigseed`. Save `state-omp.tap`. Pass when omp names the sentinel skill once and the journal ends with a `commit` line.
- [ ] Lane 8. Case `compose replace reaches claude` in `world.test.ts`. A fixture pack replaces `own/rigseed`, the case writes each composed unit's source file into the mirror unchanged, and `claude -p "/rigseed"` runs. Save `world-compose.tap`. Pass when the reply holds the sentinel of the replacing unit and not that of the replaced one.
- [ ] Lane 9. Case `world reads an omp-written config` in `world.test.ts`. `omp config set` writes `config.yml` in a scratch agent dir, then `loadWorld` runs with that dir as the omp facts root. Save `world-omp.tap`. Pass when `loadWorld` returns the omp facts with no `E_SCHEMA` and the file keeps its bytes.
- [ ] Lane 10. Case `world reads claude plugin facts` in `world.test.ts`. The case copies the real `installed_plugins.json` into a scratch HOME, runs `loadWorld`, and runs `claude plugin list --json` read-only. Save `world-plugins.tap`. Pass when every plugin id and commit in the facts equals the listing.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. `apply` wall time for a 12-op hand-built `Desired`, and `loadWorld` plus `compose` wall time, each on a fresh default fixture HOME. `rig plan` is not wired before `wiring`, so it would time only a stub.
- [ ] Probe. A 20-run loop per entry point at trunk and at head. The kit adds no `lib/` code, so both sides run the same module code.
- [ ] Baseline. Record both trunk medians first. They become the baselines in the decision trail.
- [ ] Rule. Fail when the head `apply` median exceeds 300 ms or the head `loadWorld` plus `compose` median exceeds 150 ms.

**Review gate.** None. seedkit is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Review-thread triage done. The repository runs no Bugbot check, so only human and agent threads count.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged, or a single verifier passed at the new head.
- [ ] The orchestrator squash-merges seedkit with `gh pr merge <number> --squash --admin` after green CI. The owner never merges.

## Render owned units per harness (#14)

**Depends on.** #13, merged. The code head of branch `feat/render` is open now. Its live cases need `seedkit`, so the owner adds them after `seedkit` merges and rebases.

**Files.**

- [ ] Edit `lib/targets.ts`, `targets/claude.json`, `targets/codex.json`, `targets/omp.json`, `targets/cursor.json` and `packs/core/terms.json`.
- [ ] Create `lib/targets/formats.ts` and `lib/targets/terms.ts`.
- [ ] Create `test/render.test.ts`, `test/render.helpers.ts` and `test/fixtures/render/**`. Edit `test/placement.test.ts`.
- [ ] Create `test/live/render.test.ts`.

**Build.**

- [ ] `render(stack, world)` returns `Desired` for skills, commands, agents and rules per harness. It places each unit with `place()` from #4 and adds the hide controls of every harness that reads the dir (section 7).
- [ ] The frame per instruction mode, `/craft` at the section 12 path per harness, and `/pm` from `aliases` through the core `alias.md` template. A provider entry that needs the lock renders as `not available on this harness` until `pstack`.
- [ ] `{{rig:term}}` substitution with `E_TERM_UNKNOWN` and `E_TERM_MISSING`, the name lint, and the `never_write` check.
- [ ] Target record values from the probes. Cursor dedupe `by-name` (b), Codex hiding through `agents/openai.yaml` (f), omp skill and command dirs (e), omp `AGENTS.md` (g), the Codex 32,768-byte cap (d), and the Claude `SessionEnd` record (h).
- [ ] `readSet` in `lib/targets.ts` calls `lib/targets/readset.ts` from #4. On trunk the facade still throws `not implemented`. If #14 leaves it, `wiring` connects it.

**You see.**

- [ ] `render()` on the fixture `own` pack returns `~/.claude/commands/craft.md`, `~/.claude/commands/pm.md`, `~/.claude/rules/rig-frame.md`, `~/.cursor/plugins/local/rig/skills/craft/SKILL.md`, `~/.codex/prompts/craft.md` and `~/.omp/agent/commands/craft.md`.
- [ ] A fixture unit with `{{rig:no-such}}` gives `E_TERM_UNKNOWN`.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `test/render.test.ts` covers S2.11 for the paths, S2.14 for `E_TERM_UNKNOWN`, the name lint, the hide controls per dir, and exactly one copy per harness with `place()`. Run `node --test test/render.test.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `sonnet high` at the PR head. Each lane follows the boot recipe and runs one case of `test/live/render.test.ts`.

- [ ] Lane 1. Regression lane against trunk. Case `claude runs a rendered own command`. `render` output for the fixture `own` pack goes to the fixture HOME, and the mirror runs `/rigseed`. Trunk has no `render`, so the lane records that and gates head. Save `render-claude-cmd.tap`. Pass when the reply holds the sentinel token.
- [ ] Lane 2. Case `pm expands to craft on claude`. `claude -p "/pm"` runs in the mirror. Save `render-claude-pm.tap`. Pass when the session transcript shows the `/craft` body heading in the expanded user turn.
- [ ] Lane 3. Case `hidden skill on claude`. A `machine-hidden` skill carries `disable-model-invocation: true`. One run asks for the skills that start with `rigseed`, and one run invokes `/rigseed-hidden`. Each prompt runs twice. Save `render-claude-hidden.tap`. Pass when the hidden skill is absent from both listings and the invoke prints its sentinel.
- [ ] Lane 4. Case `frame on claude`. The rendered `rig-frame.md` goes into the mirror as `.claude/rules/rig-frame.md`, and `claude -p` quotes its first line. Save `render-claude-frame.tap`. Pass when the quote equals the first line of the rendered frame.
- [ ] Lane 5. Case `omp sees a rendered skill once`. #14 puts omp skills in `~/.agents/skills`, so `omp -p` runs with both `HOME` and `PI_CODING_AGENT_DIR` set to the fixture and lists the skills that start with `rigseed`, twice. If omp cannot log in with that HOME, the lane records it and the Appendix C risk stays open. Save `render-omp-skill.tap`. Pass when both listings name the sentinel skill exactly once.
- [ ] Lane 6. Case `omp runs rendered craft`. `omp -p "/craft"` runs with the fixture agent dir. Save `render-omp-craft.tap`. Pass when the reply holds the `/craft` body line for the default provider.
- [ ] Lane 7. Case `omp frame from AGENTS.md`. omp quotes the first line of `<agent dir>/AGENTS.md`. Save `render-omp-frame.tap`. Pass when the quote equals the first line of the rendered frame.
- [ ] Lane 8. Case `codex hides a rendered skill`. The mirror writes the hidden skill and its `agents/openai.yaml` into `.agents/skills/`. `codex exec` lists the skills that start with `rigseed`, twice, then invokes `$rigseed-hidden`. Save `render-codex-hidden.tap`. Pass when the hidden skill is absent from both listings and the invoke prints its sentinel.
- [ ] Lane 9. Case `cursor loads the rig local plugin`. `cursor-agent -p --plugin-dir <fixture>/.cursor/plugins/local/rig` invokes `/craft`. Save `render-cursor-craft.tap`. Pass when the reply holds the `/craft` body line for the default provider.
- [ ] Lane 10. Case `cursor frame through a project rule`. The rendered `rig-frame.mdc` goes into `.cursor/rules/` in the workspace, and `cursor-agent -p` quotes its first line. User-level rules stay unproven (A24). Save `render-cursor-frame.tap`. Pass when the quote equals the first line of the rendered frame.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. `render` wall time for the fixture `own` pack over four harnesses.
- [ ] Probe. A 20-run loop at trunk and at head. Trunk throws `not implemented`, so only head produces the metric.
- [ ] Baseline. Record that trunk has no `render`. Record the head median.
- [ ] Rule. Fail when the head median exceeds 200 ms.

**Review gate.** None. #14 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Review-thread triage done. The repository runs no Bugbot check, so only human and agent threads count.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged, or a single verifier passed at the new head.
- [ ] The orchestrator squash-merges #14 with `gh pr merge <number> --squash --admin` after green CI. The owner never merges.

## Wire plan, apply and doctor end to end (wiring)

**Depends on.** #14. #12 is merged.

**Files.**

- [ ] Edit `lib/commands.ts`.
- [ ] Create `lib/commands/plan.ts`, `apply.ts` and `doctor.ts`, plus stubs `stats.ts`, `models.ts`, `pack.ts` and `pin.ts`.
- [ ] Edit `lib/state/**` only for the observe and plan glue that the CLI needs.
- [ ] Create `test/wiring.test.ts`, `test/perf/plan-wall.ts` and `test/live/wiring.test.ts`.
- [ ] Create `rig.lock.json` with the core tree hash, so the `pin` check of S2.13 has a seal to compare.
- [ ] Edit `test/cli.test.ts`.

**Build.**

- [ ] `planCmd` runs `loadWorld`, `compose`, `render`, `gate`, observe and `plan`. It prints one line per op and the `N changes, M blocks` footer, with the exit codes of section 1.
- [ ] `applyCmd` with the journaled write and `--undo <run-id>`.
- [ ] `doctorCmd` without `--project`. Drift, effective duplicates per harness from `readSet`, the `/pm` alias reminder, and a shadowed Cursor local plugin.
- [ ] The `E_INTERNAL` guard in `lib/commands.ts`. A handler that returns no exit code exits 1, which closes the scaffold follow-up in the decision trail.
- [ ] `test/perf/plan-wall.ts`, the perf lever that every later PR reuses. It takes `--cmd <rig args>`, with `plan` as the default.

**You see.**

- [ ] `HOME=<fixture> node bin/rig.ts plan` prints `create` lines for the `own` pack and `N changes, 0 blocks`, and exits 0.
- [ ] A second `rig apply` prints `0 changes, 0 blocks`.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `test/wiring.test.ts` covers S1.1 to S1.3, S2.1, S2.2 (every k through the CLI), S2.6 to S2.10, S2.12, S2.13 and S2.15. Run `node --test test/wiring.test.ts`.
- [ ] `test/cli.test.ts` gains the `E_INTERNAL` case. Run `node --test test/cli.test.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `sonnet high` at the PR head. Each lane follows the boot recipe and runs one case of `test/live/wiring.test.ts`.

- [ ] Lane 1. Regression lane against trunk. Case `plan then apply reaches claude`. `rig plan` runs at trunk and head on the same fixture HOME. Trunk prints `not implemented` and exits 1, so the lane records that. Head runs `rig apply`, and the mirror runs `/rigseed`. Save `wiring-regression.tap`. Pass when trunk exits 1 with `not implemented`, head `plan` exits 0, and the head reply holds the sentinel.
- [ ] Lane 2. Case `second apply converges`. Two `rig apply` runs, then the mirror runs `/rigseed`. Save `wiring-converge.tap`. Pass when the second run prints `0 changes, 0 blocks` and the reply holds the sentinel.
- [ ] Lane 3. Case `undo through the CLI`. `rig apply`, then `rig apply --undo <run-id>`, then the mirror runs `/rigseed`. Save `wiring-undo.tap`. Pass when the reply lacks the sentinel and the fixture tree hash equals the hash before the first apply.
- [ ] Lane 4. Case `abort at every op, omp sees one copy`. For k from 1 to N, `RIG_TEST=1 RIG_TEST_ABORT_AFTER=k rig apply` dies and the next `rig apply` recovers. Then `omp -p` lists the skills that start with `rigseed`. Save `wiring-abort.tap`. Pass when every k converges to the same tree hash and omp names the sentinel skill once.
- [ ] Lane 5. Case `hand-written pm blocks`. The fixture HOME holds a foreign `~/.claude/commands/pm.md` with its own sentinel. Save `wiring-pm-block.tap`. Pass when `rig plan` and `rig apply` exit 1 with `E_ADOPT_MISMATCH`, the file keeps its bytes, and `/pm` in the mirror prints the foreign sentinel.
- [ ] Lane 6. Case `exec block stops the write`. A fixture pack holds a shebang script. Save `wiring-exec.tap`. Pass when `rig plan` exits 1 and names `exec`, the fixture tree hash is unchanged, and claude in the mirror does not list the hostile unit.
- [ ] Lane 7. Case `ack unblocks`. The case pastes the stanza that `rig plan` printed into `audit.allow.json`, with a reason and an expiry, then runs `rig apply`. Save `wiring-ack.tap`. Pass when `rig plan` exits 0 and claude in the mirror runs the acked unit.
- [ ] Lane 8. Case `doctor reports drift and keeps the hand edit`. The case edits an owned file after `rig apply`. Save `wiring-drift.tap`. Pass when `rig doctor` exits 1 and names the path, and claude in the mirror prints the hand-edited sentinel.
- [ ] Lane 9. Case `doctor on the real machine writes nothing` (S1.4). Snapshot every read dir and the state root of the real HOME, run `rig doctor` with the real HOME, snapshot again. Save `wiring-doctor-real.json`. Pass when the two snapshots are equal.
- [ ] Lane 10. Case `plan on the real machine writes nothing`. The same snapshots around `rig plan` with the real HOME. Save `wiring-plan-real.json`. Pass when the snapshots are equal and every printed op is `create`, `adopt` or a named block.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. `rig plan` wall time on the default fixture HOME. Trunk stops at the stub, so trunk times only parsing and the throw.
- [ ] Probe. `node test/perf/plan-wall.ts --trunk <trunk worktree> --head . --runs 10`. It runs `rig plan` on a fresh default fixture HOME, alternates trunk and head, prints both medians, and also times `node -e 0` so the reader can subtract Node startup.
- [ ] Baseline. Record the trunk median first, with the note that it times no pipeline work.
- [ ] Rule. Fail when the head median exceeds 1 s. No ratio to trunk applies, because trunk does no work.

**Review gate.** None. wiring is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Review-thread triage done. The repository runs no Bugbot check, so only human and agent threads count.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged, or a single verifier passed at the new head.
- [ ] The orchestrator squash-merges wiring with `gh pr merge <number> --squash --admin` after green CI. The owner never merges.

## Seed the pstack provider path (pstack)

**Depends on.** `wiring`.

**Files.**

- [ ] Edit `providers/pstack.json`, `rig.json` (`pins`) and `rig.lock.json` (the pstack pin and the core reseal).
- [ ] Edit `packs/core/commands/craft.md` and `packs/core/frame.md` only where the pstack entry needs it.
- [ ] Edit `lib/targets/` for the `plugin-cache:` and `plugin-local:` entry resolution and the `whole` render of the pstack model files.
- [ ] Edit `lib/commands/pin.ts` and `lib/commands/doctor.ts`.
- [ ] Create `test/pstack.test.ts`, `test/fixtures/pstack/**` and `test/live/pstack.test.ts`.

**Build.**

- [ ] The Claude `/craft` body names the exact path `~/.claude/plugins/cache/<marketplace>/pstack/<version>/skills/poteto-mode/SKILL.md`, with the version from `rig.lock.json`. It holds no `sort` and no `tail`. Codex and omp get `not available on this harness`.
- [ ] The frame names pstack as the default provider and states the `rig-project:` rule.
- [ ] `~/.claude/rules/pstack-models.md` and `~/.cursor/rules/pstack-models.mdc` render as `whole` files from `models.cellValues`. `patch` in `lib/targets.ts` gains the owned `keep_header` case, so the header lines stay and an equal file adopts.
- [ ] `pinCmd` for `rig pin check pstack --sha <sha>` and `rig pin set pstack`, through `pinCheck` and `pinSet` from #7.
- [ ] `rig doctor` reports the pstack pin against `installed_plugins.json` and an `autoUpdate` marketplace that serves it.

**You see.**

- [ ] `rig plan` prints `create owned claude ~/.claude/commands/craft.md` and a `create` or `adopt` line for `~/.claude/rules/pstack-models.md`.
- [ ] `rig pin check pstack --sha <sha>` prints the candidate and its tree hash.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `test/pstack.test.ts` covers S2.11 for the lock path, S4.3, S4.11, S3.3 for the header lines of the pstack model files, and the null-entry line on Codex and omp. Run `node --test test/pstack.test.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `sonnet high` at the PR head. Each lane follows the boot recipe and runs one case of `test/live/pstack.test.ts`.

- [ ] Lane 1. Regression lane against trunk. Case `craft reads poteto-mode at the locked path`. The fixture lock pins the installed pstack version, and `claude -p "/craft name the file you were told to read, then stop"` runs in the mirror. Trunk renders the pstack entry as not available, so the lane records the trunk reply. Save `pstack-craft-path.tap`. Pass when the head transcript holds a Read whose path equals the locked path and that file exists.
- [ ] Lane 2. Case `craft loads the poteto-mode text`. `claude -p "/craft reply with the H1 heading of the file you read"`. Save `pstack-craft-h1.tap`. Pass when the reply holds `Poteto mode`.
- [ ] Lane 3. Case `doctor flags a version mismatch`. The fixture lock pins another version, and `rig doctor` runs with the real HOME. Save `pstack-doctor-pin.tap`. Pass when `rig doctor` exits 1, names pstack and both versions, and the real HOME snapshot is unchanged.
- [ ] Lane 4. Case `pin check against the real marketplace repo`. `rig pin check pstack --sha <installed commit>` clones over the network into a temp dir. Save `pstack-pin-check.tap`. Pass when the candidate tree hash equals the tree hash of the installed cache dir, computed read-only with `lib/tree.ts`.
- [ ] Lane 5. Case `pin set refuses another commit`. `rig pin check` at another SHA, then `rig pin set pstack`. Save `pstack-pin-set.tap`. Pass when `rig pin set` exits 1 and `rig.lock.json` keeps its bytes.
- [ ] Lane 6. Case `pstack-models steers the first dispatch` (A22). The rendered `pstack-models.md` goes into the mirror, and `/craft` gets a toy task that needs one subagent. Save `pstack-dispatch.tap`. Pass when the first Agent call in the transcript sets the model and effort of the rendered line for its role.
- [ ] Lane 7. Case `adopt keeps an equal pstack-models file`. The fixture HOME holds a file with the rendered bytes. Save `pstack-adopt.tap`. Pass when `rig plan` prints `adopt`, `rig apply` leaves the sha unchanged, and claude in the mirror quotes the same `# budget` line.
- [ ] Lane 8. Case `omp craft says pstack is not available`. `omp -p "/craft"` runs with the fixture agent dir. Save `pstack-omp-craft.tap`. Pass when the reply holds `not available on this harness`.
- [ ] Lane 9. Case `omp frame names the default provider`. omp quotes the frame line for the default provider. Save `pstack-omp-frame.tap`. Pass when the quote equals the rendered line.
- [ ] Lane 10. Case `cursor craft resolves the local plugin path`. `cursor-agent -p --plugin-dir` invokes `/craft` and asks which file it must read. Save `pstack-cursor-craft.tap`. Pass when the reply names the resolved `plugin-local:` path, or the lane records that pstack is not installed for Cursor on this machine.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. `rig plan` wall time on the default fixture HOME plus the pstack provider and a fixture plugin cache.
- [ ] Probe. `node test/perf/plan-wall.ts --trunk <trunk worktree> --head . --runs 10`. It runs `rig plan` on a fresh default fixture HOME, alternates trunk and head, prints both medians, and also times `node -e 0` so the reader can subtract Node startup.
- [ ] Baseline. Record the trunk median first. Trunk is `wiring`, so both sides run the full pipeline.
- [ ] Rule. Fail when the head median exceeds 1 s, or exceeds the trunk median by more than 20 percent.

**Review gate.** None. pstack is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Review-thread triage done. The repository runs no Bugbot check, so only human and agent threads count.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged, or a single verifier passed at the new head.
- [ ] The orchestrator squash-merges pstack with `gh pr merge <number> --squash --admin` after green CI. The owner never merges.

## Seed the OpenSpec provider path (openspec)

**Depends on.** `pstack`.

**Files.**

- [ ] Edit `providers/openspec.json`.
- [ ] Edit `packs/core/commands/craft.md` and `packs/core/frame.md` only where the OpenSpec entry needs it, and reseal the core tree hash.
- [ ] Edit `lib/commands/doctor.ts`.
- [ ] Create `test/openspec.test.ts`, `test/fixtures/openspec/**` and `test/live/openspec.test.ts`.

**Build.**

- [ ] `providers/openspec.json` carries every field of section 2.5. `/craft` routes a `rig-project: openspec` line to `/opsx:propose` on Claude Code and to `/prompts:opsx-propose` on Codex. omp and Cursor get `not available on this harness`. Fix the record or the template wherever a lane shows another route.
- [ ] `rig doctor --project <dir>` reports the declared provider and its source file, agreement with the overlay `projects` map, and footprints such as `openspec/` as info.
- [ ] The provider record feeds the `telemetry` check from #5. It warns when neither `DO_NOT_TRACK` nor `OPENSPEC_TELEMETRY=0` is set.

**You see.**

- [ ] `rig doctor --project <scratch>` prints the provider openspec and the file that declares it.
- [ ] `rig plan` prints a `telemetry` warning with neither opt-out set, and exits 0.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `test/openspec.test.ts` covers S4.6, S4.9, and the `/craft` routing line per harness. Run `node --test test/openspec.test.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `sonnet high` at the PR head. Each lane follows the boot recipe and runs one case of `test/live/openspec.test.ts`.

- [ ] Lane 1. Regression lane against trunk. Case `craft routes to opsx:propose`. A scratch repo runs `openspec init` for Claude Code (flags from `openspec init --help` at run time), `CLAUDE.md` holds the `rig-project:` line for openspec, and `/craft propose a change that adds a hello command` runs at trunk and head. `render` fills `{{entries}}` from every provider record, so trunk can route already. The lane records the trunk result and gates head. Save `openspec-route.tap`. Pass when the head transcript runs `opsx:propose` or creates `openspec/changes/<id>/proposal.md`.
- [ ] Lane 2. Case `no line falls back to pstack`. The same repo without the line. Save `openspec-default.tap`. Pass when the transcript holds a Read of the locked poteto-mode path.
- [ ] Lane 3. Case `a footprint alone selects nothing`. The repo has `openspec/` and no line. Save `openspec-footprint.tap`. Pass when `rig doctor --project` prints the footprint as info and the default provider, and `/craft` reads poteto-mode.
- [ ] Lane 4. Case `the CLAUDE.local.md twin selects`. The line sits only in the uncommitted `CLAUDE.local.md`. Save `openspec-local.tap`. Pass when `rig doctor --project` names `CLAUDE.local.md` as the source and `/craft` runs `opsx:propose`.
- [ ] Lane 5. Case `doctor --project writes nothing`. `git status --porcelain` and the repo tree hash before and after `rig doctor --project`. Save `openspec-nowrite.tap`. Pass when both are unchanged.
- [ ] Lane 6. Case `overlay map disagrees`. The overlay `projects` map names pstack and the line names openspec. Save `openspec-overlay.tap`. Pass when `rig doctor --project` warns and names both, and `/craft` follows the line.
- [ ] Lane 7. Case `telemetry warns until an opt-out is set`. `rig plan` with no opt-out, then with `DO_NOT_TRACK=1`. Save `openspec-telemetry.tap`. Pass when the first run warns and exits 0, and the second run has no `telemetry` finding.
- [ ] Lane 8. Case `what openspec init generates` (A8). `git status --porcelain` after `openspec init`. Save `openspec-init.tap`. Pass when the footprint list of `rig doctor --project` equals the generated paths, and the lane records whether `.claude/skills/` appears.
- [ ] Lane 9. Case `codex reads the route from the frame`. The workspace `AGENTS.md` holds the rendered frame and the line, and `codex exec` asks which command the frame says to run. Codex prompts are user-level only, so no project mirror of `/prompts:craft` exists. Save `openspec-codex.tap`. Pass when the reply names `/prompts:opsx-propose`.
- [ ] Lane 10. Case `omp says openspec is not available`. omp runs with the rendered frame and a workspace `AGENTS.md` that holds the line. Save `openspec-omp.tap`. Pass when the reply holds `not available on this harness` and names pstack as the fallback.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. `rig plan` wall time with two workflow providers, and `rig doctor --project` wall time on the scratch repo.
- [ ] Probe. `node test/perf/plan-wall.ts --trunk <trunk worktree> --head . --runs 10`. It runs `rig plan` on a fresh default fixture HOME, alternates trunk and head, prints both medians, and also times `node -e 0` so the reader can subtract Node startup. A second run of the same probe uses `--cmd 'doctor --project <dir>'`.
- [ ] Baseline. Record both trunk medians first.
- [ ] Rule. Fail when either head median exceeds 1 s, or exceeds its trunk median by more than 20 percent.

**Review gate.** None. openspec is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Review-thread triage done. The repository runs no Bugbot check, so only human and agent threads count.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged, or a single verifier passed at the new head.
- [ ] The orchestrator squash-merges openspec with `gh pr merge <number> --squash --admin` after green CI. The owner never merges.

## Add the cve and budget checks (checks)

**Depends on.** `pstack`, for `lib/commands/pin.ts`.

**Files.**

- [ ] Create `lib/gate/cve.ts` and `lib/gate/budget.ts`. Edit `lib/gate/registry.ts` and `lib/gate.ts`.
- [ ] Edit `lib/lock/` for the OSV `querybatch` fetch.
- [ ] Edit `lib/commands/pack.ts` and `lib/commands/pin.ts`.
- [ ] Create `test/checks.test.ts`, `test/fixtures/osv/**` and `test/live/checks.test.ts`.

**Build.**

- [ ] `cve` blocks on a high or critical advisory in the OSV cache, and blocks when no scanner and no cached result exist. Open user question 2 can turn that second case into a warning.
- [ ] `budget` over rendered bytes. A description above the harness cap blocks, above 300 characters warns, and an instruction file above the Codex 32,768-byte cap blocks. Tokens are 4 characters each.
- [ ] `rig pack add` in `lib/commands/pack.ts` through `vendor` from #7. The OSV refresh runs inside `pack add` and `pin check` only, and the fetch lives in `lib/lock/`.

**You see.**

- [ ] `rig plan` prints a `budget` block for a 2,000-character description and exits 1.
- [ ] `rig pack add file://<fixture-repo> --sha <sha> --path <path>` creates `packs/<name>/` and a lock entry.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `test/checks.test.ts` covers S4.1, S4.5 and S5.4. `test/gate.test.ts` keeps the registry equal to the table in section 10. Run `node --test test/checks.test.ts test/gate.test.ts`.
- [ ] `test/boundaries.test.ts` still passes, so `fetch` stays inside `lib/lock/`. Run `node --test test/boundaries.test.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `sonnet high` at the PR head is the default. This PR runs five, because the checks read bytes and one cache. Only the Codex cap, the Claude listing, OSV, the pstack tree and a real remote clone are real artifacts to check. Each lane follows the boot recipe and runs one case of `test/live/checks.test.ts`.

- [ ] Lane 1. Regression lane against trunk. Case `rig blocks before codex truncates`. #14 renders no rules for Codex, so a fixture core pads the Codex `rig:frame` block until the rendered `AGENTS.md` is 33,000 bytes long, with a sentinel at the end. `rig plan` runs at trunk and head, and `codex exec` quotes the sentinel. Save `checks-codex-cap.tap`. Pass when trunk `plan` exits 0, codex cannot quote the tail sentinel, and head `plan` exits 1 and names `budget`.
- [ ] Lane 2. Case `listing estimate against claude`. The mirror holds the rendered units, and the case reads the skill listing attachment from the session transcript (A15). Save `checks-listing.json`. Pass when the `budget` listing estimate is within 20 percent of the listing bytes in the transcript.
- [ ] Lane 3. Case `OSV refresh over the network`. `rig pin check` on a fixture repo whose manifest pins a version with a known advisory. Save `checks-osv.tap`. Pass when `cache/osv/` holds the advisory id and `rig plan` exits 1 with `cve` (A20).
- [ ] Lane 4. Case `injection warnings on pstack` (A9). The gate runs read-only over the locked pstack cache tree. Save `checks-pstack-warn.json`. Pass when the share of skills with an injection warning is under 20 percent, or the lane files the demote-to-info follow-up.
- [ ] Lane 5. Case `pack add from a real remote`. `rig pack add` clones a public MIT repository at a fixed commit. Save `checks-pack-add.tap`. Pass when the lock tree hash equals an independent recount and the `license` check passes.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. `rig plan` wall time on the default fixture HOME with `budget` and `cve` active.
- [ ] Probe. `node test/perf/plan-wall.ts --trunk <trunk worktree> --head . --runs 10`. It runs `rig plan` on a fresh default fixture HOME, alternates trunk and head, prints both medians, and also times `node -e 0` so the reader can subtract Node startup.
- [ ] Baseline. Record the trunk median first.
- [ ] Rule. Fail when the head median exceeds 1 s, or exceeds the trunk median by more than 20 percent.

**Review gate.** None. checks is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Review-thread triage done. The repository runs no Bugbot check, so only human and agent threads count.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged, or a single verifier passed at the new head.
- [ ] The orchestrator squash-merges checks with `gh pr merge <number> --squash --admin` after green CI. The owner never merges.

## Wire rig models and models set (models-cmd)

**Depends on.** `openspec`, for `lib/commands/doctor.ts`.

**Files.**

- [ ] Edit `lib/commands/models.ts` and `lib/commands/doctor.ts`.
- [ ] Edit `lib/state/` for the `patch-cells` and `insert-markers` ops and the cell digests in `installed.json`.
- [ ] Edit `lib/targets/` only to connect `patch` from #8 to the plan.
- [ ] Create `test/models-cmd.test.ts` and `test/live/models-cmd.test.ts`. Reuse `test/fixtures/models/` from #8.

**Build.**

- [ ] `rig models` prints the effective table per harness with the source of each value.
- [ ] `rig models set <tier> <model> --harness <h>` edits `models/tiers.json` through `setTier`, then runs the apply pipeline restricted to model-bearing files.
- [ ] The `patch-cells` and `insert-markers` ops, cell and block adopt, and drift by cell digest. `patch` in `lib/targets.ts` gains the `cells`, `keys`, `frontmatter` and `block` cases through `lib/targets/patch.ts` from #8.
- [ ] `rig doctor` reports cell drift, model env overrides and stale model names in prose as info.

**You see.**

- [ ] `rig models` prints one row per tier and harness with `tiers.json`, a pinned id or an env override as the source.
- [ ] `rig models set strong <model> --harness omp` prints a diff of one line.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `test/models-cmd.test.ts` covers S3.1 to S3.12 through the CLI on the real-shape fixtures from #8. Run `node --test test/models-cmd.test.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `sonnet high` at the PR head is the default. This PR runs six, because model cells reach a harness only through Claude fleet files and the omp config in a scratch agent dir. Codex agent TOML and Cursor fleet agents are user-level files with no project mirror. Each lane follows the boot recipe and runs one case of `test/live/models-cmd.test.ts`.

- [ ] Lane 1. Regression lane against trunk. Case `claude fleet agent follows a swap`. `rig models set fast haiku --harness claude`, then the mirror holds the rendered fleet agent that `roles.json` maps to tier `fast`, and `claude -p` dispatches that agent once. Trunk has `rig models` as a stub, so the lane records that. Save `models-claude.tap`. Pass when the subagent transcript shows a `message.model` of the haiku family.
- [ ] Lane 2. Case `omp modelRoles follows a swap`. The case reads the `modelRoles` values of the real `~/.omp/agent/config.yml`, read-only, swaps between two of them with `rig models set`, and runs `omp -p --mode json`. Save `models-omp.tap`. Pass when the fixture `config.yml` changed in one line and the omp JSON names the new model.
- [ ] Lane 3. Case `an omp rewrite is not drift` (S3.6). After `rig apply`, `omp config set` changes an unrelated key in the scratch agent dir. Save `models-omp-rewrite.tap`. Pass when `rig doctor` exits 0 with no drift for `config.yml`, and `rig plan` lists no ops.
- [ ] Lane 4. Case `effort reaches the dispatch`. A role effort changes in the fleet table, and `claude -p` dispatches that role once. Save `models-effort.tap`. Pass when the Agent call in the transcript sets the new effort.
- [ ] Lane 5. Case `adopt on the real machine is read-only`. `rig plan` with the real HOME and the overlay `model_surfaces`. Save `models-real-plan.json`. Pass when the real HOME snapshot is unchanged and every model line is `adopt` or a per-cell diff.
- [ ] Lane 6. Case `env override shows its source`. `rig models` with a model env override set, then `claude -p --output-format json` with the same env. Save `models-env.tap`. Pass when `rig models` names the env var as the source and the claude JSON reports that model.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. `rig plan` wall time on the fixture HOME with the five real-shape model surfaces, and `rig models set` wall time.
- [ ] Probe. `node test/perf/plan-wall.ts --trunk <trunk worktree> --head . --runs 10`. It runs `rig plan` on a fresh default fixture HOME, alternates trunk and head, prints both medians, and also times `node -e 0` so the reader can subtract Node startup. A second run uses `--cmd 'models set strong model-b --harness omp'` on a fresh fixture each time.
- [ ] Baseline. Record both trunk medians first. Trunk has no `models set`, so record that and keep only the `plan` ratio.
- [ ] Rule. Fail when the head `plan` median exceeds 1 s or the trunk median by more than 20 percent, or when `models set` exceeds 1 s.

**Review gate.** None. models-cmd is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Review-thread triage done. The repository runs no Bugbot check, so only human and agent threads count.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged, or a single verifier passed at the new head.
- [ ] The orchestrator squash-merges models-cmd with `gh pr merge <number> --squash --admin` after green CI. The owner never merges.

## Deliver per-project packs without repository writes (scope)

**Depends on.** `models-cmd`, for `lib/commands/doctor.ts` and `lib/targets/`.

**Files.**

- [ ] Edit `lib/stack.ts` for the scope rules and the absent-part info line.
- [ ] Edit `lib/targets/` for the Claude local plugin render into `$XDG_DATA_HOME/rig/marketplace`.
- [ ] Edit `lib/commands/apply.ts` and `lib/commands/doctor.ts`.
- [ ] Create `test/scope.test.ts` and `test/live/scope.test.ts`.

**Build.**

- [ ] The scopes `machine-hidden`, `project` and `hybrid` per section 11, with `machine-hidden` as the default.
- [ ] The Claude `project` channel renders a local plugin under the data root. `rig apply` prints the registration commands and the `enabledPlugins` snippet, and writes no `enabledPlugins` entry.
- [ ] `rig doctor --project <dir>` reports whether each scope pack is enabled and from which file, and prints the repository paths to commit for Codex, omp and Cursor.

**You see.**

- [ ] `rig plan` prints `info scope codex <pack> project part absent: commit its files (doctor --project)`.
- [ ] `rig apply` prints the `enabledPlugins` snippet for `.claude/settings.local.json`.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `test/scope.test.ts` covers S4.7, S4.8 and S4.12, and asserts that `~/.claude/settings.json` keeps its bytes across `rig apply`. Run `node --test test/scope.test.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `sonnet high` at the PR head is the default. This PR runs five, because only Claude Code has a project channel in v0, and its full variant needs an operator. Each lane follows the boot recipe and runs one case of `test/live/scope.test.ts`.

- [ ] Lane 1. Regression lane against trunk. Case `machine-hidden stays hidden and invocable`. Trunk already hides through `render`, so trunk and head both run it. Save `scope-hidden.tap`. Pass when both sides keep the skill out of the listing and invoke it by name.
- [ ] Lane 2. Case `project plugin loads in one project only`. The no-write variant of probe (k) passes the rendered plugin dir to one `claude -p` run, and a control run has no plugin. Save `scope-plugin.tap`. Pass when the first run lists the namespaced skill and the control run does not.
- [ ] Lane 3. Operator-run case `marketplace registration end to end`. The operator runs the printed commands on a scratch user profile and pastes the snippet into a scratch project. Save `scope-register.json`. Pass when `claude plugin list --json` reports the plugin enabled in that project and disabled in a neutral dir.
- [ ] Lane 4. Case `codex project part after a commit`. `rig doctor --project` prints the Codex paths, the case copies them into the workspace as a commit would, and `codex exec` lists the skill. Save `scope-codex.tap`. Pass when codex lists the skill and rig wrote nothing into the workspace.
- [ ] Lane 5. Case `no write into the repository`. `rig apply` and `rig doctor --project` run against a scratch repo. Save `scope-nowrite.tap`. Pass when `git status --porcelain` prints nothing and the repo tree hash is unchanged.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. `rig plan` wall time on the fixture HOME with one `project` pack and one `hybrid` pack.
- [ ] Probe. `node test/perf/plan-wall.ts --trunk <trunk worktree> --head . --runs 10`. It runs `rig plan` on a fresh default fixture HOME, alternates trunk and head, prints both medians, and also times `node -e 0` so the reader can subtract Node startup.
- [ ] Baseline. Record the trunk median first.
- [ ] Rule. Fail when the head median exceeds 1 s, or exceeds the trunk median by more than 20 percent.

**Review gate.** None. scope is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Review-thread triage done. The repository runs no Bugbot check, so only human and agent threads count.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged, or a single verifier passed at the new head.
- [ ] The orchestrator squash-merges scope with `gh pr merge <number> --squash --admin` after green CI. The owner never merges.

## Wire rig stats, suggest and the session hook (stats)

**Depends on.** `scope`, for `lib/state/` and `lib/targets/`.

**Files.**

- [ ] Edit `lib/commands/stats.ts` and `lib/metrics/propose.ts`.
- [ ] Edit `lib/state/` for the `json-element` op and `lib/targets/` for the hook element patch.
- [ ] Create `test/stats.test.ts` and `test/live/stats.test.ts`.

**Build.**

- [ ] `statsCmd` with `--since`, `--harness`, `--suggest`, `--record` and `--session`, and the exit-2 combinations of section 1.
- [ ] `--suggest` writes a unified diff to `proposals/<date>.patch` and applies nothing.
- [ ] `patch` in `lib/targets.ts` gains the `json-element` case. The `json-element` op writes one `hooks.SessionEnd` element into `~/.claude/settings.json` when `metrics.session_hook` is true, and blocks with `E_JSON_ROUNDTRIP` on a file that does not round-trip.

**You see.**

- [ ] `rig stats` prints tokens by type, cache hit rate and tool error rate per harness and model.
- [ ] `printf 'not json' | rig stats --record` prints 0 bytes and exits 0.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `test/stats.test.ts` covers S5.1 to S5.3 and S5.5 to S5.8. Run `node --test test/stats.test.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `sonnet high` at the PR head is the default. This PR runs six, because three harnesses write transcripts that a headless run can produce, plus the hook, the store privacy and one proposal. Each lane follows the boot recipe and runs one case of `test/live/stats.test.ts`.

- [ ] Lane 1. Regression lane against trunk. Case `stats counts a real claude session once`. `claude -p --output-format json` runs in a scratch repo with a sentinel prompt. The case copies that session's transcript into the fixture transcript root and runs `rig stats --record --session <id>`. Trunk has `rig stats` as a stub, so the lane records that. Save `stats-claude.tap`. Pass when the input and output token totals equal the usage in the claude result JSON.
- [ ] Lane 2. Case `the store holds no content`. `grep -c <sentinel>` over `metrics.jsonl`, `proposals/` and `log/` after lanes 1 and 6. Save `stats-privacy.tap`. Pass when every count is 0.
- [ ] Lane 3. Case `the real SessionEnd hook prints 0 bytes`. The mirror holds the rendered hook element with its command prefixed by `HOME=<fixture>`, and `claude -p` ends the session. Save `stats-hook.tap`. Pass when the hook exits 0, adds 0 bytes to the claude output, and `log/rig.log` names the transcript path it rejected.
- [ ] Lane 4. Case `omp session counted`. `omp -p --mode json` runs with the fixture agent dir, so its transcript lands inside the fixture HOME. Save `stats-omp.tap`. Pass when `rig stats --harness omp` counts one session with the tokens of the omp JSON.
- [ ] Lane 5. Case `codex cached tokens split`. `codex exec --json` runs without `--ephemeral`, and the case copies its rollout into the fixture root. Save `stats-codex.tap`. Pass when uncached input equals input minus cached tokens from the JSON events.
- [ ] Lane 6. Case `suggest proposes a disable`. The fixture has an unused unit and the transcripts of lanes 1 and 4. Save `stats-suggest.tap`. Pass when `git apply --check` accepts the proposal against `rig.json`, and no harness file changed.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. `rig stats` wall time over the fixture transcripts, and `rig stats --record` wall time in hook mode, because the hook runs at every session end.
- [ ] Probe. `node test/perf/plan-wall.ts --cmd 'stats' --runs 10` and `--cmd 'stats --record'` with a fixture payload on stdin, at trunk and head. Trunk has `stats` as a stub.
- [ ] Baseline. Record that trunk has no `stats`. Record both head medians.
- [ ] Rule. Fail when `rig stats` exceeds 1 s or `rig stats --record` exceeds 300 ms.

**Review gate.** None. stats is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Review-thread triage done. The repository runs no Bugbot check, so only human and agent threads count.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged, or a single verifier passed at the new head.
- [ ] The orchestrator squash-merges stats with `gh pr merge <number> --squash --admin` after green CI. The owner never merges.

## Port office-hours as /oh (product)

**Depends on.** `stats` and `checks`.

**Files.**

- [ ] Create `packs/product/pack.json`, `packs/product/skills/office-hours/SKILL.md`, `packs/product/skills/office-hours/references/product-core.md` and `packs/product/commands/oh.md`.
- [ ] Create `packs/product/NOTICE.md` and `packs/product/licenses/MIT-gstack.txt`.
- [ ] Edit `providers/pstack.json`, `providers/openspec.json` and `rig.json`.
- [ ] Edit `lib/world/schemas.ts` for the `intake` and `ported_from` keys.
- [ ] Create `test/product.test.ts` and `test/live/product.test.ts`.

**Build.**

- [ ] Count `gstack-`, `$GSTACK` and `{{` in the source template first (A6). Split the PR when the port needs a shim.
- [ ] Port `office-hours` per design draft section 9. Drop the `gstack-paths` and profile calls, write `docs/designs/<slug>.md`, call `rig-doc-review`, and close with the active provider's `intake` line.
- [ ] `pack.json` holds `ported_from` with the source SHA. The pack ships the MIT notice.

**You see.**

- [ ] `rig plan` prints `create` lines for `/oh` and the `office-hours` skill, and no gate finding.
- [ ] The rendered bytes hold no `gstack-` and no `$GSTACK`.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `test/product.test.ts` checks the rendered body for `gstack-`, `$GSTACK` and leftover `{{` placeholders, the `license` check with the notice, the `budget` caps, and one `intake` line per provider. Run `node --test test/product.test.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `sonnet high` at the PR head is the default. This PR runs five, because `/oh` has one artifact, a design doc, and two provider endings, on the two harnesses with a bare command dir. Each lane follows the boot recipe and runs one case of `test/live/product.test.ts`.

- [ ] Lane 1. Regression lane against trunk. Case `oh writes a design doc`. `claude -p "/oh <idea with its answers stated>" --max-turns 15` runs in a scratch repo. Trunk has no `/oh`, so the lane records the unknown command. Save `product-oh.tap`. Pass when head creates `docs/designs/<slug>.md` with the template headings and the transcript has no call to a `gstack-` binary.
- [ ] Lane 2. Case `oh closes with the pstack intake`. The scratch repo has no `rig-project:` line. Save `product-pstack.tap`. Pass when the last reply holds the pstack `intake` line.
- [ ] Lane 3. Case `oh closes with the openspec intake`. The scratch repo declares openspec. Save `product-openspec.tap`. Pass when the last reply names `/opsx:propose`.
- [ ] Lane 4. Case `omp runs oh`. `omp -p "/oh <idea>"` runs with the fixture agent dir and a scratch cwd. Save `product-omp.tap`. Pass when omp creates `docs/designs/<slug>.md` in the scratch cwd.
- [ ] Lane 5. Case `doc-review stub with no filler`. The `doc-review` slot is null in the fixture `rig.json`. Save `product-docreview.tap`. Pass when the transcript shows the `rig-doc-review` stub and its no-filler line.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. `rig plan` wall time on the fixture HOME with the product pack.
- [ ] Probe. `node test/perf/plan-wall.ts --trunk <trunk worktree> --head . --runs 10`. It runs `rig plan` on a fresh default fixture HOME, alternates trunk and head, prints both medians, and also times `node -e 0` so the reader can subtract Node startup.
- [ ] Baseline. Record the trunk median first.
- [ ] Rule. Fail when the head median exceeds 1 s, or exceeds the trunk median by more than 20 percent.

**Review gate.** None. product is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Review-thread triage done. The repository runs no Bugbot check, so only human and agent threads count.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged, or a single verifier passed at the new head.
- [ ] The orchestrator squash-merges product with `gh pr merge <number> --squash --admin` after green CI. The owner never merges.

## Update the decision records for the architecture deltas (records)

**Depends on.** This plan PR, because both edit `docs/README.md`.

**Files.**

- [ ] Edit `docs/decisions/0002`, `0003`, `0004`, `0005`, `0007`, `0008`, `0010`, `0012`, `0013`, `0015` and `0020`.
- [ ] Create `docs/decisions/0026-product-pack-in-v0.md` for delta 6, which the user reversed when the product roles joined the seed tests.
- [ ] Edit `docs/README.md`, the decision table and the status of the slices plan.
- [ ] Edit the After v0 list of `docs/plan/v0-slices.md` and row 6 of section 14 in `docs/design/rig-architecture.md`.

**Build.**

- [ ] Each record gains an update paragraph that names its row in the table of section 15 and the delta row of section 14.
- [ ] Record 0026 states that `office-hours` as `/oh` is back in v0, with the decision trail row as its source. Its status follows the user's word.

**You see.**

- [ ] Every record in the section 15 table names its delta.
- [ ] `docs/README.md` lists 0026. (0025 went to the TypeScript decision first.)

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `grep -L 'Update 2026-11' docs/decisions/0002* docs/decisions/0003* docs/decisions/0004* docs/decisions/0005* docs/decisions/0007* docs/decisions/0008* docs/decisions/0010* docs/decisions/0012* docs/decisions/0013* docs/decisions/0015* docs/decisions/0020*` prints nothing.
- [ ] The leak grep of the dispatch brief prints nothing over `docs`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `sonnet high` at the PR head is the default. This PR runs one, because the PR changes only docs and no harness reads them.

- [ ] Lane 1. Regression lane against trunk. Docs only, so no harness runs. The lane runs the update grep and the leak grep at trunk and head. Save `records-docs.txt`. Pass when both greps print nothing at head and every relative link in the changed files resolves.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Not applicable. The PR changes docs only.
- [ ] Probe. Not applicable. No code path changes.
- [ ] Baseline. Not applicable. Trunk and head run the same code.
- [ ] Rule. Not applicable. No metric exists to gate.

**Review gate.** None. records is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Review-thread triage done. The repository runs no Bugbot check, so only human and agent threads count.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged, or a single verifier passed at the new head.
- [ ] The orchestrator squash-merges records with `gh pr merge <number> --squash --admin` after green CI. The owner never merges.

## Close the program

- [ ] Every box above is checked with its evidence.
- [ ] Run `RIG_LIVE=1 node --test test/live/*.test.ts` once at the last merged trunk SHA and save the TAP file. Every case passes, or the report names each skip and its reason.
- [ ] Run `rig doctor` and `rig plan` with the real HOME and compare snapshots of every read dir before and after (S1.4). The diff is empty.
- [ ] Reply to the operator with the report the execution playbook names, per `<pstack>/skills/ketchup/SKILL.md`.

## Appendix A. Prototype evidence

Four throwaway prototypes settled the forks with the most risk on 2026-11-04. They live in the orchestrator's session scratchpad, under `<scratchpad>/proto/`, and the prototype rows of the decision trail name each folder. They are not on a branch and have no SHA. rig copies no prototype code. Rerun one with the command in its row, from its folder.

| Question | Prototype and command | Variants | Measured result | Decision |
|---|---|---|---|---|
| How does `apply` converge after a crash and undo a run? | `p1-transaction/`, `node proto.ts all` | A journal plus pre-image backups. B generations. C direct writes with only an installed record. | A passed every scenario. B lost a user file that rig replaced on the first run (scenario 4b fails). | A, merged in #12. Record the mode with the sha, and sweep temp litter on start. |
| How does rig patch model cells inside files that people and harnesses also edit? | `p2-cells/`, `node run.js A`, `B` or `C` | A structural line locators, a closed set of six kinds. B parse and reserialize. C markers around existing cells. | A changed 0 bytes outside cells. B changed 1,826 bytes outside cells. C broke the no-write adopt, and its markers vanished on a YAML rewrite. | A, merged in #8. Markers only where rig inserts a new block. Effort syntax is declared per target, because a last-colon rule misread `acme/foo:medium`. |
| Where does each unit go so that every harness sees it exactly once? | `p3-placement/`, `node place.ts --full` | A minimal-set solver over the declared writable dirs. B and B+ a fixed channel per harness. C shared dir first. A0 and AU solver variants. | Exactly once in 32 of 32 cells for A and AU, 28 for A0 and C, 26 for B+ and 21 for B. Fixed channels listed a skill twice on Cursor. | A, merged in #4. |
| How does `rig stats` count tokens without content? | `p4-metrics/`, `node reader.js A`, `B` or `C` | A naive sums. B dedupe and per-harness fields. C B plus a canary harvest. | Naive sums overcount Claude 2.1 to 2.5 times, because usage repeats per content block. Codex input includes cached tokens. Advisor iterations form a separate bucket. The field allowlist leaked 0 of 20 canaries. | B, merged in #6. Dedupe Claude by `message.id`, the last line wins. |

The slice 0 probes in #2, #9 and #10 are evidence too. Their verdicts are in `probes/results/*.json` and `docs/research/2026-11-05-probes-*.md`.

These questions stay unproven. The PR that proves each one is in parentheses.

- Cursor loads user-level `~/.cursor/rules/*.mdc` (A24, score 4). Lane 10 of #14 proves only the project-rule path. An operator check in the Cursor IDE stays open (A38).
- A rig-owned local marketplace with user `false` and project `true` loads a plugin in one project only (probe (k), A25). Lane 3 of `scope` needs the operator, because it writes user settings.
- The frame stops a model from acting on text from a provider that is not active (A1). No lane in this plan measures it.
- `pstack-models.md` steers the model and effort of the first dispatch (A22). Lane 6 of `pstack` measures it.
- Transcript fields attribute skill loads well enough for `--suggest` (A30). Lane 6 of `stats` checks one proposal only.
- `office-hours` fits one PR (A6, score 5). `product` measures the port size first.

## Appendix B. Alternatives rejected

- **Generations instead of a journal.** Prototype p1 variant B kept old generations of rig's files. It lost a user file that rig replaced on the first run, so undo could not restore it.
- **Parse and reserialize.** Prototype p2 variant B rebuilt each file from a parsed model. It changed 1,826 bytes outside the cells, which breaks the guarantee that adopt changes nothing outside cells.
- **Markers around every existing cell.** Prototype p2 variant C inserted marker regions on adopt. Adopt then wrote to a file whose cells already matched, and omp dropped the markers when it rewrote `config.yml` (probe (c) confirms the rewrite).
- **A fixed channel per harness.** Prototype p3 variants B and B+ wrote each harness's own dir. They reached exactly once in 21 and 26 of 32 cells, and Cursor listed a skill twice. Probe (b) later showed why. Cursor collapses by name, and the first source wins.
- **Naive token sums.** Prototype p4 variant A summed every usage line. It overcounted Claude 2.1 to 2.5 times.
- **One end-to-end milestone instead of a seed test per PR.** The decision trail first planned one tracer milestone. The user asked for seeding as the test of each step, so every PR now carries its own live cases.
- **An isolated `CLAUDE_CONFIG_DIR` for the Claude seed.** Claude Code is not logged in there, and rig never copies credentials. The project-level mirror runs with the normal login and writes only into a scratch repo.
- **More parallel PRs after `wiring`.** Five PRs edit `lib/commands/doctor.ts` and four edit `lib/state/`. A chain costs wall time. Parallel branches would cost merge conflicts in the files that the plan proves, so only `checks` and `records` run beside the chain.

## Appendix C. Risks

| Risk | PR | What the owner watches |
|---|---|---|
| The real user-level units leak into a Claude seed run, for example a hand-written `/pm` in `~/.claude/commands`. | `seedkit` and every live PR | Every case asserts on a unique sentinel token, never on a unit name alone. |
| A live case writes into the real harness config. | every live PR | The boot recipe hashes four config files before and after. `mirrorProject` refuses a target inside the real HOME. |
| omp with a fixture agent dir still reads the real `~/.agents/skills`. | #14, `wiring` | Cases assert on sentinels. A case that needs the fixture `~/.agents/skills` sets `HOME` to the fixture and records whether omp still authenticates. |
| Codex custom prompts are user-level only, so `/prompts:craft` has no project mirror. | `pstack`, `openspec` | Codex lanes ask about the frame text in `AGENTS.md` instead, and the plan says so. |
| Model-reported listings vary between runs. | #14 | A listing lane runs its prompt twice. Two different answers fail the lane. |
| Live lanes cost tokens and can hit rate limits. | every live PR | `--max-turns` caps each run. A quota failure gives no verdict and gets one rerun. |
| `cve` with no scanner and no cache blocks the first offline plan. | `checks` | The PR keeps block, as the gate table says, and records the open user question 2. |
| The session hook validates the transcript path under the fixture root, so a real run cannot record in place. | `stats` | Lane 3 checks the 0-byte, exit-0 path. Lane 1 copies the transcript into the fixture root first. |
| The project-scope full variant needs a write to user settings. | `scope` | Lane 3 is operator-run. The other lanes use the no-write variant of probe (k). |
| The `office-hours` port overruns. | `product` | Count `gstack-`, `$GSTACK` and `{{` in the template before porting. Split the PR when the port needs a shim. |
| A typecheck PR from the decision trail touches every `lib/` file. | not planned here | The orchestrator schedules it after `stats`, or outside any open PR that edits `lib/`. |
| The scaffold follow-up for a handler that returns nothing still exits 0. | `wiring` | `wiring` adds the `E_INTERNAL` guard and its test. |
| A budget of 1 s for `rig plan` has no measurement behind it. | `wiring` | The first measured trunk median replaces it in the decision trail. |

## Appendix D. Links and reading list

- Read before editing. `docs/design/rig-architecture.md` sections 1 to 13, `docs/plan/v0-slices.md`, `docs/assumptions-and-open-questions.md` and the probe records `docs/research/2026-11-05-probes-*.md`.
- Decisions. `docs/decisions/0001` to `0024`, and section 14 of the architecture doc for the deltas that `records` writes up.
- The `how` skill, `<pstack>/skills/how/SKILL.md`, runs before `pstack`, `openspec` and `stats`, because those PRs cross the most module boundaries.
- The `interrogate` skill, `<pstack>/skills/interrogate/SKILL.md`, runs for no PR. The user said that adversarial agent review is mostly token waste. The swarm audit lanes cover review.
- The decision trail is `.audit/rig-v0-decisions.tsv` in the primary checkout, per `<pstack>/skills/show-me-your-work/SKILL.md`. It stays local and untracked.
