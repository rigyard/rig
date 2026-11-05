# Run multi-step work with /craft

In this page you start multi-step work with the mode skill `craft`. You see which files rig installs for it, how a pack supplies its hub, playbooks and adapter, and how your `rig.json` changes a step. At the end you can read each block that the mode compile prints.

## Type the mode skill

Type `/craft` in Claude Code and `$craft` in Codex. Cursor and omp should take `/craft` too. The live lanes of `test/live/mode.test.ts` record the form that works. An optional first argument names a domain:

```text
/craft eng: design the boundary between the parser and the renderer
```

rig has four domains: business (`biz`), product (`prod`), engineering (`eng`) and upkeep (`upk`). `packs/core/domains.json` lists them with their stages. Without the argument, the model picks the domain from your task. The rig frame tells the model about `craft` in one line, in the typed form of each harness. The form comes from `skill_prefix` in `targets/<harness>.json`: `/craft` in Claude Code, Cursor and omp, `$craft` in Codex. In Claude Code the line reads ``For multi-step work, type `/craft`, optionally with a domain: `/craft eng: ...`.``, and in Codex it says `$craft` at both places.

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

The shell tells the model to read its adapter section first, then `hub.md` in full, then the domain file. Where a domain file and the hub name the same step, the domain file wins. A pack that adopts no `hub.md` gives a shell with no hub step.

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

The checkout enables no pack with a hub yet, so on main `rig plan` lists the shell, the four domain files and the adapter only.

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

A hook list in `fill` replaces the pack list at the same address. A trigger with a `domain` goes in that domain file, and a trigger with none goes in the shell. `disable` removes a unit from every step. `auto` lists the units to which rig adds no hide switch, so the model may pick them. rig does not rewrite upstream frontmatter, so a unit whose source already sets the hide key of a harness, such as `disable-model-invocation: true`, stays hidden on that harness. `rig plan` then prints `info <unit> stays hidden on <harness>: its source sets <key>`. `auto` is empty by default, and an overlay `auto` adds to the repo list.

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
block E_ARTIFACT_DANGLING prd: the artifact brief of pack fixture requires prd, which no artifact writes
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
