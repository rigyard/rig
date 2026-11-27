# The rig guide

rig keeps one stack of skills, workflows, custom hooks, triggers, and model tiers in a repository and writes pinned copies into Claude Code, Codex, omp, Cursor, and Antigravity.

## Contents

1. [Set up rig](./01-setup.md). Install the CLI, learn config/state roots, and read `rig doctor`.
2. [Plan, apply, undo](./02-plan-and-apply.md). Preview diffs, write atomically, adopt existing files, and roll back runs.
3. [Pass the gate](./03-the-gate.md). Read the ten checks, clear blocks, and ack findings.
4. [Add packs and seal core](./04-packs-and-pins.md). Vendor commits, track ports in `rig.lock.json`, and seal core.
5. [Scope packs to projects](./05-scope-and-projects.md). Configure machine-hidden, project, or hybrid packs.
6. [Run multi-step work with /craft](./06-craft.md). Use `pstack` engineering and `gstack` `office-hours`, plus custom hooks and triggers.
7. [Pick and swap models](./07-models.md). Configure roles, tiers, aliases, and per-harness swaps.
8. [Read your usage](./08-stats.md). Measure session tokens, skills, and cost, and review suggested diffs.
9. [Make it yours](./09-make-it-yours.md). Use `~/.config/rig` overlays, unit operations, evidence ledgers, and custom targets.
10. [Recipes and pitfalls](./10-recipes-and-pitfalls.md). Common command sequences and quick fixes.

Coding agents read [AGENTS.md](../../AGENTS.md) for the setup steps and rules. Read [What rig writes per harness](../harnesses.md) for every filesystem path rig touches.

## Core loop

Always preview with `rig plan` before writing with `rig apply`:

```text
rig plan
rig apply
```

`rig plan` writes nothing and exits 1 if any gate check blocks. `rig apply` executes the verified ops as one transaction, and `rig apply --undo <run-id>` restores the prior bytes.

Next: [Set up rig](./01-setup.md).
