# rig CLI and repository reference

This page holds command flags, domains, hooks and triggers, harness paths, safety checks, repository layout, and development commands for rig. Start with [the README](../README.md) or [the rig guide](./guide/README.md) for a walkthrough.

## Supported harnesses

| Harness | Skills and frame paths | Model files |
|---|---|---|
| Claude Code | `~/.claude/skills/`, `~/.claude/rules/rig-frame.md`, `~/.claude/agents/` | Frontmatter and agent files in `~/.claude/agents/` |
| Codex | `~/.agents/skills/`, managed block in `~/.codex/AGENTS.md`, `~/.codex/agents/` | `~/.codex/agents/*.toml`, `[agents]` block in `~/.codex/config.toml`, `~/.codex/pstack-models.md` |
| omp | Reads `~/.agents/skills/` (writable `~/.omp/agent/skills/`), managed block in `~/.omp/agent/AGENTS.md` | `modelRoles` keys in `~/.omp/agent/config.yml`, `~/.omp/agent/pstack-models.md` |
| Cursor | Reads `~/.agents/skills/`, `~/.cursor/rules/rig-frame.mdc`, `~/.cursor/agents/` | Agent frontmatter in `~/.cursor/agents/`, `~/.cursor/rules/pstack-models.mdc` |
| Antigravity | `~/.gemini/config/skills.json` pointing to `~/.agents/skills`, `~/.gemini/config/rules/rig-frame.md`, `~/.gemini/config/agents/` | `model` key in `~/.gemini/config/agents/` |

