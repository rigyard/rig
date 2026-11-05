# rig v1 concept

Status: concept, agreed with the user over five review iterations on 2026-11-05. It replaces the v0 direction "rig links an installed pstack". The ADRs in `docs/decisions/` are history until a decision here or in [rig-v1-first-seed.md](rig-v1-first-seed.md) confirms or replaces them.

## What rig is

rig is a seeder. It takes a skeleton of how agent work flows (from pstack and gstack), a default configuration pinned to exact upstream commits, and a team's own choices. It compiles them into one set of files per coding-agent harness: Claude Code, Codex, Cursor and omp.

rig solves two problems. The first is user-global skills. A repo's `AGENTS.md` and repo skills cover one project, but each person also keeps global skills in `~/.claude`, `~/.cursor`, `~/.codex` and `~/.omp`, often on two harnesses at work and two at home. rig seeds the same set into all four from one config repo, and lets you check in one place that pstack, gstack and your own skills still work together after a release of a plugin, a harness or a model. The second is supply-chain risk. An automatic update of a skill or plugin can bring a vulnerability or a malicious prompt. In rig no skill updates itself. A new version enters only through `rig pin check`, the gate and a review in the team's config repo.

Three rules carry the design:

1. rig owns its mode. rig ports pstack (MIT) at one commit and compiles its own mode skill, `rig-mode`, from data. pstack's hub skill is not installed.
2. Seeding is deterministic. The same committed config gives the same files in every fresh HOME, on every machine, with no language model in the path. A personal overlay is the only per-person input.
3. Domains talk through artifacts. Business, product, engineering and upkeep steps hand work to each other only through repo files. The end-to-end process therefore does not depend on the harness.

## Assumptions for review

These assumptions open the review. Cite them by number.

Product assumptions:

