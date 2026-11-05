# rig v1 first seed program plan

This plan builds the first seeded rig for the rig maintainers and the agents that build rig.
The first seed is the default config compiled from pstack at `2776ddd` and gstack at `b406820` into Claude Code, Codex, Cursor and omp.
The rule is that seeding stays deterministic. A CI runner with no model gets byte-identical HOMEs from the committed config.
The order is `subtract`, then `vendor`, `links` and `mode` in parallel, then `port` after `vendor`, then `seed`.
The design is [docs/design/rig-v1-first-seed.md](../design/rig-v1-first-seed.md). The concept is [docs/design/rig-v1-concept.md](../design/rig-v1-concept.md).

## How to read this

One box is one unit of work. Every box names the evidence that checks it. A nested box is a sub-step of the box above it. Check a box only when its evidence exists, a file, a log line, a TAP file, a test run, or a SHA. The body is a how-to. The appendices explain and record.

`<pstack>` is the installed pstack plugin folder, `~/.claude/plugins/cache/cursor-plugins/pstack/0.15.36/`. The program runs `<pstack>/skills/poteto-mode/playbooks/autopilot-stack.md`. The operator lands every PR. Each PR stops at merge-ready as an operator item.

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

This plan adapts the playbook skeleton in the same ways as [v0-prs.md](v0-prs.md):

- Claude Code runs the program, not Cursor. No cloud VM, Bugbot or `control-ui` exists here. Each lane runs in its own git worktree on the operator's machine.
- The live block is the seed test. Each lane is one named case in `test/live/<pr-id>.test.ts`, run through `liveTest` and `runHarness` from `test/helpers/live.ts`. It runs only with `RIG_LIVE=1`.
- A lane saves a TAP or JSON file instead of a screenshot. rig is a CLI and has no screen.
- A mechanism PR (`subtract`, `vendor`, `links`, `mode`, `port`) runs fewer than ten lanes, because it has fewer than ten distinct harness scenarios. Its live block says which. `seed` runs ten.
- The perf metric is `rig plan` wall time on a fixture HOME. The trunk median on 2026-11-05 was 0.19 s with the trunk config and an empty HOME. The prototype with a vendored pstack measured 0.40 s. The absolute budget stays 1 s, as in v0.
- No PR changes a UI interaction, so no PR is review-gated.
- Owners run `<pstack>/skills/no-comments/SKILL.md` and the self-adversarial pass of their dispatch brief. `deslop` is not installed until `seed` lands.

## Program checklist

### Arm the program

- [ ] State the protocol and this plan to the operator, then stop. Start execution only on the operator's explicit go.
- [ ] Read these from trunk at program start. Re-read them at every tick.
  - [ ] `git show origin/main:docs/plan/v1-first-seed-prs.md`
  - [ ] `git show origin/main:docs/design/rig-v1-first-seed.md`
  - [ ] `git show origin/main:docs/design/rig-v1-concept.md`
  - [ ] `<pstack>/skills/poteto-mode/playbooks/autopilot-stack.md`. pstack is not in this repository before `seed`, so the installed plugin copy stands in for trunk.
  - [ ] `<pstack>/skills/swarm/SKILL.md`
  - [ ] `<pstack>/skills/poteto-mode/playbooks/opening-a-pr.md`
  - [ ] Control skill. Claude Code has none for a CLI here. The driver is `test/helpers/live.ts` plus `test/helpers/mirror.ts`.
- [ ] On the operator's go, arm the audit tick as `/loop 1h` with the tick prompt below. Never leave the cadence to memory.
- [ ] Use this tick prompt, verbatim. "Re-read the execution playbook from trunk. Audit the operation against it and fix drift in this tick. Probe every active lane and judge progress by side effects only. Stand down a stuck lane and dispatch its replacement now. Then post a short status message to the operator in chat only when the audit found a tracked change that no earlier status message reported, such as a PR opened, a code-ready head, a round launched or closed, a verdict, a merge, a stuck agent and the action taken, a blocker added or cleared, or a decision only the operator can make. Name every such change and nothing else. Do not repeat a table, the merged list, or an unchanged blocker. If the audit found none, end the turn with no reply text. Either way, log this tick's row in your decision trail. The row names the items reported, or none."
- [ ] On the operator's hold or stand-down, send every owner a zero-writes order at once.

### Spawn owners

- [ ] Spawn one owner per PR with the full lifecycle the execution playbook names. Each owner gets its section of this plan, the user's goal, and the dispatch contract of the orchestrator's rules.
- [ ] Follow this dependency graph. Base a dependent PR on its parent branch, as the execution playbook stacks.
  - [ ] `subtract` is independent and first. It branches from `main`.
  - [ ] `vendor`, `links` and `mode` each stack on `subtract`. They run in parallel.
  - [ ] `port` after `vendor`.
  - [ ] `seed` after `mode`, `port` and `links`.
