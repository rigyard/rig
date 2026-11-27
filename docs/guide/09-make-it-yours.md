# Make it yours

Customize packs, workflow fills, hooks, triggers, models, and targets without forking the upstream repository.

## Personal overlay (`~/.config/rig`)

Your overlay mirrors the repo layout (`rig.json`, `packs/`, `models/`, `rig.lock.json`, `audit.allow.json`) and survives `git pull` ([decision 0002](../decisions/0002-generic-repo-private-overlay.md)). Overlays can only add new packs, triggers, aliases, harness records, private terms, and empty model cells (`E_OVERLAY_CONFLICT` if setting a key the repo already defines), with one exception: `metrics.session_hook`:

```text
mkdir -p ~/.config/rig
echo '{"schema": 2, "metrics": {"session_hook": true}}' > ~/.config/rig/rig.json
rig plan
```

## Disable, add, or replace units

- **Disable:** Add `"<pack>/<unit>"` to `disable` in `~/.config/rig/rig.json`. `mode` warns gently (`info mode`) and skips disabled pstack skills; `auto` or core units cannot be disabled.
- **Add a private pack:** Commit your pack in `~/.config/rig`, vendor it with `rig pack add ... --into overlay`, attest ports with `rig pin set <name> --ported`, and add its key to `packs` in overlay `rig.json`. Adding a name that collides with another unit blocks with `E_CLASH`.
- **Replace:** Declare `"units": {"<name>": {"replaces": "<pack>/<unit>"}}` in your pack's `pack.json` so your unit replaces the shipped one cleanly.

## Add a harness as data

Add harnesses such as `pi` as repository data (Section 1 Case C of the [architecture](../design/rig-architecture.md)):

1. Add `targets/<h>.json` with read dirs, unit formats, instructions file, and transcript root.
2. Add a `<h>` row to every key in `packs/core/terms.json` (`E_TERM_MISSING` names any gap).
3. Reseal core offline: `rig pin check core && rig pin set core`.
4. Add `<h>` to `harnesses` in `rig.json`, then run `rig plan` and `rig apply`.

Harnesses needing an unknown file format also require a renderer under `lib/targets/`.

## Evidence ledger (`evidence.json`) and sealed core

An optional `evidence.json` (`schema: 1`) in the repo root lets `rig doctor` summarize unit status (`untested`, `helps`, `no-effect`, `hurts`, `safety` with `source`, `models`, `date`) without affecting `plan` or `apply` (overlay `evidence.json` is ignored). `packs/core/` stays locked via `rig.lock.json`: `disable`, `replaces`, core-name collisions (`E_CORE_SHADOW`), or an overlay `packs/core/` folder (`E_OVERLAY_CONFLICT`) are all blocked.

Next: [Recipes and pitfalls](./10-recipes-and-pitfalls.md).
