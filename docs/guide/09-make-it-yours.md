# Make it yours

In this page you change the stack without forking it. You put your additions in the overlay, you use the four customization operations, and you learn which errors stop a change that would hide or break another unit. You also see how a new harness arrives as a data file, and which parts of rig stay sealed.

## Use the overlay

The overlay lives at `~/.config/rig` (or `$XDG_CONFIG_HOME/rig`). It has the same layout as the repo: `rig.json`, `packs/`, `providers/`, `models/`, `rig.lock.json` and `audit.allow.json`. Keep it in its own git repository. Then the repo stays generic, and your private packs, providers and model ids stay in the overlay ([decision 0002](../decisions/0002-generic-repo-private-overlay.md)).

The overlay only adds. It can add packs, providers, list entries, tier cells, roles and slot fillers. It cannot change a value that the repo sets:

```text
mkdir -p ~/.config/rig
echo '{"schema": 1, "default_provider": "openspec"}' > ~/.config/rig/rig.json
rig plan
```

That plan exits 2 with `rig plan: E_OVERLAY_CONFLICT ~/.config/rig/rig.json: default_provider: the repo already sets this value; the overlay only adds`. A list entry that the repo already has, a tier cell, a role and a provider record in both roots fail the same way (tests under `overlay merge adds only` in `test/world.test.ts`).

## Disable a default unit

Add the unit id, `<pack>/<unit>`, to `disable` in the overlay `rig.json`:

```text
{"schema": 1, "disable": ["product/office-hours"]}
```

```text
rig plan
...
22 changes, 0 blocks
```

The same plan without the entry has 33 changes. The 11 missing lines are the `office-hours` skill files on Claude Code and Codex. An id that no listed pack contains blocks the plan:

```text
block E_UNKNOWN_UNIT disable names product/nothing, which no listed pack contains
```

## Fill a slot

The repo leaves both slots, `doc-review` and `second-opinion`, empty (`null`). The overlay fills one with a provider that it lists. [Pick and swap models](./07-models.md#fill-the-second-opinion-slot) shows a full `second-opinion` example. A slot takes one filler. When the repo already fills a slot, an overlay filler fails with `E_SLOT_TWICE` (test `a second filler is E_SLOT_TWICE` in `test/world.test.ts`). The overlay cannot empty a filled slot either.

## Add a pack

Put the pack under `~/.config/rig/packs/<name>/` and list it in the overlay `rig.json`. A pack holds `pack.json` plus units by layout: `skills/<name>/SKILL.md`, `commands/<name>.md`, `agents/<name>.md` and `rules/<name>.md`.

```text
~/.config/rig/packs/mine/pack.json          {"schema": 1, "name": "mine", "license": "MIT"}
~/.config/rig/packs/mine/skills/notes/SKILL.md
~/.config/rig/rig.json                      {"schema": 1, "packs": {"mine": {"harnesses": ["claude"]}}}
```

```text
rig plan
...
create  owned  claude  ~/.claude/skills/notes/SKILL.md                                 mine/notes
34 changes, 0 blocks
```

Give the pack a `license`. Without one, the gate blocks with `block license mine/pack.json: license missing` and prints an ack stanza. To vendor a pack from a public repository into the overlay, use `rig pack add <repo> --sha <sha> --path <path> --into overlay` ([Add packs and pin plugins](./04-packs-and-pins.md)).

Two units may not install one name. When `mine` adds a skill named `office-hours`, the plan blocks:

```text
block E_CLASH product/office-hours and mine/office-hours install the same name office-hours; declare replaces in one of them, or disable one
```

Skills and commands share one name space, because Claude Code runs both as `/name`. An agent and a skill with the same name do not clash. rig has no precedence order, so you resolve each clash yourself.

## Replace a unit

To use your own version of a pack unit, declare `replaces` in your pack's `pack.json`:

```text
{"schema": 1, "name": "mine", "license": "MIT",
 "units": {"office-hours": {"replaces": "product/office-hours"}}}
```

```text
rig plan
...
create  owned  claude  ~/.claude/skills/office-hours/SKILL.md                  mine/office-hours
24 changes, 0 blocks
```

The count includes the `notes` skill from above. The replaced unit leaves the stack on every harness. Your unit installs where its own pack entry allows, here Claude Code only. Two units that replace one target fail with `E_CLASH`. A `replaces` that names a unit that does not exist is `E_UNKNOWN_UNIT`.

## Add a harness as data

A harness is a target record, `targets/<h>.json`. Section 1, Case C of the [architecture](../design/rig-architecture.md) walks through a new harness. Targets load from the repo only, so this is a repo change, not an overlay change:

1. Write `targets/<h>.json`: the dirs the harness reads, the unit formats, the instructions file, the transcript root, or `null` where the harness has none.
2. Add a `<h>` row to each term in `packs/core/terms.json`. A pack text that uses a term with no row fails with `E_TERM_MISSING`, so the build names each missing row.
3. `terms.json` is part of core, so reseal it with `rig pin check core` and `rig pin set core`.
4. Add `<h>` to `harnesses` in `rig.json`, then run `rig plan` and `rig apply`.

A harness whose format fits no value that the schema knows, for example a new agent file format, needs a new renderer in `lib/targets/`. That is a code change.

## Know what stays sealed

The core pack, `packs/core/`, is sealed. It holds the frame (`frame.md` with the principles index `principles.md`), `/craft`, the alias template, the two slot stubs and `terms.json`. `rig.lock.json` records the hash of the core tree, and the gate blocks a plan whose core tree differs from it ([decision 0005](../decisions/0005-sealed-core.md)).

- `disable` and `replaces` cannot name a core unit. Both fail with `E_SCHEMA`, for example `disable[0]: core units are sealed and cannot be named here`.
- A pack unit with a core name fails with `E_CORE_SHADOW`, for example `mine/craft uses the core name craft (core/craft)`.
- An overlay `packs/core/` directory fails with `E_OVERLAY_CONFLICT`.

The frame's text is fixed, but you control what it renders. Its lines take `default_provider`, `providers`, `slots` and the model table from your configuration. The principles index points at the principle leaves of the pinned pstack plugin. On main, pstack has no locked version in `rig.lock.json` yet, so `rig plan` warns `pin pstack/rig.lock.json`. That is an open decision ([assumptions and open questions](../assumptions-and-open-questions.md)).

Next: [Recipes and pitfalls](./10-recipes-and-pitfalls.md).