- [ ] Hold the file boundaries. A shared file changes only in PRs that the graph orders, in this order.
  - [ ] `lib/lock.ts`, `lib/lock/**` and `lib/commands/pack.ts` change in `subtract`, `vendor`, then `port`.
  - [ ] `lib/commands/pin.ts` changes in `subtract`, then `port`.
  - [ ] `lib/gate/pin.ts` changes in `subtract`, `vendor`, `port`, then `seed`.
  - [ ] `lib/gate/registry.ts` changes in `subtract`, then `links`. `lib/gate/links.ts` and `lib/gate/budget.ts` change only in `links`. `lib/gate/telemetry.ts` changes only in `subtract`.
  - [ ] `lib/world/schemas.ts` changes only in `subtract`. It holds every schema 2 validator, the lock's included (`lib/world/schemas.ts:239-251`). `subtract` lands all schema 2 fields at once, so `vendor`, `port` and `mode` do not edit it. `lib/mode.ts` validates the inner shape of the mode block. `lib/world.ts` changes in `subtract`, then `mode`.
  - [ ] `lib/stack.ts`, `lib/mode.ts`, `lib/targets.ts` and `lib/targets/**` change in `subtract`, then `mode`.
  - [ ] `packs/core/**` changes in `subtract`, then `mode`. Each of them reseals `lock.core.tree`.
  - [ ] `rig.json` changes in `subtract`, then `seed`. `rig.lock.json` changes in `subtract`, `mode`, then `seed`, because `mode` reseals the core tree. `packs/pstack/**`, `packs/cursor-team-kit/**` and `packs/cli-for-agent/**` appear only in `seed`. `packs/product/**` changes in `subtract`, then `seed`.
  - [ ] `.claude/skills/rig-port/**` appears only in `port`.
  - [ ] `docs/design/**`, `docs/plan/**`, `docs/decisions/**` and `docs/README.md` change only in this plan PR.
  - [ ] The user docs, `README.md`, `docs/guide/**` and `docs/harnesses.md`, change in the PR whose behavior they describe. `test/docs.test.ts` checks every `rig` line in them against `rig --help`, so a PR that removes or adds a command, a subcommand or a flag updates them in the same PR. `subtract` deletes `docs/guide/06-craft.md` and removes the provider, slot and plugin-pin text from the other pages. `vendor` documents `--root`, `--exclude` and `--name`. `port` documents `--ported`, `--diff` and the port records. `mode` and `seed` document the mode skill and the seeded default.
- [ ] Hold the review gate. No PR changes an interaction, so none waits for an operator review with screenshots.

### PR mechanics, for every PR

- [ ] Resolve the forge once. Default to `gh`. If `command -v origin` succeeds and Origin can resolve the repository, use `origin pr` for every PR operation. Record any fallback to `gh`. Never require `gt`.
- [ ] Switch `gh` to the repository owner account before any push, fetch or `gh` call in this repository.
- [ ] Open the PR ready, never draft, per **Opening a PR**, with `gh pr create --base <parent branch or main>`. Open its `## Why` with the user's goal.
- [ ] Run `npm test` and `npm run typecheck` once before the PR-facing push. Push with hooks on.
- [ ] Run the self-adversarial pass before each commit and `<pstack>/skills/no-comments/SKILL.md` before review.
- [ ] Triage every review thread per `<pstack>/skills/poteto-mode/references/bugbot-triage.md`. No Bugbot check runs on this repository.
- [ ] Commit with the repository identity. Decision 0023 makes repository commits unsigned. Never run `git stash`.
- [ ] Rebase onto current trunk before the code-ready report and babysit. Keep that merge base in fix rounds. Rebase again only at merge prep, on a `git merge-tree` conflict with trunk, on a CI failure that comes from a change on trunk, or when a known concurrent change to the same files lands.

### Verdict and merge, for every PR

- [ ] A full swarm runs once, at the code-ready head. Another full swarm runs only for new behavior, a redesign, or a large new diff. A rebase, a merge-conflict resolution, or a minor fix gets a single verifier at the new head, and a wording-only change gets none. Run each full swarm per `<pstack>/skills/swarm/SKILL.md`. One gates lane runs `npm test` and `npm run typecheck`. The live lanes come from the PR's **Verify, live** block. The perf lane comes from its **Verify, perf** block. Two or more audit lanes, each with its own focus, read the diff and the receipts and distrust the PR body. The root audits the receipts in the merge-ready report before the verdict.
- [ ] Judge every finding by the execution playbook's blocking rule. The verdict is clean when none blocks. A failure on trunk behavior in a lane marked `Regression lane against trunk.` is recorded against trunk and does not block the PR. A new head gets a fresh verdict, except for results that stay valid under the patch-id rule in `<pstack>/skills/poteto-mode/playbooks/shipping.md`.
- [ ] A live lane that fails on a harness login, a rate limit or a quota gives no verdict. The root reruns it once and records the cause. A second such failure goes to the operator.
- [ ] At a clean verdict on the exact head SHA, the root posts the merge-ready report and stops. The operator lands the stack bottom-up. Before landing, compare `git patch-id` at the verdict SHA with the head. When the patches differ only in tests or docs, a lane result stands. Otherwise a single verifier runs at the new head first.

### Boot recipe, for every live lane

Each live lane runs in its own git worktree at the PR head, on the operator's machine. The lane's test case is the driver.

