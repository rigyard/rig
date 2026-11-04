# 0019. Claude tiers as aliases, with optional pinned ids

- Status: Accepted
- Date: 2026-11-04

## Context

A Claude alias resolves to the current model of its family. Verified on one machine: `opus` resolved to `claude-opus-5-5`, `sonnet` to `claude-sonnet-5-5`, `fable` to `claude-fable-5-1`, read from `message.model` in subagent transcripts. No `ANTHROPIC_DEFAULT_*_MODEL` variable was set. The Claude Code Agent tool `model` parameter accepts aliases only.

## Decision

- Claude tiers in `tiers.json` default to aliases.
- A tier can be pinned to a full model id.
- A pinned tier renders the full id into agent frontmatter. The alternative is `ANTHROPIC_DEFAULT_<FAMILY>_MODEL`, which remaps the alias for every session.
- The orchestrator selects the agent type, not the model. For a pinned tier the dispatch omits `model`, because a dispatch parameter overrides frontmatter.
- `rig stats` reports what each alias resolved to and when the resolution changed.

## Consequences

- Most Claude releases need no edit. omp, Codex and Cursor take concrete ids, so their swaps go through `rig models set`.
- An orchestration rule that tells the model to pass `model` on every dispatch defeats a pin. `doctor` cannot detect that from files. `rig stats` shows it as a resolved model that differs from the pin.
