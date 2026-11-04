# 0021. Observability from transcripts, and self-feedback that the user approves

- Status: Accepted
- Date: 2026-11-04

## Context

The user wants rig to measure how agents and rig itself behave: tool usage, tokens (input, output, cache read, cache write), cost, cache hit rate and context management. The goal is self-feedback. The harnesses already write local transcripts with most of these fields. Claude Code deletes transcripts after its cleanup period, 30 days by default. A dispatch-log hook from draft v3 was dropped, because it duplicated the transcripts.

## Decision

- Source: harness transcripts, read on demand. rig reads metadata fields only, not message text, tool input or tool output. Mechanism: each reader keeps a field allowlist, and a slice 6 canary test checks that no prompt text reaches the store.
- Store: a content-free aggregate file, `~/.local/state/rig/metrics.jsonl`, one line per session per harness. It survives transcript cleanup.
- Optional end-of-session hook: off by default, one config line to enable, zero bytes to stdout, exit 0 on every error with the error in rig's log.
- Dedupe: count each Claude `message.id` once, count each subagent file once, key the store by harness and session.
- Self-feedback: `rig stats --suggest` prints a report plus a proposed diff against the configuration, shown like `rig plan`. The user applies it, commits it, and runs `rig apply`. Nothing applies automatically: `--suggest` prints, and `rig stats` writes only under `~/.local/state/rig/`. No data leaves the machine: `rig stats` makes no network call.
- ccusage is an optional cross-check, never a dependency.
- OpenTelemetry only if a probe shows that transcript-based skill attribution is too weak.

## Consequences

- Transcript formats are undocumented and drift between versions. The readers parse defensively, report "n/a" for a missing field, and date records by their own timestamp.
- Codex lacks cache-write and cost data. Cursor lacks token data. The report says so per metric.
- The store and the hook write under `~/.local/state/rig/`. That is rig's own state, not harness configuration, so `apply` stays the only writer of harness configuration.
