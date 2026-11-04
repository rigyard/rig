# 0009. OpenSpec proves pluggability, a restrictive SDLC plugin is a stretch

- Status: Accepted (priority). The go/no-go threshold text is Proposed.
- Date: 2026-11-04

## Context

The user stated the priority: a spec-driven provider such as OpenSpec is the main proof of pluggability. Support for a restrictive SDLC plugin is nice to have. Drop it if complexity grows too much.

## Decision

- OpenSpec is a provider record of `kind: cli` in the repository, delivered in slice 5. rig installs nothing for it. `openspec init` in the repository does the setup. The project declares it with `rig-project: openspec`.
- The restrictive SDLC plugin is a data-only provider record in the overlay, for Claude Code only.
- Threshold: rig supports it while it needs nothing beyond (a) the user-scope off, project-scope on flip, (b) one data record, (c) frame sentences that hold for every provider.
- rig documents it as not supported on the day it needs a rig hook, an edit to the plugin, suppression of its hooks, or a Codex, omp or Cursor port.
- Today it meets the threshold: go, with `rig pin check` on each release.

## Consequences

- Such a plugin can release often and break compatibility. Each release costs one `pin check`.
- Its session-start injection and per-prompt hook are disclosed in the record's `injects` field.
