# 0003. Install copies pinned by a lockfile, not symlinks

- Status: Accepted
- Date: 2026-11-04

## Context

The user wants full control and no automatic updates. A copy is a pin. Symlinks into a shared store broke after a directory move and left dangling links. Claude Code does not read `~/.agents/skills`, so one shared link store cannot serve every harness. Hooks that call skill scripts need real files.

## Decision

- Vendored packs are copied into the repository. `rig.lock.json` records repo, ref, SHA, paths, license and a tree sha256 per source.
- `apply` installs copies and records path and sha256 per file in `~/.rig/installed.json`.
- Native plugins that the harness installs (pstack, provider plugins) stay external pins. The lock records `version` and `gitCommitSha`. rig does not copy them.
- Three commands use the network: `rig pack add`, `rig pin check` and the OSV refresh. `apply` is offline. rig installs no timer or hook that runs it.

## Consequences

- Each source edit needs one `apply`.
- `doctor` gets a drift signal: live sha256 against `installed.json`.
- An upgrade is a deliberate `pack add --sha <new>`, a diff you review, and a commit.
- See [decision 0006](0006-one-gate-before-apply.md) for the gate on native plugins.
