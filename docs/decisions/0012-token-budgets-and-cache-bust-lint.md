# 0012. Token budgets and a cache-bust lint in the gate

- Status: Proposed
- Date: 2026-11-04

## Context

Context cost is the agent equivalent of startup time. pstack measures nothing. gstack enforces a byte ceiling per skill and keeps a size ledger. Prompt caching pays only when the prefix stays byte-stable.

## Decision

- A `budget` check in the gate (`rig audit`, `plan`, `apply`) computes static metrics per harness: always-on tokens, listing characters, largest and median body tokens, bodies over 500 lines, worst-case co-load against the 25,000-token compaction pool, hook output tokens, reference depth.
- The check includes a cache-bust lint. It flags timestamps, git status, random order and per-session paths in text that sits in the prompt prefix.
- Thresholds start from the proposed budgets in [routing and context](../research/2026-11-04-routing-and-context.md), for example always-on core of 4,000 tokens or fewer per harness. Those numbers are researcher judgment, not vendor limits. You calibrate them with measurements.
- Proposed severity rule: block where the harness drops or truncates text (the 1,536-character description cap, the Codex `AGENTS.md` cap), warn where text costs money.
- The hook meter runs every SessionStart, UserPromptSubmit and PreToolUse hook that rig can see, including hooks that rig does not own.

## Consequences

- The severity rule waits for the user's confirmation.
- Live metrics (cache hit rate, real load cost) come from transcripts ([decision 0021](0021-observability-and-self-feedback.md)). OpenTelemetry is a fallback only.
- The design draft v4 contains the check.
