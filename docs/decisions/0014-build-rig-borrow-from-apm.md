# 0014. Build rig and borrow ideas from APM

- Status: Proposed
- Date: 2026-11-04

## Context

Microsoft APM is the closest existing tool. It has a manifest, a lock with content hashes, an audit and install-time policy. See [prior art](../research/2026-11-04-prior-art.md).

## Decision

- Build rig as a Node ESM CLI with zero npm dependencies.
- Borrow from APM: the lock with content hashes, the hidden-Unicode audit, tighten-only policy inheritance.
- Do not adopt or wrap APM. It has no omp, pi or Hermes targets and no slots. Its runtime breaks the zero-dependency constraint. Its installer would own writes under `~` that rig keeps behind its own gate.
- Do not adopt the skills CLI, ruler or rulesync. They skip collisions without a message, overwrite hand edits, or have no lockfile. The skills CLI can serve as a vendoring source.
- Borrow named presets from OpenSpec.

## Consequences

- rig maintains its own lock, gate and writer.
- If APM adds omp and Hermes targets and slots later, review this decision.
