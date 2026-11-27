# AGENTS.md

rig compiles one Git-pinned stack of skills, workflows, hooks, triggers, and model tiers into Claude Code, Codex, omp, Cursor, and Antigravity.

## Set up or use rig

When the user asks to install, set up, update, or use rig, read [.agents/skills/rig-setup/SKILL.md](./.agents/skills/rig-setup/SKILL.md) and follow it.

## Rules

- Run `rig plan` before `rig apply`. Run `rig apply` only after the user approves the diff.
- Never write rig files into `~` by hand, and never edit `rig.lock.json` by hand.
- Never read, print, or commit secrets. Keep personal paths, account names, and private packs in `~/.config/rig`.

## Change this repository

- Verify with `npm test`. Do not add runtime dependencies.
- After a change under `packs/core/`, run `rig pin check core` and `rig pin set core`.
- `evals/history.jsonl` is append-only.
- Follow [CONTRIBUTING.md](./CONTRIBUTING.md). Reviewers check [REVIEW.md](./REVIEW.md).