- [ ] `git fetch origin <head-branch> && git worktree add "$TMPDIR/rig-lane-<pr-id>-<n>" <head SHA>`. Run every later step inside that worktree.
- [ ] Export `RIG_LIVE=1` and `DO_NOT_TRACK=1`. Write `node --version` and the version line of each harness CLI that the lane uses to `versions.txt`.
- [ ] Record the sha256 of `~/.claude/settings.json`, `~/.claude/plugins/installed_plugins.json`, `~/.codex/config.toml` and `~/.omp/agent/config.yml`. Compare them after the lane. A changed hash fails the lane, because no lane may write into the real harness config.
- [ ] Run only the lane's case, in the foreground. `set -o pipefail; node --test --test-name-pattern '<case>' test/live/<pr-id>.test.ts | tee <slug>; echo "exit=${PIPESTATUS[0]}"`.
- [ ] Each case builds a fixture HOME with `makeFixtureHome`, runs `bin/rig.ts` with `HOME` set to it, then drives one harness.
  - [ ] Claude Code. `mirrorProject` copies the `.claude/` units of the fixture HOME into a scratch git repo. `claude -p --max-turns <n> --output-format json` runs in that repo with the normal login.
  - [ ] omp. `PI_CODING_AGENT_DIR=<fixture>/.omp/agent omp -p --mode json`, with stdin closed.
  - [ ] Codex. `mirrorProject` writes `AGENTS.md` and `.agents/skills/` into a scratch workspace. `codex exec -s read-only --ephemeral --ignore-user-config --json -C <workspace>`.
  - [ ] Cursor. `cursor-agent -p --mode ask --trust --workspace <workspace> --output-format json`.
- [ ] A case reads a Claude transcript only for tool names, file paths and usage fields. It never copies message text into an artifact.
- [ ] Save every artifact, the TAP file, the harness JSON and `versions.txt`, to `/tmp/swarm-<pr-id>/worker-<n>/`. Return the paths with the report.

## Remove the v0 provider path (subtract)

**Depends on.** None. It branches from `main`.

**Files.**

- [ ] Delete `providers/pstack.json`, `providers/openspec.json`, `lib/targets/providers.ts`, `packs/core/principles.md`, `packs/core/commands/craft.md`, `packs/core/skills/rig-doc-review/`, `packs/core/skills/rig-second-opinion/`, `probes/craft-claude-project-units.ts`, `test/openspec.test.ts`, `test/openspec.helpers.ts`.
- [ ] Edit `lib/world/schemas.ts`, `lib/world.ts`, `lib/world/project.ts`, `lib/world/merge.ts`, `lib/lock.ts`, `lib/lock/lockfile.ts`, `lib/commands/pin.ts`, `lib/commands/doctor.ts`, `lib/commands/models.ts`, `lib/commands/shared.ts`, `lib/gate/pin.ts`, `lib/gate/telemetry.ts`, `lib/gate/registry.ts`, `lib/stack.ts`, `lib/targets.ts`, `lib/targets/vars.ts`, `lib/targets/models-render.ts`, `packs/core/frame.md`, `rig.json`, `rig.lock.json`.
- [ ] Edit `packs/product/pack.json`, `packs/product/skills/office-hours/SKILL.md` and `packs/product/skills/office-hours/references/design-doc.md`.
- [ ] Edit `test/pstack.test.ts`, `test/pstack.helpers.ts` and every other test that names a provider, a slot or `/craft`.
- [ ] Delete `docs/guide/06-craft.md`. Edit `README.md`, `docs/guide/README.md`, `docs/guide/01-setup.md` to `05-scope-and-projects.md`, `07-models.md`, `09-make-it-yours.md`, `10-recipes-and-pitfalls.md` and `docs/harnesses.md` where they name a provider, a slot, `/craft` or a plugin pin. Quote only outputs that a test at the PR head prints.

**Build.**

- [ ] Land every schema 2 validator in `lib/world/schemas.ts`. rig.json drops `pins`, `providers`, `default_provider` and `slots`, and gains `fill`. The lock drops `pins` and gains `root`, `exclude`, `port` and `candidate` per pack. pack.json drops `source` and `ported_from`, and gains `mode`, `model_surfaces` and `telemetry`. A schema 1 file gives `E_SCHEMA` with the message "schema 1 is v0, see docs/design/rig-v1-first-seed.md".
- [ ] Rewrite the product pack for schema 2. `pack.json` drops `source` and `ported_from`. `design-doc.md:135,159-171` and `SKILL.md:115` drop the slot and provider text and the `{{rig:intake}}` term. Remove the `pm` to `craft` alias from `rig.json`. `vendor()` in `lib/lock.ts` writes pack.json schema 2 without `source`, so the tests that run `rig pack add` keep loading the world.
- [ ] Delete the installed-plugin half of `pin check` and `pin set` (`lib/lock.ts:156-275`) and of the pin gate (`lib/gate/pin.ts:58-118`). `pin check core` keeps working.
- [ ] Delete the pstack `model_surfaces` with the provider record. `seed` adds them back in `packs/pstack/pack.json`. The `telemetry` check reads `telemetry` from pack.json. Remove the plugin and provider text from the `pin` and `telemetry` rows of `lib/gate/registry.ts`.
- [ ] Remove the provider and slot readers in `lib/world/project.ts`, `lib/world/merge.ts:43-46`, `lib/commands/doctor.ts:91-134`, `lib/commands/models.ts:29`, `lib/commands/shared.ts:36` and `lib/targets/models-render.ts:24-46`.
- [ ] `frame.md` loses `{{providers}}`, `{{default_provider}}` and `{{slots}}`. Reseal `lock.core.tree`.

