# Make it yours

In this page you change the stack without forking it. You put your additions in the overlay, you use the four customization operations, and you learn which errors stop a change that would hide or break another unit. You also see how a new harness arrives as a data file, and which parts of rig stay sealed.

## Use the overlay

The overlay lives at `~/.config/rig` (or `$XDG_CONFIG_HOME/rig`). It has the same layout as the repo: `rig.json`, `packs/`, `models/`, `rig.lock.json` and `audit.allow.json`. Keep it in its own git repository. Then the repo stays generic, and your private packs and model ids stay in the overlay ([decision 0002](../decisions/0002-generic-repo-private-overlay.md)).

The overlay only adds. It can add packs, list entries, tier cells and roles. It cannot change a value that the repo sets. One key is the exception: `metrics.session_hook`. Your overlay value wins over the repo's, because the hook writes only into your own HOME:

```text
mkdir -p ~/.config/rig
echo '{"schema": 2, "metrics": {"session_hook": true}}' > ~/.config/rig/rig.json
rig plan
```

That plan shows the `json-element` line for `~/.claude/settings.json`, even when the repo's `rig.json` sets `session_hook` to `false`. Any other key that the repo sets fails with `E_OVERLAY_CONFLICT` and exit 2, for example `rig plan: E_OVERLAY_CONFLICT ~/.config/rig/rig.json: fill["eng:ground"]: the repo already sets this value; the overlay only adds`. A list entry that the repo already has, a tier cell and a role fail the same way (tests under `overlay merge adds only` in `test/world.test.ts`). The list of exceptions is `OVERLAY_OVERRIDES` in `lib/world/merge.ts`.

## Disable a default unit

Add the unit id, `<pack>/<unit>`, to `disable` in the overlay `rig.json`:

```text
{"schema": 2, "disable": ["product/office-hours"]}
```

```text
rig plan
...
<n> changes, 0 blocks
```

The same plan without the entry has 279 changes. The 13 missing lines are the `office-hours` skill files on Claude Code and Codex. An id that no listed pack contains blocks the plan:

```text
block E_UNKNOWN_UNIT disable names product/nothing, which no listed pack contains
```

The repo `rig.json` disables `pstack/poteto-agent` and `pstack/comment-sicko` this way. The core agents `rig-agent` and `rig-janitor` do their jobs, and the adapter of each harness maps the pstack names to them. To change their model or effort, edit the `agents` consumer in `models/roles.json`, then run `rig apply`. rig refuses `xhigh`, `max` and fast models for agent definitions: the plan blocks with `E_AGENT_MODEL` (guide 7).

The hub and the playbooks of the mode skill are upstream text, so they can still name a unit that you disabled. That is not a block. The `mode` check prints an `info mode` line with the unit and the line, and the `craft` shell tells the model to skip a skill that is not installed and write one line that names it. A `rig.json` `fill` or a pack hook that names the disabled unit is dropped, and `rig plan` prints an `info` line with its address. A name that matches no unit and is not disabled, such as an upstream rename, still blocks with `E_MODE_NAME`. `auto` is different: an `auto` entry that names a disabled unit is `E_MODE_REF`.

## Add a pack

Put the pack under `~/.config/rig/packs/<name>/` and list it in the overlay `rig.json`. A pack holds `pack.json` plus units by layout: `skills/<name>/SKILL.md`, `commands/<name>.md`, `agents/<name>.md` and `rules/<name>.md`.

```text
~/.config/rig/packs/mine/pack.json          {"schema": 2, "name": "mine", "license": "MIT"}
~/.config/rig/packs/mine/skills/notes/SKILL.md
~/.config/rig/rig.json                      {"schema": 2, "packs": {"mine": {"harnesses": ["claude"]}}}
```

Every pack needs a lock entry, so this plan blocks with `block pin mine/.: pack mine has no lock entry; rig pack add writes the entry`. Commit the pack in the git repository of your overlay, then adopt it from that commit and attest it:

```text
rig pack add file:///home/you/.config/rig --sha <full commit of the overlay repo> --name mine --port packs/mine --into overlay
rig pin set mine --ported
rig plan
```

```text
...
create  owned  claude  ~/.claude/skills/notes/SKILL.md                                                           mine/notes
<n> changes, 0 blocks
```

After each edit of the pack, run `rig pin set mine --ported` again. It hashes the folder from disk and needs no network.

Give the pack a `license`. Without one, the gate blocks with `block license mine/pack.json: license missing` and prints an ack stanza. To vendor a pack from a public repository into the overlay, use `rig pack add <repo> --sha <sha> --root <dir> --path . --into overlay` ([Add packs and seal core](./04-packs-and-pins.md)).

Two units may not install one name. When `mine` adds a skill named `office-hours`, the plan blocks:

```text
block E_CLASH product/office-hours and mine/office-hours install the same name office-hours; declare replaces in one of them, or disable one
```

Skills and commands share one name space, because Claude Code runs both as `/name`. An agent and a skill with the same name do not clash. rig has no precedence order, so you resolve each clash yourself.

## Replace a unit

To use your own version of a pack unit, declare `replaces` in your pack's `pack.json`:

```text
{"schema": 2, "name": "mine", "license": "MIT",
 "units": {"office-hours": {"replaces": "product/office-hours"}}}
```

