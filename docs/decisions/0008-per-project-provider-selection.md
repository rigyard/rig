# 0008. Select the workflow provider per project, by explicit declaration only

- Status: Accepted
- Date: 2026-11-04

## Context

Synthesis v1 rendered one user-scope frame per profile. Review found a blocker: a frame rendered for one profile gives wrong instructions in other repositories, and swapping profiles swaps the whole machine. Draft v3 then selected the provider from footprints (an `openspec/` directory, an `enabledPlugins` entry). The v3 review found that this is context inference. The user decided that rig never infers context: the user declares it.

## Decision

- Profiles are removed. One machine-level base installs everywhere.
- The provider comes only from an explicit declaration, in this order: (1) a `projects` entry in the overlay `rig.json`, which the frame renders on the local machine, (2) a `rig-project: <provider>` line in project instructions, (3) `default_provider`, which is pstack. The user set pstack as the default and the quality bar.
- Footprints are info. `doctor --project DIR` lists them and prints the line that would declare the provider. A footprint never selects a provider. Mechanism: the resolver takes no footprint input (slice 2 test).
- The frame is provider-agnostic. It names the rule, not the provider.
- A restrictive provider plugin is off at user scope and on at project scope. That is activation, not selection. Claude Code documents this precedence (page plugins/loading).
- rig writes nothing into repositories. No command takes a repository path as a write target. `doctor --project DIR` is read-only.

## Consequences

- Codex, omp and Cursor have no uncommitted per-project instruction file. A local choice there is an overlay `projects` entry, which the frame renders.
- The frame lists overlay project declarations by directory. That text changes only on `apply`, so it does not bust the prompt cache between sessions.
- `CLAUDE.local.md` makes Claude skip a repository `AGENTS.md` by default. `doctor --project` warns when both exist.

## Update 2026-11-05

Change: only the `rig-project:` line, or its uncommitted twin, selects a provider. The overlay `projects` map is a `doctor --project` check, not a selector. The frame lists no projects.

Reason: one selector per project, which the model reads in the project itself. See delta 11 in section 14 of [the architecture doc](../design/rig-architecture.md#14-what-changes-from-draft-v4) and the 0008 row in section 15. This replaces the two consequences above that say the overlay entry selects and the frame renders it.

Implemented in: pre-release PR #13 (overlay entry reported, one selector) and pre-release PR #20 (frame without a project list).
