# rig v0 architecture

Status: v0 architecture, 2026-11-04. Updated 2026-11-05 for what the merged PRs changed. It turns design Draft v4 and the Accepted decisions 0001 to 0024 into data shapes, module boundaries and a type sketch. It contains no implementation code. Section [What changes from Draft v4](#14-what-changes-from-draft-v4) lists each delta and its reason. The slice plan is in [v0 slices](../plan/v0-slices.md).

Measured values come from one machine. They show shapes, not targets.

## 1. Usage

### CLI README

rig is one Node ESM CLI with zero npm dependencies. It composes packs, runs one gate, and writes pinned copies into Claude Code, Codex, omp and Cursor.

```
rig plan [--repair]                            compose, render, gate, diff against disk and state; writes nothing
rig apply [--undo <run-id> | --repair]         plan, then the journaled write; the only writer into ~
rig doctor [--project <dir>]                   read-only diagnosis of the machine, or of one project
rig stats [--since <dur>] [--harness <h>] [--suggest]
                                               metrics from transcripts; --suggest adds a proposed diff
rig stats --record [--session <id>]            hook mode: record one session in the store
rig models [set <tier> <model> --harness <h>]  effective model table, or a tier swap through apply
rig pack add <repo> --sha <sha> --path <path> [--into overlay]
                                               vendor a pack at a commit, gate it, print ack stanzas
rig pin check <name> [--sha <sha>]             gate a native plugin tree at a commit, record a candidate
rig pin set <name>                             promote the candidate when the installed commit matches
```

Top-level commands: `plan`, `apply`, `doctor`, `stats`, `models`, `pack`, `pin`. That is 7. `pack` has one subcommand (`add`). `pin` has two (`check`, `set`).

| Command | Purpose | Writes | Network |
|---|---|---|---|
| `rig plan` | Compose, render, gate, observe, plan. Prints one line per op and every finding. Warns on each effective duplicate per harness (section 7). Exit 1 on an unacked block, drift, an adopt mismatch or a compose error. It replaces the draft's `audit` command: plan writes nothing, so plan is the audit. | nothing | no |
| `rig apply` | The same pipeline, then the journaled transaction. Recovers an interrupted run first. | harness files under `~`, the state root, the local marketplace | no |
| `rig apply --repair` | The same pipeline with each drifted recorded entry planned as a write: a removed file as a create, an edited file as an update, a block or cells region rewritten without the user's text around it. Not a fifth operation: `apply` with a flag. | as apply | no |
| `rig apply --undo <run-id>` | Restores the pre-images of one run, newest op first, only where the current bytes equal that run's post-image. One conflicting path stops the undo before any write. Journaled as a new run. | the same | no |
| `rig doctor` | Drift of managed files and cells, effective duplicates per harness, pins against installed plugins, auto-update marketplaces, a marketplace plugin that shadows the rig local plugin on Cursor, env overrides of models, the `/pm` alias reminder, telemetry env, stale model names in prose. | nothing | no |
| `rig doctor --project <dir>` | Adds: the declared provider (`rig-project:` line) and its source, agreement with the overlay `projects` map, footprints as info, the scope packs declared for the directory and whether the user enabled them, and the paths to commit for a pack that is absent on Codex, omp or Cursor. | nothing | no |
| `rig stats` | Reads transcripts, appends content-free aggregates to `metrics.jsonl`, prints a report. | state root only | no |
| `rig stats --suggest` | Adds a proposed unified diff against config. Prints it and writes it to `proposals/<date>.patch`. Applies nothing. | state root only | no |
| `rig stats --record` | Hook mode. Reads the session id and transcript path from the hook JSON on stdin, records that session. Prints 0 bytes, exits 0 on every error, logs errors. | state root only | no |
| `rig stats --record --session <id>` | Records one named session by hand. Reads no stdin. Finds the transcript under each harness's transcript root. Prints one line. Exit 1 on an error. | state root only | no |
| `rig models` | Effective table per harness, with the source of each value: `tiers.json`, a pinned id, or an env override. | nothing | no |
| `rig models set <tier> <model> --harness <h>` | Edits `models/tiers.json`, then runs the apply pipeline restricted to model-bearing files. Same gate, same writer. Prints the diff. | `models/tiers.json`, then as apply | no |
| `rig pack add` | Clones at the commit into a temp dir, copies the paths, hashes the tree, writes the lock entry and a `pack.json` skeleton, runs the gate, refreshes the OSV cache, prints findings and ack stanzas. | `packs/<name>/` and the lock of one config root, plus `cache/osv/` and `log/` in the state root | yes |
| `rig pin check <name> --sha <sha>` | Clones the plugin's marketplace repo at the commit, gates the plugin tree, refreshes the OSV cache, records `candidate` in the lock. For `core` it hashes `packs/core/` instead and needs no `--sha` and no network. | the lock of one config root, plus `cache/osv/` and `log/` in the state root | yes, except `core` |
| `rig pin set <name>` | Promotes `candidate` to `current`. For a native plugin it refuses unless the installed `gitCommitSha` equals the candidate. | the lock of one config root | no |

Flags:

| Flag | Command | Rule |
|---|---|---|
| `--undo <run-id>` | `apply` | The run must have a journal. Excludes `--repair`. |
| `--repair` | `plan`, `apply` | Plans each drifted owned, block or cells entry that `installed.json` records as a write of the render; an unmanaged collision keeps `E_ADOPT_MISMATCH`. On `apply` the writes use the same journal and backups, so `--undo` restores the edited bytes. |
| `--project <dir>` | `doctor` | Read-only. rig never writes into `<dir>`. |
| `--since <dur>` | `stats` | `7d`, `24h`, `30m`. Default `30d`. |
| `--harness <h>` | `stats`, `models set` | A harness id from `targets/*.json`. Required for `models set`. |
| `--suggest` | `stats` | Adds the proposed diff. Writes only under the state root. |
| `--record` | `stats` | Hook mode. Cannot combine with `--since`, `--harness` or `--suggest`. |
| `--session <id>` | `stats` | Only with `--record`. |
| `--sha <sha>` | `pack add`, `pin check` | Required, except `pin check core`. |
| `--path <path>` | `pack add` | Required. Repeatable. |
| `--into overlay` | `pack add` | Writes into `~/.config/rig/` instead of the repo. |
| `--help` | every command | Prints help derived from the command table. |

Exit codes:

| Code | Meaning |
|---|---|
| 0 | Done. No block. Warnings may exist. |
| 1 | Blocked or failed: a gate block, drift, an adopt mismatch, an undo conflict, a compose error, or an internal error (`E_INTERNAL`). The output names the code. |
| 2 | Usage or config error: an unknown command, an unknown flag, a missing required flag, a config parse error (`E_SCHEMA`, `E_SCOPE_MODE`), or a state root or data root outside `$HOME` (`E_STATE_ROOT`). |

`rig doctor` exits 1 when a finding is an error (drift, a managed duplicate, a pin mismatch) and 0 when findings are info or warnings only.

Logging: `plan` and `doctor` write nothing, so they write no log either. Only `apply`, `stats`, `pack`, `pin` and `models set` append to `log/rig.log` in the state root.

No skip flag exists. The parser is strict and derives from the one command table in `bin/rig.ts`, so no parse path accepts a flag that the table does not list. Help text and dispatch derive from the same table.

Error codes:

| Code | Raised by | Meaning |
|---|---|---|
| `E_USAGE` | `bin/rig.ts` | Unknown command or flag, missing required flag. Exit 2. |
| `E_SCHEMA` | `world` | Unknown key, wrong type, missing `schema` field, bad enum value, empty ack reason, missing ack expiry. A parse error, exit 2. |
| `E_SCOPE_MODE` | `world` | `rig.json` picks a scope that `pack.json` does not list. A parse error, exit 2. |
| `E_STATE_ROOT` | `world` | The state root or the data root does not resolve inside `$HOME`. Exit 2. |
| `E_OVERLAY_CONFLICT` | `world` | The overlay sets a key that the repo already sets, or names a core unit. |
| `E_STATE_IN_READSET` | `world` | The state root, the data dir or a backup path lies inside a declared read-set. |
| `E_CLASH` | `stack` | Two packs install the same name and neither declares `replaces`. A foreign unit with the same name also clashes. |
| `E_CORE_SHADOW` | `stack` | A pack unit uses a core name. |
| `E_SLOT_TWICE` | `stack` | A slot has a second filler. |
| `E_READSET` | `targets` | No placement gives each harness exactly one copy. |
| `E_SAME_FAMILY` | `targets` | A `second-opinion` filler runs the same CLI as the current harness, and the filler record forbids it. |
| `E_TERM_UNKNOWN`, `E_TERM_MISSING` | `targets` | A `{{rig:term}}` placeholder is not in `terms.json`, or a target has no row for it. `{{rig:intake}}` comes from the provider records, not from `terms.json`. A `{{name}}` variable in a core template is not one of that template's variables. |
| `E_LOCATOR` | `targets` | A declared cell is absent, a cell matches twice, or a `block` has no markers while its table already exists outside them. |
| `E_ADOPT_MISMATCH` | `state` | First run on a path, and its current bytes or values differ from the render. This covers an unmanaged file at a rendered path, for example a hand-written `/pm`. |
| `E_DRIFT` | `state` | Current bytes or cell values differ from what rig last wrote. |
| `E_JSON_ROUNDTRIP` | `targets`, `world` | A JSON file rig must edit does not round-trip byte-identical. |
| `E_CONTAINMENT` | `fs` | A path resolves outside `$HOME`, through a symlinked parent, into a `never_write` glob, or onto a symlink. |
| `E_CHANGED_UNDER` | `state` | A file changed between plan and its rename. The run stops. |
| `E_LOCKED` | `state` | Another rig run holds the state lock. |
| `E_RECOVERY_CONFLICT` | `state` | A journaled path matches neither its before nor its after hash. |
| `E_UNDO_CONFLICT` | `state` | A path of the undone run no longer has that run's after hash. One finding per path. |
| `E_PIN_UNCHECKED` | `lock` | `pin set` found an installed commit that `pin check` did not record. |
| `E_INTERNAL` | any | A bug. Exit 1. |

Output of `plan`, one line per op:

```
create        owned   claude  ~/.claude/skills/explain/SKILL.md      own/explain
patch-cells   cells   omp     ~/.omp/agent/config.yml                modelRoles.advisor: <provider>/<model-a>:medium -> <provider>/<model-b>:medium
adopt         cells   claude  ~/.claude/rules/orchestration.md       12 cells equal
insert-markers cells  claude  ~/.claude/rules/orchestration.md       2 marker pairs
block         owned   claude  ~/.claude/commands/pm.md               E_ADOPT_MISMATCH (diff below)
4 changes, 1 block
```

A run with nothing to do prints `0 changes, 0 blocks` and exits 0.

### Case A: add a pack

Goal: vendor a skill pack from a public repo and install it hidden on Claude Code and Cursor.

1. `rig pack add https://github.com/acme/agent-skills --sha 1a2b3c4 --path skills/review-kit`
   - `lib/lock.ts` clones into a temp dir, copies `skills/review-kit` into `packs/review-kit/`, hashes the tree, writes the lock entry and `packs/review-kit/pack.json` with the detected license and `"scopes": ["machine-hidden"]`.
   - `lib/gate.ts` runs every check on the new pack. The OSV cache refreshes here, because this command may use the network.
   - Output: `block exec review-kit/scripts/fmt.sh: shebang` plus an ack stanza. Exit 1.
2. You read `scripts/fmt.sh`. You paste the stanza into `audit.allow.json` with a reason and an expiry. rig never writes that file.
3. You add the pack to `rig.json`: `"review-kit": {"harnesses": ["claude", "cursor"]}`. No `scope` key means `machine-hidden`.
4. `rig plan` shows `create owned claude ~/.claude/skills/review/SKILL.md review-kit/review`. Cursor gets no line: `place()` found that `~/.claude/skills` serves both harnesses (section 7). Exit 0.
5. `rig apply` runs the same pipeline, journals each op, writes the copies, records them in `installed.json`. A second `rig apply` prints `0 changes`.

Files touched: `packs/review-kit/**`, `rig.lock.json` (by rig), `audit.allow.json` and `rig.json` (by you). No code.

### Case B: swap a model after a vendor release

Goal: a vendor releases a model. You move the `strong` tier on omp to it.

1. `rig models` prints the table. The `strong` row on omp shows `<provider>/<model-a>`, source `tiers.json`. The Claude row shows `opus`, source `tiers.json (alias)`.
2. `rig models set strong <provider>/<model-b> --harness omp`
   - `lib/models.ts` builds a new tiers object in memory.
   - `bin/rig.ts` runs the pipeline on that in-memory world, restricted to model-bearing ops.
   - If anything blocks, rig writes nothing and exits 1.
   - Otherwise `models.ts` writes `models/tiers.json`, and `state.apply` patches the cells: one line in `~/.omp/agent/config.yml` (kind `keys`, the `modelRoles` key mapped to `strong`). Surfaces of other harnesses do not change.
   - Output: the diff of each changed cell, `1 change, 0 blocks`.
3. You commit `models/tiers.json`.

Claude needs no step for a Claude release: the alias `opus` resolves to the new model. A pinned Claude tier (`"strong": {"claude": {"id": "<full-id>"}}`) renders the full id into agent frontmatter and needs a `models set` like any other harness.

The other way, a hand edit of `tiers.json` followed by `rig apply`, reaches the same state through the same writer. It is the same data edit, not a second mechanism. `models set` adds one thing: it writes `tiers.json` only when the plan has no block.

### Case C: add a target

Goal: add pi as a harness in v1.

1. Write `targets/pi.json` from the schema in section 2.4: read-set dirs (`~/.pi/agent/skills`, `~/.agents/skills`), `dedupe: "by-name"` for both (first wins, with a warning), command format `md-body` in `~/.pi/agent/prompts`, instructions `~/.pi/agent/AGENTS.md` in `managed-block` mode, `transcripts: null`, `hooks.session_end: null`, `project_scope: null`.
2. Add a `pi` row to each term in `packs/core/terms.json`. A pack text that uses a term with no `pi` row fails compose with `E_TERM_MISSING`, so the build tells you which rows are missing. `terms.json` is core, so run `rig pin check core` and `rig pin set core` to reseal it. The commit shows the change.
3. Add `"pi"` to `rig.json` `harnesses`.
4. `rig plan` recomputes every placement. pi reads `~/.agents/skills`, which Codex and Cursor read too. Units that already sit there now also reach pi. Units that need a pi copy get `~/.pi/agent/skills`. Any unit with no valid placement fails with `E_READSET`, naming pi and the colliding dirs.
5. `rig apply`.

Files touched: `targets/pi.json`, `packs/core/terms.json` plus the core seal in `rig.lock.json`, `rig.json`. A harness whose format fits no enum value (for example a new agent file format) needs one new enum value and its renderer in `lib/targets/`, which is a core change.

## 2. Data model

### Roots

| Root | Path | Owner | Content |
|---|---|---|---|
| Repo config root | the rig repo | the user, in git | `rig.json`, `packs/`, `targets/`, `providers/`, `models/`, `rig.lock.json`, `audit.allow.json` |
| Overlay config root | `~/.config/rig/` | the user, its own git repo | the same layout, its own lock and acks |
| State root | `$XDG_STATE_HOME/rig/`, default `~/.local/state/rig/` | rig | `installed.json`, `journal/`, `backups/`, `apply.lock`, `metrics.jsonl`, `proposals/`, `log/`, `cache/osv/` |
| Data root | `$XDG_DATA_HOME/rig/`, default `~/.local/share/rig/` | rig | `marketplace/`: the local Claude Code marketplace for plugin-channel packs |

No harness lists the state root or the data root in its read-set. `world` checks this at load and fails with `E_STATE_IN_READSET` when a user sets `XDG_STATE_HOME` inside one. Backups therefore never load as units (Claude Code reads `~/.claude/rules/` recursively, so a backup there would load).

Every config file is plain JSON with a `schema` integer and closed keys. The examples below use `//` comments for the reader only. Files that rig edits (`rig.lock.json`, `models/tiers.json`) must stay in canonical form, `JSON.stringify(v, null, 2) + "\n"`. A file that does not round-trip makes rig refuse the edit with `E_JSON_ROUNDTRIP` and print the value to set.

### 2.1 rig.json

Repo root:

```jsonc
{
  "schema": 1,
  "harnesses": ["claude", "codex", "omp", "cursor"],     // ids of targets/*.json that this machine uses
  "packs": {
    "own":        {},                                      // no scope key: machine-hidden
    "review-kit": {"scope": "machine-hidden", "harnesses": ["claude", "cursor"]},
    "notes":      {"channel": {"claude": "plugin"}}        // E_READSET exit, section 7
  },
  "pins": ["pstack"],                                      // native plugins rig gates but does not copy
  "providers": ["pstack", "openspec", "codex-cli"],        // ids of providers/*.json in use
  "default_provider": "pstack",
  "aliases": {"pm": "craft"},
  "slots": {
    "second-opinion": {"provider": "codex-cli", "tier": "strong", "harnesses": ["claude", "omp", "cursor"]},
    "doc-review": null                                     // empty filler: the stub says so
  },
  "disable": ["own/explain"],                              // pack/unit; a core unit here is E_SCHEMA
  "metrics": {"session_hook": false}
}
```

Overlay root (`~/.config/rig/rig.json`). It adds keys or entries. It never overrides a repo value.

```jsonc
{
  "schema": 1,
  "packs": {"acme-notes": {"scope": "project", "projects": ["~/src/acme-app"]}},
  "providers": ["acme-flow"],
  "projects": {"~/src/acme-app": {"provider": "acme-flow"}},   // doctor --project checks the line agrees; it selects nothing
  "model_surfaces": [                                          // user files that hold model cells
    {"path": "~/.claude/rules/orchestration.md", "harness": "claude", "consumer": "fleet", "markers": true,
     "kind": "cells", "header": "| Role | Model, effort | Use for |",
     "key_column": "Role", "column": "Model, effort", "grammar": "{display}, {effort}[, {rest}]"},
    {"path": "~/.claude/rules/orchestration.md", "harness": "claude", "consumer": "fleet", "markers": true,
     "kind": "cells", "header": "| Role | Default | Lower to | Raise to |",
     "key_column": "Role", "column": "Default", "grammar": "{effort}"}
  ],
  "private_terms": ["acme-internal"]                           // secret check: blocks these in repo packs
}
```

Rules:

- `packs.<name>.scope` is one of `machine-hidden`, `project`, `hybrid` (decision 0017). No `scope` key means `machine-hidden`. `project` and `hybrid` need `projects`. A scope that `pack.json` does not list is a parse error, `E_SCOPE_MODE`, exit 2.
- `packs` is one object per pack. It holds the list of packs and each pack's scope choice together, so the draft's separate `scope` map does not exist.
- `packs.<name>.harnesses` narrows the default (`rig.json` `harnesses`). `channel` picks a non-skill-dir channel per harness. v0 knows one value, `plugin`, on Claude Code.
- `slots.<slot>` takes one filler. A second filler in the overlay is `E_SLOT_TWICE`. `harnesses` narrows where the stub renders. A headless filler that forbids its own family must leave its own harness out, or compose fails with `E_SAME_FAMILY`.
- No key lets rig replace an unmanaged file. An existing file at a rendered path that differs from the render blocks adopt with a diff (section 8). You move the file, or make it equal.

### 2.2 pack.json

`pack.json` lists exceptions only. Units come from the directory layout: `skills/<name>/SKILL.md`, `commands/<name>.md`, `agents/<name>.md`, `rules/<name>.md`.

```jsonc
{
  "schema": 1,
  "name": "review-kit",
  "scopes": ["machine-hidden", "project"],          // scopes the pack supports; rig.json picks one
  "license": "MIT",                                 // detected by pack add; the license check reads it
  "source": {"repo": "https://github.com/acme/agent-skills", "sha": "1a2b3c4", "paths": ["skills/review-kit"]},
  "units": {
    "review": {"harnesses": ["claude", "cursor"]},  // narrows one unit
    "explain": {"replaces": "own/explain"}          // replace operation; a core name here is E_SCHEMA
  }
}
```

`source` is null for packs written in the repo, such as `own`.

### 2.3 Core pack

`packs/core/` is sealed by its tree hash in `rig.lock.json`. It is always installed and never listed in `packs`. Members:

- `frame.md`: the frame template (precedence, the `rig-project:` rule, four invariants, slot lines, the router line, the principles pointer).
- `principles.md`: the principles index. v0 entries point at the pstack pin's `principle-*` leaves.
- `skills/rig-second-opinion/`, `skills/rig-doc-review/`: slot stubs. The body renders from the filler.
- `commands/craft.md`: the entry template. `commands/alias.md`: the one-line template that each `aliases` entry renders, for example `/pm` (section 12).
- `terms.json`: the vocabulary.
- `schemas/`: one JSON schema per config file.

`terms.json`:

```jsonc
{
  "schema": 1,
  "terms": {
    "ask-user":   {"claude": "use AskUserQuestion", "codex": "ask in one short numbered list", "omp": "use the ask tool", "cursor": "use AskQuestion"},
    "subagent":   {"claude": "the Agent tool", "codex": "a spawned agent", "omp": "the task tool", "cursor": "a subagent"}
  }
}
```

Pack text may use `{{rig:ask-user}}`. An unknown key fails with `E_TERM_UNKNOWN`. A used key with no row for a target harness fails with `E_TERM_MISSING`. No free-string rewrite exists.

### 2.4 targets/\<h\>.json

The full Claude Code record:

```jsonc
{
  "schema": 1,
  "name": "claude",
  "root": "~/.claude",
  "reads": {
    "skills": [
      {"path": "~/.claude/skills", "writable": true, "dedupe": "none"},
      {"path": "~/.claude/plugins/cache", "writable": false, "plugin": true, "dedupe": "none"}
    ],
    "never_write": ["~/.claude/plugins/**"]
  },
  "channels": {"plugin": {"marketplace": "rig-local", "dir": "$XDG_DATA_HOME/rig/marketplace"}},
  "units": {
    "skill":   {"frontmatter": "keep", "sidecar": null},
    "command": {"dir": "~/.claude/commands", "format": "md-frontmatter"},
    "agent":   {"dir": "~/.claude/agents", "format": "claude-md"},
    "rule":    {"dir": "~/.claude/rules", "format": "md"}
  },
  "hide": {"method": "frontmatter-key", "key": "disable-model-invocation", "value": true},
  "instructions": {"path": "~/.claude/rules/rig-frame.md", "mode": "whole-file"},
  "effort_syntax": "separate-key",
  "model_surfaces": [
    {"path": "~/.claude/agents/{role}.md", "consumer": "fleet", "kind": "frontmatter",   // hand-written files
     "keys": {"model": "model", "effort": "effort"}, "display_in": "description"}
  ],
  "project_scope": {"channel": "plugin", "enable_file": ".claude/settings.local.json"},   // probe (k)
  "hooks": {"session_end": {"event": "SessionEnd", "file": "~/.claude/settings.json", "pointer": "/hooks/SessionEnd",
                            "payload": ["session_id", "transcript_path"]}},               // probe (h)
  "transcripts": {"format": "claude-jsonl", "root": "~/.claude/projects"},
  "facts": {"installed_plugins": "~/.claude/plugins/installed_plugins.json",
            "marketplaces": "~/.claude/plugins/known_marketplaces.json"},
  "budget": {"description_max": 1536, "listing_fraction": 0.01, "instructions_max_bytes": null}
}
```

The other v0 records differ in these fields (values before slice 0 probes):

```jsonc
// targets/codex.json
{"reads": {"skills": [{"path": "~/.codex/skills", "writable": true, "dedupe": "none"},
                      {"path": "~/.agents/skills", "writable": true, "dedupe": "none"}], "never_write": []},
 "units": {"skill": {"frontmatter": "keep", "sidecar": "openai-yaml"},
           "command": {"dir": "~/.codex/prompts", "format": "md-body"},
           "agent": {"dir": "~/.codex/agents", "format": "codex-toml"}},
 "hide": {"method": "sidecar", "file": "agents/openai.yaml", "key": "policy.allow_implicit_invocation", "value": false},  // probe (f)
 "instructions": {"path": "~/.codex/AGENTS.md", "mode": "managed-block"},
 "effort_syntax": "separate-key",
 "model_surfaces": [
   {"path": "~/.codex/agents/{role}.toml", "consumer": "fleet", "kind": "whole",
    "keys": {"model": "model", "effort": "model_reasoning_effort"}, "text_from": "~/.claude/agents/{role}.md"},
   {"path": "~/.codex/config.toml", "consumer": "codex", "kind": "block", "marker": "rig:models", "table": "agents",
    "keys": {"model": "default_subagent_model", "effort": "default_subagent_reasoning_effort"}}],
 "project_scope": null, "hooks": {"session_end": null},                                       // Stop fires per turn
 "transcripts": {"format": "codex-rollout", "root": "~/.codex/sessions"},
 "budget": {"description_max": 1024, "instructions_max_bytes": null}}                          // probe (d)

// targets/omp.json
{"reads": {"skills": [{"path": "~/.omp/agent/skills", "writable": true, "dedupe": "identical-bytes"},
                      {"path": "~/.claude/skills", "writable": false, "dedupe": "identical-bytes"},
                      {"path": "~/.codex/skills", "writable": false, "dedupe": "identical-bytes"}],   // probe (e)
           "never_write": ["~/.omp/agent/extensions/**", "~/.omp/agent/config.yml.lock"]},
 "units": {"command": {"dir": "~/.omp/agent/commands", "format": "md-frontmatter"}, "agent": null},  // probe (e)
 "hide": {"method": "frontmatter-key", "key": "hide", "value": true},
 "instructions": {"path": "~/.omp/agent/AGENTS.md", "mode": "managed-block"},                  // probe (g)
 "effort_syntax": "colon-suffix",
 "model_surfaces": [{"path": "~/.omp/agent/config.yml", "consumer": "omp", "kind": "keys",
                     "map": "modelRoles", "grammar": "{model_effort}", "harness_rewrites": true}],  // probe (c)
 "project_scope": null, "hooks": {"session_end": null},                                       // no session-end event known
 "transcripts": {"format": "omp-jsonl", "root": "~/.omp/agent/sessions"}}

// targets/cursor.json
{"reads": {"skills": [{"path": "~/.cursor/skills", "writable": false, "dedupe": "none"},
                      {"path": "~/.agents/skills", "writable": false, "dedupe": "none"},
                      {"path": "~/.claude/skills", "writable": false, "dedupe": "none"},
                      {"path": "~/.codex/skills", "writable": false, "dedupe": "none"},
                      {"path": "~/.cursor/plugins/local/rig/skills", "writable": true, "plugin": true,
                       "dedupe": "none"}],                                                        // probes (b), (j)
           "never_write": ["~/.cursor/skills-cursor/**", "~/.cursor/hooks.json", "~/.cursor/chats/**"]},  // v0 writes no Cursor hook
 "units": {"command": {"dir": "~/.cursor/plugins/local/rig/skills", "format": "skill-hidden"},   // decision 0016
           "agent": {"dir": "~/.cursor/agents", "format": "cursor-md"},
           "rule": {"dir": "~/.cursor/rules", "format": "mdc"}},
 "instructions": {"path": "~/.cursor/rules/rig-frame.mdc", "mode": "whole-file"},              // unverified: probe (j)
 "effort_syntax": "bracket",
 "model_surfaces": [{"path": "~/.cursor/agents/{role}.md", "consumer": "fleet", "kind": "frontmatter",
                     "keys": {"model": "model"}, "grammar": "{model_effort}"}],
 "project_scope": null, "hooks": {"session_end": null},                                       // stop fires per turn
 "transcripts": {"format": "cursor-agent-jsonl", "root": "~/.cursor/projects"}}
```

Field rules:

- `reads.skills[].writable`: rig may place copies there. A dir appears as writable in exactly one record, which owns its render format. `~/.agents/skills` belongs to Codex. On Cursor the only writable dir is `~/.cursor/plugins/local/rig/skills`, inside the rig local plugin (decision 0020).
- `reads.skills[].dedupe`: `none | identical-bytes | by-name`. Slice 0 probes set the values. Two copies collapse only under the weaker rule of their two dirs (`none` is weakest).
- `reads.never_write`: globs the writer refuses even when a render names them.
- Closed enums: `units.command.format` (`md-frontmatter`, `md-body`, `skill-hidden`: a skill with `disable-model-invocation: true`), `units.agent.format` (`claude-md`, `codex-toml`, `cursor-md`), `units.rule.format` (`md`, `mdc`), `units.skill.frontmatter` (`keep`, `strip-unknown`), `units.skill.sidecar` (`null`, `openai-yaml`), `instructions.mode` (`whole-file`, `managed-block`), `hide.method` (`frontmatter-key`, `sidecar`, `none`), `effort_syntax` (`separate-key`, `colon-suffix`, `dash-fused`, `bracket`), `transcripts.format` (`claude-jsonl`, `codex-rollout`, `omp-jsonl`, `cursor-agent-jsonl`), `model_surfaces[].kind` (`frontmatter`, `cells`, `whole`, `keys`, `block`, section 8).
- `project_scope: null` means the harness has no uncommitted per-project channel. A `project` or `hybrid` pack has no project part there: `plan` prints an info line, and `doctor --project` prints the paths to commit (section 11).
- `hooks.session_end` names the harness event, the file and the JSON pointer. `null` means rig writes no session hook there.
- `model_surfaces[].path` may hold `{role}`. It expands over the consumer's roles in `roles.json`. Agent files of other roles stay hand-managed.
- `text_from` names the file whose description and body a `whole` agent render copies (section 8).
- `facts` lists harness files that `world` reads for checks. rig never writes them.

pi and Hermes fit the same schema in v1. pi needs `dedupe: "by-name"` and `md-body` prompts. Hermes needs `hide.method: "none"` and an `instructions.mode` for `SOUL.md`.

### 2.5 providers/\<p\>.json

Two kinds. A `workflow` provider is a playbook that a project declares. A `headless` provider fills the `second-opinion` slot.

```jsonc
// providers/pstack.json
{
  "schema": 1,
  "name": "pstack",
  "kind": "workflow",
  "pin": {"plugin": "pstack@<marketplace>"},                       // rig.lock.json holds version and commit
  "entry": {
    "claude": {"read": "plugin-cache:skills/poteto-mode/SKILL.md"},  // resolved to the locked version path
    "cursor": {"read": "plugin-local:skills/poteto-mode/SKILL.md"},
    "codex": null, "omp": null                                     // no pinned channel in v0
  },
  "phases": ["plan", "build", "verify", "review"],
  "model_surfaces": [
    {"path": "~/.claude/rules/pstack-models.md", "harness": "claude", "consumer": "pstack",
     "kind": "whole", "keep_header": true, "grammar": "{model} {effort}"},
    {"path": "~/.cursor/rules/pstack-models.mdc", "harness": "cursor", "consumer": "pstack",
     "kind": "whole", "keep_header": true, "grammar": "{model_effort}", "effort_syntax": "dash-fused"}
  ],
  "telemetry": null,
  "footprint": {"claude": "enabledPlugins:pstack@<marketplace>"}   // doctor --project info only
}

// providers/openspec.json (abridged)
{"schema": 1, "name": "openspec", "kind": "workflow", "pin": {"cli": "openspec", "version": "1.5.0"},
 "entry": {"claude": {"command": "/opsx:propose"}, "codex": {"command": "/prompts:opsx-propose"}, "omp": null, "cursor": null},
 "phases": ["explore", "propose", "apply", "sync", "archive"], "artifacts": "openspec/changes/<name>/", "model_surfaces": [],
 "telemetry": {"default_on": true, "optout_env": ["OPENSPEC_TELEMETRY=0", "DO_NOT_TRACK=1"]},
 "footprint": {"any": "dir:openspec/"}}

// providers/codex-cli.json
{
  "schema": 1,
  "name": "codex-cli",
  "kind": "headless",
  "family": "openai",
  "argv": ["codex", "exec", "--model", "{model}", "{prompt}"],     // probe (i) sets the read-only flag
  "model_harness": "codex",                                        // {model} comes from tiers.json for this harness
  "forbid_same_family": true,                                      // E_SAME_FAMILY when the current harness is codex
  "telemetry": null
}
```

The other headless records follow the same shape: `claude-cli` (`claude -p --output-format json --model {model}`), `omp-cli` (`omp -p --mode json --model {model}`), `cursor-cli` (`cursor-agent -p --output-format json --model {model} --mode ask`). A `native` filler record has `"kind": "native"` and `"model_harness"` set to a multi-vendor harness. It picks the tier's model there.

Model rule files belong in the provider record, because the provider defines their labels. A new provider adds its own surfaces without a target record edit.

### 2.6 models/roles.json

Role to tier and default effort, per consumer. Labels and keys are data, byte-exact. rig writes no other text from this file, so it holds no "use for", "lower to" or "raise to" strings.

```jsonc
{
  "schema": 1,
  "consumers": {
    "fleet": {
      "deep-reasoner":  ["reason", "high"],
      "reviewer":       ["strong", "high"],
      "senior-worker":  ["strong", "high"],
      "fast-worker":    ["fast", "low"],
      "quick-worker":   ["cheap", "low"],
      "web-researcher": ["fast", "medium"]
    },
    "pstack": {                                           // one entry per role line, 17 in pstack 0.15.36
      "budget":               {"literal": "medium (high)"},  // the "# budget:" line
      "feature, refactoring": ["fast", "high"],
      "hardest tasks":        ["strong", "xhigh"],
      "arena runners":        [["strong", "high"], ["fast", "high"]],          // a panel: one cell per element
      "how explorer":         {"all": ["fast", "high"], "cursor": "auto"}      // per-harness override
    },
    "omp": {
      "task":    ["fast", "auto"],                        // auto: an omp passthrough effort
      "advisor": ["strong", "medium"],
      "judge":   {"literal": "<provider>/<model>:medium"}, // other family on purpose, not a tier
      "plan":    ["reason", "high"],
      "default": ["cheap", "medium"]
    },
    "codex": {"default": ["strong", "medium"]}
  }
}
```

Entry forms: `[tier, effort]`, a panel `[[tier, effort], ...]`, `{"literal": "<value>"}`, and `{"all": <form>, "<harness>": <form or passthrough literal>}`. An effort is a canonical rung (`low`, `medium`, `high`, `xhigh`, `max`) or a passthrough literal that `tiers.json` lists for the surface's harness.

### 2.7 models/tiers.json

```jsonc
{
  "schema": 1,
  "ladders": {
    "claude": ["low", "medium", "high", "xhigh", "max"],
    "codex":  ["low", "medium", "high", "xhigh"],          // probe (i) confirms the top rung
    "omp":    ["low", "medium", "high"],
    "cursor": ["low", "medium", "high"]
  },
  "passthrough": {"omp": ["auto"], "cursor": ["auto"]},
  "tiers": {
    "reason": {"claude": "fable",  "codex": "<codex-model>", "omp": "<provider>/<model-r>", "cursor": "<slug-r>"},
    "strong": {"claude": "opus",   "codex": "<codex-model>", "omp": "<provider>/<model-a>", "cursor": "<slug-s>"},
    "fast":   {"claude": "sonnet", "codex": "<codex-model>", "omp": "<provider>/<model-f>", "cursor": "<slug-f>"},
    "cheap":  {"claude": {"id": "<pinned-full-id>", "display": "Haiku"},
               "codex": "<codex-model>", "omp": "<provider>/<model-c>", "cursor": "<slug-c>"}
  }
}
```

- A string value is a model token. On Claude it is an alias by default. `{id, display}` pins a full id. `display` defaults to the capitalised alias.
- The Agent tool takes aliases only, so a pinned Claude tier reaches dispatches through agent frontmatter.
- `effort_syntax` comes from the target record or the surface, not from this file.
- Clamping: a canonical rung maps to the highest ladder rung at or below it. A passthrough literal is never a rung, so an escalation cannot land on it.

### 2.8 rig.lock.json

One per config root. `lib/lock.ts` writes it.

```jsonc
{
  "schema": 1,
  "core": {"tree": "sha256:9f2c...", "candidate": null},
  "packs": {
    "review-kit": {"repo": "https://github.com/acme/agent-skills", "sha": "1a2b3c4",
                   "paths": ["skills/review-kit"], "license": "MIT", "tree": "sha256:41ab..."}
  },
  "pins": {
    "pstack": {"plugin": "pstack@<marketplace>",
               "current":   {"version": "0.15.36", "sha": "<commit>", "tree": "sha256:77de..."},
               "candidate": {"version": "0.15.37", "sha": "<commit>", "tree": "sha256:a0c1...", "checked": "2026-11-04"}}
  }
}
```

The tree hash is sha256 over the sorted list of `<relative path>\0<mode>\0<sha256 of bytes>` lines.

### 2.9 audit.allow.json

One per config root. Only the user writes it.

```jsonc
{
  "schema": 1,
  "acks": [
    {"id": "c41f09a2e8d1b7f3", "check": "exec", "pack": "review-kit", "path": "scripts/fmt.sh",
     "reason": "formatter run by hand only, read on 2026-11-04", "expires": "2027-02-01"}
  ]
}
```

`id` is the first 16 hex chars of sha256 over check, pack, path and the evidence bytes. One changed byte in the evidence changes the id, so the finding blocks again. An empty `reason` or a missing `expires` is `E_SCHEMA`. An expired ack counts as absent.

### 2.10 installed.json

In the state root. `lib/state.ts` writes it at the end of each apply.

```jsonc
{
  "schema": 1,
  "entries": {
    "~/.claude/skills/review/SKILL.md": {"kind": "owned", "sha256": "5e1b...", "mode": 420,
                                         "unit": "review-kit/review", "run": "20261104T201512.044Z-3"},
    "~/.omp/agent/config.yml":          {"kind": "cells", "digest": "sha256:0d4e...", "markers": false,
                                         "unit": "models/omp", "run": "20261104T201512.044Z-3"},
    "~/.codex/AGENTS.md":               {"kind": "block", "digest": "sha256:8a90...", "marker": "rig:frame",
                                         "unit": "core/frame", "run": "20261104T201512.044Z-3"},
    "~/.claude/settings.json":          {"kind": "json-element", "pointer": "/hooks/SessionEnd",
                                         "id": "<node> <rig-bin> stats --record", "digest": "sha256:61c2...",
                                         "unit": "core/session-end", "run": "20261104T201512.044Z-3"}
  }
}
```

- `owned`: `sha256` of the whole file rig wrote, and its mode. Surfaces of kind `whole` use this entry kind.
- `cells`: kinds `frontmatter`, `cells` and `keys`. `digest` of the cell values rig last wrote in that file: sha256 of the canonical JSON list `[[surface index, key, element, value], ...]`. The file bytes outside cells are not part of it.
- `block`: the frame block and surfaces of kind `block`. `digest` of the bytes between rig's own markers.
- `json-element`: the element's `id` and the `digest` of its canonical JSON. The session-end hook uses it.

The run id is `<UTC time to the millisecond>-<sequence>`. The sequence is one more than the highest existing journal number, so two runs in one millisecond still differ.

### 2.11 Journal line

`journal/<run-id>.jsonl` in the state root. One JSON object per line.

```jsonc
{"type": "run", "run": "20261104T201512.044Z-3", "cmd": "apply", "rig": "0.1.0"}
{"type": "intent", "seq": 1, "path": "~/.omp/agent/config.yml", "op": "patch-cells", "kind": "cells",
 "before_sha": "sha256:aa01...", "after_sha": "sha256:bb02...",
 "backup": "backups/20261104T201512.044Z-3/.omp/agent/config.yml",
 "entry_before": {"kind": "cells", "digest": "sha256:0d4e..."}, "entry_after": {"kind": "cells", "digest": "sha256:19f7..."}}
{"type": "commit", "run": "20261104T201512.044Z-3", "ops": 1}
// closing lines of other runs:
{"type": "abort", "seq": 4, "reason": "E_CHANGED_UNDER", "done": [1, 2, 3]}
{"type": "recovered", "by": "20261104T202230.910Z-4", "done": [1, 2]}
```

A journal ends with `commit`, `abort` (the run stopped on `E_CHANGED_UNDER`), or `recovered` (a later run finished the bookkeeping). `done` lists the seqs of the intents that the run finished. The run writes it into `abort`, and recovery writes the intents that it finds done into `recovered`. An undo of the run restores only those intents. A journal closed by an older rig has no `done`. `before_sha` is null for a create. `after_sha` is null for a remove. Paths are home-relative with a `~/` prefix.

### 2.12 metrics.jsonl

In the state root. `lib/metrics.ts` appends it.

```jsonc
{"schema": 1, "harness": "claude", "session_id": "<id>", "project": "sha256:3c9a...", "source": "record",
 "start": "2026-11-04T18:02:11Z", "end": "2026-11-04T18:40:57Z", "reader": "claude-jsonl@1",
 "models": {"<model-id>": {"input": 41230, "output": 9120, "cache_read": 802311, "cache_write": 51022, "requests": 61}},
 "cost_usd": 3.41, "tools": {"Read": [88, 0], "Bash": [41, 3], "_other": [12, 1]},
 "skills": {"explain": 2}, "agents": {"reviewer": {"dispatches": 2, "effort": {"high": 2}}},
 "compactions": 1, "hook_bytes": {"SessionStart": 1180}}
```

- No prompt text, tool input, tool output or file content. `project` is a hash of the project path.
- A missing source field stays absent or `null`, never `0`.
- Each line is an independent fact keyed by `(harness, session_id)`. Readers keep the last line per key.
- Each line stays under 4 KiB, so one `O_APPEND` write is atomic. Maps keep their largest entries and fold the rest into `_other`.

## 3. File ownership

One writer per file. "User" means a person editing in git. rig never writes a file whose writer column says "user" only.

| File | Lives in | Writer | Readers |
|---|---|---|---|
| `rig.json` | each config root | user | `world` |
| `packs/<name>/**` (own packs) | each config root | user | `world` |
| `packs/<name>/**` (vendored) | each config root | `lock` (`rig pack add`), then user | `world` |
| `packs/core/**` | repo | user, then sealed by `lock` (`rig pin set core`) | `world` |
| `targets/<h>.json` | repo | user | `world` |
| `providers/<p>.json` | each config root | user | `world` |
| `models/roles.json` | each config root | user | `world` |
| `models/tiers.json` | each config root | user, and `models` (`rig models set`) | `world` |
| `rig.lock.json` | each config root | `lock` | `world` |
| `audit.allow.json` | each config root | user | `world` |
| `installed.json` | state root | `state` | `state` |
| `journal/<run-id>.jsonl` | state root | `state` | `state` |
| `backups/<run-id>/**` | state root | `state` | `state` |
| `apply.lock` | state root | `state` | `state` |
| `metrics.jsonl` | state root | `metrics` | `metrics` |
| `proposals/<date>.patch` | state root | `metrics` | user |
| `log/rig.log` | state root | `fs` logger | user |
| `cache/osv/<ecosystem>.json` | state root | `gate` | `gate` |
| `marketplace/**` | data root | `state` (as owned files) | Claude Code |
| harness files in `Desired` | `~` | `state` | harnesses, `state` |
| `facts` files, `settings.local.json`, plugin caches, `skills-cursor/**`, extensions | `~` | harness or user | `world` |
| anything inside a repository | anywhere | user | `world` (`doctor --project`) |

`rig models set` writes only `models/tiers.json`. `rig pack add` and `rig pin` write only their root's lock and the new pack dir. Nothing else writes into a config root.

## 4. Type and signature sketch

The sketch is the contract between modules. Bodies throw. `// TODO` blocks give pseudocode for the four places where the logic is hard: `place()`, cell patching, apply, and recovery. A typedef tagged `// schema: <file>` mirrors one example in section 2, field for field.

### Config and world

```js
// lib/world.ts — public: loadWorld, projectDeclaration, encode

/** @typedef {"low"|"medium"|"high"|"xhigh"|"max"} Effort */
/** @typedef {"reason"|"strong"|"fast"|"cheap"} Tier */
/** @typedef {"machine-hidden"|"project"|"hybrid"} Scope */

/** // schema: rig.json
 * @typedef {object} RigConfig
 * @property {1} schema
 * @property {string[]} harnesses
 * @property {Record<string, {scope?: Scope, projects?: string[], harnesses?: string[], channel?: Record<string, "plugin">}>} packs   no scope: machine-hidden
 * @property {string[]} pins
 * @property {string[]} providers
 * @property {string} default_provider
 * @property {Record<string, string>} aliases
 * @property {Record<string, {provider: string, tier?: Tier, harnesses?: string[]} | null>} slots
 * @property {string[]} disable
 * @property {{session_hook: boolean}} metrics
 * @property {Record<string, {provider: string}>} [projects]      overlay only
 * @property {ModelSurface[]} [model_surfaces]                     overlay only
 * @property {string[]} [private_terms]                            overlay only
 */

/** // schema: pack.json
 * @typedef {object} PackManifest
 * @property {1} schema
 * @property {string} name
 * @property {Scope[]} scopes
 * @property {string} license
 * @property {{repo: string, sha: string, paths: string[]} | null} source
 * @property {{source: string, sha: string} | null} [ported_from]   provenance of a ported pack, info only
 * @property {Record<string, {harnesses?: string[], replaces?: string}>} units
 */

/** // schema: targets/<h>.json
 * @typedef {object} TargetRecord
 * @property {1} schema
 * @property {string} name
 * @property {string} root
 * @property {{skills: ReadDir[], never_write: string[]}} reads
 * @property {{plugin?: {marketplace: string, dir: string}}} [channels]
 * @property {{skill?: object, command?: {dir: string, format: string}, agent?: AgentFormat | null, rule?: {dir: string, format: "md"|"mdc"}}} units
 * @property {{method: "frontmatter-key"|"sidecar"|"none", key?: string, file?: string, value?: unknown}} hide
 * @property {{path: string, mode: "whole-file"|"managed-block"}} instructions
 * @property {{source: string, effort_table?: boolean}} [models]   the frame's Models line
 * @property {"separate-key"|"colon-suffix"|"dash-fused"|"bracket"} effort_syntax
 * @property {ModelSurface[]} model_surfaces
 * @property {{channel: "plugin", enable_file: string} | null} project_scope
 * @property {{session_end: {event: string, file: string, pointer: string, payload: string[]} | null}} hooks
 * @property {{format: "claude-jsonl"|"codex-rollout"|"omp-jsonl"|"cursor-agent-jsonl", root: string} | null} transcripts
 * @property {Record<string, string>} [facts]
 * @property {{description_max: number, listing_fraction?: number, instructions_max_bytes: number | null}} [budget]
 */
/** @typedef {{path: string, writable: boolean, plugin?: boolean, dedupe: "none"|"identical-bytes"|"by-name"}} ReadDir */
/** @typedef {{dir: string, format: "claude-md"|"codex-toml"|"cursor-md"}} AgentFormat */

/**
 * A model surface: {path, kind, consumer} plus the kind's parameters (section 8).
 * @typedef {object} ModelSurface
 * @property {string} path               may hold {role}, expanded over the consumer's roles
 * @property {string} [harness]          defaults to the record that declares it
 * @property {"fleet"|"pstack"|"omp"|"codex"|string} consumer   a key of roles.json consumers
 * @property {"frontmatter"|"cells"|"whole"|"keys"|"block"} kind   decision 0011
 * @property {boolean} [markers]         cells: markdown files people maintain only
 * @property {boolean} [harness_rewrites] the harness rewrites this file (probe c)
 * @property {string} [header] @property {string} [key_column] @property {string} [column]   cells
 * @property {string} [map]              keys
 * @property {string} [marker] @property {string} [table]   block
 * @property {{model?: string, effort?: string}} [keys]     frontmatter, whole, block
 * @property {string} [display_in]       frontmatter: the key whose first "(<display>)" token is a cell
 * @property {boolean} [keep_header]     whole: keep the current leading frontmatter and "#" lines
 * @property {string} [text_from]        whole agent files: source of description and body
 * @property {string} [grammar]          placeholders: {model} {effort} {display} {model_effort} {rest}
 * @property {string} [effort_syntax]    overrides the record's value for this surface
 */

/** // schema: providers/<p>.json
 * @typedef {object} ProviderRecord
 * @property {1} schema
 * @property {string} name
 * @property {"workflow"|"headless"|"native"} kind
 * @property {{plugin: string} | {cli: string, version: string} | null} [pin]
 * @property {Record<string, {read: string} | {command: string} | null>} [entry]      workflow
 * @property {string[]} [phases]                                                      workflow
 * @property {string} [artifacts]                                                     workflow
 * @property {ModelSurface[]} [model_surfaces]                                        workflow
 * @property {Record<string, string>} [footprint]                                     workflow, info only
 * @property {Record<string, string | null>} [intake]                                 workflow, the {{rig:intake}} rows
 * @property {string} [family]                                                        headless, native
 * @property {string[]} [argv]                                                        headless
 * @property {string} [model_harness]                                                 headless, native
 * @property {boolean} [forbid_same_family]                                           headless
 * @property {{default_on: boolean, optout_env: string[]} | null} telemetry
 */

/** @typedef {[Tier, Effort|string]} TierEffort */
/** @typedef {TierEffort | TierEffort[] | {literal: string} | {all: RoleValue, [harness: string]: RoleValue | string}} RoleValue */
/** // schema: models/roles.json
 * @typedef {{schema: 1, consumers: Record<string, Record<string, RoleValue>>}} Roles
 */
/** // schema: models/tiers.json
 * @typedef {object} Tiers
 * @property {1} schema
 * @property {Record<string, Effort[]>} ladders
 * @property {Record<string, string[]>} passthrough
 * @property {Record<Tier, Record<string, string | {id: string, display?: string}>>} tiers
 */
/** // schema: rig.lock.json
 * @typedef {object} Lock
 * @property {1} schema
 * @property {{tree: string, candidate: string | null}} core
 * @property {Record<string, {repo: string, sha: string, paths: string[], license: string, tree: string}>} packs
 * @property {Record<string, {plugin: string, current: PinState | null, candidate: (PinState & {checked: string}) | null}>} pins
 */
/** @typedef {{version: string, sha: string, tree: string}} PinState */
/** // schema: audit.allow.json
 * @typedef {{schema: 1, acks: {id: string, check: string, pack: string, path: string, reason: string, expires: string}[]}} Allow
 */

/**
 * Everything rig knows before compose. Frozen. Built only by loadWorld.
 * @typedef {object} World
 * @property {{home: string, state: string, data: string, test: boolean}} env
 * @property {RigConfig} config            repo plus overlay, merged (adds only)
 * @property {Map<string, Pack>} packs     including core
 * @property {Map<string, TargetRecord>} targets   only the harnesses rig.json names
 * @property {Map<string, ProviderRecord>} providers
 * @property {Roles} roles
 * @property {Tiers} tiers
 * @property {{repo: Lock, overlay: Lock | null}} locks
 * @property {Allow["acks"]} acks
 * @property {Record<string, Record<string, Record<string, string>>>} terms
 * @property {Map<string, unknown>} facts  parsed facts files, keyed by home-relative path
 * @property {Map<string, Uint8Array>} sources   text_from files of whole surfaces, keyed by home-relative path
 * @property {Record<string, string | undefined>} vars   only the env vars checks read (DO_NOT_TRACK, model overrides)
 */
/** @typedef {{name: string, root: "repo"|"overlay", manifest: PackManifest, files: Map<string, {bytes: Uint8Array, mode: number}>}} Pack */

/** Read and validate both config roots, merge the overlay, pre-read facts. @param {NodeJS.ProcessEnv} env @returns {World} */
export function loadWorld(env) { throw new Error("not implemented"); }

/**
 * Read the provider declaration of one project. Never infers.
 * @param {World} world @param {string} dir
 * @returns {{provider: string, source: "instructions"|"local-instructions"|"default", line: string | null,
 *            overlay: string | null, agrees: boolean, footprints: string[], packs: {name: string, enabled: boolean, source: "local"|"project"|"user"|null}[]}}
 */
export function projectDeclaration(world, dir) { throw new Error("not implemented"); }

/** Validate and serialize one config kind in canonical form. @param {"tiers"|"lock"|"rig"|"roles"} kind @param {unknown} value @returns {Uint8Array} */
export function encode(kind, value) { throw new Error("not implemented"); }
```

### Stack and render

```js
// lib/stack.ts — public: compose

/**
 * @typedef {object} Unit
 * @property {string} id           "<pack>/<name>"
 * @property {"skill"|"command"|"agent"|"rule"|"frame"|"slot-stub"} type
 * @property {string} name         installed name
 * @property {Scope} scope
 * @property {string[]} projects
 * @property {string[]} harnesses  after pack, unit and rig.json narrowing
 * @property {Record<string, "plugin">} channel
 * @property {Map<string, {bytes: Uint8Array, mode: number}>} files   source files, relative to the unit
 */
/** @typedef {{units: Unit[], slots: Record<string, ProviderRecord | null>, providers: ProviderRecord[], errors: RigError[]}} Stack */
/** @typedef {{code: string, message: string, path?: string, harness?: string}} RigError */

/** Core seal, packs, scope, disable, replace, slots, clash rules. Pure. @param {World} world @returns {Stack} */
export function compose(world) { throw new Error("not implemented"); }
```

```js
// lib/targets.ts — public: render, readSet, patch
// internals: lib/targets/place.ts, cells.ts, formats.ts, terms.ts (unreachable from outside, see boundary test)

/**
 * What rig wants on disk, per absolute path. A `whole` surface renders as "owned"; with keep_header set,
 * patch() completes its bytes from the current file.
 * @typedef {{kind: "owned", path: string, bytes: Uint8Array, mode: number, unit: string, keep_header?: boolean}
 *         | {kind: "cells", path: string, surfaces: ModelSurface[], values: CellValue[], unit: string}
 *         | {kind: "block", path: string, marker: string, bytes: Uint8Array, unit: string, table?: string}
 *         | {kind: "json-element", path: string, pointer: string, id: string, value: unknown, unit: string}} DesiredEntry
 */
/** @typedef {{surface: number, key: string, element: number, value: string}} CellValue */
/** @typedef {{entries: Map<string, DesiredEntry>, errors: RigError[], info: string[]}} Desired */

/** Render every unit and surface for every harness. Pure: reads nothing from disk. @param {Stack} stack @param {World} world @returns {Desired} */
export function render(stack, world) { throw new Error("not implemented"); }

/**
 * Every skill each harness sees, managed or not, for plan and doctor. Reads dirs, skips dot entries.
 * @param {World} world
 * @returns {Map<string, {name: string, path: string, realpath: string, sha256: string, managed: boolean}[]>}  by harness
 */
export function readSet(world) { throw new Error("not implemented"); }

/**
 * Locate and patch one region in current bytes. Covers cells, block, json-element, and owned with keep_header.
 * @param {Uint8Array | null} bytes   current file bytes, null when absent
 * @param {DesiredEntry} entry        kind cells, block, json-element, or owned with keep_header
 * @returns {{current: CellValue[] | Uint8Array | unknown | null, next: Uint8Array, markers: "present"|"inserted"|"n/a", error?: RigError}}
 */
export function patch(bytes, entry) {
  // TODO cells (surface kinds frontmatter, cells, keys):
  //  1. Search scope: if surface.markers and rig markers exist, only between each start/end pair; else the whole file.
  //  2. kind cells: find the line equal to surface.header; the next line must be a separator row; for each row,
  //     split on unescaped "|", key = trimmed cell of key_column; skip rows whose key is not in roles.json consumer.
  //     Parse the column cell with the grammar: "{display}, {effort}[, {rest}]" -> tokens; rest is kept byte-exact.
  //     A header that matches twice in scope -> E_LOCATOR (ambiguous). Zero times -> E_LOCATOR (absent).
  //  3. kind keys: find the top-level line "<map>:" ; scan following lines indented deeper; "<key>: <value>"
  //     line-level only; never parse or reserialize YAML. colon-suffix splits model and effort on the last ":".
  //  4. kind frontmatter: inside the leading "---" block only; "<key>: <value>" for each of surface.keys; the display
  //     token = the first "(<display>)" in the display_in value whose text equals a known display name.
  //  5. current = located values. next = bytes with only the value spans replaced (byte offsets, right to left),
  //     plus marker lines inserted around each located table when surface.markers and markers are absent.
  //  6. Assert: next with cells reverted equals bytes with markers inserted. A failed assert is E_INTERNAL.
  // TODO block (the frame block and kind block): markers by file type, "<!-- <marker>:start -->" ... "<!-- <marker>:end -->"
  //  in markdown, "# <marker>:start" ... "# <marker>:end" in TOML; foreign blocks stay byte-identical;
  //  absent and entry.table set and a "[<table>]" line exists outside the markers -> E_LOCATOR (never a second table);
  //  absent otherwise -> append the block with one blank line before it; current = the bytes between markers.
  // TODO owned with keep_header: header = the leading "---" frontmatter block, if any, plus the leading "#" lines of
  //  the current bytes, byte-exact; a header line that starts with "# budget: " takes its value from the render;
  //  next = header + entry.bytes (the rendered label lines); absent file -> no header.
  // TODO json-element (a JSON merge): require JSON.stringify(JSON.parse(bytes), null, 2) + "\n" === bytes, else E_JSON_ROUNDTRIP;
  //  find the element under pointer whose command string equals entry.id; replace it or append it; every other
  //  key and element stays; reserialize.
  throw new Error("not implemented");
}
```

```js
// lib/targets/place.ts — internal to targets

/**
 * @typedef {object} PlacementUnit
 * @property {string} id
 * @property {string[]} harnesses        harnesses that must see the unit
 * @property {Record<string, "plugin">} channel
 * @property {Record<string, string>} digests   tree digest of the render, by format owner (target name)
 */
/**
 * The smallest set of writable dirs (plus declared channels) such that each harness in unit.harnesses sees the
 * unit exactly once after its own dedupe rule, and every other installed harness sees it at most once.
 * @param {PlacementUnit} unit @param {string[]} installed  rig.json harnesses @param {Map<string, TargetRecord>} targets
 * @returns {{dirs: {path: string, owner: string}[], leaks: string[]} | {error: RigError}}
 */
export function place(unit, installed, targets) {
  // TODO
  //  candidates = every reads.skills entry with writable: true (one owner each), plus channel targets:
  //    for h in unit.harnesses with unit.channel[h] == "plugin": the record's channels.plugin dir, read by h only
  //    (and that h drops its skill dirs from the candidate set for this unit).
  //  for size k = 1 .. candidates.length, subsets in record order (deterministic):
  //    for each installed harness h:
  //      seen = subset dirs that h reads (reads.skills paths, or the plugin channel for h)
  //      copies = collapse(seen, h): two copies merge when the weaker dedupe of their two dirs allows it:
  //        "by-name" -> always; "identical-bytes" -> only when digests[ownerA] == digests[ownerB]; "none" -> never
  //      need = unit.harnesses.includes(h) ? exactly 1 : at most 1
  //    first subset where every h meets need -> return {dirs, leaks: installed harnesses outside unit.harnesses with 1 copy}
  //  none -> E_READSET naming the first failing harness and the dirs it would see twice,
  //          plus both exits: narrow unit.harnesses, or set rig.json packs.<pack>.channel.<harness> = "plugin"
  throw new Error("not implemented");
}
```

Different owner formats can render different bytes (a Codex copy may carry an `openai.yaml` sidecar). `place()` compares tree digests, so it treats such copies as distinct even where a harness compares SKILL.md only. That errs toward fewer collapses: under the recorded dedupe values it can reject a valid placement, but it cannot accept one that shows a duplicate.

### Models

```js
// lib/models.ts — public: cellValues, setTier, effective

/** Cell values for one surface: roles x tiers -> per-harness tokens, with ladders, clamping, aliases and pins. Pure.
 *  @param {World} world @param {ModelSurface} surface @param {string} harness @returns {CellValue[]} */
export function cellValues(world, surface, harness) { throw new Error("not implemented"); }

/** Build a new world with one tier cell changed. Writes nothing until write() runs.
 *  @param {World} world @param {Tier} tier @param {string} model @param {string} harness
 *  @returns {{world: World, write: () => void}}   write() replaces models/tiers.json of the defining root */
export function setTier(world, tier, model, harness) { throw new Error("not implemented"); }

/** The effective table per harness with the source of each value.
 *  @param {World} world @returns {{harness: string, tier: Tier, model: string, source: "tiers.json"|"pinned id"|"env override", env?: string}[]} */
export function effective(world) { throw new Error("not implemented"); }
```

### Gate

```js
// lib/gate.ts — public: gate, refreshOsv

/** @typedef {"pin"|"exec"|"secret"|"unicode"|"license"|"cve"|"telemetry"|"budget"} CheckId */
/** @typedef {{check: CheckId, severity: "block"|"warn"|"info", pack: string, path: string, evidence: string, id: string, acked: boolean, stanza: string | null}} Finding */

/** Run every registered check over sources and rendered bytes. Pure over its inputs; reads the OSV cache from world.
 *  @param {Stack} stack @param {Desired} desired @param {World} world @returns {{findings: Finding[], blocked: boolean}} */
export function gate(stack, desired, world) { throw new Error("not implemented"); }

/** Refresh cache/osv for the manifests in the stack. Called only by lib/lock.ts, which passes its fetch.
 *  @param {Stack} stack @param {(url: string, body: string) => Promise<string>} fetchFn @returns {Promise<void>} */
export async function refreshOsv(stack, fetchFn) { throw new Error("not implemented"); }
```

### State: plan, apply, undo

```js
// lib/state.ts — public: plan, apply, undo
// internals: lib/state/observe.ts, journal.ts, recover.ts

/** @typedef {"create"|"update"|"patch-cells"|"adopt"|"insert-markers"|"remove-to-backup"|"forget"|"block"} OpName */
/**
 * @typedef {object} Op
 * @property {OpName} op
 * @property {"owned"|"cells"|"block"|"json-element"} kind
 * @property {string} path
 * @property {string} harness
 * @property {string} unit
 * @property {string | null} before_sha
 * @property {string | null} after_sha
 * @property {Uint8Array | null} next        bytes to write; null for adopt, forget, block
 * @property {InstalledEntry | null} entry_before
 * @property {InstalledEntry | null} entry_after
 * @property {RigError} [error]              set when op is "block"
 * @property {string} [diff]                 per-cell or unified diff shown by plan
 */
/** @typedef {{ops: Op[], findings: Finding[], blocked: boolean, interrupted: string[]}} Plan */

/** // schema: installed.json
 * @typedef {{schema: 1, entries: Record<string, InstalledEntry>}} Installed
 */
/** @typedef {{kind: "owned"|"cells"|"block"|"json-element", sha256?: string, mode?: number, digest?: string, markers?: boolean,
 *             marker?: string, pointer?: string, id?: string, unit: string, run: string}} InstalledEntry */
/** // schema: journal/<run-id>.jsonl
 * @typedef {{type: "run", run: string, cmd: string, rig: string}
 *         | {type: "intent", seq: number, path: string, op: OpName, kind: string, before_sha: string | null, after_sha: string | null,
 *            backup: string | null, entry_before: InstalledEntry | null, entry_after: InstalledEntry | null}
 *         | {type: "commit", run: string, ops: number} | {type: "abort", seq: number, reason: string, done: number[]}
 *         | {type: "recovered", by: string, done: number[]}} JournalLine
 */

/**
 * Observe current bytes of every desired and installed path, then derive ops. Read-only: never recovers,
 * never logs. An interrupted journal is simulated (installed entries rebuilt in memory) and named in .interrupted.
 * @param {Desired} desired @param {{findings: Finding[], blocked: boolean}} gated @param {World} world
 * @param {{filter?: (e: DesiredEntry) => boolean}} [opts]   models set passes the model-bearing filter
 * @returns {Plan}
 */
export function plan(desired, gated, world, opts) {
  // TODO per path in union(desired, installed):
  //  owned:  keep_header -> desired bytes = targets.patch(current, entry).next first
  //          absent -> create | current sha == desired sha -> (no entry ? adopt : nothing)
  //          | no entry and differs -> block E_ADOPT_MISMATCH with a unified diff (rig never replaces an unmanaged file)
  //          | entry and current != entry.sha256 -> block E_DRIFT | else update
  //  cells of kind frontmatter on an absent file -> info line, no op (rig does not author agent files)
  //  cells/block/json-element: r = targets.patch(current, entry); r.error -> block
  //          | no entry and r.current == null (block or element absent) -> update that inserts it (r.next)
  //          | no entry: r.current == desired values ? adopt (+ insert-markers when r.markers == "inserted")
  //                                                 : block E_ADOPT_MISMATCH with per-cell diff
  //          | digest(r.current) != entry.digest -> block E_DRIFT (names path and cells)
  //          | digest(desired) != entry.digest -> patch-cells (or update for block and json-element)
  //  installed but not desired: owned -> current == entry.sha256 ? remove-to-backup : block E_DRIFT
  //          | cells -> forget (state only, no file write) | block, json-element -> update that removes the region
  //  blocked = gated.blocked || any op is block
  throw new Error("not implemented");
}

/**
 * Recover, re-plan, then write every op through the journal. The only caller of fs.writeHome.
 * @param {Plan} planned @param {World} world @returns {{run: string, changed: number, replan?: boolean, error?: RigError}}
 */
export function apply(planned, world) {
  // TODO
  //  0. take apply.lock (O_EXCL, holds pid and run id); held by a live pid -> E_LOCKED
  //  1. recover(): every journal without commit/abort/recovered (see recover.ts below)
  //  2. if recovery changed installed.json, the given plan is stale: return {replan: true} and bin calls prepare() again
  //  3. planned.blocked -> return; nothing written, no journal created
  //  4. re-read the sha of every op in plan order; the first != before_sha ends the batch, the ops before it still run
  //  5. write journal/<run>.jsonl with the run line and every intent: temp, fsync, link, fsync dir   // intents before mutation
  //  6. pre-image exists -> copy to backups/<run>/<home-relative path>; temp file next to each target, chmod to the
  //     preserved mode; then fsync every backup, temp file and backup dir in one pass (fs.fsyncAll)
  //  7. for each op with bytes to write, in plan order:
  //     a. RIG_TEST=1 and RIG_TEST_ABORT_AFTER=n reached -> SIGKILL self (tests only)
  //     b. re-read current sha; != before_sha -> remove the temp files left, write installed.json for done intents,
  //        append the abort line with the seqs of the done intents, return E_CHANGED_UNDER
  //     c. fs.installHome: rename the temp file onto the target
  //        remove-to-backup: the backup from (6) holds the bytes; then unlink. No byte is lost.
  //  8. fsync every dir whose entries changed in one pass
  //  9. apply entry_after of every op (adopt and forget too) to installed.json; replace it atomically
  // 10. append commit line, fsync; release apply.lock
  throw new Error("not implemented");
}

/** Restore one run's pre-images, newest op first. Journaled as a new run. No pack gate.
 *  Any conflicting path stops the undo before the first write; conflicts lists every such path.
 *  @param {string} runId @param {World} world @returns {{run: string, restored: number, conflicts: RigError[]}} */
export function undo(runId, world) { throw new Error("not implemented"); }
```

```js
// lib/state/recover.ts — internal to state

/** @param {World} world @param {string} runId @returns {{done: number, notDone: number, conflicts: RigError[]}} */
export function recover(world, runId) {
  // TODO
  //  for each intent line of the open journal, in order:
  //    re-validate path: realpath of parent inside HOME, not in never_write, no symlink at path; else E_CONTAINMENT
  //    re-derive the backup path from run id and path; a journal value that differs is ignored and reported
  //    cur = sha256(current bytes) or null
  //    cur == after_sha  -> done: apply entry_after to installed.json
  //    cur == before_sha -> not done: keep entry_before
  //    else              -> E_RECOVERY_CONFLICT naming the path; stop, write nothing more
  //  replace installed.json atomically; append {"type": "recovered", "by": <new run id>, "done": <seqs of the done intents>}
  //  journal text is data only: no field is executed, spawned or used as a format string
  throw new Error("not implemented");
}
```

### Lock, metrics, fs

```js
// lib/lock.ts — public: vendor, pinCheck, pinSet. The only module that spawns git or calls fetch.

/** @param {World} world @param {{repo: string, sha: string, paths: string[], into: "repo"|"overlay"}} args
 *  @returns {Promise<{pack: string, findings: Finding[], blocked: boolean}>} */
export async function vendor(world, args) { throw new Error("not implemented"); }

/** @param {World} world @param {string} name  a pin name or "core" @param {string | null} sha
 *  @returns {Promise<{candidate: PinState, findings: Finding[], blocked: boolean}>} */
export async function pinCheck(world, name, sha) { throw new Error("not implemented"); }

/** @param {World} world @param {string} name @returns {{promoted: boolean, error?: RigError}}  E_PIN_UNCHECKED on mismatch */
export function pinSet(world, name) { throw new Error("not implemented"); }
```

```js
// lib/metrics.ts — public: stats, recordSession. Both call the internal record().
// internals: lib/metrics/readers/{claude-jsonl,codex-rollout,omp-jsonl,cursor-agent-jsonl}.ts, record.ts, propose.ts

/** // schema: metrics.jsonl
 * @typedef {object} MetricsLine
 * @property {1} schema @property {string} harness @property {string} session_id @property {string} project
 * @property {"stats"|"record"} source @property {string} start @property {string} end @property {string} reader
 * @property {Record<string, {input?: number, output?: number, cache_read?: number, cache_write?: number, requests: number}>} models
 * @property {number | null} cost_usd
 * @property {Record<string, [number, number]>} tools          [calls, errors]
 * @property {Record<string, number>} skills
 * @property {Record<string, {dispatches: number, effort: Record<string, number>}>} agents
 * @property {number | null} compactions
 * @property {Record<string, number> | null} hook_bytes
 */

/** rig stats. patch is null unless opts.suggest. @param {World} world @param {{since: string, harness?: string, suggest: boolean}} opts
 *  @returns {{text: string, patch: string | null}} */
export function stats(world, opts) { throw new Error("not implemented"); }

/** rig stats --record. From stdin (hook mode: never throws, never prints, returns 0) or from a named session (by hand).
 *  @param {World | null} world @param {{stdin: Uint8Array} | {session: string}} input @returns {0|1} */
export function recordSession(world, input) { throw new Error("not implemented"); }
```

```js
// lib/fs.ts — contained primitives. Each export has an import allowlist (boundary test).

/** Atomic write into HOME: realpath containment, no symlinked parent, no symlink target, temp + fsync + rename, mode kept.
 *  Allowed importer: lib/state.ts (and lib/state/*). */
export function writeHome(path, bytes, mode) { throw new Error("not implemented"); }
/** Atomic write or O_APPEND under the state root. Refuses a path inside any read-set (section 2, Roots).
 *  Allowed importers: state, metrics, gate. */
export function writeState(rel, bytes) { throw new Error("not implemented"); }
export function appendState(rel, line) { throw new Error("not implemented"); }
/** Atomic write into a config root. Allowed importers: lock, models. */
export function writeConfig(root, rel, bytes) { throw new Error("not implemented"); }
/** The one logger: log/rig.log. Allowed importers: the apply, stats, pack, pin and models set paths. Never plan or doctor. */
export function log(event) { throw new Error("not implemented"); }
```

### CLI

```js
// bin/rig.ts — the command table. Parser, help and dispatch derive from it. No policy here.

/** @typedef {{name: string, sub?: string, args?: string[], flags: Record<string, {value: boolean, required?: boolean, repeat?: boolean}>,
 *             run: (a: object, env: NodeJS.ProcessEnv) => Promise<0|1>, help: string}} Command */
/** @type {Command[]} */
const COMMANDS = [
  {name: "plan",   flags: {}, run: planCmd, help: "compose, render, gate, diff; writes nothing"},
  {name: "apply",  flags: {"--undo": {value: true}}, run: applyCmd, help: "plan, then the journaled write"},
  {name: "doctor", flags: {"--project": {value: true}}, run: doctorCmd, help: "read-only diagnosis"},
  {name: "stats",  flags: {"--since": {value: true}, "--harness": {value: true}, "--suggest": {value: false}, "--record": {value: false}, "--session": {value: true}}, run: statsCmd, help: "metrics and proposals"},
  {name: "models", sub: "set", args: ["tier", "model"], flags: {"--harness": {value: true, required: true}}, run: modelsCmd, help: "effective table, or a tier swap"},
  {name: "pack",   sub: "add", args: ["repo"], flags: {"--sha": {value: true, required: true}, "--path": {value: true, required: true, repeat: true}, "--into": {value: true}}, run: packAddCmd, help: "vendor a pack"},
  {name: "pin",    sub: "check|set", args: ["name"], flags: {"--sha": {value: true}}, run: pinCmd, help: "gate and promote native plugins"},
];

/** One local helper, not exported: the shared pipeline for plan, apply, doctor and models. planCmd and doctorCmd
 *  also call targets.readSet for the duplicate warnings.
 *  @param {World} world @param {{filter?: (e: DesiredEntry) => boolean}} opts @returns {{stack: Stack, desired: Desired, gated: object, plan: Plan}} */
function prepare(world, opts) {
  // TODO stack = compose(world); desired = render(stack, world); gated = gate(stack, desired, world);
  //      return {stack, desired, gated, plan: state.plan(desired, gated, world, opts)}
  throw new Error("not implemented");
}
```

`rig models` with no subcommand prints the table. `rig models set` with no `--harness` exits 2. `pin check` needs `--sha` for every name except `core`. The handler checks this and exits 2. `stats` exits 2 on `--record` with another `stats` flag except `--session`, and on `--session` without `--record`.

## 5. Module map

Each module owns one body of knowledge and exports one to three functions. Files under `lib/<module>/` are internals of that module.

| Module | Owns the knowledge of | Exports | Files it writes (W) or parses (R) |
|---|---|---|---|
| `bin/rig.ts` | the command table, strict parsing, dispatch, exit codes | none (entry point) | none |
| `lib/world.ts` | every config schema (closed keys, `schema` field), both roots, overlay merge (adds only, core references rejected), canonical JSON, facts pre-read, project declarations | `loadWorld`, `projectDeclaration`, `encode` | R: `rig.json`, `packs/<name>/**`, `packs/core/**`, `targets/<h>.json`, `providers/<p>.json`, `models/roles.json`, `models/tiers.json`, `rig.lock.json`, `audit.allow.json`, `facts` files, `text_from` files of model surfaces, `settings.local.json` and instruction files of `--project <dir>` |
| `lib/stack.ts` | core seal, packs, units, scope, the four customization operations, slots, clash rules | `compose` | none |
| `lib/targets.ts` | harness formats, vocabulary, read-sets and `place()`, model surfaces and their render kinds, effort syntax, managed blocks, JSON elements | `render`, `readSet`, `patch` | R: skill dirs in `reads` (for `readSet`) |
| `lib/models.ts` | roles x tiers, ladders, clamping, passthrough, aliases versus pinned ids | `cellValues`, `setTier`, `effective` | W: `models/tiers.json` |
| `lib/gate.ts` | the check registry, ack ids, OSV cache format | `gate`, `refreshOsv` | W: `cache/osv/<ecosystem>.json` |
| `lib/state.ts` | observe, plan, the journaled transaction, undo, recovery, the installed record | `plan`, `apply`, `undo` | W: `installed.json`, `journal/<run-id>.jsonl`, `backups/<run-id>/**`, `apply.lock`, `marketplace/**`, harness files in `Desired` |
| `lib/lock.ts` | the lock per root, vendoring, pin check and set, tree hashing, network | `vendor`, `pinCheck`, `pinSet` | W: `rig.lock.json`, `packs/<name>/**` (vendored) |
| `lib/metrics.ts` | transcript readers per format, dedupe, content-free aggregates, the store, proposals | `stats`, `recordSession` | W: `metrics.jsonl`, `proposals/<date>.patch`. R: transcripts |
| `lib/fs.ts` | containment, atomic write, mode preservation, the logger | `writeHome`, `writeState`, `appendState`, `writeConfig`, `log` | W: `log/rig.log` |

`doctor` is a command, not a module. It calls `prepare()` (drift, adopt state, pin findings), `targets.readSet` (duplicates), `models.effective` (env overrides), and `world.projectDeclaration` (with `--project`). `fs.ts` has five exports because it is the primitive layer. The boundary test fixes who may import each one.

### Boundary test

`test/boundaries.test.ts` parses every file under `bin/` and `lib/` and fails on any row below.

| Rule | Fails when |
|---|---|
| Internals | a file outside `lib/<m>/` and outside `lib/<m>.ts` imports `lib/<m>/*` (tests under `test/unit/<m>/` are exempt) |
| HOME writes | any module other than `lib/state.ts` and `lib/state/*` imports `writeHome` |
| Config writes | any module other than `lib/lock.ts` and `lib/models.ts` imports `writeConfig` |
| State writes | any module other than `state`, `metrics`, `gate` imports `writeState` or `appendState` |
| Raw fs writes | any module other than `lib/fs.ts` imports a write function of `node:fs` (`writeFile*`, `rename*`, `unlink*`, `rm*`, `open` with a write flag, `appendFile*`, `chmod*`) |
| Network and spawn | any module other than `lib/lock.ts` imports `node:net`, `node:http(s)`, or references `fetch`; any module other than `lib/lock.ts` and `lib/fs.ts` imports `node:child_process`. `lib/fs.ts` spawns only node on its own `lib/fs/fsync-batch.ts`: its one `child_process` call must match the pin in `test/boundaries.test.ts` (rule "spawn pin": command, argv, option keys and env keys are fixed, and the file holds no second use). |
| Code plugins | any dynamic `import()`, or any spawn argument built from a pack path |
| Test hooks | any module other than `lib/state.ts` and `lib/state/*` reads `RIG_TEST` or `RIG_TEST_ABORT_AFTER` |
| Logger | the `plan` and `doctor` code paths reach `log` (checked by a call-graph walk from `planCmd` and `doctorCmd`) |
| Hand-synced lists | the check table in section 10 of this file differs from the gate registry, or the CLI README command list differs from `COMMANDS` |

## 6. Pipeline

```
loadWorld(env) ─► World ─► compose ─► Stack ─► render ─► Desired ─► gate ─► Findings
     (shell: reads)          (pure)             (pure)              (pure)
                                                              │
                         observe (shell: reads) ─► Observed ──┴─► plan (pure) ─► Plan ─► apply (shell: writes) ─► installed.json
```

The order is compose, render, gate, plan, apply. The draft wording says compose, gate, render. Render is pure and writes nothing, so the gate can see rendered bytes before any write. The `budget` check needs rendered bytes, and `unicode` and `secret` also scan rendered text, because a vocabulary term or a slot filler can add text that no source file holds.

| Stage | Input | Output | Validates | Pure |
|---|---|---|---|---|
| `loadWorld` | env, both config roots, facts files | `World`, frozen | schemas, closed keys, enums, cross-field rules (for example `project` scope needs `projects`), `E_SCOPE_MODE`, overlay adds only, ack fields, state root inside `$HOME` and outside read-sets | no: reads |
| `compose` | `World` | `Stack` | core seal membership, `E_CLASH`, `E_CORE_SHADOW`, `E_SLOT_TWICE`, disable and replace targets exist | yes |
| `render` | `Stack`, `World` | `Desired` | `E_READSET`, scope absence per harness (info), `E_SAME_FAMILY`, `E_TERM_*`, name lint (name equals folder, `^[a-z0-9]+(-[a-z0-9]+)*$`, 64 chars or fewer), dangling relative links | yes |
| `gate` | `Stack`, `Desired`, `World` | findings, `blocked` | the eight checks, acks and their expiry | yes (the OSV cache is in `World`) |
| observe | `Desired` paths, `installed.json` paths | current bytes, modes, realpaths | containment of each path | no: reads |
| `plan` | `Desired`, observed, installed, findings | `Plan` | adopt, drift, `E_LOCATOR`, `E_JSON_ROUNDTRIP` | yes |
| `apply` | `Plan` | journal, files, `installed.json` | before-sha re-check per op, containment again | no: writes |

`plan` and `apply` share every stage. `apply` differs only at the mutation step, so the plan output is what apply does. Nothing in the plan comes from "what the previous run meant": it comes from observed bytes plus `installed.json`.

## 7. Read-set matrix and dedupe

User-level skill dirs per harness, before the slice 0 probes. R means the harness reads the dir. W means rig may write there, in the format of the owner record.

| Dir | Claude Code | Codex | omp | Cursor | rig writes |
|---|---|---|---|---|---|
| `~/.claude/skills` | R | | R | R | W (owner `claude`) |
| `~/.codex/skills` | | R | R | R | W (owner `codex`) |
| `~/.agents/skills` | | R | probe (e) | R | W (owner `codex`) |
| `~/.omp/agent/skills` | | | R | | W (owner `omp`) |
| `~/.cursor/skills` | | | | R | no |
| `~/.cursor/skills-cursor` | | | | R | never (`never_write`) |
| Claude plugin cache, incl. the rig-local marketplace | R (enabled plugins) | | probe (e) | probe (b) | only through the `plugin` channel |
| `~/.cursor/plugins/local/rig/skills` | | | | R, probe (j) | W (owner `cursor`, decision 0020) |
| other `~/.cursor/plugins/local/*` | | | | R | no |

Dedupe values: Codex shows same-name skills twice, even a link and its target, so `none`. omp collapses identical skills (assumption, probe (e)). Cursor is unknown until probe (b), so the record starts at `none`.

Placement for common unit harness sets, with both outcomes of probe (b). It assumes omp reads `~/.codex/skills` with `identical-bytes` and does not read the Claude plugin cache.

| Unit harnesses | Cursor `none` | Cursor `identical-bytes` |
|---|---|---|
| Claude only | `~/.claude/skills`. omp and Cursor see it once (leaks, info). | the same |
| Codex only | `~/.codex/skills`. omp and Cursor see it once (leaks). | the same |
| Claude, Cursor | `~/.claude/skills` | the same |
| Codex, omp, Cursor | `~/.codex/skills` | the same |
| Claude, Codex | `E_READSET` (Cursor: `~/.claude/skills` + `~/.codex/skills`). With `channel.claude = "plugin"`: plugin + `~/.codex/skills`. | `~/.claude/skills` + `~/.codex/skills` when both renders have equal digests, else as in the left column |
| Claude, Codex, omp, Cursor | `E_READSET`. With the plugin channel: plugin + `~/.codex/skills`. | `~/.claude/skills` + `~/.codex/skills` with equal digests |

If Cursor does not deduplicate, a unit for Claude Code, Codex and Cursor needs a non-skill-dir channel on one of them. Cursor reads every skill dir that Claude Code and Codex read. The only v0 channel that keeps a copy out of Cursor's view is a rig-owned local plugin on Claude Code. The rig local plugin on Cursor does not help here, because only Cursor reads it. The Claude channel costs two things: Claude Code invokes plugin skills as `/<plugin>:<skill>`, and the user registers the marketplace and enables the plugin once, with the commands that `rig apply` prints. rig writes no `enabledPlugins` entry (see the marketplace registration question in section 15).

Hide controls: a copy carries the hide control of every harness that reads its dir, not only its owner's. A hidden copy in `~/.codex/skills` therefore has the `openai.yaml` sidecar for Codex and the `disable-model-invocation` and `hide` frontmatter keys for Cursor and omp. One consequence: a hidden Claude Code copy and a hidden Codex copy never have equal tree digests, because only the Codex dir carries the sidecar. A `machine-hidden` unit for Claude Code and Codex therefore needs the plugin channel under either outcome of probe (b).

Rule, as `place()` implements it: each harness in the unit's set sees exactly one copy after its dedupe rule. Every other installed harness sees at most one. A leak (one copy in a harness outside the set) is info in `plan`. Narrowing the unit's harnesses fixes `E_READSET` only because of the second clause.

Agents have their own read order: Cursor reads `~/.cursor/agents`, `~/.claude/agents` and `~/.codex/agents`, and the `.cursor` file wins by name. rig patches the model values in the hand-written fleet agent files in `~/.cursor/agents` (kind `frontmatter`), so Cursor uses a file with a Cursor model string.

`doctor` duplicates: for each harness, list every skill in every read dir (including enabled plugin dirs), skip dot entries (`.trash`, `.backup-*`, `.system`, `.sync-manifest.json`), skip a dir that holds a `.orphaned_at` file, in plugin dirs that rig does not write (Claude Code writes `.orphaned_at` into a stale cache version that it no longer loads; `.in_use` alone does not make one stale; the rig-managed Cursor plugin dir is never skipped), key each by `(name, realpath, SKILL.md sha256)`, then apply the harness's dedupe rule. A name with two or more remaining entries is a duplicate. It is info when no entry is managed, and an error when one is, because a managed duplicate means a placement bug. A `hybrid` unit on Claude Code is the exception inside a project where its plugin is enabled: `doctor --project` reports the hidden copy plus the project copy as the expected pair. Only `rig doctor` runs this scan (`lib/commands/doctor.ts`, `duplicates`); `rig plan` does not call `readSet`.

## 8. Cells, markers and adopt

rig renders model and effort values only (decision 0011). A cell is a model token, an effort token or a model display token. A model surface `{path, kind, consumer}` declares one model-bearing file and its render kind. The kinds and their files follow Draft v4 section 6:

| Kind | Files in v0 | What rig renders | Markers | Entry in `installed.json` |
|---|---|---|---|---|
| `frontmatter` | Claude `~/.claude/agents/<fleet role>.md`, Cursor `~/.cursor/agents/<fleet role>.md`. Hand-written files. | Claude: the `model:` and `effort:` values in the leading `---` block, and the first parenthesised display name in `description`, for example `(Opus)`. Cursor: `model: <slug>[effort=<e>]`. | no | `cells` |
| `cells` | the user's personal rules file with the fleet tables, declared in the overlay `model_surfaces`, because its path is the user's | a cell found by the table's exact header row, the row's key column and the column name, parsed by a grammar. `Opus, high, read-only` with `{display}, {effort}[, {rest}]` gives two cells and keeps `read-only`. | yes, when `markers: true` | `cells` |
| `whole` | Claude `~/.claude/rules/pstack-models.md`, Cursor `~/.cursor/rules/pstack-models.mdc`, Codex `~/.codex/agents/<fleet role>.toml` | pstack model rules: the `# budget:` value and one `<label>: <value>[, <value>]` line per label in `roles.json` order, with labels byte-exact. The header (frontmatter and `#` lines) keeps its current bytes. Codex agents: `description`, `model`, `model_reasoning_effort` and `developer_instructions`. | no | `owned` |
| `keys` | omp `~/.omp/agent/config.yml` `modelRoles` | the values of the five `modelRoles` keys, line by line. rig never reserializes YAML. | never | `cells` |
| `block` | Codex `~/.codex/config.toml` | the `[agents]` table with `default_subagent_model` and `default_subagent_reasoning_effort`, between `# rig:models:start` and `# rig:models:end` | always | `block` |
| `agent` | the files of agent units that rig renders: Claude, Codex, Cursor and Antigravity `.../agents/<role>.<ext>` for the roles of the `agents` consumer | the model keys of `keys` (with a `grammar`, its token goes to `keys.model`) set in the rendered bytes. A path that no agent unit renders gets an `absent` info line. | never | `owned` |

The source of the Codex agent text is the Claude fleet agent file of the same role (`text_from`). Its description becomes `description` and its body becomes `developer_instructions`. `world` reads that file. rig never writes its body. When that file is absent, `plan` prints an info line and renders no Codex agent file.

Raise and lower conditions, the retry rule, the "Use for" column and row order stay hand-written. rig stores no copy of them, so `roles.json` does not hold them.

What is not a cell:

- Model names in prose, for example an example line `deep-reasoner (Fable, high)` under a "Discipline" heading. `doctor` lists stale model mentions in managed files as info.
- A second spelling in a description, such as "Opus, for edits". Only the first parenthesised display name is a cell.
- The `#` lines of a pstack model rules file other than `# budget:`. rig copies them verbatim.
- The "Lower to" and "Raise to" columns.

Markers:

- Markers of kind `cells` exist only in markdown files that people maintain, such as a fleet rules file. A surface sets `markers: true` in the overlay `model_surfaces` list.
- On adopt, rig inserts `<!-- rig:models:start -->` and `<!-- rig:models:end -->` around each located table. One pair per table. Prose between two tables stays outside.
- A `block` region is defined by its markers. In the Codex config they are TOML comment lines. When the markers are absent and no `[agents]` table exists, `plan` shows an append. When an `[agents]` table already exists outside markers, `plan` blocks with `E_LOCATOR`, so rig never writes a second table.
- Marker insertion is a planned write: an `insert-markers` op in `plan`, the gate, the journal.
- Markers carry no hash. The digest lives in `installed.json`.
- Before adopt, the `cells` kind scans the whole file and blocks on an ambiguous header. After adopt, it scans only between marker pairs. If markers vanish later, `plan` shows `insert-markers` again.
- The omp config and the pstack model rules never get markers. omp or the pstack setup may rewrite them. The `keys` kind finds its cells by structure alone. `world` rejects `markers: true` on a path that does not end in `.md`.

Adopt, the first run on a path with no `installed.json` entry:

| Entry | Current state | Result |
|---|---|---|
| cells | located values equal the render | `adopt`: record the digest, plus `insert-markers` where markers apply. No cell byte changes. |
| cells | values differ | `block E_ADOPT_MISMATCH` with a per-cell diff. Exit 1. Two exits: change `roles.json` or `tiers.json` to match the file, or edit the file to match. |
| cells | a declared cell is absent or ambiguous | `block E_LOCATOR` naming the surface |
| cells, kind `frontmatter` | the file is absent | info line, no op. rig does not author agent files. |
| block | region absent | `update` that appends it, unless its table already exists outside markers (`E_LOCATOR`) |
| block | region equals the render | `adopt` |
| block | region differs | `block E_ADOPT_MISMATCH` with a diff |
| owned | absent | `create` |
| owned | bytes equal the render | `adopt` |
| owned | bytes differ | `block E_ADOPT_MISMATCH` with a unified diff. rig never replaces an unmanaged file. You move the file away, or make it equal, and run `rig plan` again. For a `whole` model file, you can also change `roles.json` or `tiers.json` to match. |

Drift, after adopt:

- Drift means the current cell values or block bytes differ from the `installed.json` digest, or an owned file's sha differs. `doctor` and `plan` name the path and the cells. `plan` blocks with `E_DRIFT`.
- A harness that rewrites other parts of its file is not drift. Only cell values count.
- Other tools rewrite rig targets. A pstack setup run rewrites both pstack model rule files. omp rewrites its config. Codex appends tables to its config. Plugin auto-update rewrites caches. `doctor` names each changed path. `plan` blocks until you resolve it: restore the values, or change `roles.json` or `tiers.json` to the new values. Then run `rig apply`.

The fleet agents (`deep-reasoner`, `reviewer` and so on) stay hand-written on Claude Code and Cursor. rig adopts each file on the first run and then patches only its `frontmatter` cells. Agent files of roles that `roles.json` does not list stay hand-managed, and `doctor` lists them as info. Codex agent TOML files are `whole` files that rig owns after adopt.

## 9. Rollback and recovery

Apply writes all ops as one batch, so each durability step costs one pass of fsyncs, not one fsync per op. It writes the journal with every intent line (fsync). Then it writes the backups of the pre-images and a temp file next to each target, with the mode copied, and fsyncs all of them in one pass. Then, per op in plan order, it re-checks the before-sha and renames the temp file onto the target. Then it fsyncs each dir whose entries changed, in one pass, replaces `installed.json` and appends `commit`. One child process runs the fsyncs of one pass at the same time, so the disk merges its cache flushes. The pseudocode is in `state.apply` and `recover` (section 4).

The order gives one invariant. Before the first rename, the journal with every intent, each backup and each temp file is durable, so after a crash each intent path holds its whole before bytes or its whole after bytes. Before `commit`, each rename and `installed.json` is durable, so a closed journal never names a change that the disk can lose.

| Crash point | Disk state | Next `rig apply` |
|---|---|---|
| before the journal | nothing changed | no journal, so nothing to recover. The fresh plan contains every op. |
| after the journal, before the first rename | every file has `before_sha`, temp files next to some targets | recovery: not done for every intent, and the sweep removes the temp files. The plan contains every op again. |
| after k renames | After a process crash, the first k files have `after_sha` and the rest `before_sha`. The dirs are not yet fsynced, so a power loss can keep any subset of the k renames. Each file still has its whole `before_sha` or its whole `after_sha`. | recovery classifies each path on its own: the done ones rebuild their entries, and the plan contains the rest. |
| after all renames, before `installed.json` | All files new, record old. A power loss before the dir fsync ends can keep any subset of the renames, as in the row above. | recovery rebuilds the record from the intents |
| after `installed.json`, before `commit` | all done | recovery finds every intent done and appends `recovered` |
| file changed by a third party mid-run | sha matches neither | `E_RECOVERY_CONFLICT` names the path. Nothing more is written. |

Because the plan derives from observed bytes plus `installed.json`, the run after recovery converges: a second apply prints `0 changes`. Slice tests inject a crash after k renames with `RIG_TEST_ABORT_AFTER=<k>`, or after a step with `journal`, `staged` or `installed`. rig reads it only when `RIG_TEST=1`. It is not a CLI flag.

Containment, on every write and every restore:

- Resolve the realpath of the parent. It must be inside the realpath of `$HOME`.
- Refuse a symlinked parent that leaves `$HOME`, and a target that is a symlink.
- Refuse a path that matches a `never_write` glob.
- Refuse a backup path inside a read-set.

Journal text is data. rig never runs, spawns or formats it.

Remove never deletes. `remove-to-backup` keeps the old bytes in `backups/<run-id>/`.

`rig apply --undo <run-id>`:

1. Read the run's journal. Walk its intents in reverse order.
2. Per path: current sha equals the run's `after_sha` -> restore the pre-image (or, for a create, move the current bytes to the new run's backups). Otherwise the path conflicts: `E_UNDO_CONFLICT`. A run that never committed skips each intent that its `done` list does not name, because a later run may have written the same bytes since. A journal without a `done` list (written by an older rig) keeps the old rule: an intent is skipped when the path still holds its before state and not its after state.
3. Any conflict stops the whole undo before the first write. The output lists every conflicting path, not only the first. No path restores. You resolve each path and run the undo again.
4. The undo is a new journaled run, with its own backups and its own `commit`. `installed.json` returns to each intent's `entry_before`.

