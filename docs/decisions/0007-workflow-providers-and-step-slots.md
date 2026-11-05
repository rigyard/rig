# 0007. Workflow providers per project, step-slots for narrow contracts

- Status: Proposed
- Date: 2026-11-04

## Context

The user's rough hypothesis: playbooks are providers per task type, step-slots exist only for narrow-contract phases, the phase vocabulary is metadata, and nesting stops at two levels. Research found that providers do not interleave. A restrictive SDLC plugin runs one phase per session. pstack runs a whole playbook in one chat, and its code playbooks chain into "Opening a PR". OpenSpec is a self-contained CLI.

## Decision

- One active workflow provider per project. It routes its own task types, as pstack's playbook list does. A split per task type is rejected, because it cuts pstack's chains and each provider's shared artifact directory.
- Step-slots only for narrow contracts. v0 has two: `doc-review`, and `second-opinion` by user decision ([decision 0018](0018-four-tiers-and-second-opinion-slot.md)). Any other new slot appears when you ran two real providers for one step within a month.
- The phase vocabulary is data on the provider record (`phases`). The frame uses it for one rule: "if the provider has no verify phase, verify yourself". The frame has no phase guards.
- Two levels: the frame, then the provider. Chains inside a provider stay inside it.

## Consequences

- This changes the hypothesis on one point: providers are per project, not per task type.
- `verify`, `code-review` and `ship` are v1 slot candidates.

## Update 2026-11-05

Change: the slot list and the filler kinds follow section 2 of [the architecture doc](../design/rig-architecture.md). In v0 the slots are `doc-review` and `second-opinion` stubs plus the frame fillers. The `/craft` entry lists each provider entry from its provider record.

Reason: the architecture fixes the slot contract in closed-key schemas. See the 0007 row in section 15 and delta 17 in section 14.

Implemented in: [#13](https://github.com/rigyard/rig/pull/13) (schemas, provider records) and [#20](https://github.com/rigyard/rig/pull/20) (fillers rendered from provider records).
