# Read your usage

Inspect token usage, cache hit rates, tool calls, skill reads, and cost from local harness transcripts without exposing prompt or response content.

## Run a usage report

`rig stats` reads metadata-only fields from harness transcripts offline and stores per-session records in `~/.local/state/rig/metrics.jsonl` ([decision 0021](../decisions/0021-observability-and-self-feedback.md)):

```text
rig stats --harness codex --since 7d
```

- `--since <n><d|h|m>` sets the lookback window (default `30d`).
- Project paths hash to sha256; non-allowlisted fields appear only by key name under `dropped keys`.
- Missing harness metrics (cost on Codex, tokens on Cursor) print `n/a`, never `0`.
- `rig stats --record --session <id>` records one session manually (`E_SESSION_NOT_FOUND` if missing).

## Suggest config diffs and turn on session hooks

Run `rig stats --suggest` to print unused skills and escalated roles and write a reviewable patch under `~/.local/state/rig/proposals/`:

```text
rig stats --since 7d --suggest
```

rig never edits `rig.json` automatically; review the patch, run `git apply`, and run `rig apply`. To auto-record Claude Code sessions on exit, enable `metrics.session_hook` in `rig.json` or your personal overlay `~/.config/rig/rig.json`:

```json
{ "schema": 2, "metrics": { "session_hook": true } }
```

This writes one `SessionEnd` element into `~/.claude/settings.json` that logs errors content-free to `~/.local/state/rig/log/rig.log` and always exits 0.

Next: [Make it yours](./09-make-it-yours.md).
