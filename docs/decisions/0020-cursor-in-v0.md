# 0020. Cursor is a v0 target, pi and Hermes move to v1

- Status: Accepted
- Date: 2026-11-04

## Context

The user named Cursor an important harness. It is pstack's native home. Cursor reads skills from its own directories and also from `~/.claude/skills`, `~/.codex/skills` and `~/.agents/skills`, so a naive seeder lists one skill several times. User Rules live only in the Cursor UI. The `chats/` store holds content and rig must not read it. Local data has no token counts or cost.

## Decision

- v0 harnesses: Claude Code, Codex, omp and Cursor. pi and Hermes are v1.
- The Cursor target renders skills, agents in `~/.cursor/agents`, `.mdc` rules, `~/.cursor/rules/pstack-models.mdc`, and `/craft` as a skill.
- rig installs its Cursor skills, including `/craft`, as a local plugin in `~/.cursor/plugins/local/<name>`. Agents go to `~/.cursor/agents/`, because `.cursor` wins over `.claude/agents`. The `.mdc` rules go to `~/.cursor/rules/`, because pstack reads its model rule by path.
- Read-set rule: each target record lists the directories its harness reads. Each unit reaches a harness through exactly one directory. `rig audit` warns on an effective duplicate.
- Agent models use the Cursor model string `<slug>[effort=<e>]`.
- rig merges entries into `~/.cursor/hooks.json` and keeps every entry it did not write (slice 6 test). rig does not write to `~/.cursor/skills-cursor/`: the Cursor target record does not declare it, and the writer accepts only declared paths.
- Measurement on Cursor covers invocation counts, model mix and tool calls. It has no local token or cost data.

## Consequences

- A marketplace plugin with the same name wins over a local one. `doctor` flags that shadowing.
- Whether Cursor collapses a skill that it finds in several directories is unverified. Slice 1 probes it.
- The Cursor frame target is unverified. Slice 2 probes `~/.cursor/rules/rig-frame.mdc`.
