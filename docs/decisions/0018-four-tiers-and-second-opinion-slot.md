# 0018. Four model tiers, and a second-opinion step-slot for cross-family judgment

- Status: Accepted
- Date: 2026-11-04

## Context

Draft v3 had five tiers. The fifth, `xfam`, stood for a judge from another model family. The v3 review found it too many: `xfam` served one role, and on some harnesses several tiers held the same model. Single-vendor harnesses (Claude Code, Codex) reach another family only by calling another CLI. Multi-vendor harnesses (omp, Cursor) can pick another family as a model.

## Decision

- Four tiers: `reason`, `strong`, `fast`, `cheap`. They map one to one to the fleet positions and to the Claude aliases `fable`, `opus`, `sonnet`, `haiku`.
- Cross-family judgment is not a tier. It is a `second-opinion` step-slot.
- Contract: input is a question plus artifact paths. Output is an independent verdict with evidence per claim. The provider runs read-only.
- Providers: headless Claude (`claude -p --output-format json --model <alias>`), headless omp (`omp -p --mode json --model <provider/model>`), headless Codex (`codex exec`), headless Cursor (`cursor-agent -p --output-format json --model <slug[effort=..]> --mode ask`), or a native other-family model in a multi-vendor harness.
- omp's `judge` role takes a literal model id in `roles.json`, not a tier.
- The default filler is empty. The user picks a provider in the overlay.

## Consequences

- The slot is a user decision, so it does not wait for the two-providers trigger in [decision 0007](0007-workflow-providers-and-step-slots.md).
- A CLI provider spends tokens in another harness. Those tokens show up in that harness's transcripts.
- The Codex read-only flag is unverified.