Read [What rig writes per harness](./harnesses.md) for full read-sets, dedupe rules, and never-write paths. Additional harnesses such as `pi` can be added as target records in `targets/<name>.json` ([Make it yours](./guide/09-make-it-yours.md#add-a-harness-as-data)).

## Domains, workflows, hooks, and triggers

`packs/core/domains.json` defines four workflow domains compiled into `/craft` (`craft/references/<domain>.md`):

| Domain | Stages | Shipped fills and hooks on `main` |
|---|---|---|
| Business (`biz`) | `demand`, `scope` | Open slots ready for your own packs |
| Product (`prod`) | `discover`, `shape`, `review`, `spec` | `prod:discover` runs `product/office-hours` (ported from `gstack`); conditional trigger runs `pstack/reframe` |
| Engineering (`eng`) | `ground`, `design`, `build`, `verify`, `review`, `ship` | `eng:ground` (`pstack/how`), `eng:design` (`pstack/architect`), `eng:review.before` (`pstack/no-comments`), `eng:ship.before` (`cursor-team-kit/deslop`), plus `engineering-research` and `cli-for-agents` triggers |
| Upkeep (`upk`) | `upkeep`, `retire` | `worktree-cleanup` playbook from `pstack` |

Customize behavior without changing upstream pack bytes:
- **`fill` step slots and `.before`/`.after` hooks** in `rig.json` bind or replace skills at any `<prefix>:<stage>` address.
- **Domain `triggers`** fire only inside the domain they target, while **frame `triggers`** (with no `domain` field) install into `rig-frame` across every session on all five harnesses (`unslop`, `technical-writing`, `deslop`, `no-comments` by default).
- **`metrics.session_hook`** in `rig.json` or `~/.config/rig/rig.json` installs a Claude Code `SessionEnd` hook running `rig stats --record`.

## Commands

rig has seven commands, and every command accepts `--help`. Exit codes are `0` for done, `1` for blocked or failed, and `2` for a usage or config error.

| Command | What it does |
|---|---|
| `rig plan [--repair]` | Composes domains, packs, hooks, and triggers, renders per harness, runs the gate, and diffs against disk. Writes nothing. `--repair` plans drifted managed entries as writes. |
| `rig apply [--undo <run-id> \| --repair]` | Runs the plan, then writes it as one journaled transaction. `--undo` restores a run byte for byte. `--repair` writes drifted managed files and blocks back to the render. |
| `rig doctor [--project <dir>]` | Read-only diagnosis of the machine, or of one project: drift, the core seal, telemetry, aliases, evidence ledger counts, and scope packs. |
| `rig stats [--since <dur>] [--harness <h>] [--suggest] [--record] [--session <id>]` | Token and session metrics from harness transcripts. `--suggest` writes a proposed diff patch that you review and apply. `--record` records one session. |
| `rig models` and `rig models set <tier> <model> --harness <h>` | Shows the model table per harness, or swaps one tier model and re-renders only model cells through the gate and journal. |
| `rig pack add <repo> --sha <sha> [--root <dir>] [--path <path>] [--exclude <path>] [--port <path>] [--name <name>] [--into overlay]` | Vendors one folder at a full 40-hex commit, gates it, and prints ack stanzas if needed. `--port` tracks upstream sources; `--into overlay` writes into `~/.config/rig`. |
| `rig pin check <name> [--sha <sha>] [--diff] [--exclude <path>] [--no-exclude]` and `rig pin set <name> [--ported]` | Gates a core or pack candidate tree before `rig pin set` promotes it. `--diff` shows upstream port diffs; `--ported` attests a reviewed port (`E_PORT_STALE` otherwise). |

## Safety and supply-chain model

- **Offline by default.** Only `rig pack add`, and `rig pin check` and `rig pin set` of a pack, access the network. All other commands stay offline.
- **Data-only packs and zero runtime dependencies.** Packs and target records are data files, rig executes no pack code, and `test/package.test.ts` rejects any runtime dependency in `package.json`.
- **Ten-check gate on every write.** The gate checks `pin`, `exec`, `secret`, `unicode`, `links`, `mode`, `license`, `cve`, `telemetry` (warn), and `budget` before writing a byte. No flag skips the gate.
- **Journaled writes inside `$HOME`.** Every write goes through one journaled transaction, refuses paths outside `$HOME`, and supports `rig apply --undo <run-id>`.

Read [SECURITY.md](../SECURITY.md) for vulnerability reporting and threat-model details.

## What ships in this repository

| Path | Content |
|---|---|
| `packs/core` | Sealed core: `frame.md`, alias template, `terms.json`, `domains.json`, `craft` shell, `engineering-research`, and `rig-agent` / `rig-janitor`. |
| `packs/pstack`, `packs/cursor-team-kit`, `packs/cli-for-agent` | Engineering workflow (`pstack` hub and 22 playbooks at `b7b93c3`) plus `deslop`, `control-cli`, `control-ui`, and `cli-for-agents` (`2776ddd`) from `https://github.com/cursor/plugins`. |
| `packs/product` | Product discovery skill `office-hours`, ported from `gstack` under MIT ([packs/product/NOTICE.md](../packs/product/NOTICE.md)). |
| `targets/` | One JSON target record per harness (`claude`, `codex`, `omp`, `cursor`, `antigravity`). |
| `models/` | `roles.json` maps roles to four tiers; `tiers.json` maps each tier per harness. |

## Customize with an overlay

Put personal additions in `~/.config/rig`. The overlay adds packs, extra `fill` triggers, harness records outside the repo list, aliases, private terms, and empty model cells, and may enable `metrics.session_hook`. Any attempt to overwrite a key set by the repo fails with `E_OVERLAY_CONFLICT`. Because `~/.config/rig` lives outside the checkout, `git pull` leaves your customizations intact ([Make it yours](./guide/09-make-it-yours.md)).

## Install notes and development

`npm link` places both `rig` and `rigctl` on your `PATH`. Do not run `npm install -g` from a git URL because Node does not strip TypeScript types under `node_modules`.

```sh
npm test
npm ci --ignore-scripts && npm run typecheck
```

Offline tests build a temporary `HOME` and never touch your config files. Live harness CLI tests require `RIG_LIVE=1`. Read [CONTRIBUTING.md](../CONTRIBUTING.md) before opening a pull request.
