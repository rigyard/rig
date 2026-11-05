# Start work with /craft

In this page you learn what `/craft` is on each harness, how it hands off to the workflow provider of the project, and what `/pm` is. You also see what `/craft` tells the agent when pstack has no pin. `/craft` is the one entry command that rig renders on every harness ([decision 0016](../decisions/0016-entry-command-craft.md)).

## Read what /craft says

One machine-wide command cannot know which project you are in. So the body of `/craft` states the selection rule and lists one line per workflow provider. After `rig apply` on main, `~/.claude/commands/craft.md` holds:

```text
---
description: Start work with the workflow provider that this project declares.
---
Find the "rig-project: <provider>" line in the project instructions.
If it names pstack: rig.lock.json holds no locked pstack version, so its path is unknown. Tell the user to run "rig pin check pstack", then stop.
If it names openspec: run /opsx:propose.
If no line exists: act as if it names pstack.
```

The rule is the one from [Scope packs to projects](./05-scope-and-projects.md): only a `rig-project:` line selects, else `default_provider`. The frame file that rig writes on each harness states the same rule.

## Find /craft on your harness

rig renders `/craft` from each target record's command format:

| Harness | File | You type | Limits |
|---|---|---|---|
| Claude Code | `~/.claude/commands/craft.md` | `/craft` | none |
| Codex | `~/.codex/prompts/craft.md`, body only | `/prompts:craft` | no bare `/craft`. pstack is not available. |
| omp | `~/.omp/agent/commands/craft.md` | `/craft` | no workflow provider has an omp entry |
| Cursor | `~/.cursor/plugins/local/rig/skills/craft/SKILL.md` | `/craft` | a hidden skill in rig's local plugin. openspec is not available. |

On Cursor, commands are legacy, so rig renders `/craft` as a skill with `disable-model-invocation: true`, plus the plugin manifest `~/.cursor/plugins/local/rig/.cursor-plugin/plugin.json`. Whether Cursor loads a user-level local plugin is not verified yet (probe (j), assumption A24 in [assumptions and open questions](../assumptions-and-open-questions.md)). The omp probe confirmed that a command file in `~/.omp/agent/commands` runs as a bare `/name` ([omp probe record](../research/2026-11-05-probes-omp.md)). The Codex form is open (assumption A36).

A provider with no entry on a harness gets a fallback line. The omp file shows it for both providers:

```text
If it names pstack: pstack is not available on this harness. Say so in your first message, then follow the frame.
If it names openspec: openspec is not available on this harness. Say so in your first message, then follow the frame.
```

## Follow the route to a provider

Each provider record in `providers/*.json` has an `entry` per harness. rig turns it into the `/craft` line:

- `pstack` on Claude Code reads `plugin-cache:skills/poteto-mode/SKILL.md`. rig builds the exact path from the locked version in `rig.lock.json`. It does not pick the newest cached version.
- `pstack` on Cursor reads `plugin-local:skills/poteto-mode/SKILL.md`. The line becomes `read ~/.cursor/plugins/local/pstack/skills/poteto-mode/SKILL.md and follow it.` That path has no version, so it does not depend on the lock.
- `pstack` on Codex and omp has `entry: null`.
- `openspec` runs a command: `/opsx:propose` on Claude Code, `/prompts:opsx-propose` on Codex. Cursor and omp have `entry: null`.

With a locked pstack version, the Claude Code line reads like this (`test/frame.test.ts`, "/craft on Claude reads pstack at the exact locked plugin-cache path"):

```text
If it names pstack: read ~/.claude/plugins/cache/cursor-plugins/pstack/0.15.36/skills/poteto-mode/SKILL.md and follow it.
```

## Handle a missing pstack pin

On main, `rig.lock.json` holds no pstack pin. This is an open decision (see [assumptions and open questions](../assumptions-and-open-questions.md)). Until you pin it, `/craft` on Claude Code tells the agent to ask you for `rig pin check pstack` and then stop. `rig plan` and `rig doctor` warn about the same gap:

```text
warn pin pstack/rig.lock.json: /craft on claude reads pstack from the plugin cache, and pstack has no locked version: run rig pin check pstack
```

A candidate version is not a locked version. With only a candidate in the lock, `/craft` still names no path (`test/frame.test.ts`, "with no locked pstack version"). Run `rig pin check pstack`, then `rig pin set pstack`, as [Add packs and pin plugins](./04-packs-and-pins.md) shows. The next `rig apply` writes the locked path.

## Use /pm while the alias lasts

`rig.json` holds `"aliases": {"pm": "craft"}`. rig renders `/pm` next to `/craft` on every harness, with one body line:

```text
Run /craft with the same arguments.
```

On Codex that line still names `/craft`, while the prompt there is `/prompts:craft`. `rig doctor` prints a reminder while the alias exists:

```text
info  alias     /pm is an alias of /craft (rig.json aliases). A hand-written pm command at a rendered path blocks rig plan with E_ADOPT_MISMATCH.
```

A `pm` command that you wrote yourself collides with the alias. `rig plan` shows the diff and blocks:

```text
block   owned  claude  ~/.claude/commands/pm.md                                        E_ADOPT_MISMATCH ~/.claude/commands/pm.md exists and is not managed: bytes differ (diff below)
--- ~/.claude/commands/pm.md (current)
+++ ~/.claude/commands/pm.md (desired)
 ---
+description: Alias of /craft.
-description: My old pm command.
 ---
+Run /craft with the same arguments.
-Plan the work.
 
32 changes, 1 block
```

Remove one of the two: your file, or the alias. While the block stands, `apply` writes nothing (`test/plan-apply.test.ts`, "an unmanaged file at a rendered path blocks with E_ADOPT_MISMATCH and a diff; apply writes nothing"). When the alias goes away is open question 10 in [assumptions and open questions](../assumptions-and-open-questions.md).

## Go from /oh to /craft

The `product` pack's `/oh` skill tells the agent to close the design doc with the intake line of the active provider. On Claude Code and Cursor, the pstack line is `Next: /craft feature <design-doc>`. So a product session hands off to `/craft` with the design doc as input.

Next: [Pick and swap models](./07-models.md).
