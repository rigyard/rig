# 0015. Test doubles: fixture packs and fixture HOME yes, gate stubs no

- Status: Proposed
- Date: 2026-11-04

## Context

The user asked whether mocking gates and hooks is worth it. A fixture HOME with a stub `claude` binary already worked for cleanup scripts.

## Decision

| Kind | Decision | Reason |
|---|---|---|
| Audit checks on fixture packs | Keep, v0 | Pure functions over bytes. High value, low cost. |
| Fixture HOME plus a stub `claude` | Keep, v0 | `apply`, `doctor` and `pin` need a fake `~`. |
| Provider approval gates with an auto-approve stub | Cut | Provider gates are prose. A stub tests the model, not rig. |
| Simulated session-start hook injections | Defer to a v1 promptfoo spike | Frame obedience is an eval, not a unit test. |

Smallest proving tests:

- A shebang fixture blocks. One changed byte in an acked script blocks again.
- Fixture user settings with a provider off, project settings with it on, and a fixture `installed_plugins.json`: `doctor --project` prints effective `true` with source `project`.
- One manual run of `claude plugin list` in a real project confirms the precedence message.

## Consequences

- v0 runs one headless smoke test per harness instead of gate stubs.
- Frame obedience stays unproven until v1.