Undo restores the journaled pre-images byte-exact and runs no pack gate, because it writes no pack content. The tradeoff: a pre-image that the gate would block today comes back unchecked. It was on disk before rig touched it.

The harness can still write between the before-sha re-check and the rename. That window is one read and one rename long. The cost of a hit is one lost harness write, which rig cannot detect afterwards. omp keeps a 0-byte `config.yml.lock`. Whether rig must take it is an open question.

## 10. Gate

One registry table in `lib/gate.ts`. `plan` output and this table derive from it. A test fails when they differ.

| Check | Runs on | Finds | Severity | Ackable |
|---|---|---|---|---|
| `pin` | lock, sources, facts, records | lock tree mismatch, core seal mismatch, installed plugin commit differs from `current`. Auto-update on for a marketplace that serves a pinned plugin (warn). A provider entry that reads the plugin cache with no locked version (warn) | block | never |
| `exec` | sources | exec bit, shebang, script extension, binary magic, `hooks.json`, `.mcp.json`, `package.json` scripts, symlinks in a pack | block | yes |
| `secret` | sources, rendered | secret patterns. Sub-rule `private_terms`: an overlay term inside a repo pack. | block | yes |
| `unicode` | sources, rendered | hidden Unicode (zero-width, bidi), pipe-to-shell, eval of fetched data (block). Injection phrases (warn) | block, warn | yes |
| `license` | sources | missing or disallowed license | block | yes |
| `cve` | packs with a dependency manifest | high or critical advisory in the OSV cache. No scanner and no cached result (block, see open questions) | block | yes |
| `telemetry` | provider and pin records | `default_on` and neither `DO_NOT_TRACK` nor a listed opt-out var set | warn | no: set the var |
| `budget` | rendered bytes plus always-on files rig can read | description above the harness cap (block), above 300 chars (warn), always-on tokens, listing chars, body size, co-load, cache-bust lint, reference depth, instruction file above the harness limit (block) | block, warn | no |

