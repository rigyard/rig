# 0026. The product pack is in v0

- Status: Accepted
- Date: 2026-11-04

## Context

Draft v4 put the product pack (`office-hours`, ported as `/oh`) in slice 5. The v0 architecture moved it after v0, because slices 1 to 5 held the riskiest work and the port has its own size risk (assumption A6).

The user then asked for end-to-end seed tests on real harnesses, using OpenSpec, full pstack and the gstack product roles. The product roles are part of that proof.

## Decision

- `office-hours` as `/oh` is back in v0.
- It ships as the `product` pack, a port of the gstack skill with its MIT notice.
- It follows the pstack and OpenSpec provider paths, with its own seed test.

## Consequences

- Delta 6 in section 14 of [the architecture doc](../design/rig-architecture.md#14-what-changes-from-draft-v4) no longer holds. The product pack is not under "After v0" in the slice plan.
- The pack needs the `intake` and `ported_from` keys in the closed schemas.
- Source: the decision trail rows of 2026-11-04 22:51 and 22:52 (`.audit/rig-v0-decisions.tsv` in the primary checkout, not committed).
- Implemented in: pre-release PR #17 (the port) and pre-release PR #22 (enabled on all four harnesses).
- Number: the program plan names this record 0025. The TypeScript decision took 0025 first, so this record is 0026.
