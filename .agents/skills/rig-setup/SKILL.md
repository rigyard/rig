---
name: rig-setup
description: "Use when the user asks to install, set up, update, or use rig, or asks what rig would change on their machine. Clones rig, runs the read-only rig doctor and rig plan, explains the diff, and runs rig apply only after the user approves."
---

# Set up and use rig

## Set up

Do these steps in order. Stop at any failure and show the user the error.

1. If the current directory is not a rig checkout (no `rig.json` and `bin/rig.ts`), run `git clone https://github.com/rigyard/rig.git ~/src/rig` and work from `~/src/rig`. Ask first if that path exists.
2. Run `node --version`. rig needs Node 22.18.0 or later. Do not run `npm install`. rig has zero runtime dependencies and no build step.
3. If `rig` is not on `PATH`, run `npm link` in the checkout. If Homebrew `rig` is already on `PATH`, use `rigctl` instead of `rig`.
4. Ask the user which harnesses they use. Edit `harnesses` in `rig.json` to list only those. Use ids from `targets/*.json`.
5. Run `rig doctor`. It writes nothing. Report the errors and warnings.
6. Run `rig plan`. It writes nothing and exits 1 if a gate check blocks. Summarize the diff: which files rig adds, changes, or leaves alone, per harness.
7. Ask the user for approval. Run `rig apply` only after they say yes.
8. Report the run id that `rig apply` prints. To roll back, run `rig apply --undo <run-id>`.

If the gate blocks, read the finding code and follow `docs/guide/03-the-gate.md`. No flag skips the gate. Do not edit the gate to make a block pass.

## Update

Run `git pull` in the checkout, then `rig plan`, then `rig apply` after the user approves.

## Use

| Goal | Command or file |
|---|---|
| Start multi-step work | `/craft` (Claude Code, Cursor, Antigravity), `$craft` (Codex), `/skill:craft` (omp). Name a domain: `/craft eng: <task>` |
| Preview changes | `rig plan` |
| Write changes | `rig apply` |
| Undo a run | `rig apply --undo <run-id>` |
| Fix drift in managed files | `rig plan --repair`, then `rig apply --repair` |
| Check or swap model tiers | `rig models`, `rig models set <tier> <model> --harness <h>` |
| Read token and cost usage | `rig stats` |
| Add or pin a pack | `rig pack add`, `rig pin check`, `rig pin set` |
| Keep private packs and hooks | Overlay in `~/.config/rig`, see `docs/guide/09-make-it-yours.md` |

Every command takes `--help`. Exit codes: 0 done, 1 blocked or failed, 2 usage or config error. The full guide is in `docs/guide/README.md`.
