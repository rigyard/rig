# 0017. Per-pack scope, chosen by the user, with no context inference

- Status: Accepted
- Date: 2026-11-04

## Context

Draft v3 installed every overlay pack machine-wide and hidden, deferred project scope to v1, and selected the provider from footprints. The v3 review found that footprint selection is context inference. The user decided that rig never infers context.

## Decision

Requirement: each pack declares its scope: machine-wide (hidden), selected projects only, or hybrid. The user chooses the scope explicitly. rig does not determine the scope itself.

- `pack.json` lists the modes the pack supports: `machine-hidden`, `project`, `hybrid`.
- The user picks one mode per pack in `rig.json` or the overlay, with a project list for `project` and `hybrid`.
- No entry: `machine-hidden`. A mode that the pack does not list is a parse error.
- All three modes exist from v0.
- The same rule covers providers: the provider comes only from an explicit declaration ([decision 0008](0008-per-project-provider-selection.md)).

## Consequences

- On Claude Code a project-only pack is a local-path plugin from a rig-owned marketplace, `false` at user scope. The user enables it per project in `.claude/settings.local.json`. `doctor --project` prints the snippet. rig writes nothing into repositories.
- On Codex, omp and Cursor a project-only pack needs files in the repository. rig does not write them, so the pack is absent there until the user commits them.
- The exact meaning of `hybrid` (hidden machine-wide, invocable in the listed projects) is proposed and waits for confirmation.