**You see.**

- [ ] `rg -nw "providers|default_provider|plugin-cache|craft|renderSlotStub|intake" lib bin packs` prints no line outside the schema 1 error message.
- [ ] `rig plan` on a fixture HOME prints `0 blocks` and plans only the frame and the product pack.
- [ ] `rg -n "craft|provider|slot" README.md docs/guide docs/harnesses.md` prints no line that describes v0 behavior as current.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `test/world.test.ts` gains a case for the schema 1 refusal of rig.json and of rig.lock.json. `test/plan-apply.test.ts` keeps its second-apply and drift cases green. Run `npm test`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Four lanes on `sonnet high` at the PR head, because the PR removes a path and adds no harness behavior. Each lane follows the boot recipe and runs one case of `test/live/subtract.test.ts`.

- [ ] Lane 1. Regression lane against trunk. Case `claude reads the frame`. Seed a fixture HOME at trunk and at head, mirror it, and ask `claude -p` to quote the rig frame's first invariant. Save `subtract-claude.tap`. Pass when both replies hold the invariant and the head frame has no provider line.
- [ ] Lane 2. Case `codex reads the frame block`. Seed, mirror `AGENTS.md`, and ask `codex exec -s read-only` to quote the `rig:frame` block's first line. Save `subtract-codex.tap`. Pass when the quote matches.
- [ ] Lane 3. Case `omp reads the frame`. Seed and ask `omp -p` to quote the first line of the `rig:frame` block in `~/.omp/agent/AGENTS.md`. Save `subtract-omp.tap`. Pass when the quote matches and the frame has no provider line.
- [ ] Lane 4. Case `cursor reads the frame rule`. Seed and ask `cursor-agent -p --mode ask` to quote the frame rule. Save `subtract-cursor.tap`. Pass when the quote matches.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. `rig plan` wall time on a fresh fixture HOME with the repository config.
- [ ] Probe. Ten runs each at trunk and at head, interleaved, with `RIG_NOW` fixed.
- [ ] Baseline. Record the trunk median first. The 2026-11-05 trunk median was 0.19 s.
- [ ] Rule. Fail when the head median exceeds the trunk median by more than 20 percent or exceeds 1 s.

**Review gate.** None. subtract is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Review-thread triage done. The repository runs no Bugbot check, so only human and agent threads count.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged, or a single verifier passed at the new head.
- [ ] The root posts the merge-ready report. The operator lands subtract first in the stack.

## Vendor with root, excludes and a name (vendor)

**Depends on.** `subtract`.

**Files.**

- [ ] Edit `lib/lock.ts`, `lib/lock/lockfile.ts`, `lib/lock/git.ts`, `lib/commands/pack.ts`, `lib/gate/pin.ts`, `bin/rig.ts`.
- [ ] Edit `test/lock.test.ts` and `test/lock.helpers.ts`.
- [ ] Create `test/live/vendor.test.ts`.

**Build.**

- [ ] `vendor()` in `lib/lock.ts` takes `root`, `paths`, `exclude` and `name`. `select` keeps the structure under `root`. An exclude that matches nothing gives `E_PATH_MISSING`. A SHA that is not 40 hex gives `E_USAGE` before any fetch.
- [ ] The lock entry fills `root` and `exclude`. `rig pack add` prints the kept file count and the excluded byte count.
- [ ] The pin gate blocks any file in a pack under a locked exclude prefix.

**You see.**

- [ ] `rig pack add file://<synthetic> --sha <40hex> --root pstack --path . --exclude skills/statechart` prints `vendored pstack` and `0 blocks`.
- [ ] `rig pack add <repo> --sha 2776ddd --path x` prints `E_USAGE` and exits 2.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `test/lock.test.ts` gains cases for structure under root, an excluded exec file that never reaches disk, `E_PATH_MISSING`, the short SHA refusal, the name default and override, and the no-op re-run. Run `node --test test/lock.test.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Three lanes on `sonnet high` at the PR head, because the PR adds one CLI path and no harness behavior. Each lane follows the boot recipe and runs one case of `test/live/vendor.test.ts`.

- [ ] Lane 1. Regression lane against trunk. Case `vendor pstack from GitHub`. Run the design's pstack `pack add` without its two `--port` flags against `https://github.com/cursor/plugins` at `2776ddd2355d6d6c8747d3964600f28daf62f049` at trunk and at head. Trunk has no `--root` or `--exclude`, so the lane records that and gates head. Save `vendor-pstack.tap`. Pass when head prints `0 blocks` and 107 kept files.
- [ ] Lane 2. Case `vendor twice is a no-op`. Run the same command twice. Save `vendor-noop.tap`. Pass when the second run prints `already vendored` and the lock bytes do not change.
- [ ] Lane 3. Case `claude lists a vendored leaf`. Enable the vendored pack, seed a fixture HOME, mirror it, and ask `claude -p` whether a skill named `how` exists. Save `vendor-claude.tap`. Pass when Claude finds `how` through the skill tool and the four real config hashes are unchanged.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. `rig plan` wall time on a fresh fixture HOME. The diff also adds `rig pack add` wall time for the synthetic repo.
- [ ] Probe. Ten interleaved runs at trunk and at head. `rig pack add` runs only at head, because trunk lacks the flags.
- [ ] Baseline. Record the trunk `rig plan` median first.
- [ ] Rule. Fail when the head `rig plan` median exceeds the trunk median by more than 20 percent, or when the synthetic `rig pack add` median exceeds 2 s.

