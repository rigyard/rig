# Run multi-step work with /craft

In this page you start multi-step work with the mode skill `craft`. You see which files rig installs for it, how a pack supplies its hub, playbooks and adapter, and how your `rig.json` changes a step. At the end you can read each block that the mode compile prints.

## Type the mode skill

Type `/craft` in Claude Code and Cursor, and `$craft` in Codex. The omp docs name `/skill:<name>` as the typed form of a skill, so `/skill:craft` there. The live lanes of `test/live/mode.test.ts` and `test/live/first-seed.test.ts` record the form that works. An optional first argument names a domain:

```text
/craft eng: design the boundary between the parser and the renderer
```

rig has four domains: business (`biz`), product (`prod`), engineering (`eng`) and upkeep (`upk`). `packs/core/domains.json` lists them with their stages. Without the argument, the model picks the domain from your task. The rig frame tells the model about `craft` in one line, in the typed form of each harness. The form comes from `skill_prefix` in `targets/<harness>.json`. It is `/craft` in Claude Code and Cursor, `$craft` in Codex, and `/skill:craft` in omp, because omp 18.16 runs a skill from a prompt only in the `/skill:<name>` form. In Claude Code the line reads ``For multi-step work, type `/craft`, optionally with a domain: `/craft eng: ...`.``. Codex says `$craft` and omp says `/skill:craft` at both places. The `craft` skill itself gives the domain argument as `eng: ...`, with no typed form, because every harness reads the same file.

`craft` carries the hide switch of every harness, so the model never starts it on its own. You start it.

## Know what rig installs

rig places a `craft/` dir in every skill dir that holds a vendored leaf, so the anchor of each leaf resolves, and each harness still reads one `craft`. A pack that `rig.json` limits to one harness can add a dir. When no placement gives both, `rig plan` blocks with `E_READSET` and names the packs whose `harnesses` lists to align. Each `craft/` dir holds:

| Path | Source |
|---|---|
| `craft/SKILL.md` | the shell, from `packs/core/skills/craft/SKILL.md` |
| `craft/hub.md` | the hub of a pack, byte for byte |
| `craft/playbooks/*.md` | the playbooks of a pack, byte for byte |
| `craft/references/bugbot-triage.md` | a pack reference, byte for byte |
| `craft/references/<domain>.md` | one file per domain, from `domains.json`, pack `mode` data and `rig.json` `fill` |
| `craft/references/adapter.md` | one section per harness that reads the dir |

The shell tells the model to read its adapter section first, then `hub.md` in full, then the domain file. Hub triggers are keyed by situation, not by step. When a step's fill or pack hook restates a hub trigger, the domain file prints one line under that step, `Replaces the hub trigger: "<trigger text>"`, and the model runs the step in place of that trigger. The trigger text comes from `mode.hub_triggers` in the pack that ships the hub, keyed by step or hook address, verbatim from a `- ` line of `hub.md`. A text that is no such line fails with `E_MODE_REF`. The seeded pstack pack names four: `eng:ground` (`how`), `eng:design` (`architect`), `eng:review.before` (`no-comments`) and `eng:ship.before` (`deslop`). An address with no fill and no hook prints no line, so its hub trigger still applies.

Each domain file says where to start. A domain with a playbook or an artifact tells the model to follow the playbook that the hub selects. If the hub selects no playbook, the model skips each step whose artifact for this task already exists and starts at the first step left. A domain with neither tells the model to start at the first step. A pack that adopts no `hub.md` gives a shell with no hub step.

With a pack that ships a hub and one playbook, `rig plan` lists these files for Claude Code (`test/mode.test.ts`, "with the fixture pack, rig plan plans the shell, the hub, the playbook, one file per domain and the adapter"):

```text
create  owned  claude  ~/.claude/skills/craft/SKILL.md                                 core/craft
create  owned  claude  ~/.claude/skills/craft/references/business.md                   core/craft
create  owned  claude  ~/.claude/skills/craft/references/product.md                    core/craft
create  owned  claude  ~/.claude/skills/craft/references/engineering.md                core/craft
create  owned  claude  ~/.claude/skills/craft/references/upkeep.md                     core/craft
create  owned  claude  ~/.claude/skills/craft/references/adapter.md                    core/craft
create  owned  claude  ~/.claude/skills/craft/hub.md                                   core/craft
create  owned  claude  ~/.claude/skills/craft/playbooks/bug-fix.md                     core/craft
create  owned  claude  ~/.claude/skills/craft/references/bugbot-triage.md              core/craft
```

