# rig v1 concept

Status: concept, agreed with the user over five review iterations on 2026-11-05, and revised the same day for the `craft` install shape. It replaces the v0 direction "rig links an installed pstack". The ADRs in `docs/decisions/` are history until a decision here or in [rig-v1-first-seed.md](rig-v1-first-seed.md) confirms or replaces them.

## What rig is

rig is a seeder. It takes a skeleton of how agent work flows (from pstack and gstack), a default configuration pinned to exact upstream commits, and a team's own choices. It compiles them into one set of files per coding-agent harness: Claude Code, Codex, Cursor and omp.

rig solves two problems. The first is user-global skills. A repo's `AGENTS.md` and repo skills cover one project, but each person also keeps global skills in `~/.claude`, `~/.cursor`, `~/.codex` and `~/.omp`, often on two harnesses at work and two at home. rig seeds the same set into all four from one config repo, and lets you check in one place that pstack, gstack and your own skills still work together after a release of a plugin, a harness or a model. The second is supply-chain risk. An automatic update of a skill or plugin can bring a vulnerability or a malicious prompt. In rig no skill updates itself. A new version enters only through `rig pin check`, the gate and a review in the team's config repo.

Three rules carry the design:

1. rig owns its mode. rig vendors pstack (MIT) at one commit and renders its own mode skill, `craft` (`/craft`). pstack's hub installs byte-identical as the file `craft/hub.md`, not as a skill. rig renders the shell, one file per domain and an adapter file with one section per harness from data. Changed on 2026-11-05: the hub was a port source and was not installed.
2. Seeding is deterministic. The same committed config gives the same files in every fresh HOME, on every machine, with no language model in the path. A personal overlay is the only per-person input.
3. Domains talk through artifacts. Business, product, engineering and upkeep steps hand work to each other only through repo files. The end-to-end process therefore does not depend on the harness.

## Assumptions for review

These assumptions open the review. Cite them by number.

Product assumptions:

| # | Assumption |
|---|---|
| Z1 | rig seeds from a pinned upstream commit. It does not fork pstack or gstack. Vendored files stay byte-identical to the commit in the repo. In a harness copy of a vendored leaf, rig adds only the hide keys of the harnesses that read the dir and a two-line adapter anchor (assertion A8 of the first-seed design). rig's own parts are the `craft` shell, the domain files, the adapters, the pack `mode` data and the gstack ports. A maintainer moves the pin on purpose. Changed on 2026-11-05: only the mode data and the gstack ports were rig's own, and the hub was ported. |
| Z2 | One mode skill drives four domains. They are business, product, engineering and upkeep. Each domain is a `domain` label on playbooks, not a new noun. The user names a domain as the first argument (`/craft eng: ...`). Without it the mode skill picks the domain. |
| Z3 | The process is harness-independent. Artifacts are repo files, so a brief written in Claude Code feeds a spec written in Cursor. |
| Z4 | Simplicity wins. Five nouns and four operations. A sixth noun or a fifth operation needs a trade-off row first. |
| Z5 | Every step has the same shape: `before` hooks, one `slot`, `after` hooks. |
| Z6 | Specification tools such as OpenSpec plug in as durable artifacts, not as a flow in core. A delegated tool's human gates are respected by default. |

Collaboration assumptions:

| # | Assumption |
|---|---|
| Z7 | A team's configuration is a git repo: `rig.json`, `rig.lock.json` and team packs. The team changes it by pull request. |
| Z8 | Everyone on the team gets the same bytes. Tree hashes in the lock pin them, the gate checks them, and `rig apply --undo` reverts a run. |
| Z9 | Changes land on three levels: a fix to rig itself, a change to the team config repo, and a personal overlay that nobody else sees. |
| Z10 | The team maintains AI tooling like code. `rig doctor` shows drift and stale pins. |
| Z11 | A review remark that repeats becomes a rule. A pull request to a team pack adds a hook or a trigger. |
| Z12 | No skill updates itself. A new upstream version reaches a HOME only after the gate and a review. Example: pstack 0.15.36 `make-bot-ui` line 89 runs `curl ... \| sudo sh`, and the gate blocks it. |

Open questions:

| # | Question |
|---|---|
| P1 | Do the four domains and their steps fit the team's real process? |
| P2 | One mode skill for all domains, or one mode per domain? |
| P3 | Are order-free hook lists enough, or do hooks need an order? |
| P4 | Which gaps belong to the harness (context compaction, caching, session handoff), not to rig? |
| P5 | Who owns the team config repo? |
| P6 | What fills the `retire` step? Proposed answer: [Evidence and retirement](#evidence-and-retirement). |

## The model

### Nouns

| Noun | What it is | Example |
|---|---|---|
| mode | The mode skill `craft`. Per harness it holds a rig-rendered shell, pstack's hub as `hub.md`, the hub's playbooks, one reference file per domain (steps, fills, artifacts, playbooks) and one adapter file with a section for each harness that reads the dir. | `craft/SKILL.md` |
| playbook | Ordered steps for one kind of task, labeled with a domain. | pstack `bug-fix.md`, domain engineering |
| skill | A unit a harness loads. Every skill carries the harness hide switch, so the model does not pick it. The user can still invoke it. Units in `rig.json` `auto` stay visible to the model. | pstack `how`, gstack-derived `office-hours` |
| principle | A skill that states one rule and when it applies. The hub indexes them. | `principle-prove-it-works` |
| artifact | A repo file with a schema that one step writes and a later step requires. | `docs/designs/<slug>.md` |

### Operations

| Operation | Effect |
|---|---|
| add | Bring a pack or a unit into the stack. |
| replace | Swap a unit for another with the same role. |
| disable | Remove a unit that is present. |
| fill | Put a skill into a step slot or a hook list, or add a trigger. |

### Domains and steps

A domain is one of the four areas of work. A step is one stage in a domain. Each step has three positions. The visualization pictures the domains as masts and the steps as yards. The code and these docs do not use those words.

| Position | Holds | Rule |
|---|---|---|
| `before` | a list of hook skills | runs before the slot, order-free |
| `slot` | exactly one skill, or nothing | does the stage's work |
| `after` | a list of hook skills | runs after the slot, order-free |

The stages:

| Domain | Prefix | Stages | Upstream source |
|---|---|---|---|
| Business | `biz` | demand, scope | gstack (mapping is rig's) |
| Product | `prod` | discover, shape, review, spec | gstack (mapping is rig's) |
| Engineering | `eng` | ground, design, build, verify, review, ship | pstack |
| Upkeep | `upk` | upkeep, retire | pstack playbooks that the seed labels `upkeep`, for example `worktree-cleanup` |

`fill` addresses a step with `<prefix>:<stage>` for the slot and `<prefix>:<stage>.before` or `.after` for a hook list:

```json
{
  "fill": {
    "eng:ground": "pstack/how",
    "eng:ship.before": ["cursor-team-kit/deslop"],
    "prod:discover": "product/office-hours",
    "triggers": [{ "when": "Building or changing a CLI", "use": "cli-for-agent/cli-for-agents" }]
  }
}
```

A trigger tied to a step becomes a hook. pstack's "Before commit, run deslop" becomes `eng:ship.before`. A situational trigger, such as "building a CLI", stays a trigger. The domain file of its `domain` lists it, and the shell lists a trigger with no domain. On Claude Code a hook may later compile to a harness event. On other harnesses it is prose in the domain file.

The mode skill reads the hub in full, then the domain file. Where both name the same step, the domain file wins. A team therefore changes a step with a fill, and the hub bytes stay upstream bytes.

### Artifacts

An artifact definition has the OpenSpec schema shape plus two rig fields:

| Field | Meaning |
|---|---|
| `id`, `generates`, `template`, `instruction`, `requires` | as in OpenSpec `schema.yaml` |
| `write_at` | the step that writes it, for example `prod:discover` |
| `ready_when` | optional text a reader checks before using it, for example `Verdict: ready` |
| `check` | optional command that validates it, for example `openspec validate --specs` |

The cross-domain contract is a chain of seven artifacts, in this order. brief, prd, spec, tasks, proof, release, upkeep. `rig plan` blocks with `E_ARTIFACT_DANGLING` when an enabled artifact `requires` an artifact that no enabled step writes. The ground stage reads every existing artifact, so no `read_at` field exists.

## Four layers

| Layer | Owner | Where | Contents |
|---|---|---|---|
| 1. Skeleton | rig | `packs/core/` in the rig repo, sealed by tree hash | mode skill shell template, domain table, frame, terms |
| 2. Default config | rig | `rig.json`, `rig.lock.json`, `packs/*` in the rig repo | pstack, cursor-team-kit `deslop`, `control-cli` and `control-ui`, cli-for-agents, the gstack-derived product pack, pinned at full commits, plus default fills |
| 3. Team config | the team | a fork of layer 2, shared by git | team packs, team fills, team pins |
| 4. Personal overlay | one person | `~/.config/rig/rig.json` and its packs | personal fills and packs |

A team shares its whole seeded version by sharing the config repo. Another team forks it, agrees on its own fills, and sends fixes back by pull request.

## Pinning and seeding

### Two kinds of upstream content

| Kind | What | How rig gets it | Example |
|---|---|---|---|
| Vendored | upstream bytes that work as they are | `rig pack add` fetches a full commit, copies the chosen paths, records a tree hash | pstack leaf skills, pstack's hub and playbooks, `deslop`, `cli-for-agents` |
| Ported | rig-authored content derived from upstream prose | an agent or a person writes it once, the lock records the upstream sources it derives from | the Claude Code adapter (from pstack `docs/harness/claude-code.md`), the product pack (from gstack `office-hours`) |

Both kinds live as committed files in the config repo. The difference is who wrote the bytes.

pstack leaves can be vendored. They are prose, and the harness agent maps their Cursor tool names at run time through an adapter document. pstack ships such an adapter for Claude Code (`docs/harness/claude-code.md`). rig always renders `craft/references/adapter.md`, with one section for each harness that reads the dir. A harness with no adapter gets a section that says the skills use its own names. The Claude adapter is a port of the upstream file. The Codex, Cursor and omp adapters are rig-authored. Each vendored leaf copy gets a two-line anchor after its frontmatter that links to the adapter, as the pstack Claude Code installer does.

gstack skills cannot be vendored as they are. Each one first runs `~/.claude/skills/gstack/bin/gstack-skill-start`, calls up to 18 gstack binaries, and writes state under `~/.gstack`. rig ports the ones it needs. A port strips the runtime calls and points state at repo files. `packs/product` already does this for `office-hours`.

### Is seeding deterministic?

Yes. A CI runner with no language model produces byte-identical output from the committed config repo.

| Step | Needs network | Needs an agent |
|---|---|---|
| `rig plan`, `rig apply`, `rig apply --undo`, `rig doctor` | no | no |
| `rig pack add`, `rig pin check`, `rig pin set` | git and OSV | no |
| Re-port after an upstream source of a port changed | no | yes, or a person |

One step needs judgment. It is the re-port after an upstream source of a port changed. For example, pstack's Claude Code adapter gains a row, or gstack's `office-hours` template changes. A hub change is a plain pin move. `E_MODE_NAME` and `E_PLAYBOOK_UNLABELED` screen it, because the hub is vendored, not ported. A deterministic check finds this case. The lock records the tree hash of every port source and the hash a maintainer last reviewed. `rig plan` blocks with `E_PORT_STALE` until they match again.

The maintainer runs the port in the config repo with the repo skill `/rig-port`. It reads `rig pin check <pack> --diff`, edits the port, runs `rig plan` until only `E_PORT_STALE` remains, then runs `rig pin set <pack> --ported`. The result is a pull request. CI checks it without a model. Users who seed never run the port.

When a pin moves and no port source changed, the CLI alone moves it. The first seed shows this path. It adopts the product pack at gstack `b244e6d`, where the port was made, and moves it to `b406820` with `rig pin check` and `rig pin set`, because `office-hours` did not change between them.

### Maintainer commands

| Command | Maintainer role |
|---|---|
| `rig pack add` | receive a part from a supplier, at a full commit |
| `rig pin check` | inspect a newer part before you accept it |
| `rig pin set` | accept the newer part |
| `rig plan` | draw the assembly plan, gate every file |
| `rig apply` | write the stack into each harness |
| `rig apply --undo` | take one run off again |
| `rig doctor` | check each harness for drift |

## Evidence and retirement

Status: proposal, 2026-11-10. Not reviewed yet. L1 is built. L0 and L2 are not. All code facts are at `76fe1ba`.

A unit earns its place when it helps on a frontier model, measured against the same model without the unit. pstack and gstack both lack this for most units. pstack measures per task and keeps no record: its Eval playbook has no promotion threshold (`pstack/skills/poteto-mode/playbooks/eval.md:25` at cursor/plugins `de8ee15`). gstack keeps a ledger, but at gstack `f0cd9f8` it holds 65 `untested` parts, 5 `safety` parts and 1 `helps` part (`docs/inventory/evidence.json`). gstack cut `/investigate` after a paired eval: 50.0% of trials passed with the skill and 47.2% without it, 95% CI -5.8 to +11.4. The run's own rule read FIX-METHOD, not a cut (gstack-evals `c86552e`, `wiki/board/2026-11-07-geva-380-r3c-results.md:42`). The cut was a product call on no detectable gain at 43% more cost per pass.

rig adds three levels of evidence. The word "level" avoids a clash with the four layers of config above. Each level is designed to work without the next one. L1 does today. For L0 this is a requirement on its future tests.

| Level | Question | Mechanism | Model cost | State |
|---|---|---|---|---|
| L0. Ledger | What do we know about each unit? | `evidence.json` beside `rig.json` | none | not built |
| L1. Use | Does any session open the unit? | `rig stats` | none | built (#56) |
| L2. Effect | Does the unit raise the pass rate, and at what cost? | Paired runs with and without the unit | paid, on demand | not built |

[rig-feedback-loop.md](rig-feedback-loop.md) is a separate signal. Its friction reports name a unit, but they report a misfire, not an effect, so they never set a ledger status.

### L0. Ledger

`evidence.json` sits in the team config repo beside `rig.json`. It maps a unit ref `<pack>/<unit>` to one row:

- `status`: `untested`, `helps`, `no-effect`, `hurts` or `safety`. A unit with no row is `untested`.
- `source`: a path or URL of the run that set the status. Required for every status except `untested`.
- `models`: the models that the run measured.
- `date`: the date of the run.

`safety` marks a guard whose value is the failure it prevents, such as a gate or `deslop`. A guard keeps its place without an effect run.

The ledger is rig data, not upstream data. It lives outside `packs/`, so no tree hash in `rig.lock.json` covers it, and `pack.json` does not change. It follows `audit.allow.json`, an optional repo-root file that rig already reads (`lib/world.ts:343`). It gets its own closed spec in `lib/world/schemas.ts`, next to `ALLOW` (`lib/world/schemas.ts:244`). Every root record there is closed, so a ledger key inside `rig.json` would need a change to the `rig.json` spec, and a separate file needs none. The ledger is a config file, not a sixth noun (Z4). It records facts about units and adds no operation.

`rig doctor` would check the ledger and print the count per status:

- No `evidence.json`, or an empty one: every unit is `untested`. This is not an error.
- A row whose ref no listed pack contains: `E_UNKNOWN_UNIT`, as `disable` gives (`lib/stack.ts:83-86`). This also covers a unit that a pin move removed upstream. gstack hit this case when it retired `/investigate` (`ef99eb5a5`). The fix is to delete the row in the same pull request as the pin move.
- A row with an unknown `status`, or without `source` when `status` is not `untested`: an error that names the ref.

A team changes a row by pull request, like any other config. The ledger check would read no metrics store. Its tests must run with no state root, so that they pin that L0 needs no `rig stats` data.

### L1. Use

`rig stats` records, for each session, which unit dirs a transcript opens. It counts a skill tool call, and a file read or shell command that names a path inside an installed unit dir, in the four transcript readers, for Claude Code, Codex, Cursor and omp (`lib/metrics/unit-paths.ts`, #56). `rig stats --suggest` proposes `disable` for a skill with no open in the window (`lib/metrics/propose.ts:32-57`). The pins are `test/stats.test.ts:402` for the diff, and `test/unit-paths.test.ts:20` for the path forms.

The count has four limits that a reader of the numbers needs:

- A command that only names the dir counts as an open, so the count is an upper bound (`test/unit-paths.test.ts:30`). The gstack-evals rule is stricter in one place and looser in another. It also counts a quoted sentinel (`src/grade/transcript.ts:243-268` at `c86552e`), which rig does not.
- A read of `craft/hub.md` or of a playbook counts for `craft`, never for the playbook (`test/stats.test.ts:557`). rig has no per-playbook use count.
- A harness that records no skill loads never proves a unit unused (`test/stats.test.ts:613`).
- The rule skips `core/` units, units that are not skills, and packs in the overlay, which get a note and no diff (`lib/metrics/propose.ts:44-51`).

An open is not an effect. A unit that is opened often can still have no effect.

`--suggest` applies nothing. It prints a patch and saves it under the state root, and no file outside the state root changes (`test/stats.test.ts:402` and `:572`). A later change would let `propose` read the ledger and also propose `disable` for a unit whose row is `no-effect` or `hurts`. That change is not built, and it would keep the same rule that the user applies the patch.

### L2. Effect

The masked arm is one config line for a skill. Arm `with` is the team config. Arm `without` is the same config plus `disable: ["<pack>/<unit>"]` (`lib/stack.ts:83-86`). Each arm is seeded into its own fixture HOME, as `setup` in `test/plan-apply.test.ts` does (from line 53).

What `disable` masks depends on the kind of unit. A `rig plan` on a copy of the repo at `76fe1ba` on 2026-11-10 showed three cases:

- A skill no other leaf links to: the arm builds. The frame drops its trigger line (`test/frame.test.ts:126`). A hub or playbook that names it gets an info line, not a block (`test/mode.test.ts:314`, `test/first-seed.test.ts:202`).
- A skill that another leaf links to: `rig plan` blocks. With `disable: ["pstack/principle-fix-root-causes"]` the gate reports two `links` findings, one for `~/.claude/skills` and one for `~/.agents/skills`, both from `principle-attack-the-premise`. A `links` finding can be acked, so the arm config carries one ack in its `audit.allow.json`.
- A playbook: `disable` cannot name it. A playbook is an adopted file of the pack, not a unit, so `disable: ["pstack/bug-fix"]` gives `E_UNKNOWN_UNIT` (`lib/stack.ts:150` skips adopted paths). Deleting the file from the copy gives a `pin` block, which nobody can ack, and `E_MODE_REF` for the `bug-fix` entry in `pack.json` `mode.playbooks` (`lib/mode.ts:179`). A playbook arm therefore needs a pack vendored with `--exclude` for that file, a lock entry for it, and no `bug-fix` entry in `mode.playbooks`. The hub is byte-identical, so it still lists the playbook. The arms differ in the file and in a hub line that names it.

A skill with `disable-model-invocation: true` reaches the model only when the hub or a playbook tells it to read the skill. rig hides every skill it installs unless the unit is in `rig.json` `auto` (`test/mode.test.ts:465`), and all 24 pstack `principle-*` leaves ship with the key upstream. The arm for such a unit is therefore the `craft` mode skill with and without the unit. A loose skill folder is the wrong arm. A 2026-11-10 prototype showed this. With the principle installed as a project skill, the first-turn input was 18,373 tokens in both arms, and the model opened the skill in 0 of 6 trials.

The mode-skill arm for a principle is buildable today. The Principles index is part of the vendored hub, and no rig file lists principles (`packs/core` holds none). With the leaf disabled, the hub still names it, and the `craft` shell tells the model to skip a skill that is not installed and to write one line that names it (`packs/core/skills/craft/SKILL.md:14`). Graders must ignore that line, because only the `without` arm writes it.

The run reuses gstack-evals (MIT) where it fits. Its two entry points answer different questions:

- `skill-eval` asks whether an edited skill lost anything against its old copy. Arms `before` and `after` are required, and PASS means "no loss detected" (`docs/skill-eval.md:3,41,131` at `c86552e`). It never returns `helps`. That fits a re-port: `before` is the unit at the old pin, `after` is the unit at the new pin. Its arms are skill folders, and a loadout arm, the closest match to a seeded rig HOME, stops with `E_USAGE` on a real host (`:96`). A playbook is not a skill folder.
- The outcome lanes (`lanes/outcome-skills/`) ask whether a skill helps against a masked arm. They produced the `/investigate` result. Their fit for a rig unit is unverified.

Both need a spend-ledger item and `gstack-approvals`. If neither fits a playbook, L2 needs a small rig-owned runner.

A run sets a row only when:

- the arms differ only by the unit, as defined above,
- the model is a frontier model on the harness's default system prompt,
- tasks are graded by hidden tests, or by a blinded judge from another model family for prose units. A candidate cheap judge is a System One decision model with the Jev wire contract, such as a self-hosted basal. On 2026-11-10, on 42 labeled cases fixed before any call (30 code fixes over 5 bugs, 12 prose passages), basal pico reached AUC 0.85 (95% CI 0.72 to 0.94) and mini 0.76 (0.60 to 0.89). Neither is calibrated at 0.5, and a negated question moved p by about 0.2. Such a judge compares arms by mean probability, not by a fixed threshold, and only for effects larger than its per-case noise. It is not trusted for prose yet,
- the pass rate without the unit leaves headroom.

The numeric thresholds are `derive-from: gstack-evals prereg of the first rig run`. A null result gets one check before `no-effect`. The check asks four questions. Did the sessions open the unit? Did the tasks fit it? Did the run have the power to see the effect? Does today's model do the job without it?

First pilot: the pstack Bug fix playbook, graded by hidden tests. At `76fe1ba`, 15 of rig's 79 commits are fixes, and each one adds or changes a test under `test/`. They are candidate tasks, after each passes calibration. A public pool of real bug fixes with hidden tests, as gstack-evals uses, is the fallback. The pilot measures the playbook on a model, not on rig. The pstack units are in `packs/pstack/` since the first seed (#42), so nothing blocks the run. The playbook arm needs the `--exclude` build above. A skill pilot such as `pstack/principle-fix-root-causes` needs only `disable` and one ack. Which pilot goes first is open.

A scratch pilot on 2026-11-10 tested the runner shape without rig. Arms ran `claude -p` on a subscription login with `--setting-sources project,local --strict-mcp-config`. Under these flags the user's global `CLAUDE.md` and rules did not reach the model: a probe answered `NONE`, while the same probe without the flags quoted them. A project `CLAUDE.md` did load. The unit was a two-sentence bug-fix rule ("list every caller, fix the root cause where all callers route through"), delivered as the project `CLAUDE.md`. On one race-condition fixture with a hidden test, Sonnet passed 5 of 5 with the rule and 3 of 5 without it, at 1.7 times the cost per trial. Fisher's exact p is 0.44, so this is a working runner, not evidence. Three of four earlier fixtures failed calibration: Sonnet passed one 5 of 5 and another 4 of 5, and the third needed its grader changed. The next run fixes these from the start:

- The grader is frozen before the first trial. The pilot's grader was narrowed after a 0 of 5 run.
- A placebo arm carries an unrelated rule of the same length, so the effect is not just "any added text".
- Each arm runs 15 to 20 trials on two or more fixtures.

### Retire

The `upk:retire` step has no fill in `rig.json` today, and no unit in the seed does retirement work. This section proposes what fills it. A team fills `upk:retire` with a skill or playbook that runs one review:

1. Run `rig stats --suggest` for the units with no open (L1).
2. Run `rig doctor` and read the ledger counts (L0).
3. List each unit that is `no-effect` or `hurts`, and each unit that is `untested` and unopened.
4. Open one pull request that edits `disable` or the ledger, with the evidence in the description.

A unit leaves the stack only through a reviewed `disable` in a pull request, never automatically (Z7, Z12). `safety` units stay. A null result is not a cut by itself. gstack's cut of `/investigate` was a product call on cost, and the run's own rule did not ask for it. rig ships no retire skill in the default config until L0 exists, because the review has nothing to read before then.

## Roadmap

| Phase | Goal | Done when |
|---|---|---|
| 1. Subtract | Remove the v0 provider path: workflow providers, slots, the v0 `/craft` provider command, installed-plugin pins. | `npm test` passes with no provider code. |
| 2. Mechanisms | Vendoring with root and excludes, the links check, the mode skill renderer, port records. | Each mechanism passes its unit and synthetic end-to-end tests. |
| 3. First seed | The default config seeded from pstack `2776ddd` and gstack `b406820` into all four harnesses. | The first-seed end-to-end test passes, and a live Claude Code run uses the mode skill. |
| 4. Breadth | Business steps, an OpenSpec artifact pack, a team config repo template, more gstack ports, the evidence ledger and the first effect pilot. | Each item has its own plan. |

The v0 `/craft` was the provider entry command. Phase 1 removes it. The v1 `/craft` is the mode skill, and phase 2 adds it.

The program plan for phases 1 to 3 is [docs/plan/v1-first-seed-prs.md](../plan/v1-first-seed-prs.md).

## Trade-off register

| Decision | Cost | Comes back when |
|---|---|---|
| Install the hub byte-identical as `craft/hub.md` and keep rig's choices in the domain files. Changed on 2026-11-05: the hub was ported once (C1). | The model applies "the domain file wins over the hub" in prose, and only a live lane checks it | A live lane shows the model follows the hub over a domain file |
| Steps are rig stages, not bindings to numbered playbook steps | A slot cannot change a vendored playbook's text | A team needs to replace one step inside a pstack playbook |
| Hooks are order-free | Two hooks cannot depend on each other | A real pair of hooks needs an order (P3) |
| Exclude scripts at vendor time | The `show-me-your-work` skill and the `babysit`, `shipping`, `multi-phase-plan` and `worktree-cleanup` playbooks lose their helper scripts | The gate learns to approve a reviewed script |
| No `read_at` on artifacts | Ground reads every artifact | A repo has so many artifacts that ground floods its context |
| No separate lifecycle layer around rig | Two cycles share one tool: the work's lifecycle (domains) and the tooling's lifecycle (the maintainer commands) | A team needs scheduled tooling reviews that `rig doctor` cannot drive |
| A learning loop writes packs or the overlay, never compiled files | Lessons need a pull request | Never. Compiled files are rig's (`E_DRIFT`). |
| Effect runs reuse an outside harness instead of a `rig eval` | rig depends on gstack-evals and its run setup | gstack-evals cannot run a non-gstack unit, or its setup costs more than a small rig-owned runner |

## Uncertainties

| Uncertainty | Score | Reason | Blast radius | Resolution path |
|---|---|---|---|---|
| Product and business stage names fit real teams (P1) | 5 | gstack does not split product and business. The mapping is ours. | Steps get renamed after teams use them | Team review of the stage table |
| One mode skill serves four domains (P2) | 6 | The shell is short, but the hub alone is 5,336 tokens, and the model reads it on every `/craft` | Split into one mode per domain | Count the tokens of the shell, the hub and one domain file in the first seed |
| The model applies "the domain file wins over the hub" | 6 | The rule is prose in the shell. No code enforces it. | A team fill does not change what the model runs | `mode` live lane 6. A fill sets `eng:design` to a fixture unit. Pass when the transcript reads the fixture unit and not `architect`. |
| Order-free hooks are enough (P3) | 6 | No real pair of dependent hooks has appeared yet | Hook lists need an order field | Collect hook pairs from team configs |
| Leaf skills work on Codex and omp through a rig adapter | 4 | pstack ships an adapter for Claude Code only. The Codex and omp adapters are rig-authored and unmeasured. | Leaves misuse tool names on Codex and omp | `mode` live lane 7. `$architect` typed on Codex reads the adapter |
| gstack-evals runs a rig unit outside the gstack ecosystem | 4 | Its call needs a spend-ledger item and `gstack-approvals`. `skill-eval` takes skill folders and answers "no loss", not "helps". A playbook is not a skill folder. On 2026-11-10 at `c86552e`, `skill-eval --example` passed on the keyless fake host. `doctor --host claude` exited 2 on three missing items: a Docker daemon, `ANTHROPIC_API_KEY` (the metering proxy bills the API, not a Claude Code login), and `gstack-approvals`, which comes with a gstack install. | L2 needs a small rig-owned runner | One outcome-lane dry run on a skill-shaped pstack unit such as `how`, with Docker running and a capped API key |
| A public bug-fix pool fits a pstack playbook | 6 | Its tasks are single-repo fixes. pstack playbooks also steer delegation and PR work, which such tasks do not exercise. | The pilot reads `not distinguished` for a reason that is not the playbook | Read the pilot transcripts for which playbook steps ran |
| A playbook arm differs from its masked arm only by the playbook | 4 | `disable` cannot name a playbook, so the arm needs a re-vendor with `--exclude` and a `mode.playbooks` edit, and the vendored hub still lists the playbook. | A `not distinguished` or `helps` result that comes from the hub line or the pack edit | Probe: run `rig plan` on the `--exclude` build. Pass when no block remains and the diff against the full pack is the file and its `mode.playbooks` entry. Then read the `without` transcripts for a model that looks for the missing playbook. |

Overall confidence: 7 of 10 for the concept. The deterministic seed path is 8 of 10. It rests on code that exists today and on the prototype in Appendix A of the first-seed design.