| # | Assumption |
|---|---|
| Z1 | rig seeds from a pinned upstream commit. It does not fork pstack or gstack. Vendored skills stay byte-identical to the commit. Only the mode data (step table and router, derived from pstack's hub) and the gstack ports are rig's own. A maintainer moves the pin on purpose. |
| Z2 | One mode skill drives four domains. They are business, product, engineering and upkeep. Each domain is a `domain` label on playbooks, not a new noun. |
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
| mode | The mode skill. One compiled `SKILL.md` per harness: situational triggers, principles index, autonomy rules, model roles, playbook router, step fills, artifact contract. | `rig-mode/SKILL.md` |
| playbook | Ordered steps for one kind of task, labeled with a domain. | pstack `bug-fix.md`, domain engineering |
| skill | A unit a harness loads. Most are hidden and run only when the mode skill or a playbook names them. | pstack `how`, gstack-derived `office-hours` |
| principle | A skill that states one rule and when it applies. The mode skill indexes them. | `principle-prove-it-works` |
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
| Upkeep | `upk` | upkeep, retire | none yet |

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

A trigger tied to a step becomes a hook. pstack's "Before commit, run deslop" becomes `eng:ship.before`. A situational trigger, such as "building a CLI", stays a mode trigger. On Claude Code a hook may later compile to a harness event. On other harnesses it is prose in the mode skill.

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
| 1. Skeleton | rig | `packs/core/` in the rig repo, sealed by tree hash | mode skill template, domain table, frame, terms |
| 2. Default config | rig | `rig.json`, `rig.lock.json`, `packs/*` in the rig repo | pstack, cursor-team-kit `deslop`, cli-for-agents, the gstack-derived product pack, pinned at full commits, plus default fills |
| 3. Team config | the team | a fork of layer 2, shared by git | team packs, team fills, team pins |
| 4. Personal overlay | one person | `~/.config/rig/rig.json` and its packs | personal fills and packs |

A team shares its whole seeded version by sharing the config repo. Another team forks it, agrees on its own fills, and sends fixes back by pull request.

## Pinning and seeding

### Two kinds of upstream content

| Kind | What | How rig gets it | Example |
|---|---|---|---|
| Vendored | upstream bytes that work as they are | `rig pack add` fetches a full commit, copies the chosen paths, records a tree hash | pstack leaf skills, playbooks, `deslop`, `cli-for-agents` |
| Ported | rig-authored content derived from upstream prose | an agent or a person writes it once, the lock records the upstream sources it derives from | the mode skill data (from pstack's hub), the product pack (from gstack `office-hours`) |

Both kinds live as committed files in the config repo. The difference is who wrote the bytes.

pstack leaves can be vendored. They are prose, and the harness agent maps their Cursor tool names at run time through an adapter document. pstack already ships such an adapter for Claude Code (`docs/harness/claude-code.md`).

gstack skills cannot be vendored as they are. Each one first runs `~/.claude/skills/gstack/bin/gstack-skill-start`, calls up to 18 gstack binaries, and writes state under `~/.gstack`. rig ports the ones it needs. A port strips the runtime calls and points state at repo files. `packs/product` already does this for `office-hours`.

### Is seeding deterministic?

Yes. A CI runner with no language model produces byte-identical output from the committed config repo.

| Step | Needs network | Needs an agent |
|---|---|---|
| `rig plan`, `rig apply`, `rig apply --undo`, `rig doctor` | no | no |
| `rig pack add`, `rig pin check`, `rig pin set` | git and OSV | no |
| Re-port after an upstream source of a port changed | no | yes, or a person |

One step needs judgment. It is the re-port after an upstream source of a port changed. For example, pstack's hub gains a trigger, or gstack's `office-hours` template changes. A deterministic check finds this case. The lock records the tree hash of every port source and the hash a maintainer last reviewed. `rig plan` blocks with `E_PORT_STALE` until they match again.

The maintainer runs the port in the config repo with the repo skill `/rig-port`. It reads `rig pin check <pack> --diff`, edits the port, runs `rig plan` until only `E_PORT_STALE` remains, then runs `rig pin set <pack> --ported`. The result is a pull request. CI checks it without a model. Users who seed never run the port.

When a pin moves and no port source changed, the CLI alone moves it. The first seed shows this path. It adopts the product pack at gstack `b244e6d`, where the port was made, and moves it to `b406820` with `rig pin check` and `rig pin set`, because `office-hours` did not change between them.

### Maintainer commands

| Command | Maintainer role |
|---|---|
| `rig pack add` | receive a part from a supplier, at a full commit |
| `rig pin check` | inspect a newer part before you accept it |
| `rig pin set` | accept the newer part |
| `rig plan` | draw the assembly plan, gate every file |
| `rig apply` | mount the rig on each hull (harness) |
| `rig apply --undo` | take one run off again |
| `rig doctor` | survey the hulls for drift |

## Roadmap

| Phase | Goal | Done when |
|---|---|---|
| 1. Subtract | Remove the v0 provider path: workflow providers, slots, `/craft`, installed-plugin pins. | `npm test` passes with no provider code. |
| 2. Mechanisms | Vendoring with root and excludes, the links check, the mode skill compiler, port records. | Each mechanism passes its unit and synthetic end-to-end tests. |
| 3. First seed | The default config seeded from pstack `2776ddd` and gstack `b406820` into all four harnesses. | The first-seed end-to-end test passes, and a live Claude Code run uses the mode skill. |
| 4. Breadth | Codex and omp adapters, business steps, an OpenSpec artifact pack, a team config repo template, more gstack ports. | Each item has its own plan. |

The program plan for phases 1 to 3 is [docs/plan/v1-first-seed-prs.md](../plan/v1-first-seed-prs.md).

## Trade-off register

| Decision | Cost | Comes back when |
|---|---|---|
| Port the hub once (C1) instead of parsing it at every seed | A hub change needs a re-port | The hub keeps its grammar for a year and re-ports become routine |
| Steps are rig stages, not bindings to numbered playbook steps | A slot cannot change a vendored playbook's text | A team needs to replace one step inside a pstack playbook |
| Hooks are order-free | Two hooks cannot depend on each other | A real pair of hooks needs an order (P3) |
| Exclude scripts at vendor time | The `show-me-your-work` skill and the `babysit`, `multi-phase-plan` and `worktree-cleanup` playbooks lose their helper scripts | The gate learns to approve a reviewed script |
| No `read_at` on artifacts | Ground reads every artifact | A repo has so many artifacts that ground floods its context |
| No separate lifecycle layer around rig | Two cycles share one tool: the work's lifecycle (domains) and the tooling's lifecycle (the maintainer commands) | A team needs scheduled tooling reviews that `rig doctor` cannot drive |
| A learning loop writes packs or the overlay, never compiled files | Lessons need a pull request | Never. Compiled files are rig's (`E_DRIFT`). |

## Uncertainties

| Uncertainty | Score | Reason | Blast radius | Resolution path |
|---|---|---|---|---|
| Product and business stage names fit real teams (P1) | 5 | gstack does not split product and business. The mapping is ours. | Steps get renamed after teams use them | Team review of the stage table |
| One mode skill serves four domains (P2) | 6 | A mode skill with every domain may exceed the 5,000-token skill budget | Split into one mode per domain | Measure the compiled mode skill in the first seed |
| Order-free hooks are enough (P3) | 6 | No real pair of dependent hooks has appeared yet | Hook lists need an order field | Collect hook pairs from team configs |
| Leaf skills work on Codex and omp through a rig adapter | 4 | pstack ships an adapter for Claude Code only | Leaves misuse tool names on Codex and omp | Live runs after the `adapter` work in phase 4 |

Overall confidence: 7 of 10 for the concept. The deterministic seed path is 8 of 10. It rests on code that exists today and on the prototype in Appendix A of the first-seed design.