The checkout seeds pstack, so on main each `craft/` dir also holds pstack's hub, its 23 playbooks and `bugbot-triage.md`. rig writes one `craft/` dir in `~/.claude/skills`, for Claude Code and Cursor, and one in `~/.agents/skills`, for Codex, omp and Cursor. Cursor keeps the first copy of a name, so it reads one.

## Know the seeded default

The seed behaves as pstack does by default, because the model reads pstack's own hub. `rig.json` restates four step triggers of the hub as fills, so the domain file and the hub agree:

| Hub trigger | Step | Unit | Set in |
|---|---|---|---|
| "Nontrivial change, architecture decision, or 'are we sure?'" | `eng:ground` | `pstack/how` | `rig.json` `fill` |
| "Code crossing a function boundary" | `eng:design` | `pstack/architect` | `rig.json` `fill` |
| "Before review" | `eng:review.before` | `pstack/no-comments` | `packs/pstack/pack.json` `mode.hooks` |
| "Before commit" | `eng:ship.before` | `cursor-team-kit/deslop` | `rig.json` `fill` |

`rig.json` also adds one trigger to the engineering domain: when you build or change a CLI, use `cli-for-agent/cli-for-agents`. `prod:discover` runs `product/office-hours`, which writes the `brief` artifact to `docs/designs/<slug>.md` in your repository.

`rig.json` restates four more hub triggers with no domain. rig renders them into the frame, and every harness loads the frame in every session. So these four apply with or without `/craft`:

| Hub trigger | Unit |
|---|---|
| "Any prose surface, your reply to the user included" | `pstack/unslop` |
| "Docs, RFCs, readmes, PR descriptions, or commit messages" | `pstack/technical-writing` |
| "Before commit" | `cursor-team-kit/deslop` |
| "Before review" | `pstack/no-comments` |

The hub's other triggers stay in the hub. `auto` is empty, so every skill stays hidden until the hub, a domain file, a frame trigger or you name it.

Each pstack playbook carries a domain label in `packs/pstack/pack.json`. `worktree-cleanup` is upkeep, and the other 22 are engineering.

pstack skills use Cursor tool names. `craft/references/adapter.md` maps them per harness:

| Harness | Adapter source |
|---|---|
| Claude Code | a port of upstream `pstack/docs/harness/claude-code.md` to rig's layout, for example `Task` to `Agent` and `/pstack:<name>` to `/<name>` |
| Codex | rig-authored from the Codex 0.166.0 tool names, for example `Task` to `spawn_agent` and a todolist to `update_plan` |
| Cursor | rig-authored. The tool names stay. Only the install paths change. |
| omp | rig-authored from the omp 18.16.0 tool names, for example `Task` to `task` and `AskQuestion` to `ask` |

A pin move that changes `docs/harness/claude-code.md` upstream blocks `rig plan` with `E_PORT_STALE pstack` until a maintainer updates the Claude adapter and runs `rig pin set pstack --ported`.

## Supply mode data from a pack

A pack carries its part of the mode in `pack.json` `mode`. Drop the pack and its part drops with it:

```json
{
  "mode": {
    "adopt": {
      "hub.md": { "from": "skills/poteto-mode/SKILL.md" },
      "playbooks/": { "from": "skills/poteto-mode/playbooks/" },
      "references/bugbot-triage.md": { "from": "skills/poteto-mode/references/bugbot-triage.md" }
    },
    "playbooks": { "bug-fix": { "domain": "engineering", "file": "skills/poteto-mode/playbooks/bug-fix.md" } },
    "artifacts": {},
    "hooks": { "eng:review.before": ["pstack/no-comments"] },
    "adapter": { "claude": "Map `Task` to the `Agent` tool. ..." }
  }
}
```

- `adopt` maps an install path under `craft/` to a file or a folder of the pack. A folder key ends in `/`. The key `hub.md` marks the hub. An adopted file gives no unit of its own, so `skills/poteto-mode/` installs no skill.
- `playbooks` gives each adopted playbook a domain label.
- `artifacts` names the repo files that one step writes and a later step requires, with `generates`, `write_at`, `instruction` and `requires`.
- `hooks` sets the default `before` and `after` lists of a step.
- `adapter` holds Markdown per harness id. rig writes it as that harness's section of `craft/references/adapter.md`. A harness with no text gets a section that says the skills use its own names.
- `triggers` and `sections` serve a pack with no hub.