**Review gate.** None. vendor is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Review-thread triage done. The repository runs no Bugbot check, so only human and agent threads count.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged, or a single verifier passed at the new head.
- [ ] The root posts the merge-ready report. The operator lands vendor after subtract.

## Check links and count hidden units right (links)

**Depends on.** `subtract`.

**Files.**

- [ ] Create `lib/gate/links.ts`.
- [ ] Edit `lib/gate/registry.ts` and `lib/gate/budget.ts`.
- [ ] Edit `test/gate.test.ts` and `test/gate-cve-budget.test.ts`.
- [ ] Create `test/live/links.test.ts`.

**Build.**

- [ ] `runLinks` in `lib/gate/links.ts` blocks when a relative Markdown link in an owned `.md` entry does not resolve to an owned path of the same harness. The finding is ackable. Links in code spans and fences, URLs with a scheme, anchors, and targets that are not paths (no `/` and no file extension, such as `url`) are skipped.
- [ ] `hidden()` in `lib/gate/budget.ts` treats a skill with the Codex sidecar as hidden.

**You see.**

- [ ] `rig plan` on a fixture pack with a link to a missing skill prints `block links` with the source path and the target.
- [ ] The Codex listing line in `rig plan` counts only visible skills.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `test/gate.test.ts` gains cases for a resolving link, a dangling link, a link to an excluded file, an anchor-only link, an absolute URL, a `[PR #123](url)` placeholder and a link inside a code fence. `test/gate-cve-budget.test.ts` gains a sidecar-hidden case. Run `npm test`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Two lanes on `sonnet high` at the PR head, because the PR changes only gate findings. Each lane follows the boot recipe and runs one case of `test/live/links.test.ts`.

- [ ] Lane 1. Regression lane against trunk. Case `codex hides sidecar skills`. Seed the product pack at trunk and at head and run `codex exec -s read-only` with a prompt that lists the available skills. Save `links-codex.tap`. Pass when `office-hours` is absent from the listing on both sides and head reports a smaller listing count than trunk.
- [ ] Lane 2. Case `claude follows a seeded link`. Seed a fixture skill that links a reference file and ask `claude -p` to read it through the link. Save `links-claude.tap`. Pass when the reply quotes the reference sentinel.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. `rig plan` wall time on a fresh fixture HOME.
- [ ] Probe. Ten interleaved runs at trunk and at head.
- [ ] Baseline. Record the trunk median first.
- [ ] Rule. Fail when the head median exceeds the trunk median by more than 20 percent or exceeds 1 s.

**Review gate.** None. links is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Review-thread triage done. The repository runs no Bugbot check, so only human and agent threads count.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged, or a single verifier passed at the new head.
- [ ] The root posts the merge-ready report. The operator lands links after subtract.

## Compile the mode skill from pack data (mode)

**Depends on.** `subtract`.

**Files.**

- [ ] Create `lib/mode.ts`, `packs/core/skills/rig-mode/SKILL.md`, `packs/core/domains.json`.
- [ ] Edit `lib/stack.ts`, `lib/targets.ts`, `lib/targets/vars.ts`, `lib/world/schemas.ts`, `lib/world.ts`, `packs/core/frame.md`.
- [ ] Create `test/mode.test.ts`, `test/fixtures/rig-mode-pack/`, `test/live/mode.test.ts`.

**Build.**

- [ ] `compileMode` and `modeMarkdown` in `lib/mode.ts`, with the types of the design's type sketch. `compileMode` resolves adopted files, refs, fills and the artifact graph.
- [ ] `compileMode` validates the mode block, including the `subagents` and `adapter` sections. `domains.json` lists the four domains and their stages.
- [ ] `discover` maps core `skills/rig-mode/` to unit type `mode`. `renderMode` in `lib/targets.ts` runs after every other unit and writes `rig-mode/SKILL.md`, `rig-mode/playbooks/*` and `rig-mode/references/*` per harness.
- [ ] New errors `E_MODE_REF`, `E_FILL_UNKNOWN` and `E_ARTIFACT_DANGLING` block `rig plan`.

**You see.**

