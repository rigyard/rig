# rig

[![test](https://github.com/rigyard/rig/actions/workflows/test.yml/badge.svg)](https://github.com/rigyard/rig/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
![Node >= 22.18.0](https://img.shields.io/badge/node-%3E%3D22.18.0-brightgreen.svg)

Stop maintaining separate agent setups for Claude Code, Codex, omp, Cursor, and Antigravity. rig compiles one Git-pinned stack of skills, agents, rules, and model tiers into every coding-agent harness on your machine, with a read-only diff, a ten-check safety gate, and one-command rollback.

![Overview of rig compiling a Git-pinned repo and personal overlay through rig plan, a ten-check offline gate, and journaled rig apply into five coding-agent harnesses](./docs/assets/rig-overview.png)

## Why use rig

- **Write once, seed five harnesses.** Add a skill or rule once, and rig writes each harness's native format with no duplicate listings across shared directories.
- **Pinned copies, zero pack code.** Packs are data pinned by commit SHA and sha256 tree hash in `rig.lock.json`. Nothing auto-updates, and rig runs on Node with zero runtime dependencies.
- **Diff, gate, undo.** `rig plan` previews every byte before touching disk, ten checks block secrets, executables, broken links, and cap overruns, and `rig apply --undo <run-id>` restores any run.

## Try it

Requires Node 22.18.0 or later, with no build step.

```sh
git clone https://github.com/rigyard/rig.git ~/src/rig
cd ~/src/rig
npm link
rig doctor
rig plan
rig apply
```

`rig doctor` and `rig plan` write nothing. Edit `harnesses` in `rig.json` before `rig apply` if you only use a subset of the five harnesses. Use `rigctl` when Homebrew `rig` is already on `PATH`.

## What ships out of the box

- **Curated default stack.** Pinned `/craft` workflow (`packs/pstack`), `office-hours` product review (`packs/product`), `cursor-team-kit`, `cli-for-agents`, and a sealed core (`packs/core`) across Claude Code, Codex, omp, Cursor, and Antigravity.
- **Seven commands.** `rig doctor`, `rig plan`, `rig apply`, `rig models`, `rig stats`, `rig pack`, and `rig pin`. Every command takes `--help`, and full flags live in [the CLI and repository reference](./docs/reference.md).
- **Your own overlay.** Keep private packs, overrides, and personal model choices in `~/.config/rig` so `git pull` leaves your setup alone ([Make it yours](./docs/guide/09-make-it-yours.md)).

## Documentation

- [The rig guide](./docs/guide/README.md) walks through setup, the gate, packs, `/craft`, models, and overlays.
- [CLI and repository reference](./docs/reference.md) holds command flags, harness paths, shipped packs, safety guarantees, and dev checks.
- [What rig writes per harness](./docs/harnesses.md) lists every path rig touches and every path it refuses to write.
- [Design, ADRs, and architecture](./docs/README.md) and [evaluations](./evals/README.md) document how rig is built and tested.
- [Contributing](./CONTRIBUTING.md), [Security](./SECURITY.md), [MIT License](./LICENSE), and [Third-party notices](./NOTICE.md).