Prose fields may name a skill as `{{skill:<pack>/<unit>}}`. rig renders it as a link relative to each copy. The first-seed design has the full type: [rig-v1-first-seed.md](../design/rig-v1-first-seed.md).

## Fill a step from rig.json

A step has a `before` list, one `slot` and an `after` list. `fill` addresses the slot with `<prefix>:<stage>`, a hook list with `<prefix>:<stage>.before` or `.after`, and adds situational triggers with `triggers`:

```json
{
  "fill": {
    "eng:design": "pstack/architect",
    "eng:ship.before": ["cursor-team-kit/deslop"],
    "triggers": [{ "when": "Building or changing a CLI", "use": "cli-for-agent/cli-for-agents", "domain": "engineering" }]
  },
  "auto": []
}
```

A hook list in `fill` replaces the pack list at the same address. A trigger with a `domain` goes in that domain file. A trigger with no domain goes in the frame, described below. `disable` removes a unit from every step. `auto` lists the units to which rig adds no hide switch, so the model may pick them. rig does not rewrite upstream frontmatter, so a unit whose source already sets the hide key of a harness, such as `disable-model-invocation: true`, stays hidden on that harness. `rig plan` then prints `info <unit> stays hidden on <harness>: its source sets <key>`. `auto` is empty by default, and an overlay `auto` adds to the repo list.

The frame of each harness lists the triggers with no domain under `Triggers, in every task:`. Each line has the form `<when>: read <path> and apply it.` The path names the copy of the unit in the first read dir of the harness that holds one, such as `~/.claude/skills/unslop/SKILL.md` for Claude Code. The model opens that file by its path, so the unit can stay hidden. A disabled unit has no line. A unit with no copy in the read dirs of a harness has no line there, and `rig plan` prints an `info absent` line for it. The shell section "Triggers with no domain" points to the frame and lists only the pack triggers with no domain (`test/frame.test.ts`, "each frame holds the four hub triggers, each a path to the owned SKILL.md of its unit in the read set of the harness").

## Read the vendored leaves

Each `SKILL.md` copy of a vendored pack gets two lines after its frontmatter:

```text
Read the section for your harness in [the rig adapter](../craft/references/adapter.md) once per session before you follow this skill.
```

The second line is empty. The pack bytes stay as upstream wrote them. An authored pack such as `product` gets no anchor.

## Read the mode blocks

The mode compile blocks `rig plan` when the mode data does not hold together. These blocks are not ackable. `rig plan` prints the lines below for the cases of `test/mode.test.ts`.

An unknown step address:

```text
block E_FILL_UNKNOWN eng:shipit: rig.json fill.eng:shipit is no step address of packs/core/domains.json
```

An artifact that requires one that no pack writes:

```text
block E_ARTIFACT_DANGLING prd: the artifact sketch of pack fixture requires prd, which no artifact writes
```

An adopted playbook with no domain label:

```text
block E_PLAYBOOK_UNLABELED fixture/skills/poteto-mode/playbooks/feature.md: the adopted playbook craft/playbooks/feature.md has no entry in packs/fixture/pack.json mode.playbooks
```

A vendored leaf with no frontmatter close:

```text
block E_ANCHOR_MISSING unit fixture/architect: SKILL.md has no frontmatter close, so rig cannot insert the adapter anchor
```

`E_MODE_REF` names a fill, a hook, an `auto` entry or a `{{skill:...}}` that names no kept unit. `E_CLASH` names two packs that adopt one path, or an adopt onto a path that rig renders.

The gate check `mode` reads the hub and the playbooks of the composed mode skill. It blocks when they name a unit, as `**x** skill`, `` `/x` `` or /x, that no kept unit has. `rig pack add` and `rig pin check` gate one pack tree with no composed mode, so they do not run this check, and `rig pin set` runs no gate. A pin move that brings a new name passes `rig pin check` and `rig pin set`, and blocks at the next `rig plan` until you vendor the unit or ack the name:

```text
block mode fixture/skills/poteto-mode/SKILL.md: E_MODE_NAME nope at line 23: no kept unit has this name; vendor the unit, or ack the name
```

The ack holds the name, so it does not clear a second unknown name in the same file. [Pass the gate](./03-the-gate.md) shows how to ack a finding.

Next: [Pick and swap models](./07-models.md).
