# rig

rig installs one pinned set of agent skills, commands, agents and rules into the coding-agent harnesses on your machine. v0 supports Claude Code, Codex, omp and Cursor. You keep one source of truth in a repository, and rig writes a copy of it into each harness in that harness's own format.

You get three things from it:

- **The same stack in every harness.** A skill you add appears once in Claude Code, Codex, omp and Cursor, with no duplicates where one harness reads another's directories.
- **No surprise updates.** rig installs copies pinned by a sha256 tree hash in `rig.lock.json`. Nothing updates itself. Only `rig pack add` and `rig pin check` use the network.
- **One gate before every write.** rig checks every unit for pinned versions, executables, secrets, hidden Unicode and injection phrases, licenses, known CVEs, telemetry and token budget before it writes a byte. No flag skips the gate.

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

New here? The [rig guide](./docs/guide/README.md) walks you through setup, a first apply, the gate, packs, project scope, models, usage stats and your own overlay.

## Usage

rig has seven commands. Every command takes `--help`.

| Command | What it does |
|---|---|
| `rig plan` | Composes the stack, renders it per harness, runs the gate, and diffs it against disk and rig state. Writes nothing. |
| `rig apply [--undo <run-id>]` | Runs the plan, then writes it as one journaled transaction. `--undo` restores a run byte for byte. |
| `rig doctor [--project <dir>]` | Read-only diagnosis of the machine, or of one project: drift, pins, telemetry, aliases, the active workflow provider. |
| `rig stats [--since <dur>] [--harness <h>] [--suggest]` | Token and session metrics read from harness transcripts. `--suggest` adds a proposed diff that you apply yourself. |
| `rig models` and `rig models set <tier> <model> --harness <h>` | Shows the model table per harness, or swaps the model of one tier and re-renders only the model cells, through the same gate and transaction as `rig apply`. |
| `rig pack add <repo> --sha <sha> --path <path>` | Vendors a pack at one commit, gates it, and prints the ack stanzas the gate needs. |
| `rig pin check <name>` and `rig pin set <name>` | Gates a native plugin, such as pstack, at a commit and records it as a candidate, then promotes the candidate to the lock. |

Exit codes: `0` done, `1` blocked or failed, `2` usage or config error.

### Start work with `/craft`

rig renders one entry command, `/craft`, into every harness. `/craft` reads the active workflow provider for the project and hands the task to it. A project selects its provider only with a `rig-project: <provider>` line in its instructions. rig never guesses it from files in the repository. Without the line, `/craft` uses `default_provider` from `rig.json`. `/pm` is an alias of `/craft`.

```text
/craft add a --json flag to the export command. text output stays byte-identical.
```

[Start work with /craft](./docs/guide/06-craft.md) shows what `/craft` becomes in each harness and where a harness offers less.

## What ships here

| Path | Content |
|---|---|
| `packs/core` | The sealed core: the frame that every harness loads, the principles index, `/craft` and its alias, and the `doc-review` and `second-opinion` slot stubs. |
| `packs/product` | `/oh`, an office-hours product review, ported from gstack under its MIT license (see `packs/product/NOTICE.md`). |
| `providers/` | Workflow provider records for pstack and OpenSpec. |
| `targets/` | One record per harness: where it reads, where rig writes, and which files carry model values. |
| `models/` | `roles.json` maps roles to four tiers. `tiers.json` maps each tier to a model per harness. |

[What rig writes per harness](./docs/harnesses.md) lists every path rig writes and every path it leaves alone.

## Not shipped here

rig routes to workflow providers. It does not bundle them. Install the providers you use with their own installer:

- pstack, as a Claude Code or Cursor plugin. Pin it with `rig pin check pstack` so `/craft` reads a locked version.
- OpenSpec, as its own CLI.

## Make it yours

Put your own config in `~/.config/rig`. The overlay adds packs, fills slots, disables default units and adds model rows for harnesses that the repository leaves empty. It never changes a value that the repository sets. When it tries, rig stops with `E_OVERLAY_CONFLICT`. The overlay lives outside the checkout, so a `git pull` of rig leaves it alone. [Make it yours](./docs/guide/09-make-it-yours.md) covers the four customization operations and how to add a harness target as data.

## Develop rig

```sh
npm test
npm ci --ignore-scripts && npm run typecheck
```

Tests build a temporary HOME and never touch yours. Tests that run real harness CLIs are opt-in with `RIG_LIVE=1`, and they check that your harness config files hash the same before and after. `npm run typecheck` fails when the strict `tsc` error count rises above `tsc-baseline.json`.

Design, decisions and research live in [docs/](./docs/README.md).

rig v1 is in design. rig seeds pstack and gstack from pinned upstream commits and compiles its own mode skill, `rig-mode`, from pack data. Read [the v1 concept](./docs/design/rig-v1-concept.md) and [the first-seed plan](./docs/plan/v1-first-seed-prs.md). This README and the guide describe v0 until the v1 PRs land.
