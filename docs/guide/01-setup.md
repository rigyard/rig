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
| Repo config | your checkout (`RIG_ROOT` overrides it) | `rig.json`, `rig.lock.json`, `packs/`, `targets/`, `providers/`, `models/` | `rig models set` (`models/tiers.json`), `rig pack add`, `rig pin check`, `rig pin set`, and you |
| User overlay | `$XDG_CONFIG_HOME/rig`, else `~/.config/rig` | your own additions to the repo config | `rig pack add --into overlay`, and you |
| State | `$XDG_STATE_HOME/rig`, else `~/.local/state/rig` | `installed.json`, `journal/`, `backups/`, `log/rig.log`, `metrics.jsonl`, `cache/` | `rig apply`, `rig stats --record` (`metrics.jsonl`), the network commands (`cache/osv/`) |
| Data | `$XDG_DATA_HOME/rig`, else `~/.local/share/rig` | `marketplace/`, the local Claude Code marketplace for project packs | `rig apply` |

The overlay only adds keys and entries. If an overlay file sets a value that the repo already sets, rig stops with `E_OVERLAY_CONFLICT` and exit 2. This keeps the repo generic and your private additions in one place. [Decision 0002](../decisions/0002-generic-repo-private-overlay.md) explains the split.

The state root and the data root must resolve inside `$HOME`. If not, rig stops with `E_STATE_ROOT` and exit 2.

## Choose your harnesses

The `harnesses` list in `rig.json` names the harnesses rig writes for. The repo default lists all four:

```text
"harnesses": [
  "claude",
  "codex",
  "omp",
  "cursor"
],
```

Each name must match a target record in `targets/` (`claude.json`, `codex.json`, `omp.json`, `cursor.json`). rig does not look for an installed harness. It plans files for every harness in the list, also on a machine where that harness is not installed.

To drop a harness, edit `rig.json` in your checkout. The overlay cannot remove an entry, and it cannot repeat one. An overlay `rig.json` with `"harnesses": ["claude"]` stops every command:

```text
rig plan: E_OVERLAY_CONFLICT ~/.config/rig/rig.json: harnesses[0]: the repo already lists this entry
```

With `"harnesses": ["claude", "codex"]` in the checkout, the plan shrinks to the files of those two harnesses:

```text
info budget */harness:claude: always-on: 2,475 characters, 619 tokens
info budget */harness:codex: always-on: 1,782 characters, 446 tokens
...
24 changes, 0 blocks
```

## Run your first doctor

`rig doctor` reads your machine and your config. It writes nothing and logs nothing. On a fresh HOME with the repo defaults, it prints:

```text
info  drift     33 changes pending; rig plan lists them
warn  pin       pstack/rig.lock.json: /craft on claude reads pstack from the plugin cache, and pstack has no locked version: run rig pin check pstack
warn  telemetry openspec/providers/openspec.json: openspec sends telemetry by default. Add to your shell profile: export DO_NOT_TRACK=1
info  alias     /pm is an alias of /craft (rig.json aliases). A hand-written pm command at a rendered path blocks rig plan with E_ADOPT_MISMATCH.
0 errors, 2 warnings
```

Each line has a level, a topic and a text. Read them like this:

- `drift` counts the changes that `rig apply` would make. On a fresh HOME every change is a create. The number depends on your packs, your harnesses and the files already on disk.
- `pin` says that `/craft` on Claude Code reads pstack from the plugin cache, and `rig.lock.json` has no pstack entry yet. This is the current state of the repo, not a settled policy. See [open questions](../assumptions-and-open-questions.md). [Packs and pins](./04-packs-and-pins.md) shows what `rig pin check` does.
- `telemetry` names a provider that sends telemetry unless you opt out in your shell profile. rig does not change your shell profile.
- `alias` reminds you that `/pm` renders as an alias of `/craft`. If you already keep a hand-written `pm` command, [Plan, apply, undo](./02-plan-and-apply.md) shows what happens.

The last line counts errors and warnings. Doctor exits 1 when it prints an error, else 0. This run exits 0, because warnings do not block.

After an apply, doctor can also report drift of managed files, duplicate skills per harness and the state of pinned plugins. Run `rig doctor --project <dir>` to see, for one project, which workflow provider and which project packs apply there. [Scope and projects](./05-scope-and-projects.md) covers that form.

Next: [Plan, apply, undo](./02-plan-and-apply.md).
