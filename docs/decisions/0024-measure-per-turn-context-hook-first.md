# 0024. Measure a per-turn context hook first, decide on disabling it later

- Status: Accepted
- Date: 2026-11-04

## Context

A hook can inject context on every prompt. One example is a code-graph prompt hook. In an indexed repository it injected about 16.7 KB on structural prompts. It adds the text to the user message, so the prefix cache holds. The cost is real, but no data yet shows that it outweighs the benefit of the hook.

## Decision

- Measure the hook first. Use metrics derived from transcripts: injected bytes per turn, and the turns that carry an injection.
- Do not disable the hook now.
- Decide later, on that data, whether to replace the hook with an on-demand tool.

## Consequences

- The `budget` meter and `rig stats` report hook bytes ([decision 0021](0021-observability-and-self-feedback.md)).
- The disable decision needs a new record after the data exists.
- Until then, rig leaves the hook as the user configured it.
