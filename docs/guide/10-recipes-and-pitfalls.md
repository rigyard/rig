# Recipes and pitfalls

Ready-to-run commands and common blocked-plan errors.

## Quick recipes

| Goal | Commands | Details |
|---|---|---|
| Seed an existing machine | `rig doctor`, `rig plan`, fix `E_ADOPT_MISMATCH`, `rig apply` | [Plan, apply, undo](./02-plan-and-apply.md#adopt-unmanaged-files) |
| Swap a tier model | `rig models`, `rig models set strong <model> --harness claude` | [Pick and swap models](./07-models.md#swap-or-pin-a-tier) |
| Scope a pack to one project | Add `"scope": "project"` in `~/.config/rig/rig.json`, `rig apply`, enable `.claude/settings.local.json` | [Scope packs to projects](./05-scope-and-projects.md) |
| Weekly cost and diff review | `rig stats --since 7d --suggest` | [Read your usage](./08-stats.md) |
| Roll back an apply | `rig apply --undo <run-id>` | [Plan, apply, undo](./02-plan-and-apply.md#undo-and-repair) |

## Common pitfalls

- **Edited a managed file (`E_DRIFT`).** Edit the pack unit instead, or run `rig apply --repair` to restore rendered bytes and permissions (`--undo` reverses repairs too).
- **Overrode a repo key in overlay (`E_OVERLAY_CONFLICT`).** Edit `harnesses` or seeded tier values in checkout `rig.json`/`models/tiers.json`; only `metrics.session_hook` overrides the repo.
- **Tried to ack a `pin` error.** Acking `pin` fails with exit 2. Fix the lock, run `rig pin check core && rig pin set core`, or attest with `rig pin set <pack> --ported`.
- **Left upstream plugin installed (`E_FOREIGN_INSTALL`).** Uninstall duplicate `pstack`/`gstack` installs (`claude plugin uninstall ...`, Cursor UI/plugin dir, or `omp plugin uninstall ...`).
- **Pre-existing skill or symlink at target path.** Hand-written targets block with `E_ADOPT_MISMATCH`; symlinks inside harness subfolders block with `E_CONTAINMENT`.
- **Used `npm install -g` instead of `npm link`.** Node skips TypeScript type stripping under `node_modules`. Install from a local checkout with `npm link`.

Back to [the guide index](./README.md).
