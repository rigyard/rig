# 0005. A named, sealed core with four customization operations

- Status: Proposed
- Date: 2026-11-04

## Context

The user wants a core that stays fixed and a layer that other people can change. The repository is generic, so forks and other consumers matter. A user pack must not shadow a core name, and an edit in place must be visible.

## Decision

- Core is `packs/core/`. It is always installed and never listed in `packs`.
- Members: the frame template, `rules/working.md`, `rules/writing.md`, the slot stubs (`doc-review`, `router`, `second-opinion`), and the schemas for providers, targets, roles and tiers. The gate, the renderers and the metrics reader are code in `lib/` and are not pluggable.
- Four operations: disable a default unit, fill a slot, add a pack, replace a non-sealed unit.
- A core reference in `disable` or `replaces` is a parse error. A pack unit with a core name raises `E_CORE_SHADOW`, which you cannot ack.
- The lock holds the core tree hash. A changed core byte fails the `pin` check. A deliberate change is a commit plus `rig pin set core`, visible in git.

## Consequences

- The seal is tamper-evident, not tamper-proof. A fork owner can reseal.
- Design candidate 1 proposed a larger core (mode skill, principle leaves, writing skills). Core membership is an open question.

## Update 2026-11-05

Change: core holds the frame template, the principles index, the `doc-review` and `second-opinion` stubs, the entry templates, `terms.json` and the schemas. It no longer holds `rules/working.md`, `rules/writing.md` or a `router` stub. A deliberate core change is a commit plus `rig pin check core` and `rig pin set core`.

Reason: core holds what rig's own contract needs. The rules files are user prose, and the router filler renders frame lines. See delta 12 in section 14 of [the architecture doc](../design/rig-architecture.md#14-what-changes-from-draft-v4) and the 0005 row in section 15.

Implemented in: pre-release PR #13 (core data) and pre-release PR #20 (frame and `/craft`, core resealed).
