# Set up rig

Install rig from a checkout, configure the active harnesses, and run a read-only `rig doctor` report.

## Check Node and link the CLI

rig requires Node 22.18.0 or later and runs TypeScript directly with zero build step (`node --version`).

```text
git clone https://github.com/rigyard/rig.git ~/src/rig
cd ~/src/rig
npm link
rig --help
```

Use `rigctl` when Homebrew `rig` is already on `PATH`. Do not run `npm install -g <git url>` because Node does not strip types inside `node_modules` ([decision 0025](../decisions/0025-typescript-native-type-stripping.md)).

## Let your agent do it

Paste this prompt into any coding agent. It needs no checkout first. The agent follows [AGENTS.md](../../AGENTS.md) and stops for your approval before any write:

```text
Set up rig for me. Read https://raw.githubusercontent.com/rigyard/rig/main/AGENTS.md and follow it: clone the repo, run rig doctor and rig plan, explain the diff, and wait for my approval before rig apply.
```

## Config and state roots

| Root | Default path | Purpose | Written by |
|---|---|---|---|
| Repo config | checkout root (`RIG_ROOT`) | `rig.json`, `rig.lock.json`, `packs/`, `targets/`, `models/` | `rig models set`, `rig pack add`, `rig pin check`, `rig pin set`, you |
| User overlay | `$XDG_CONFIG_HOME/rig` or `~/.config/rig` | Additive overrides outside git pull | `rig pack add --into overlay`, you |
| State | `$XDG_STATE_HOME/rig` or `~/.local/state/rig` | `installed.json`, `journal/`, `backups/`, `log/rig.log`, `metrics.jsonl`, `cache/` | `rig apply`, `rig stats --record`, network pin/pack commands |
| Data | `$XDG_DATA_HOME/rig` or `~/.local/share/rig` | `marketplace/` for Claude Code project packs | `rig apply` |

Overlays can only add entries (`E_OVERLAY_CONFLICT` otherwise), except `metrics.session_hook` ([Make it yours](./09-make-it-yours.md)). State and data roots must stay inside `$HOME` (`E_STATE_ROOT` otherwise).

## Choose active harnesses

`rig.json` enables all five shipped targets in `targets/`:

```text
"harnesses": [
  "claude",
  "codex",
  "omp",
  "cursor",
  "antigravity"
],
```

Edit `harnesses` in your checkout `rig.json` to drop unused targets (overlays cannot remove repo entries).

```text
rig plan: E_OVERLAY_CONFLICT ~/.config/rig/rig.json: harnesses[0]: the repo already lists this entry
```

## Run your first doctor

`rig doctor` reads your environment without writing any files. On a fresh `HOME`:

```text
info  drift    279 changes pending; rig plan lists them
info  evidence untested 60, helps 0, no-effect 0, hurts 0, safety 0 (no evidence.json)
0 errors, 0 warnings
```

It reports pending drift, evidence counts, core seal status, missing telemetry opt-outs, aliases, duplicate skills after apply, and `--project <dir>` scope status. Exits 1 on any error.

Next: [Plan, apply, undo](./02-plan-and-apply.md).
