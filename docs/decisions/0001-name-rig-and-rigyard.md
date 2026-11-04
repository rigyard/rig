# 0001. Name the project rig and the organization rigyard

- Status: Accepted
- Date: 2026-11-04

## Context

The project had an earlier working name. The user renamed it and created a GitHub organization for it.

## Decision

- Project name: rig.
- GitHub organization: `rigyard`. Repository: `rigyard/rig`.
- CLI binary: `bin/rig`. Fallback binary name: `rigctl`.

## Consequences

- Two public projects already use the name rig. `r-lib/rig` is an R installation manager (1,020 stars) and ships in Homebrew. `0xPlaygrounds/rig` is a Rust LLM framework (9,066 stars). A user who has the Homebrew `rig` on `PATH` gets a name clash. The install docs must name `rigctl` as the alternative.
- The final binary name is an open question. See [assumptions and open questions](../assumptions-and-open-questions.md).
- Organization profile text and avatar are outside this repository.
