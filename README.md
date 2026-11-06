# rig

rig installs one pinned set of agent skills, commands, agents and rules into the coding-agent harnesses on your machine. v0 supports Claude Code, Codex, omp and Cursor. You keep one source of truth in a repository, and rig writes a copy of it into each harness in that harness's own format.

You get three things from it:

- **The same stack in every harness.** A skill you add appears once in Claude Code, Codex, omp and Cursor, with no duplicates where one harness reads another's directories.
- **No surprise updates.** rig installs copies pinned by a sha256 tree hash in `rig.lock.json`. Nothing updates itself. Only `rig pack add`, and `rig pin check` and `rig pin set` of a pack, use the network.
- **One gate before every write.** rig checks every unit for pinned versions, executables, secrets, hidden Unicode and injection phrases, relative links, unit names in the mode skill, licenses, known CVEs, telemetry and token budget before it writes a byte. No flag skips the gate.

rig is one Node CLI with no runtime dependencies. Packs and harness targets are data files, and rig runs no code from a pack.

## Install

You need Node 22.18.0 or later. rig runs its `.ts` files through Node's native type stripping, so there is no build step.

```sh
git clone <rig repository url> ~/src/rig
cd ~/src/rig
npm link
rig --help
```

`npm link` puts `rig` on your `PATH` and points it at your checkout. `npm install -g` from a git URL does not work, because Node does not strip types for files inside `node_modules`.

## Get started

Three steps:

1. Run `rig doctor`. It reads your harnesses and your rig config, writes nothing, and tells you what it found.
2. Run `rig plan`. It shows every file rig would write, adopt or block, and why.
3. Run `rig apply`. It writes the plan through one journaled transaction. Every write into a harness goes through this transaction. `rig apply --undo <run-id>` restores the previous bytes.

```text
rig doctor
rig plan
rig apply
```

New here? The [rig guide](./docs/guide/README.md) walks you through setup, a first apply, the gate, packs, project scope, the `/craft` mode skill, models, usage stats and your own overlay.

## Usage

rig has seven commands. Every command takes `--help`.

| Command | What it does |
|---|---|
| `rig plan [--repair]` | Composes the stack, renders it per harness, runs the gate, and diffs it against disk and rig state. Writes nothing. `--repair` plans drifted managed entries as writes. |
| `rig apply [--undo <run-id> \| --repair]` | Runs the plan, then writes it as one journaled transaction. `--undo` restores a run byte for byte. `--repair` writes drifted managed files and blocks back to the render. |
| `rig doctor [--project <dir>]` | Read-only diagnosis of the machine, or of one project: drift, the core seal, telemetry, aliases, the scope packs of the project. |
| `rig stats [--since <dur>] [--harness <h>] [--suggest]` | Token and session metrics read from harness transcripts. `--suggest` adds a proposed diff that you apply yourself. |
| `rig models` and `rig models set <tier> <model> --harness <h>` | Shows the model table per harness, or swaps the model of one tier and re-renders only the model cells, through the same gate and transaction as `rig apply`. |
| `rig pack add <repo> --sha <sha> [--root <dir>] [--path <path>] [--exclude <path>] [--port <path>] [--name <name>]` | Vendors one folder of a repo at a full 40-hex commit, minus the excludes, gates it, and prints the ack stanzas the gate needs. `--port` records the upstream sources of a port. With `--port` and no `--path`, it adopts a pack folder that you wrote. |
| `rig pin check <name> [--sha <sha>] [--diff] [--exclude <path>] [--no-exclude]` and `rig pin set <name> [--ported]` | For core: gates the core tree, records its tree hash as a candidate, then promotes it to the core seal. For a pack: gates the pack at a new commit with its license and exclude list, prints `port fresh` or `port stale` for its port paths, then moves the pack to that commit. `--diff` prints the port diff and records nothing. `--ported` attests a reviewed port. A stale port blocks `rig plan` with `E_PORT_STALE`. |

Exit codes: `0` done, `1` blocked or failed, `2` usage or config error.

## What ships here

| Path | Content |
|---|---|
| `packs/core` | The sealed core: the frame that every harness loads, the per-harness terms, and the alias template. |
| `packs/pstack`, `packs/cursor-team-kit`, `packs/cli-for-agent` | Upstream bytes of pstack, three cursor-team-kit skills and `cli-for-agents`, vendored from `https://github.com/cursor/plugins` at `2776ddd`. pstack's hub and playbooks install inside the `craft` mode skill. |
| `packs/product` | The `office-hours` skill, a product review ported from gstack under its MIT license (see `packs/product/NOTICE.md`). |
| `targets/` | One record per harness: where it reads, where rig writes, and which files carry model values. |
| `models/` | `roles.json` maps roles to four tiers. `tiers.json` maps each tier to a model per harness. |

[What rig writes per harness](./docs/harnesses.md) lists every path rig writes and every path it leaves alone.

## Make it yours

Put your own config in `~/.config/rig`. The overlay adds packs, disables default units and adds model rows that the repository leaves empty. It never changes a value that the repository sets. When it tries, rig stops with `E_OVERLAY_CONFLICT`. The overlay lives outside the checkout, so a `git pull` of rig leaves it alone. [Make it yours](./docs/guide/09-make-it-yours.md) covers the four customization operations and how to add a harness target as data.

## Develop rig

```sh
npm test
npm ci --ignore-scripts && npm run typecheck
```

Tests build a temporary HOME and never touch yours. Tests that run real harness CLIs are opt-in with `RIG_LIVE=1`, and they check that your harness config files hash the same before and after. Cursor lanes run with your real HOME, so they fail when a pass depends on a read under it, and name the path. `npm run typecheck` fails when the strict `tsc` error count rises above `tsc-baseline.json`.

Design, decisions and research live in [docs/](./docs/README.md).

rig v1 is in progress. The checkout seeds the first default config: pstack, cursor-team-kit and cli-for-agent from `https://github.com/cursor/plugins` at `2776ddd`, and the gstack `office-hours` port pinned at `b406820`. The mode skill `craft` (`/craft`) routes multi-step work through pstack's hub ([Run multi-step work with /craft](./docs/guide/06-craft.md)). When a plugin, a harness or a model changes, `rig pin check`, `rig pin set` and `rig plan` show in one place whether anything clashes. Read [the v1 concept](./docs/design/rig-v1-concept.md) and [the first-seed plan](./docs/plan/v1-first-seed-prs.md). The guide describes the current CLI.
