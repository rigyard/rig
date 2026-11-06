# The rig guide

rig keeps one stack of skills, commands, agents and rules in a repository and installs pinned copies of it into Claude Code, Codex, omp, Cursor and Antigravity. You run `rig plan` to see what would change, and `rig apply` to write it. The rest of rig exists so that you can trust those two commands on a machine you use every day. This guide shows how, with commands you can run.

Here's what you'll learn:

1. [Set up rig](./01-setup.md). Install the CLI, see where rig keeps its files, and read your first `rig doctor`.
2. [Plan, apply, undo](./02-plan-and-apply.md). Read a plan, write it, adopt files you already have, and roll a run back.
3. [Pass the gate](./03-the-gate.md). The ten checks, what blocks and what warns, and how to ack a finding.
4. [Add packs and seal core](./04-packs-and-pins.md). Vendor a pack at a commit and seal core again after a change.
5. [Scope packs to projects](./05-scope-and-projects.md). Machine-wide, project-only or hybrid packs, without rig writing into your repositories.
6. [Run multi-step work with /craft](./06-craft.md). The mode skill, its domain files and adapter, and how a fill changes a step.
7. [Pick and swap models](./07-models.md). Roles, tiers and a one-line model swap after a vendor release.
8. [Read your usage](./08-stats.md). Token and session metrics from your transcripts, and a suggested diff you apply yourself.
9. [Make it yours](./09-make-it-yours.md). The overlay, the four customization operations and a new harness as data.
10. [Recipes and pitfalls](./10-recipes-and-pitfalls.md). Command sequences to copy and mistakes to skip.

[What rig writes per harness](../harnesses.md) is the reference page for paths. Read it when you want to know exactly which file rig touches in a harness.

Read the pages in order the first time. After that, each page stands alone.

## If you only remember one thing

Run `rig plan` before `rig apply`, and read it:

```text
rig plan
rig apply
```

`rig plan` writes nothing. It lists every file rig would create, change, adopt or leave alone, and every gate finding that would block the write. `rig apply` writes exactly that plan, or nothing when the gate blocks. If you don't like the result, `rig apply --undo <run-id>` puts the old bytes back.

Next: [Set up rig](./01-setup.md).
