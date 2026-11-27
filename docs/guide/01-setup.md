# Set up rig

In this page you install rig from a git checkout and learn where rig keeps its config and its state. Then you choose the harnesses rig writes for and run your first `rig doctor`. At the end you have `rig` on your `PATH` and you know what each line of the doctor report means. Nothing in this page writes into your harness directories.

## Check your Node version

rig needs Node 22.18.0 or later. Run:

```text
node --version
```

The `engines` field in `package.json` says `>=22.18.0`. rig runs its `.ts` files through the native type stripping of Node, so there is no build step and no compiled output. rig does not support an older Node.

## Install from a checkout

Clone the repository and link it:

```text
git clone <rig repository url> ~/src/rig
cd ~/src/rig
npm link
rig --help
```

`npm link` puts `rig` on your `PATH` and points it at your checkout. When you pull new commits, the `rig` command runs the new code at once.

Do not use `npm install -g <git url>`. npm puts the package inside `node_modules`, and Node does not strip types for files there, so the installed `rig` does not run. See [decision 0025](../decisions/0025-typescript-native-type-stripping.md) for the reasons rig ships TypeScript without a build.

## Know where rig keeps things

rig reads two config roots and keeps its own files in two more roots. Each root has one set of commands that write it.

| Root | Default path | What it holds | Written by |
|---|---|---|---|
| Repo config | your checkout (`RIG_ROOT` overrides it) | `rig.json`, `rig.lock.json`, `packs/`, `targets/`, `models/` | `rig models set` (`models/tiers.json`), `rig pack add`, `rig pin check`, `rig pin set`, and you |
| User overlay | `$XDG_CONFIG_HOME/rig`, else `~/.config/rig` | your own additions to the repo config | `rig pack add --into overlay`, and you |
| State | `$XDG_STATE_HOME/rig`, else `~/.local/state/rig` | `installed.json`, `journal/`, `backups/`, `log/rig.log`, `metrics.jsonl`, `cache/` | `rig apply`, `rig stats --record` (`metrics.jsonl`), the network commands (`cache/osv/`) |
| Data | `$XDG_DATA_HOME/rig`, else `~/.local/share/rig` | `marketplace/`, the local Claude Code marketplace for project packs | `rig apply` |

The overlay only adds keys and entries. If an overlay file sets a value that the repo already sets, rig stops with `E_OVERLAY_CONFLICT` and exit 2. The one exception is `metrics.session_hook`: your overlay value wins ([Make it yours](./09-make-it-yours.md)). This keeps the repo generic and your private additions in one place. [Decision 0002](../decisions/0002-generic-repo-private-overlay.md) explains the split.

The state root and the data root must resolve inside `$HOME`. If not, rig stops with `E_STATE_ROOT` and exit 2.

## Choose your harnesses

The `harnesses` list in `rig.json` names the harnesses rig writes for. The repo default lists all five:

```text
"harnesses": [
  "claude",
  "codex",
  "omp",
  "cursor",
  "antigravity"
],
```

Each name must match a target record in `targets/` (`claude.json`, `codex.json`, `omp.json`, `cursor.json`, `antigravity.json`). rig does not look for an installed harness. It plans files for every harness in the list, also on a machine where that harness is not installed.

To drop a harness, edit `rig.json` in your checkout. The overlay cannot remove an entry, and it cannot repeat one. An overlay `rig.json` with `"harnesses": ["claude"]` stops every command:

```text
rig plan: E_OVERLAY_CONFLICT ~/.config/rig/rig.json: harnesses[0]: the repo already lists this entry
```

With `"harnesses": ["claude", "codex"]` in the checkout, the plan shrinks to the files of those two harnesses:

```text
info budget */harness:claude: always-on: 1,289 characters, 323 tokens
info budget */harness:codex: always-on: 654 characters, 164 tokens
...
<n> changes, 0 blocks
```

## Run your first doctor

`rig doctor` reads your machine and your config. It writes nothing and logs nothing. On a fresh HOME with the repo defaults, it prints:

```text
info  drift    279 changes pending; rig plan lists them
info  evidence untested 60, helps 0, no-effect 0, hurts 0, safety 0 (no evidence.json)
0 errors, 0 warnings
```

Each line has a level, a topic and a text. `drift` counts the changes that `rig apply` would make. On a fresh HOME every change is a create. `evidence` counts the units of the repo packs per status in the evidence ledger. The number depends on your packs, your harnesses and the files already on disk.

The last line counts errors and warnings. Doctor exits 1 when it prints an error, else 0.

Doctor also reports a broken core seal (`pin`), a pack whose `pack.json` sends telemetry with no opt-out set (`telemetry`), each alias in `rig.json` (`alias`), the count of your units per evidence status (`evidence`, see [Record what you know about a unit](./09-make-it-yours.md#record-what-you-know-about-a-unit)), and, after an apply, drift of managed files and duplicate skills per harness. Run `rig doctor --project <dir>` to see which project packs apply to one project. [Scope and projects](./05-scope-and-projects.md) covers that form.

Next: [Plan, apply, undo](./02-plan-and-apply.md).
