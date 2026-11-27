# 0004. Packs and targets are data, with no code plugins

- Status: Proposed
- Date: 2026-11-04

## Context

The user asked whether rig should accept plugins, for example an exporter for another harness. Both design candidates answered "partly": content and harness targets are worth extending, code is not. An exporter that runs code can write anywhere the user can, and the gate cannot audit code that it then runs.

## Decision

- Two extension axes. A pack is a directory of units plus a `pack.json` that lists exceptions only. A target is a JSON record with closed enum fields.
- No pack may supply an emitter, scanner or install script. A new command or agent format is a core change.
- Vocabulary: "pack" and "target". The docs avoid "plugin" for rig units, because harnesses use that word for units that run code.
- Hooks, `settings.json`, `.mcp.json` and secrets are not units. A pack that ships one gets a blocking finding.
- Planned mechanism: `test/boundaries.test.ts` fails on dynamic `import()` or a spawn of a pack path in `lib/`.

## Consequences

- A harness whose format fits no enum waits for a core change.
- Hermes leaf folding into `references/` must stay a copy. If it needs a rewrite, this decision needs review.

## Update 2026-11-05

Change: rig writes one hook element in v0. `apply` merges one `hooks.SessionEnd` element into `~/.claude/settings.json` when `metrics.session_hook` is true. It keeps every entry that rig did not write. Codex, omp and Cursor hold `hooks.session_end: null` until a probe shows a session-end event.

Reason: Codex `Stop` and Cursor `stop` fire once per turn, which breaks the zero per-turn injection budget. A fixed command string identifies rig's element in the JSON merge. See delta 7 in section 14 of [the architecture doc](../design/rig-architecture.md#14-what-changes-from-draft-v4) and the 0004 row in section 15.

Implemented in: pre-release PR #24.
