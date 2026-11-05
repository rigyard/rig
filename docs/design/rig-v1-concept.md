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
| P6 | What fills the `retire` step? |

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

## Roadmap

| Phase | Goal | Done when |
|---|---|---|
| 1. Subtract | Remove the v0 provider path: workflow providers, slots, the v0 `/craft` provider command, installed-plugin pins. | `npm test` passes with no provider code. |
| 2. Mechanisms | Vendoring with root and excludes, the links check, the mode skill renderer, port records. | Each mechanism passes its unit and synthetic end-to-end tests. |
| 3. First seed | The default config seeded from pstack `2776ddd` and gstack `b406820` into all four harnesses. | The first-seed end-to-end test passes, and a live Claude Code run uses the mode skill. |
| 4. Breadth | Business steps, an OpenSpec artifact pack, a team config repo template, more gstack ports. | Each item has its own plan. |

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

## Uncertainties

| Uncertainty | Score | Reason | Blast radius | Resolution path |
|---|---|---|---|---|
| Product and business stage names fit real teams (P1) | 5 | gstack does not split product and business. The mapping is ours. | Steps get renamed after teams use them | Team review of the stage table |
| One mode skill serves four domains (P2) | 6 | The shell is short, but the hub alone is 5,336 tokens, and the model reads it on every `/craft` | Split into one mode per domain | Count the tokens of the shell, the hub and one domain file in the first seed |
| The model applies "the domain file wins over the hub" | 6 | The rule is prose in the shell. No code enforces it. | A team fill does not change what the model runs | `mode` live lane 6. A fill sets `eng:design` to a fixture unit. Pass when the transcript reads the fixture unit and not `architect`. |
| Order-free hooks are enough (P3) | 6 | No real pair of dependent hooks has appeared yet | Hook lists need an order field | Collect hook pairs from team configs |
| Leaf skills work on Codex and omp through a rig adapter | 4 | pstack ships an adapter for Claude Code only. The Codex and omp adapters are rig-authored and unmeasured. | Leaves misuse tool names on Codex and omp | `mode` live lane 7. `$architect` typed on Codex reads the adapter |

Overall confidence: 7 of 10 for the concept. The deterministic seed path is 8 of 10. It rests on code that exists today and on the prototype in Appendix A of the first-seed design.
