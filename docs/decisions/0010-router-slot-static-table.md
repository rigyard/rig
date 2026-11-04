# 0010. Router as a core slot with a static table and escalation

- Status: Accepted
- Date: 2026-11-04

## Context

The user decided that routing is a core slot. Research found no evidence that a classifier router beats a good static choice for coding work. See [routing and context](../research/2026-11-04-routing-and-context.md). The v3 review found three problems in the first design. The frame allowed a raise only after a failure, which contradicts the user's effort table. A `route()` function had no caller in v0. A dispatch-log hook duplicated transcripts and took outcomes from the model's own label.

## Decision

- The router is a core slot. Its filler renders the `Models` lines of the frame. The default filler is `static`: the role table from [decision 0011](0011-one-model-table.md).
- Raise effort per the effort-table conditions or after a verified failure. A verified failure is a failed gate or a reviewer rejection.
- Change effort inside a session. Change the model only for a new dispatch, because a model switch loses the prompt cache.
- Inside an active provider's skill, that provider's role lines govern.
- The retry rule (which role takes over after a second failure) stays hand-written in the user's orchestration rule. rig does not render it.
- No `route()` function and no dispatch-log hook. Dispatch data comes from transcripts ([decision 0021](0021-observability-and-self-feedback.md)).
- No classifier for now. Revisit when transcript-derived metrics show escalations per role over enough dispatches to compare against `static`.

## Consequences

- Synthesis v1 cut a task-type router, because each provider routes its own task types. This decision adds a model router, which is a different thing.
- The design draft v4 contains this slot.
- Escalation counts from transcripts are heuristic, because transcripts record no uniform gate result.