- [ ] With the fixture mode pack enabled, `rig plan` plans `~/.claude/skills/rig-mode/SKILL.md` and the adopted playbooks.
- [ ] A fill of `eng:shipit` prints `E_FILL_UNKNOWN eng:shipit`. An artifact that requires `prd` with no writer prints `E_ARTIFACT_DANGLING prd`.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `test/mode.test.ts` gains cases for adoption, an adopt clash across packs, `{{skill:...}}` resolution per harness, the derived principles index, the Subagents section, the Claude-only adapter, every fill address form, `E_FILL_UNKNOWN`, `E_ARTIFACT_DANGLING`, render-twice identical bytes, and `place()` over all four harnesses giving each harness exactly one `rig-mode`. Run `node --test test/mode.test.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Five lanes on `sonnet high` at the PR head, one per harness plus one routing case. Each lane follows the boot recipe and runs one case of `test/live/mode.test.ts` with the fixture mode pack.

- [ ] Lane 1. Regression lane against trunk. Case `claude invokes the mode skill`. Trunk has no mode skill, so the lane records that and gates head. Seed, mirror, run `claude -p "/rig-mode which playbook fits a failing test report?"`. Save `mode-claude.tap`. Pass when the reply names the fixture bug-fix playbook.
- [ ] Lane 2. Case `claude reads an adopted playbook`. Ask Claude to quote step 1 of the adopted fixture playbook. Save `mode-playbook.tap`. Pass when the quote matches the fixture bytes.
- [ ] Lane 3. Case `codex lists the mode skill`. Run `codex exec -s read-only` with a prompt that lists the available skills. Save `mode-codex.tap`. Pass when `rig-mode` is listed and the fixture leaf is not.
- [ ] Lane 4. Case `cursor lists the mode skill`. Run `cursor-agent -p --mode ask` with the same prompt. Save `mode-cursor.tap`. Pass when `rig-mode` is listed.
- [ ] Lane 5. Case `omp lists the mode skill`. Run `omp -p` with the same prompt. Save `mode-omp.tap`. Pass when `rig-mode` is listed once.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. `rig plan` wall time on a fresh fixture HOME. The diff adds the mode skill compile, measured with the fixture mode pack enabled.
- [ ] Probe. Ten interleaved runs at trunk and at head with the repository config, then ten head runs with the fixture mode pack.
- [ ] Baseline. Record the trunk median first.
- [ ] Rule. Fail when the head median with the repository config exceeds the trunk median by more than 20 percent, or when the run with the fixture mode pack exceeds 1 s.

**Review gate.** None. mode is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Review-thread triage done. The repository runs no Bugbot check, so only human and agent threads count.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged, or a single verifier passed at the new head.
- [ ] The root posts the merge-ready report. The operator lands mode after subtract.

## Record ports and detect stale ones (port)

**Depends on.** `vendor`.

**Files.**

- [ ] Edit `lib/lock.ts`, `lib/lock/lockfile.ts`, `lib/commands/pin.ts`, `lib/commands/pack.ts`, `lib/gate/pin.ts`, `bin/rig.ts`.
- [ ] Create `.claude/skills/rig-port/SKILL.md`.
- [ ] Edit `test/lock.test.ts`. Create `test/port.test.ts` and `test/live/port.test.ts`.

**Build.**

- [ ] `vendor` takes `port`. Without `paths` it adopts an existing authored pack folder. The lock entry fills `port` with `paths` and `tree`, and writes `reviewed_sha` and `reviewed_tree` as null. Null counts as stale.
- [ ] `pinCheck` works on any pack, records `candidate`, prints a unified diff of the port paths with `--diff`, and replaces the candidate's exclude list with `--exclude`. `pinSet` promotes the candidate. `pinSet --ported` attests the port with no fetch.
- [ ] The pin gate blocks with `E_PORT_STALE` when `port.tree` differs from `port.reviewed_tree`. The finding is not ackable.
- [ ] The `rig-port` repo skill follows the design's split table. Write it per `asd-ste100` Strict mode.

**You see.**

- [ ] On a synthetic repo where a port source changed, `rig pin check <pack> --sha <new>` prints `port stale: <path>`, and `rig plan` prints `E_PORT_STALE <pack>` after `rig pin set`.
- [ ] After `rig pin set <pack> --ported`, `rig plan` prints `0 blocks`.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `test/port.test.ts` gains cases for adopt mode, a pin move with unchanged port sources (green with no attest), a pin move with a changed port source (blocked until `--ported`), the `--diff` output, and the idempotent second `pin set`. Run `node --test test/port.test.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Three lanes on `sonnet high` at the PR head, because the PR adds lock behavior and one repo skill. Each lane follows the boot recipe and runs one case of `test/live/port.test.ts`.

- [ ] Lane 1. Regression lane against trunk. Case `gstack office-hours re-pins without a port`. Adopt `packs/product` at gstack `b244e6d11a6466650c5147cd7dc023859968c4b5`, run `pin set product --ported`, then `pin check` and `pin set` to `b4068209809315ab1578c78e33e73512b29749ca`. Trunk has no port records, so the lane records that and gates head. Save `port-gstack.tap`. Pass when `pin check` prints `port fresh` and `rig plan` prints `0 blocks`.
- [ ] Lane 2. Case `pstack hub change marks the port stale`. Adopt a scratch pstack pack at `a968159326d1fc6b7d483491ec5c457986a20af2` (pstack 0.15.25) with the hub as port source, attest it, then `pin check` and `pin set` to `2776ddd2355d6d6c8747d3964600f28daf62f049`. The hub changed in between, at `ab1f702`. Save `port-pstack.tap`. Pass when `rig plan` prints `E_PORT_STALE pstack`.
- [ ] Lane 3. Case `claude runs rig-port on a stale fixture`. In a scratch config repo with a stale synthetic port, run `claude -p "/rig-port fixture"`. Save `port-skill.tap`. Pass when the run ends with `rig pin set fixture --ported`, `rig plan` prints `0 blocks`, and the diff touches only `packs/fixture/pack.json` and `rig.lock.json`.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. `rig plan` wall time on a fresh fixture HOME. The port check adds one hash comparison per pack.
- [ ] Probe. Ten interleaved runs at trunk and at head.
- [ ] Baseline. Record the trunk median first.
- [ ] Rule. Fail when the head median exceeds the trunk median by more than 20 percent or exceeds 1 s.

