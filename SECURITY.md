# Security policy

## Supported versions

Security fixes apply to `main` and the latest tagged release.

## Reporting a vulnerability

Report security vulnerabilities privately through [GitHub Private Vulnerability Reporting](https://github.com/rigyard/rig/security/advisories/new). Do not open public issues for security bugs.

Include the affected command or file path, steps to reproduce the issue, the commit SHA, and your Node version.

## Scope and threat model

rig writes files into coding-agent configuration directories under `$HOME` (`~/.agents`, `~/.claude`, `~/.codex`, `~/.cursor`, `~/.gemini`, and `~/.omp`) and into its own state, data, and overlay directories (`~/.local/state/rig`, `~/.local/share/rig`, and `~/.config/rig`) through a journaled transaction. It runs no code from packs or harness target records.

Before writing any file, rig runs a ten-check gate that blocks unpinned units, executables and hook scripts, secret patterns, hidden Unicode characters, broken relative links, unknown mode unit names, unreviewed licenses, known CVEs in lockfiles, and harness cap overruns. The gate warns on telemetry flags without an opt-out, injection phrases, and soft budget thresholds. Only `rig pack add`, and `rig pin check` and `rig pin set` of a pack, access the network. `rig pin check core`, `rig pin set core`, `rig pin set <pack> --ported`, `rig plan`, `rig apply`, `rig doctor`, `rig stats`, and `rig models` stay offline.