```text
rig plan
...
create  owned  claude  ~/.claude/skills/office-hours/SKILL.md                                                    mine/office-hours
<n> changes, 0 blocks
```

The count includes the `notes` skill from above. The replaced unit leaves the stack on every harness. Your unit installs where its own pack entry allows, here Claude Code only. Two units that replace one target fail with `E_CLASH`. A `replaces` that names a unit that does not exist is `E_UNKNOWN_UNIT`.

## Add a harness as data

A harness is a target record, `targets/<h>.json`. Section 1, Case C of the [architecture](../design/rig-architecture.md) walks through a new harness. Targets load from the repo only, so this is a repo change, not an overlay change:

1. Write `targets/<h>.json`: the dirs the harness reads, the unit formats, the instructions file, the transcript root, or `null` where the harness has none.
2. Add a `<h>` row to each term in `packs/core/terms.json`. A pack text that uses a term with no row fails with `E_TERM_MISSING`, so the build names each missing row.
3. `terms.json` is part of core, so reseal it with `rig pin check core` and `rig pin set core`.
4. Add `<h>` to `harnesses` in `rig.json`, then run `rig plan` and `rig apply`.

A harness whose format fits no value that the schema knows, for example a new agent file format, needs a new renderer in `lib/targets/`. That is a code change.

## Record what you know about a unit

A unit earns its place when it helps. The evidence ledger is the file where your team writes down what it knows about each unit. rig reads the ledger in one place, `rig doctor`. The ledger changes no install, so a mistake in it never stops `rig plan` or `rig apply`.

The file is `evidence.json`, in the repo config root beside `rig.json`. rig does not read one in the overlay root. The file is optional:

```json
{
  "schema": 1,
  "units": {
    "pstack/principle-fix-root-causes": { "status": "helps", "source": "evals/fix-root-causes.md", "models": ["sonnet"], "date": "2026-11-11" },
    "cursor-team-kit/deslop": { "status": "safety", "source": "docs/why-deslop.md" }
  }
}
```

A row has these keys, and no others:

- `status`: `untested`, `helps`, `no-effect`, `hurts` or `safety`. A unit with no row is `untested`. `safety` marks a guard whose value is the failure it prevents.
- `source`: the path or URL of the run that set the status. It is required for every status except `untested`.
- `models`: the models that the run measured.
- `date`: the date of the run, as `YYYY-MM-DD`.

`rig doctor` prints one line with the count per status. A unit with no row counts as `untested`:

```text
info  evidence untested 58, helps 1, no-effect 0, hurts 0, safety 1 (evidence.json)
```

With no `evidence.json`, or an empty one, every unit is `untested`, and doctor prints `(no evidence.json)` or `(evidence.json, empty)`. That is not an error.

Doctor exits 1 for a row that breaks the file. A ref that no listed repo pack contains is `E_UNKNOWN_UNIT`, for example `units["pstack/gone"]: no listed repo pack contains this unit` (`test/evidence.test.ts`, "a ref that no listed pack contains"). A unit that you removed with `disable` or that another unit replaces is still listed, so its row stays valid (`test/cli-wiring.test.ts`, "a row for a unit that rig.json disable removed stays valid" and "a row for a unit that another unit replaces stays valid"). A unit that a pin move removed upstream is not: delete its row in the same pull request as the pin move.

The ledger is a repo file, so it covers the packs of the repo only. A pack that lives in your overlay `~/.config/rig` is not a repo pack. A row for one of its units is `E_UNKNOWN_UNIT`, because a teammate has no such pack, and the count per status leaves those units out (`test/cli-wiring.test.ts`, "a row for a unit of an overlay-only pack" and "the count per status holds the units of the repo packs only").

A file that doctor cannot read, for example a directory named `evidence.json`, is `E_SCHEMA` (`test/cli-wiring.test.ts`, "evidence.json is a directory"). An unknown `status`, a missing `source`, an extra key or a wrong date is `E_SCHEMA`, and the key path names the ref, for example `units["pstack/how"].source: required when status is not untested`. A file with `schema` missing or not `1` is `E_SCHEMA` too.

No other command reads the ledger yet. `rig stats --suggest` does not use it.

## Know what stays sealed

The core pack, `packs/core/`, is sealed. It holds the frame (`frame.md`), the alias template, `terms.json`, the domain table (`domains.json`), the `craft` shell and the `engineering-research` skill. `rig.lock.json` records the hash of the core tree, and the gate blocks a plan whose core tree differs from it ([decision 0005](../decisions/0005-sealed-core.md)).

- `disable` and `replaces` cannot name a core unit. Both fail with `E_SCHEMA`, for example `disable[0]: core units are sealed and cannot be named here`.
- A pack unit with a core name fails with `E_CORE_SHADOW`. With `"aliases": {"pm": "tidy"}` in `rig.json`, a pack command `pm` gives `mine/pm uses the core name pm (core/pm)`.
- An overlay `packs/core/` directory fails with `E_OVERLAY_CONFLICT`.

The frame's text is fixed. Its one per-harness line, `Models:`, comes from the `models` field of each target record.

Next: [Recipes and pitfalls](./10-recipes-and-pitfalls.md).