`private_terms` sits inside `secret`, with the same severity, so the binding list stays at eight checks. The gate never runs hooks: hook output cost comes from transcripts in `rig stats`. Tokens are estimated at 4 characters per token.

The OSV refresh runs only inside `rig pack add` and `rig pin check`. `plan` and `apply` read `cache/osv/` offline. Network therefore lives in two commands.

`cache/osv/<ecosystem>.json` holds `{"schema": 1, "results": {"sha256:<hex of the manifest bytes>": {"advisories": [{"id": "...", "severity": "critical|high|moderate|low"}]}}}`. The ecosystem comes from the manifest name: `npm`, `PyPI`, `Go`, `crates.io`, `RubyGems`. A manifest whose digest has no result blocks. A severity that is not one of the four blocks too. `loadWorld` reads the files into `world.osv`.

## 11. Scope and project delivery

`pack.json` lists the scopes a pack supports: `machine-hidden`, `project`, `hybrid` (decision 0017). `rig.json` picks one per pack. No `scope` key means `machine-hidden`. rig determines nothing on its own.

| Scope | Claude Code | Codex | omp | Cursor |
|---|---|---|---|---|
| `machine-hidden` | `disable-model-invocation: true` | `agents/openai.yaml` sidecar, probe (f) | `hide: true` | `disable-model-invocation: true` |
| `project` | local plugin in the rig-local marketplace, `false` at user scope. You enable it per project in the uncommitted `.claude/settings.local.json`. `rig apply` and `doctor --project` print the snippet. `doctor --project` verifies it. Probe (k). | absent, info line | absent, info line | absent, info line |
| `hybrid` | hidden skill dir copy, plus the project plugin | hidden copy only. The project part is absent, info line. | the same as Codex | the same as Codex |

