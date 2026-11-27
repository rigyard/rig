# 0002. Keep the repository generic and put private content in an overlay

- Status: Accepted
- Date: 2026-11-04

## Context

The user set a binding constraint: the repository stays generic, like pstack or gstack. User-specific rules, tools and accounts must not enter it.

## Decision

- The repository names no person, no account, and no tool or organization specific to one user's setup.
- Private content lives in an overlay at `~/.config/rig/`, which is its own git repository. It holds overlay packs, overlay provider records, scope choices, project declarations, acks for overlay packs and a `private_terms` list.
- The overlay adds packs, pins and providers. It can also disable or replace non-core units with the operations in [decision 0005](0005-sealed-core.md). It cannot remove or change a core unit: a core reference in the overlay is a parse error.
- The `private_terms` check blocks any listed term that appears in a repository pack.
- The docs refer to a third-party restrictive provider plugin only as "a restrictive SDLC plugin", as a stretch example.
- Specs state requirements only. They do not describe how or where the user applies rig.

## Consequences

- Pack scope is per pack and chosen by the user, from v0 ([decision 0017](0017-per-pack-scope-no-context-inference.md)).
- The `private_terms` check is skipped when no overlay exists. A fork without an overlay gets no leak protection from it.

## Update 2026-11-05

Change: `private_terms` is now a sub-rule of the `secret` check, not a check of its own. Injection phrases warn inside `unicode`. The gate has eight checks. It skips the sub-rule when no overlay exists, as before.

Reason: the gate has exactly eight checks. See delta 9 in section 14 of [the architecture doc](../design/rig-architecture.md#14-what-changes-from-draft-v4) and the 0002 row in its decision update table (section 15).

Implemented in: pre-release PR #5 (registry, `secret`, `unicode`) and pre-release PR #16 (`cve`, `budget`).