**Review gate.** None. port is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Review-thread triage done. The repository runs no Bugbot check, so only human and agent threads count.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged, or a single verifier passed at the new head.
- [ ] The root posts the merge-ready report. The operator lands port after vendor.

## Seed the default config from pstack and gstack (seed)

**Depends on.** `mode`, `port` and `links`.

**Files.**

- [ ] Create `packs/pstack/`, `packs/cursor-team-kit/`, `packs/cli-for-agent/` with `rig pack add`, never by hand.
- [ ] Create `packs/pstack/pack.json` `mode` with `/rig-port pstack`.
- [ ] Edit `packs/product/pack.json`, `packs/product/NOTICE.md`, `rig.json`, `rig.lock.json`, `lib/gate/pin.ts`.
- [ ] Create `test/first-seed.test.ts`, `test/seed.test.ts`, `test/helpers/seed.ts`, `test/golden/first-seed.manifest`, `test/live/first-seed.test.ts`.

**Build.**

- [ ] Run the commands of the design's "Build the seed" block. pstack, cursor-team-kit and cli-for-agent vendor at `2776ddd2355d6d6c8747d3964600f28daf62f049`. product adopts at `b244e6d11a6466650c5147cd7dc023859968c4b5`, gets attested, and moves to `b4068209809315ab1578c78e33e73512b29749ca` with `pin check` and `pin set`.
- [ ] Port the hub and the Claude Code adapter into `packs/pstack/pack.json` `mode`, and add the pstack `model_surfaces`. Move the four step-anchored triggers into the `rig.json` fills. Keep the situational triggers. Run `rig pin set pstack --ported`.
- [ ] The pin gate in `lib/gate/pin.ts` blocks a non-core pack folder with no lock entry. Every pack has one from this PR on.
- [ ] `rig plan` blocks with `E_FOREIGN_INSTALL` when a harness also holds a seeded upstream that rig does not own. The first case is a Claude Code or Cursor plugin install of pstack, cursor-team-kit or gstack, read from `~/.claude/plugins/installed_plugins.json` and the Cursor plugin cache. The finding names the plugin and the harness command that removes it. It is not ackable. rig never deletes a file that it does not own. An unmanaged folder with the name of a seeded unit, such as `~/.agents/skills/architect`, already gives `E_ADOPT_MISMATCH`. Its message gains the same removal hint.
- [ ] Set the `rig.json` of the design.

**You see.**

- [ ] `rig plan` on a fresh fixture HOME prints `0 blocks` and only the warns of assertion A11.
- [ ] `~/.claude/skills/rig-mode/SKILL.md` in the fixture HOME lists the step fills and the `brief` artifact.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `test/first-seed.test.ts` runs assertions A1 to A14 of the design against the committed config. `test/seed.test.ts` runs the synthetic twin. Run `npm test`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `sonnet high` at the PR head. Each lane follows the boot recipe and runs one case of `test/live/first-seed.test.ts`.

- [ ] Lane 1. Regression lane against trunk. Case `claude routes a bug report`. Trunk has no seed, so the lane records that and gates head. Seed, mirror, run `claude -p "/rig-mode a test fails after the last merge, what do I do?"`. Save `seed-claude-route.tap`. Pass when the reply names the Bug fix playbook.
- [ ] Lane 2. Case `re-vendor reproduces the lock`. Run the design's commands in a config dir that holds only `rig.json`, the pack.json files and `packs/product`. Save `seed-revendor.tap`. Pass when every tree hash equals the committed `rig.lock.json`.
- [ ] Lane 3. Case `claude spawns Agent, not Task`. Run `/rig-mode` with a task that the Bug fix playbook delegates and read the transcript tool names. Save `seed-claude-adapter.tap`. Pass when the transcript holds an `Agent` tool call and no tool named `Task`.
- [ ] Lane 4. Case `claude runs office-hours into a repo artifact`. Run `/rig-mode` with a product idea in a scratch repo, limited by `--max-turns`. Save `seed-claude-brief.tap`. Pass when `docs/designs/<slug>.md` exists in the scratch repo and nothing exists under `~/.gstack`.
- [ ] Lane 5. Case `claude applies the ship hook`. Ask `/rig-mode` what runs before a commit. Save `seed-claude-hook.tap`. Pass when the reply names `deslop`.
- [ ] Lane 6. Case `codex lists the mode skill and hides leaves`. Save `seed-codex.tap`. Pass when `rig-mode` is listed and `how` is not.
- [ ] Lane 7. Case `cursor lists the mode skill and hides leaves`. Save `seed-cursor.tap`. Pass when `rig-mode` is listed and `how` is not.
- [ ] Lane 8. Case `omp lists the mode skill once`. Save `seed-omp.tap`. Pass when omp names `rig-mode` once and `how` is absent from the listing.
- [ ] Unit. `test/seed.test.ts` gains a case where the fixture HOME holds a pstack plugin record in `installed_plugins.json`. Pass when `rig plan` prints `E_FOREIGN_INSTALL pstack` and exits 1.
- [ ] Lane 9. Case `undo clears the seed`. Apply, then `rig apply --undo <run>`. Save `seed-undo.tap`. Pass when the fixture HOME manifest equals the manifest before apply.
- [ ] Lane 10. Case `pin check is fresh`. Run `rig pin check pstack --sha 2776ddd2355d6d6c8747d3964600f28daf62f049` and `rig pin check product --sha b4068209809315ab1578c78e33e73512b29749ca`. Save `seed-pin.tap`. Pass when both print `unchanged, port fresh` and exit 0.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. `rig plan` and `rig apply` wall time on a fresh fixture HOME with the full seed. The diff adds about 107 pstack files per harness.
- [ ] Probe. Ten interleaved `rig plan` runs at trunk and at head, then ten head `rig apply` runs, each on a new fixture HOME.
- [ ] Baseline. Record the trunk `rig plan` median first. The prototype with an unexcluded pstack measured 0.40 s.
- [ ] Rule. Fail when the head `rig plan` median exceeds 1 s or the head `rig apply` median exceeds 2 s. Trunk lacks the seed, so the rule uses absolute budgets and no ratio.