Each copy carries the hide controls of every harness that reads its dir (section 7), so a shared dir does not leak a hidden unit into a listing.

Codex, omp and Cursor have no known uncommitted per-project channel, so their records hold `project_scope: null`. A `project` or `hybrid` pack whose harnesses include one of them is not an error. The project part of the pack is absent on that harness until you commit its files to the repository. `plan` prints one info line per pack and harness:

```
info          scope   codex   acme-notes                             project part absent: commit its files (doctor --project)
```

`rig doctor --project <dir>` prints the repository paths that would deliver the pack on that harness, for you to commit. rig writes nothing into repositories.

Snippet that `rig apply` and `rig doctor --project <dir>` print for a `project` pack (you paste it into the project's `.claude/settings.local.json`):

```jsonc
{"enabledPlugins": {"acme-notes@rig-local": true}}
```

Provider per project: only the `rig-project: <provider>` line that you write in project instructions selects a provider. Claude Code also reads its uncommitted twin, `CLAUDE.local.md`. The overlay `projects` map records your declarations so `doctor --project` can check that the line exists and agrees. Footprints (`openspec/`, `enabledPlugins`) are info. With no line, `default_provider` applies. The frame states this rule and lists no projects, so its bytes do not change per project.

## 12. `/craft` and `/pm` per harness

| Harness | `/craft` | `/pm` alias | Degraded |
|---|---|---|---|
| Claude Code | `~/.claude/commands/craft.md`, rig-owned | `~/.claude/commands/pm.md`, one line: alias of `/craft` | no |
| Cursor | `~/.cursor/plugins/local/rig/skills/craft/SKILL.md`, a skill with `disable-model-invocation: true` (decisions 0016, 0020) | `~/.cursor/plugins/local/rig/skills/pm/SKILL.md`, the same form | probe (j): local plugin loading and the invocation name. A marketplace plugin named `rig` shadows the local one. `doctor` flags it. |
| Codex | `~/.codex/prompts/craft.md`, invoked as `/prompts:craft` | `~/.codex/prompts/pm.md` | no bare `/craft`, and Codex deprecates prompts |
| omp | `~/.omp/agent/commands/craft.md`, unverified bare command dir | `~/.omp/agent/commands/pm.md` | probe (e). An existing omp extension that rewrites `/pm` is code. rig never touches it. `doctor` reports it as info. |

One machine-wide `/craft` cannot know the current project's provider. Its body therefore states the rule and lists each provider entry on that harness: "Find the `rig-project:` line in project instructions. If it names openspec, run `/opsx:propose`. If none: read `<path>` and follow it." For pstack on Claude Code, `<path>` is the exact plugin-cache path for the locked version, built from `rig.lock.json` (`~/.claude/plugins/cache/<marketplace>/pstack/<version>/skills/poteto-mode/SKILL.md`). rig does not pick the newest cached version. A provider whose `entry` is null on a harness gets the line "not available on this harness".

`/pm` comes from `rig.json` `"aliases": {"pm": "craft"}` (decision 0016). A hand-written `pm` file at a rendered path collides with the alias. `plan` names the path, prints the diff, and blocks with `E_ADOPT_MISMATCH`. You remove one of the two: the file, or the alias. A file with the exact rendered bytes adopts. `doctor` prints the alias reminder while the alias exists.

## 13. Observability

- `rig stats` reads transcripts per harness through the reader that `transcripts.format` names. Each reader has a field allowlist: usage, model, tool name, error flag, durations, unit names, byte lengths. It never reads message text, tool input or tool output.
- Dedupe: count each Claude `message.id` once (usage repeats per content block), count each subagent file once, key the store by `(harness, session_id)`.
- `stats` prints, per harness and model: tokens by type, cost with its source, cache hit rate, tool error rate, loads per skill, hook output bytes, dispatches per role with effort mix, compactions, alias resolution history.
- Proposals, with `--suggest` only: a unified diff against repo config, for example a `rig.json` `disable` entry for a skill with no loads in the window, or a `roles.json` effort one rung higher for a role with repeated escalations. `stats --suggest` prints it and writes it to `proposals/<date>.patch`. It writes nothing outside the state root. You apply it with `git apply`, commit, and run `rig apply`. Nothing applies by itself. No data leaves the machine.

Session-end hook, Claude Code only in v0:

- Enable with `"metrics": {"session_hook": true}`. Off by default.
- The write is a JSON merge that keeps every entry rig did not write (decision 0020). `apply` writes one element as a `json-element` op into the file and pointer that the target record's `hooks.session_end` names: on Claude Code, `~/.claude/settings.json` `hooks.SessionEnd`. Identity: the command string. Precondition: the file round-trips byte-identical through `JSON.parse` and `JSON.stringify(v, null, 2) + "\n"`. If not, `plan` blocks with `E_JSON_ROUNDTRIP` and prints the element for you to add by hand.
- The same primitive serves Cursor `~/.cursor/hooks.json` once the Cursor record sets `hooks.session_end` and drops that file from `never_write`. A slice 5 unit test runs `targets.patch` on a fixture Cursor `hooks.json` and checks that its foreign entries keep their bytes.
- The hook runs `rig stats --record`: it reads the hook JSON on stdin (`session_id`, `transcript_path`, probe (h)), validates the transcript path under the harness's transcript root, aggregates one session, appends one line. It prints 0 bytes and exits 0 on every error. Errors go to `log/rig.log`.
- Codex `Stop` and Cursor `stop` fire once per turn. A per-turn hook breaks the zero per-turn injection budget, so their records hold `hooks.session_end: null` until a probe shows a session-end event. omp has no known event and holds `null` too. Draft v4 asks for the equivalents where they exist (assumption A34). This design limits v0 to Claude Code.
- This is the only `json-element` surface in v0.

The router slot's filler is `static`. It has no code path beyond the rendered cells. Escalation stays prose in your rules. No dispatch-log hook exists. A classifier filler waits until transcript-derived outcome data exists.

## 14. What changes from Draft v4

Each row is a real delta against Draft v4. Rows marked "decision update" also differ from an Accepted decision. Section 15 lists those records.

| # | Draft v4 says | v0 architecture | Reason |
|---|---|---|---|
| 1 | Eight commands, with an `audit` command next to `plan` (section 15). `audit` warns on an effective duplicate. | 7 commands. `audit` folds into `plan`, and `rig plan` warns on an effective duplicate. | The CLI has at most 7 commands. `plan` writes nothing, so it already is the audit. |
| 2 | `~/.rig/` for `installed.json` and the marketplace, plus `~/.local/state/rig/` for metrics and the log. | One state root, `~/.local/state/rig/`, for `installed.json`, the journal, backups, metrics and the log. `$XDG_DATA_HOME/rig/` (default `~/.local/share/rig/`) holds the local marketplace. Decision update: 0003. | Two state roots split the ownership of rig's state. |
| 3 | No rollback command. | `rig apply --undo <run-id>`. | The journal already holds each run's pre-images, so undo reuses the one writer. A flag keeps the count at 7. |
| 4 | An `--only models` flag on `apply`, and `rig models set` as sugar over it. | The filter is internal to `rig models set`. No public flag. | A public flag would be a second way to swap a model. |
| 5 | Six slices, 1 to 6. The probes sit inside slices 1 to 3. | Slices 0 to 5. Slice 0 runs eleven probes, (a) to (k), before any writer. | Each probe sets a target-record value that a writer depends on. |
| 6 | The product pack (`office-hours` as `/oh`) in slice 5. | Back in v0 by user decision, after the product roles joined the seed tests. Ported as `/oh` in [#17](https://github.com/rigyard/rig/pull/17) and enabled in [#22](https://github.com/rigyard/rig/pull/22). Decision update: [0026](../decisions/0026-product-pack-in-v0.md). The first v0 plan listed it under "After v0". | The seed tests need the product roles. The port has its own size risk (assumption A6), which the PR sequence covers. |
| 7 | The session hook goes into Claude Code `SessionEnd` and the omp, Codex and Cursor equivalents where they exist (assumption A34). It runs `rig stats --record --session <id>`. | Claude Code only in v0. Codex, omp and Cursor hold `hooks.session_end: null` until a probe shows a session-end event. The hook runs `rig stats --record` and reads the session id from stdin. `--session <id>` is for a run by hand. Decision update: 0020. | Codex `Stop` and Cursor `stop` fire once per turn, which breaks the zero per-turn injection budget. A fixed command string identifies rig's element in the JSON merge. |
| 8 | A `packs` list plus a separate `scope` map. | One object per pack in `packs`, with its scope, projects, harnesses and channel. | One list instead of two, so a pack and its scope cannot disagree. |
| 9 | Ten gate rows, with `injection` and `private_terms` as checks of their own. | Eight checks. Injection phrases warn inside `unicode`. `private_terms` is a sub-rule of `secret`. Decision update: 0002. | The gate has exactly eight checks. |
| 10 | The `budget` hook meter runs each SessionStart, UserPromptSubmit and PreToolUse hook. | rig runs no hook. Hook output bytes come from transcripts in `rig stats`. Decision update: 0012. | Running a foreign hook spawns code outside `lib/lock.ts`, which the boundary test forbids. |
| 11 | The provider comes from an overlay `projects` entry first, which the frame renders, then the `rig-project:` line, then the default. | Only the `rig-project:` line, or its uncommitted twin, selects. The overlay `projects` map is a `doctor --project` check. The frame lists no projects. Decision update: 0008. | One selector per project, which the model reads in the project itself. |
| 12 | Core holds `rules/working.md`, `rules/writing.md` and a `router` stub. | Core holds the frame template, the principles index, the `doc-review` and `second-opinion` stubs, the entry templates, `terms.json` and the schemas. Decision update: 0005. | Core holds what rig's own contract needs. The rules files are user prose. The router filler renders frame lines and needs no stub. |
| 13 | pstack reaches Codex through unpinned copies in `~/.agents/skills`, and omp through a third-party port. | pstack's `entry` is null on Codex and omp in v0. | The lock pins every byte that rig installs. |
| 14 | The OSV refresh is a network use of its own. | The OSV refresh runs only inside `pack add` and `pin check`, so network lives in two commands. Decision update: 0003. | `plan` and `apply` stay offline. |
| 15 | Compose, gate, render (slice 1). | Compose, render, gate (section 6). | The gate must see rendered bytes: `budget`, vocabulary terms and slot fillers. |
| 16 | `apply` installs the Claude local marketplace plugin with `false` at user scope. | `apply` prints the commands that register the marketplace and set the user-scope value. rig writes no `enabledPlugins` entry. | The marketplace registration question in section 15 gives the recommendation and its reason. |
| 17 | JSON examples in sketch form. | Closed-key schemas in section 2, for example the `consumers` wrapper in `roles.json` and slot objects with a tier. | A strict loader needs closed keys and one `schema` field per file. |

## 15. Rationale

### Problem

rig installs pinned copies of agent units into four harnesses whose files it shares with people, harnesses and other tools. Three facts make the shape hard. First, the model-bearing files are foreign: a rules file people maintain, a YAML file the harness rewrites, a model rule another tool regenerates. rig may change only the model and effort tokens in them. Second, Cursor reads every skill dir that Claude Code and Codex read, so a naive copy shows up twice. Third, every write must survive a crash and be undoable byte-exact, with no context inference and no write into any repository. The binding limits: 7 commands, eight gate checks, no code plugins, no skip flag, network in two commands.

### Usage

See section 1: the CLI README and the three traced cases. Each case touches data files only. A new target also needs a core reseal for its vocabulary rows, and one core enum value when it needs a new format.

### Shape

- Data shapes first: `World`, `Stack`, `Desired`, `Plan`, `installed.json`, the journal. Every stage is a value. Only `loadWorld`, observe and `apply` touch the disk (per functional core, imperative shell).
- Four kinds of desired entry: `owned`, `cells`, `block`, `json-element`. The five render kinds of decision 0011 map onto them (section 8). The cell kind is what keeps foreign bytes intact. It also removes the paraphrase risk: rig never writes condition prose, so it cannot paraphrase it.
- Modules by knowledge (per the temporal decomposition red flag): `targets` hides all harness policy behind `render`, `readSet` and `patch`. `place()`, the render kinds, dedupe and the vocabulary are internal. `models` hides ladders, clamping and pins behind `cellValues`. `state` hides observe, adopt, drift, the journal and recovery behind `plan`, `apply` and `undo`.
- One plan, two consumers: `plan` prints it, `apply` executes it, `doctor` reads its drift and adopt lines. `models set` is the same plan with a filter.
- Writes go through `fs.ts` primitives with a per-function import allowlist. A test enforces the allowlist.
- What it deliberately does not do: infer a provider or scope, run hooks, run pack code, write `enabledPlugins`, reserialize YAML or TOML, store a hash in a file, write into a repository.

### Synthesis decision

One candidate, by user decision: arena and interrogate skipped. Base: the orchestrator's design decisions, grounded in Phase A (how skill over the docs, the prior-art generators, the safe-write scripts and the live harness surfaces), reconciled with Draft v4 and decisions 0001 to 0024.

### Tradeoffs accepted

- We accept that prose model names go stale after a swap, in exchange for never rewriting prose. `doctor` lists them.
- We accept a Claude Code plugin channel that namespaces skill names and needs one manual registration and enable step, in exchange for zero `enabledPlugins` writes and a valid placement when Cursor does not deduplicate.
- We accept leaks (one copy visible in a harness outside the unit's set), in exchange for placements that use plain skill dirs. `plan` lists each leak.
- We accept that `place()` treats copies with different digests as distinct even where a harness compares SKILL.md only, in exchange for a rule that, under the recorded dedupe values, can reject but not accept a duplicate.
- We accept canonical JSON for the files rig edits, in exchange for no JSON-preserving editor.
- We accept that undo runs no pack gate, in exchange for byte-exact restores of what was on disk before.
- We accept a short race between the before-sha check and the rename, in exchange for no harness lock protocol in v0.
- We accept five exported primitives on `fs`, in exchange for one import allowlist per primitive that the boundary test checks.

### Alternatives considered

1. Full-file ownership of foreign files. rig would render the whole rules file, the omp config and every fleet agent file. The interface looks simpler: one kind. It hides less: every hand edit becomes drift, every harness rewrite becomes a conflict, and `roles.json` must carry every prose string verbatim. That moves the paraphrase risk into config instead of removing it. Rejected. The `whole` kind stays only where a tool generates the file (the pstack model rules, with its header copied verbatim) or where rig is the only author (Codex agent TOML).
2. Generations, as Nix or home-manager do: build a full tree per generation and switch links. Rollback becomes one switch. But harnesses read real dirs shared with foreign units, omp and Codex rewrite their own files in place, and rig must patch cells inside foreign files. A generation cannot hold a file that the harness keeps rewriting. The journal hides less machinery from the caller but matches how the files behave. Rejected.
3. Plugin-only delivery on Claude Code: every rig unit as a local plugin. It removes the Claude side of the read-set problem. It exposes plugin namespacing on every skill, needs an `enabledPlugins` write or a manual step for every pack, and does nothing for Codex, omp and Cursor. Kept as an opt-in channel per pack only.
4. Markers in every file. Location by marker alone is the smallest locator interface. It fails where it matters most: omp may drop comments, a model-rule generator rewrites its file, and adopt can never byte-match a file that has no markers yet. Kept for markdown that people maintain, as a hint plus a narrower search scope, and for the Codex `[agents]` block, where Draft v4 and decision 0011 ask for them.

### Open questions and risks

- Decision records that need an update. Each record below now holds an "Update 2026-11-05" section with the change, the reason and the implementing PR. Decision 0026 records delta 6.

  | Record | Change |
  |---|---|
  | 0002 | `private_terms` becomes a sub-rule of `secret`. |
  | 0003 | Network in two commands. `installed.json` moves to the state root. |
  | 0004 | One hook element, written by `apply`. |
  | 0005 | Core members. Reseal through `pin check core` and `pin set core`. |
  | 0007 | Slot list and filler kinds. |
  | 0008 | The overlay `projects` map is a check, not a selector. |
  | 0010 | The router renders cells only. |
  | 0012 | `audit` folds into `plan`. No hook execution. |
  | 0013 | The principles index is in core. |
  | 0015 | The fixture HOME premise was false. |
  | 0020 | No Cursor `hooks.json` write in v0, until a probe shows a session-end event. `rig plan` gives the duplicate warning that the record assigns to the `audit` command. |
- Should `cve` block or warn when no scanner and no cached result exist?
- Must rig take omp's `config.yml.lock` before a patch?
- How does pstack reach Codex and omp with a pin? Until then their `entry` is null.
- Does Cursor load skills from the local plugin `~/.cursor/plugins/local/rig` and user rules from `~/.cursor/rules/*.mdc`? `/craft` and the frame on Cursor depend on both. Probe (j) answers it.
- Is the plugin channel's namespacing acceptable for packs that need it?
- Are leaks to harnesses outside a unit's set acceptable as info, or should some packs require zero?
- Is the `{all, <harness>}` override in `roles.json` the right escape for a Cursor `auto` value that Claude Code does not share?
- Do the rules files that core no longer holds belong in the `own` pack?
- Slice 0 probes (a) to (k) set the target-record values marked "probe" above. The scripts, verdicts and fields are in [v0 slices](../plan/v0-slices.md).
- Session-end hook scope. Draft v4 says the hook also goes into the omp, Codex and Cursor equivalents where they exist (assumption A34). This design limits v0 to Claude Code, because Codex `Stop` and Cursor `stop` fire per turn. Confirm the limit.
- Claude local marketplace registration. Draft v4 says `apply` installs the plugin with `false` at user scope. That means rig writes `enabledPlugins` and the marketplace entry into the harness settings, or calls the `claude` CLI. The alternative: `apply` prints one command block, and the user runs it. Recommendation: print. rig then writes one element into harness settings, the opt-in hook, and no more. A CLI call would need a spawn outside `lib/lock.ts`, which the boundary test forbids. The step happens once per marketplace and once per pack. Probe (k) runs the printed commands, so its verdict covers this path. The cost is one manual step per pack.
- Config parse errors. Decided here: a config parse error (`E_SCHEMA`, `E_SCOPE_MODE`) exits 2 (section 1). Confirm.
- Logging. Decided here: `plan` and `doctor` write nothing, so they write no log. Only `apply`, `stats`, `pack`, `pin` and `models set` log (section 1). Confirm.
- State root location. Decided here: the state root and the data root must resolve inside `$HOME`, else exit 2 with `E_STATE_ROOT` (section 1). Confirm.
- Undo with a conflict. Decided here: the undo stops before any write and lists every conflicting path (section 9). The alternative restores the other paths and blocks only the conflicting ones. Confirm.
- Product pack. Decided: `office-hours` is back in v0 as `/oh` ([decision 0026](../decisions/0026-product-pack-in-v0.md)).
- Codex agent text. Decided here: a Codex agent TOML takes its `description` and `developer_instructions` from the Claude fleet agent file of the same role (section 8). Confirm, or name another source.
- Codex comment lines. The `block` kind needs Codex to keep the `# rig:models` marker comments in `config.toml`. If Codex drops them, `plan` blocks with `E_LOCATOR` on the next run.

### Next implementation step

Write the slice 0 probe scripts, starting with probe (b) (Cursor dedupe), because its verdict decides whether units for Claude Code and Codex need the plugin channel.

## 16. Red-flag self-screen

| Red flag | Verdict |
|---|---|
| Shallow module | `targets`, `models` and `state` hide placement, render kinds, ladders, adopt, drift and recovery behind two or three calls each. `fs` exposes five primitives but no policy. |
| Information leakage | Render kind grammar lives only in `targets`. Model resolution lives only in `models`. Config schemas live only in `world` (`encode` serves the two config writers). Provider model rules live in provider records, not in target records. |
| Temporal decomposition | The pipeline stages are calls inside modules owned by knowledge. Observe and plan sit in `state` with the installed record they read. |
| Pass-through method | `bin/rig.ts` `prepare()` sequences four calls and adds the filter. No exported function only forwards. |
| Split ownership | Each file has one writer (section 3). `metrics.jsonl` has one writer function, called by `stats` and the hook. |
| Two ways to do one task | `models set` and a hand edit plus `apply` run one code path with the same writer. `audit` is gone because `plan` covers it. |
| Importable internals | `lib/<m>/*` is unreachable from outside `<m>`. The boundary test fails the build. |
| Hand-synced list | The target list derives from `targets/*.json`. The command list derives from `COMMANDS`. The check list derives from the registry. Doc tables that copy them are checked by a test. |

## 17. Uncertainties and assumptions

Scores apply to assumptions only. Facts verified in the grounding or the research records are not scored. An A-number names the same assumption in [assumptions and open questions](../assumptions-and-open-questions.md).

| Assumption | Score | Reason | Blast radius | Resolution path | Falsification probe |
|---|---|---|---|---|---|
| A23: Cursor does not deduplicate identical copies, so the record value stays `none`. | 4 | No source says either way. The design handles both, at the cost of the plugin channel. | Units for Claude Code and Codex need `channel.claude = "plugin"`. | Probe (b). | One skill with identical bytes in `~/.claude/skills` and `~/.cursor/skills`: count Cursor listing entries. |
| A25: A Claude Code plugin from a local directory marketplace, `false` at user scope, loads in a project when `settings.local.json` enables it, with no fetch. | 5 | Precedence is documented. The local-directory case is not. | `project` and `hybrid` scope fail on Claude Code. | Probe (k). | Enable a fixture plugin that way. List skills inside and outside the project. |
| A13: omp reads `~/.codex/skills`, collapses identical bytes, and does not read the Claude plugin cache. | 5 | Explorer claim and research note. Not tested. | omp sees zero or two copies under the placements in section 7. | Probe (e). | Place one skill in `~/.claude/skills` and `~/.codex/skills`. Count omp's listing. |
| A26: omp keeps `modelRoles` lines in `key: value` form when it rewrites `config.yml`. | 6 | The file has no comments and a lock file, so omp likely rewrites it. | The `keys` kind fails or reports false drift. | Probe (c). | Change one setting in omp. Diff the file. Re-run the `keys` locator. |
| Users accept plugin namespacing (`/<plugin>:<skill>`) for plugin-channel packs. | 6 | A user-intent question. | Packs that need the channel are less pleasant to invoke. | Ask in the checkpoint review. | A pack whose skill must keep a bare name and must reach Claude Code, Codex and Cursor. |
| Leaks to harnesses outside a unit's set are acceptable as info. | 6 | A user-intent question. | A unit meant for one harness appears in another. | Ask in the checkpoint review. | A unit whose text gives wrong instructions in another harness. |
| A24, plus the local plugin path (no A-number): Cursor loads skills from `~/.cursor/plugins/local/rig` and `.mdc` user rules from `~/.cursor/rules`. | 5 | Decision 0020 names the local plugin. User rules are documented only in the UI. | No `/craft`, no rig skills and no frame on Cursor. | Probe (j). | Write a `craft` skill in the local plugin and `rig-frame.mdc`, ask Cursor to quote a canary line from each. |
| Codex keeps comment lines in `config.toml` when it appends tables. | 6 | Codex appends tables. Whether it rewrites comments is not checked. | The `block` markers vanish and `plan` blocks with `E_LOCATOR`. | Slice 3 fixture. Re-check after a Codex update. | Run a Codex command that appends a table, then diff the marker lines. |
| The Claude Code `SessionEnd` payload carries `session_id` and `transcript_path`. | 7 | Hook docs list them. Not seen on this payload. | The hook aggregates nothing. | Probe (h). | Log a test hook's stdin. |
| `settings.json` round-trips in canonical JSON. | 6 | Claude Code writes 2-space JSON. Hand edits may not. | The hook needs a manual paste. | `plan` blocks with the snippet. | Run the round-trip on the user's file. |
| Line-level YAML in the `keys` kind suffices: no multi-line values and no flow style on these keys. | 7 | The observed shapes are single-line. | A cell is missed and `E_LOCATOR` blocks. | Fixture of each shape in slice 3. | A quoted or multi-line value in the live file. |
| A pre-rename sha check makes harness races rare enough. | 6 | Writes happen when the user runs `apply`, rarely during a harness write. | One lost harness write, shown as drift. | Accept. Revisit if `doctor` shows it. | Run `apply` while omp writes its config in a loop. |
| omp does not need rig to hold `config.yml.lock`. | 5 | Its purpose is unknown. | A corrupt or lost omp write. | Probe (c) extension, or ask upstream. | Hold the lock file open during an omp settings change. |
| A12: Codex hides a skill through the `openai.yaml` sidecar. | 6 | Nearest documented equivalent. | `machine-hidden` packs list on Codex. | Probe (f). | Install one hidden skill. List skills with `codex exec`. |
| A35: Transcript readers survive harness updates with field allowlists. | 6 | Formats are undocumented. | Wrong totals in `stats`. | A fixture per reader version. Missing fields stay null. | Re-run reader fixtures after each harness update. |
| A28: 4 characters per token is close enough for `budget`. | 7 | Standard estimate. | Thresholds off by about 20 percent. | Calibrate against usage fields. | Compare an estimate with input tokens for one known file. |

Overall confidence: 6 out of 10. The data model, ownership and transaction rest on verified shapes and binding decisions. The open risks are the Cursor and omp read-set rules (probes b and e), project scope on Claude Code (probe k), and the Cursor local plugin and rule paths (probe j).
