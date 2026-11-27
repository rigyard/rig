# rig CLI and repository reference

This page holds the detailed command flags, harness paths, safety checks, repository layout, and development commands for rig. Start with [the README](../README.md) or [the rig guide](./guide/README.md) if you are setting up rig for the first time.

## Supported harnesses

| Harness | Skills and frame paths | Model files |
|---|---|---|
| Claude Code | `~/.claude/skills/`, `~/.claude/rules/rig-frame.md`, `~/.claude/agents/` | Frontmatter and agent files in `~/.claude/agents/` |
| Codex | `~/.agents/skills/`, managed block in `~/.codex/AGENTS.md`, `~/.codex/agents/` | `~/.codex/agents/*.toml`, `[agents]` block in `~/.codex/config.toml`, `~/.codex/pstack-models.md` |
| omp | Reads `~/.agents/skills/` (writable `~/.omp/agent/skills/`), managed block in `~/.omp/agent/AGENTS.md` | `modelRoles` keys in `~/.omp/agent/config.yml`, `~/.omp/agent/pstack-models.md` |
| Cursor | Reads `~/.agents/skills/`, `~/.cursor/rules/rig-frame.mdc`, `~/.cursor/agents/` | Agent frontmatter in `~/.cursor/agents/`, `~/.cursor/rules/pstack-models.mdc` |
| Antigravity | `~/.gemini/config/skills.json` pointing to `~/.agents/skills`, `~/.gemini/config/rules/rig-frame.md`, `~/.gemini/config/agents/` | `model` key in `~/.gemini/config/agents/` |

Read [What rig writes per harness](./harnesses.md) for full read-sets, dedupe rules, and never-write paths.

## Commands

rig has seven commands, and every command accepts `--help`. Exit codes are `0` for done, `1` for blocked or failed, and `2` for a usage or config error.

| Command | What it does |
|---|---|
| `rig plan [--repair]` | Composes the stack, renders it per harness, runs the gate, and diffs it against disk and rig state. Writes nothing. `--repair` plans drifted managed entries as writes. |
| `rig apply [--undo <run-id> \| --repair]` | Runs the plan, then writes it as one journaled transaction. `--undo` restores a run byte for byte. `--repair` writes drifted managed files and blocks back to the render. |
| `rig doctor [--project <dir>]` | Read-only diagnosis of the machine, or of one project: drift, the core seal, telemetry, aliases, the evidence ledger counts, and the scope packs of the project. |
| `rig stats [--since <dur>] [--harness <h>] [--suggest] [--record] [--session <id>]` | Token and session metrics read from harness transcripts. `--suggest` adds a proposed diff that you apply yourself. `--record` records one session, from the session hook or by hand with `--session <id>`. |
| `rig models` and `rig models set <tier> <model> --harness <h>` | Shows the model table per harness, or swaps the model of one tier and re-renders only the model cells, through the same gate and transaction as `rig apply`. |
| `rig pack add <repo> --sha <sha> [--root <dir>] [--path <path>] [--exclude <path>] [--port <path>] [--name <name>] [--into overlay]` | Vendors one folder of a repo at a full 40-hex commit, minus the excludes, gates it, and prints the ack stanzas the gate needs. `--port` records the upstream sources of a port. With `--port` and no `--path`, it adopts a pack folder that you wrote. `--into overlay` writes the pack and its lock entry into your overlay. |
| `rig pin check <name> [--sha <sha>] [--diff] [--exclude <path>] [--no-exclude]` and `rig pin set <name> [--ported]` | For core, gates the core tree, records its tree hash as a candidate, then promotes it to the core seal. For a pack, gates the pack at a new commit with its license and exclude list, prints `port fresh` or `port stale` for its port paths, then moves the pack to that commit. `--diff` prints the port diff and records nothing. `--ported` attests a reviewed port. A stale port blocks `rig plan` with `E_PORT_STALE`. |

## Safety and supply-chain model

- **Offline by default.** Only `rig pack add`, and `rig pin check` and `rig pin set` of a pack, access the network. All other commands stay offline.
- **Data-only packs and zero runtime dependencies.** Packs and target records are data files, rig executes no pack code, and `test/package.test.ts` rejects any runtime dependency in `package.json`.
- **Ten-check gate on every write.** The gate checks `pin`, `exec`, `secret`, `unicode`, `links`, `mode`, `license`, `cve`, `telemetry` (warn), and `budget` before writing a byte. No flag skips the gate.
- **Journaled writes inside `$HOME`.** Every write goes through one journaled transaction, refuses paths outside `$HOME`, and supports `rig apply --undo <run-id>`.

Read [SECURITY.md](../SECURITY.md) for vulnerability reporting and threat-model details.

## What ships in this repository

| Path | Content |
|---|---|
| `packs/core` | The sealed core: the frame that every harness loads, the per-harness terms, the alias template, the domain table, the `craft` shell, the `engineering-research` skill, and the agents `rig-agent` and `rig-janitor`. Their model and effort come from the model table. |
| `packs/pstack`, `packs/cursor-team-kit`, `packs/cli-for-agent` | Upstream bytes of pstack, three cursor-team-kit skills, and `cli-for-agents`, vendored from `https://github.com/cursor/plugins` (pstack at `b7b93c3`, the other two at `2776ddd`). pstack's hub and playbooks install inside the `craft` mode skill ([Run multi-step work with /craft](./guide/06-craft.md)). `rig.json` disables pstack's two agents, and the core agents take their place. |
| `packs/product` | The `office-hours` skill, a product review ported from gstack under its MIT license (see [packs/product/NOTICE.md](../packs/product/NOTICE.md)). |
| `targets/` | One record per harness: where it reads, where rig writes, and which files carry model values. |
| `models/` | `roles.json` maps roles to four tiers. `tiers.json` maps each tier to a model per harness. |

## Customize with an overlay

Put your own config in `~/.config/rig`. The overlay adds packs, harnesses that the repository does not list, aliases, new `fill` addresses, `disable` and `auto` entries, private terms, and model rows that the repository leaves empty. It never changes a value that the repository sets, stopping with `E_OVERLAY_CONFLICT` if it tries. The one exception is `metrics.session_hook`, where your value wins. The overlay lives outside the checkout, so a `git pull` of rig leaves it alone. Read [Make it yours](./guide/09-make-it-yours.md) for the four customization operations and adding a harness target as data.

## Install notes and development

`npm link` places both `rig` and `rigctl` on your `PATH`. Use `rigctl` if Homebrew `rig` is already installed. Do not run `npm install -g` from a git URL because Node does not strip TypeScript types for files under `node_modules`.

```sh
npm test
npm ci --ignore-scripts && npm run typecheck
```

Offline tests build a temporary `HOME` and never touch your config files. Live harness CLI tests are opt-in with `RIG_LIVE=1` and verify that your real config hashes stay unchanged. `npm run typecheck` fails when the strict `tsc` error count rises above `tsc-baseline.json`. Read [CONTRIBUTING.md](../CONTRIBUTING.md) before opening a pull request.
