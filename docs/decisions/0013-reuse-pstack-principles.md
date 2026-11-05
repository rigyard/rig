# 0013. Reuse pstack principles in v0

- Status: Proposed
- Date: 2026-11-04

## Context

pstack ships 24 principle leaves of 10 to 24 lines each. Playbooks cite them by slug only, so the principles do not depend on any playbook wording. Under a foreign provider nothing tells the model to read those leaves.

## Decision

- rig ships no principles of its own in v0. The frame points at pstack's `principle-*` leaves and carries the rule "cite only leaves you read this session".
- The frame states its four invariants in its own words: restate the goal, pause before irreversible writes, verify on the real artifact, report with evidence. A foreign provider gets them without a leaf read.
- Own principles come in v1, in pstack's shape: when it applies, the rule, one example, under 30 lines, hidden from the model listing. One index line each.
- A principle earns its place when the same instruction was written twice and none of the 24 covers it.
- Planned lint: index entries and leaves match one to one, no own title repeats a pstack title.

## Consequences

- rig depends on the pstack pin for principle text.
- Check after one month: count instructions written twice.

## Update 2026-11-05

Change: the principles index is in core. Index entries point at the pstack pin for principle text.

Reason: core holds what rig's own contract needs. See delta 12 in section 14 of [the architecture doc](../design/rig-architecture.md#14-what-changes-from-draft-v4) and the 0013 row in section 15.

Implemented in: [#13](https://github.com/rigyard/rig/pull/13) (core data) and [#25](https://github.com/rigyard/rig/pull/25) (pstack provider path, locked path).
