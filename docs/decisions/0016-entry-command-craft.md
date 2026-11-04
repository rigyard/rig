# 0016. Entry command `/craft`, with `/pm` as a temporary alias

- Status: Accepted
- Date: 2026-11-04

## Context

The default provider, pstack, needs one entry command that starts its playbook session. The earlier drafts used `/pm`. A rename to `/staff` was an open question. The user chose a name for craftsmanship and solid engineering. A local search found no collision in commands, skills, prompts, extensions or plugin caches on one machine.

## Decision

- The entry command is `/craft`.
- rig renders `/craft` for every v0 harness from the target record's command format. On Cursor it is a skill with `disable-model-invocation: true`, because Cursor commands are legacy.
- `/pm` stays as a temporary alias, through `"aliases":{"pm":"craft"}` in `rig.json`.
- `doctor` prints a reminder while the alias exists.

## Consequences

- A hand-written `/pm` command already in a harness collides with the rendered alias. `rig plan` names the path. The user removes one of the two before `apply`.
- The `/oh` intake line for pstack names `/craft`.
- The Codex and omp command forms are unverified until slice 2.
- `/boss` is an existing entry command and stays. It is orchestrator mode: delegate by default, never edit directly. It is a Claude-only unit until the orchestration rules move into rig.