**Review gate.** None. seed is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Review-thread triage done. The repository runs no Bugbot check, so only human and agent threads count.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged, or a single verifier passed at the new head.
- [ ] The root posts the merge-ready report. The operator lands seed last. Its merge is the first seeded rig.

## Close the program

- [ ] Every box above is checked with its evidence.
- [ ] Reply to the operator with the report the execution playbook names, plus the golden manifest line count per harness and the compiled mode skill token count.

## Appendix A. Prototype evidence

The prototype ran on 2026-11-05 on a scratch copy of this repository with a fixture HOME. The full record is Appendix A of [rig-v1-first-seed.md](../design/rig-v1-first-seed.md).

- Vendoring pstack works with today's `vendor()`. The pack name, the exclude support and the hub replacement are missing.
- The gate blocks 67 `exec` findings and 1 `unicode` finding in four subtrees. `disable` does not clear them, so `vendor` adds `--exclude`.
- Compose found 58 skills and 2 agents and planned 1,166 file creates across four harnesses.
- `rig plan` took 0.19 s on trunk and 0.40 s with the vendored pstack.
- Three points stay unproven. They are the mode skill compile, the adopted playbook links on Cursor, and the Claude adapter behavior. Lanes `mode` 2, `seed` 1 and `seed` 3 settle them.

## Appendix B. Alternatives rejected

- Derive the mode skill at every seed with a parser over the pinned hub. It keeps rig downstream of pstack's prose format. Details are in the design's alternatives table.
- Ack the 68 gate findings instead of excluding the subtrees. It approves 121 KB of scripts to run on developer machines.
- A `rig seed` command with recipes per upstream commit. It is a second way to vendor.
- Keep the v0 provider path beside the mode skill. Two ways to start a task, and the installed-plugin pins stay.
- One PR for the whole seed. It hides which mechanism broke. Each mechanism PR proves itself on synthetic fixtures first.

## Appendix C. Risks

- `subtract` also makes the v0 user guide from #33 stale in ten pages. Leaving it for later breaks `test/docs.test.ts` and tells a user about a `/craft` that no longer exists, so `subtract` owns that rewrite.
- `subtract` breaks many tests at once. The owner watches for tests that assert v0 behavior with no v1 meaning and deletes them in the same PR, with one line per deleted file in the PR body.
- `mode` placement on Cursor. Cursor reads `~/.claude/skills`. The owner watches `mode` lane 4 and assertion A9.
- Between `subtract` and `seed`, rig renders no `~/.claude/rules/pstack-models.md`. A real `rig apply` on a machine with an installed pstack in that window removes a file that pstack reads. Run real applies only after `seed`.
- `seed` depends on GitHub for lane 2. A network failure gives no verdict, per the verdict rules.
- The compiled mode skill may pass 5,000 tokens. The `seed` owner records the count and does not trim upstream text to pass. The budget warn is on the allowed list.
- The installed pstack 0.15.36 in the Claude plugin cache has an adapter link (`../../docs/harness/claude-code.md`) in 23 skills. The pinned commit `2776ddd` has the same version string and the link in 1 file. A dry run of the `links` check over the cache gave 31 blocks. The `seed` owner runs the check over the pinned tree and resolves each block. Either the vendored `docs/harness/` file is rendered at the linked path, or the mode adapter section replaces the link. Acks are not an option.
- The first real `rig apply` on a machine with pstack already installed stops at `E_FOREIGN_INSTALL` and `E_ADOPT_MISMATCH`. This is intended. The operator removes the old installs by hand, once per machine.
- Codex and omp leaves use Cursor names with no adapter. `seed` lanes 6 to 8 check listing only. Phase 4 `adapter` covers behavior.

## Appendix D. Links and reading list

- Read [rig-v1-concept.md](../design/rig-v1-concept.md) and [rig-v1-first-seed.md](../design/rig-v1-first-seed.md) before you edit.
- Read [rig-architecture.md](../design/rig-architecture.md) sections on the pipeline, the gate and the journal. They stay valid for v1.
- `mode` and `seed` get `<pstack>/skills/how/SKILL.md` before the change and `<pstack>/skills/interrogate/SKILL.md` on the compiled mode skill.
- Keep the decision trail per `<pstack>/skills/show-me-your-work/SKILL.md` in the orchestrator's session store.
