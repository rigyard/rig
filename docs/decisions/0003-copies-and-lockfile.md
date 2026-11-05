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

## Update 2026-11-05

Change: `installed.json` lives in one state root, `~/.local/state/rig/`, next to the journal, backups, metrics and the log. The local marketplace sits under `$XDG_DATA_HOME/rig/`. Network use is limited to two commands, `pack add` and `pin check`. The OSV refresh runs only inside them. `plan` and `apply` stay offline.

Reason: two state roots split the ownership of rig's state. A network use of its own for OSV would add a third command. See deltas 2 and 14 in section 14 of [the architecture doc](../design/rig-architecture.md#14-what-changes-from-draft-v4) and the 0003 row in section 15.

Implemented in: [#12](https://github.com/rigyard/rig/pull/12) (state root, journal) and [#3](https://github.com/rigyard/rig/pull/3) (boundary test: network only in `lib/lock/`). The OSV refresh inside `pack add` and `pin check` belongs to the `checks` PR, which has not merged yet. [#16](https://github.com/rigyard/rig/pull/16) added the `cve` check only.
