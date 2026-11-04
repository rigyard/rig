# rig design draft

Status: Draft v4, 2026-11-04. It replaces draft v2 and the unpublished draft v3. It folds in the v3 review and decisions 0010 to 0023. Where this draft and an Accepted decision disagree, the decision wins.

Measured values in this draft come from one machine on 2026-11-04. They show the order of magnitude. They are not targets.

## 1. What rig is

rig is a version-pinned agent-skill stack and a seeder. It is one Node ESM CLI with zero npm dependencies. It composes packs of skills, commands, agents and rules, runs one gate over them, and installs copies into each harness. v0 targets: Claude Code, Codex, omp and Cursor ([decision 0020](../decisions/0020-cursor-in-v0.md)). v1 targets: pi and Hermes.

Core ideas:

- One machine-level base. Each project declares its workflow provider explicitly ([decision 0008](../decisions/0008-per-project-provider-selection.md)).
- Each pack declares its scope, and the user chooses it ([decision 0017](../decisions/0017-per-pack-scope-no-context-inference.md)).
- A sealed core plus packs. Packs and targets are data. No code plugins ([decisions 0004](../decisions/0004-packs-and-targets-as-data.md) and [0005](../decisions/0005-sealed-core.md)).
- Copies pinned by a lock ([decision 0003](../decisions/0003-copies-and-lockfile.md)).
- One gate before every write ([decision 0006](../decisions/0006-one-gate-before-apply.md)).
- One model table. rig renders the model and effort values in every model-bearing file from it ([decision 0011](../decisions/0011-one-model-table.md)).
- A short frame on every harness. It states precedence and four invariants.
- Local, content-free measurement of agent behaviour, and self-feedback that the user approves ([decision 0021](../decisions/0021-observability-and-self-feedback.md)).

pstack is the default workflow provider and the quality bar. It stays an external pin. rig does not vendor or rename it: it has about 228 `poteto-mode` references and frequent patch releases, so a copy would drift.

## 2. Changes from draft v2

1. The workflow provider comes only from an explicit declaration. Footprints such as an `openspec/` directory or an `enabledPlugins` entry are `doctor` info. They never select a provider.
2. Per-pack scope from v0: machine-wide hidden (default), selected projects only, or hybrid.
3. One model table in two files, `roles.json` and `tiers.json`, with four tiers. rig renders only model and effort values. A first-run adopt step protects hand-written files.
4. The router slot has one filler, `static`, which renders the frame's `Models` lines. No `route()` function and no dispatch-log hook.
5. A new step-slot, `second-opinion`, for judgment from another model family.
6. The gate gains `budget`, keeps `cve` and `injection`, and gets a generic `telemetry` check.
7. The pstack entry command is `/craft`. `/pm` stays as a temporary alias. `/boss` is an existing entry command next to `/craft` and `/oh`: orchestrator mode, which delegates by default and never edits directly. It is a Claude-only unit until the orchestration rules move into rig.
8. Cursor is a v0 target.
9. A new section: observability and self-feedback (section 14).
10. Six v0 slices. The product pack moves into slice 5.

## 3. Composition model

### Machine level

`rig.json` in the repository plus `~/.config/rig/rig.json` in the private overlay ([decision 0002](../decisions/0002-generic-repo-private-overlay.md)). The overlay adds packs, pins, providers, scope choices and project declarations. It can disable or replace non-core units with the operations in section 4. It cannot remove or change a core unit.

```json
// rig.json (repository)
{"schema":1,"packs":["own","product"],"pins":["pstack"],"providers":["pstack","openspec"],
 "default_provider":"pstack","aliases":{"pm":"craft"},
 "slots":{"doc-review":"redpen","router":"static","second-opinion":null},
 "harnesses":["claude","codex","omp","cursor"],"metrics":{"session_hook":false}}
// ~/.config/rig/rig.json (overlay, example)
{"schema":1,"packs":["<overlay-pack>"],"pins":["<sdlc-plugin>"],"providers":["<sdlc-plugin>"],
 "scope":{"<overlay-pack>":{"mode":"project","projects":["~/src/<repo>"]}},
 "projects":{"~/src/<repo>":{"provider":"<sdlc-plugin>"}}}
```

`<overlay-pack>` and `<sdlc-plugin>` are placeholders for a pack and a provider record that live only in the overlay.

### Pack scope

Each pack declares its scope: machine-wide (hidden), selected projects only, or hybrid. The user chooses the scope explicitly. rig does not determine the scope itself.

- `pack.json` lists the modes the pack supports: `"scopes":["machine-hidden","project","hybrid"]`.
- The user picks one mode per pack in `rig.json` or the overlay: `"scope":{"<pack>":{"mode":"...","projects":[...]}}`.
- No entry: the pack installs in `machine-hidden` mode. `project` and `hybrid` need an explicit entry with a project list. A mode that the pack does not list is a parse error.
- `machine-hidden`: installed for every project, hidden from the model listing. You invoke its units by name.
- `project`: available only in the listed projects.
- `hybrid`: installed machine-wide and hidden, and model-invocable in the listed projects. This definition is proposed (see the open questions).

Delivery per harness for the project part:

| Harness | Project-only delivery | rig writes into the repository |
|---|---|---|
| Claude Code | rig renders the pack as a local-path plugin in a rig-owned marketplace under `~/.rig/`. `apply` installs it with `false` at user scope. The user enables it per project in `.claude/settings.local.json`. `doctor --project DIR` prints that snippet. | No |
| Codex, omp | The harness has no uncommitted per-project skill location. The pack is absent there until the user commits its files. `doctor --project DIR` prints the paths. | No |
| Cursor | Project `.cursor/skills` and `.cursor/rules` live in the repository. Same rule as Codex. | No |

The Claude Code path reuses the documented `enabledPlugins` precedence (below). Project-only delivery through a local plugin is unverified until slice 2 (assumption A25).

### Project level: explicit declaration only

The project's provider comes only from an explicit declaration. rig and the model read it in this order:

1. A `projects` entry in the overlay `rig.json`. The frame renders these entries on the local machine (section 13).
2. A `rig-project: <provider>` line in project instructions.
3. No declaration: `default_provider`.

rig never selects a provider from what it finds in a repository. Mechanism: the resolver takes only the overlay `projects` map and the `rig-project:` line as input (slice 2 test). `doctor --project DIR` lists footprints as info: an `openspec/` directory, a provider plugin in `enabledPlugins`. When a footprint has no declaration, `doctor` prints the line that would declare it. A provider plugin must also be enabled in the project. That is activation, not selection.

rig writes nothing into repositories. No command takes a repository path as a write target.

| Harness | Shared (committed) | Local (uncommitted) |
|---|---|---|
| Claude Code | A `rig-project:` line in `CLAUDE.md`, `AGENTS.md` or `.claude/rules/rig-project.md`. A provider plugin in `.claude/settings.json` `enabledPlugins`. | `CLAUDE.local.md` with the `rig-project:` line. `.claude/settings.local.json` (local beats project beats user, key by key). An overlay `projects` entry. |
| Codex | A `rig-project:` line in the repository `AGENTS.md`. | An overlay `projects` entry. Codex has no uncommitted per-project instruction file. `AGENTS.override.md` is global only. |
| omp | The same files as Codex. omp reads `AGENTS.md` and `CLAUDE.md`. | An overlay `projects` entry. |
| Cursor | A `rig-project:` line in `AGENTS.md` or in a `.cursor/rules/*.mdc` file. | An overlay `projects` entry. |

**Isolation base.** A restrictive provider plugin is `false` at user scope and `true` at project scope in the projects that the user picks. Claude Code documents the rule on its plugins/loading page. Quote: "For each plugin id, the value that applies is the one from the highest-precedence source that mentions the id." The flip must not uninstall the plugin, because a project-only `true` does not fetch it.

**Trap.** `CLAUDE.local.md` makes Claude skip a repository `AGENTS.md` unless project instructions are set to `claude-md-and-agents-md`. `doctor --project` warns when both files exist.

### Overlay without leaks

- The repository frame template names no overlay unit. Overlay records render their own lines at apply time, on the local machine only.
- The `private_terms` check blocks any overlay term that appears in a repository pack.
- Hidden units use the target's hide control: `disable-model-invocation: true` on Claude Code and Cursor. The Codex and omp controls are in the target records (Codex unverified, see assumption A12).

### Read-set matrix

Several harnesses read the same directories. Cursor reads `~/.cursor/skills`, `~/.agents/skills`, `~/.claude/skills` and `~/.codex/skills`. Each target record lists the directories that its harness reads. `rig plan` computes the effective unit set per harness from that matrix. Rule: each unit reaches a harness through exactly one directory. The Cursor target writes no copy of a skill that `~/.claude/skills` already delivers. `rig audit` warns on an effective duplicate. Whether Cursor collapses duplicates itself is unverified (assumption A23).

## 4. Core and customization

Core is `packs/core/`. It is sealed by a tree hash, never listed in `packs`, and always installed. Mechanism: compose adds core to every stack, and a `core` entry in `packs` is a parse error. Members: the frame template, `rules/working.md`, `rules/writing.md`, the slot stubs (`doc-review`, `router`, `second-opinion`), and the schemas for providers, targets, roles and tiers. The gate, the renderers and the metrics reader are code in `lib/`. They are not pluggable. Everything else is a pack (`own`, `product`, overlay packs) or a pin.

Four operations, in `rig.json` or the overlay:

1. Disable a default unit: `"disable":["own/explain"]`. A core reference here is a parse error.
2. Fill a slot: `"slots":{"doc-review":"redpen"}`. A second filler raises `E_SLOT_TWICE`.
3. Add a pack: `rig pack add github.com/cursor/plugins --sha bb68f23 --path cursor-team-kit`, ack the findings, then list it in `packs`.
4. Replace a non-sealed unit: overlay `pack.json` `"units":{"explain":{"replaces":"own/explain"}}`. A core reference in `replaces` is rejected.

Conflicts: no precedence order exists. The same installed name from two packs raises `E_CLASH` unless exactly one of them declares `replaces`. A pack unit with a core name raises `E_CORE_SHADOW`. Compose errors cannot be acked.

Configuration cannot change these items:

- the frame skeleton and its precedence list
- the invariant "pause before irreversible writes"
- the check set and severities, and the `pin` check
- the absence of a skip flag
- the writer's containment under `$HOME`
- the rule that `apply` is the only writer of harness configuration

Mechanism: the `rig.json` and `pack.json` schemas have no field for these items, and the loader rejects unknown keys (planned, slice 1 test). A core change is a repository commit plus a reseal (`rig pin set core`, which hashes the repository tree), visible in git. The seal is tamper-evident, not tamper-proof.

One-writer rule, exact scope: only `apply` writes harness configuration (skills, agents, rules, commands, settings, model-bearing files). Mechanism: only `apply` imports the writer module (planned boundary test, as in decision 0004), and the writer accepts only paths that target records declare. rig's own state is the exception: `~/.rig/` (install record, marketplace for project-scoped packs) and `~/.local/state/rig/` (metrics store and log, section 14). `rig stats` and the optional session hook write only there.

## 5. Workflow providers

A provider record is data:

```json
{"name":"<id>","kind":"claude-plugin | cli | pack",
 "entry":{"claude":"/cmd","codex":"...","omp":null,"cursor":"..."},   // null = not available there
 "phases":[...],"artifacts":"<path>","injects":["SessionStart"],
 "footprint":{"claude":"enabledPlugins:<id>","any":"dir:openspec/"},  // doctor info only, never selects
 "intake":{"claude":"/cmd <design-doc>"},                             // product-role handoff
 "models":{"reads":"<path of its model rule>","labels":"roles.json#<provider>"} | null,
 "telemetry":{"optout_env":[...],"endpoint":"..."} | null,
 "pin":{"plugin":"<name>@<marketplace>"} | {"cli":"openspec","version":"1.5.0"} | null}
```

One provider is active per project. It routes its own task types ([decision 0007](../decisions/0007-workflow-providers-and-step-slots.md)). `models` names the file the provider reads for model choices and the role-label set that rig must keep byte-exact (section 6).

### pstack (default)

- `kind: claude-plugin`, `pin: pstack@cursor-plugins`. No hooks and no `package.json` (verified, 0.15.36).
- Entry: `/craft` on every harness ([decision 0016](../decisions/0016-entry-command-craft.md)). rig renders it from the target record's command format. On Claude Code it is a user command that reads `poteto-mode` from the plugin cache by path. On Cursor it is a skill with `disable-model-invocation: true`, because Cursor commands are legacy. The Codex and omp forms are unverified.
- `/pm` stays as an alias through `"aliases":{"pm":"craft"}`. `doctor` prints a reminder while the alias exists.
- omp: a third-party omp port of pstack, published on npm. Codex: degraded, through unpinned copies in `~/.agents/skills`. Cursor is pstack's native home (local plugin).
- Model rule: pstack skills take model choices by role label from "the `pstack-models.mdc` rule". On Claude Code the rules-directory copy `~/.claude/rules/pstack-models.md` loads as always-on context (assumption A22). On Cursor rig renders `~/.cursor/rules/pstack-models.mdc`.
- pstack keeps its own raise and lower policy: start at the role's line, raise one step for the hardest work, lower for routine work.
- Whole playbook in one session. Internal chains, including "Opening a PR", stay inside pstack.

### OpenSpec (the pluggability proof)

```json
{"name":"openspec","kind":"cli","pin":{"cli":"openspec","version":"1.5.0"},
 "entry":{"claude":"/opsx:propose","codex":"/openspec-propose","omp":null,"cursor":null},
 "phases":["explore","propose","apply","sync","archive"],"artifacts":"openspec/changes/<name>/",
 "injects":[],"footprint":{"any":"dir:openspec/"},"models":null,
 "intake":{"claude":"/opsx:new <slug>, then /opsx:propose with the design doc as input"},
 "telemetry":{"optout_env":["OPENSPEC_TELEMETRY=0","DO_NOT_TRACK=1"],"endpoint":"https://edge.openspec.dev"}}
```

- The project declares it with `rig-project: openspec`. The `openspec/` directory alone selects nothing.
- The Codex entry string is unverified. Codex invokes custom prompts as `/prompts:<name>`, so the entry may be `/prompts:openspec-propose`. The Cursor entry is null until `openspec init --tools` is checked for a Cursor value.
- Setup is the CLI's own: `openspec init --tools claude,codex,pi` in the repository. Claude Code gets `.claude/commands/opsx/*.md` (verified). Codex gets global `~/.codex/prompts/openspec-*.md` (verified).
- `--tools` has no omp value. omp is degraded: run `openspec instructions <artifact>` and follow it.
- `openspec update` regenerates files after a CLI upgrade. `doctor --project` checks them against the pinned version.
- rig installs nothing. The record gives the frame the entry, the phases ("no verify or review phase: verify yourself") and the artifact path.
- Telemetry is on by default. It sends the command name, version, surface and an anonymous id. IP collection is off (verified, `dist/telemetry/index.js:103-120`). The `telemetry` check covers it (section 10).

### A restrictive SDLC plugin (stretch example)

The record lives in the overlay. Properties of the example plugin and their cost to rig:

| Property | Cost |
|---|---|
| A session-start hook injects its phase table on startup, clear and compact (about 9,200 bytes measured) | Zero code. The two-scope `enabledPlugins` flip. |
| A per-prompt hook appends to a local usage log | Zero. Disclosed in `injects`. Info, not telemetry. |
| One phase per session. The phase table must be the first message | Three frame sentences (section 13). |
| Hard approval gates | Frame tier 2: the active provider's gates stand. |
| Commit trailer, PR template, one PR per slice, model pins in its agent frontmatter | Owned by the provider. `doctor` lists pins that name a model absent from `tiers.json`. |
| Codex, omp and Cursor | `entry` is null. The frame omits the provider there. |

Threshold ([decision 0009](../decisions/0009-openspec-proof-restrictive-plugin-stretch.md)): rig supports it while it needs nothing beyond (a) the `enabledPlugins` flip, (b) one data record, (c) frame sentences that hold for every provider. rig documents it as not supported on the day it needs a rig hook, an edit to the plugin, suppression of its hooks, or a Codex, omp or Cursor port. Today it meets the threshold: go, Claude Code only, with `rig pin check` on each release.

## 6. Models: one table, two indirections

rig owns one model and effort table ([decision 0011](../decisions/0011-one-model-table.md)). Two files:

- `models/roles.json`, stable: role to tier and default effort, per consumer (fleet, pstack, omp, Codex, Cursor). A provider's role labels are the provider's, byte-exact.
- `models/tiers.json`, volatile: tier to concrete model per harness, plus each harness's effort ladder. A model release touches only this file.

Four vendor-neutral tiers: `reason`, `strong`, `fast`, `cheap` ([decision 0018](../decisions/0018-four-tiers-and-second-opinion-slot.md)). They map one to one to the fleet positions and to the Claude aliases `fable`, `opus`, `sonnet` and `haiku`. Cross-family judgment is not a tier. It is the `second-opinion` step-slot (section 8). omp's `judge` role takes a literal model id in `roles.json`, because it names a model from another family on purpose.

```json
// models/roles.json (fleet values reproduce the live agent files; example)
{"schema":1,"ladder":["low","medium","high","xhigh","max"],
 "fleet":{"deep-reasoner":["reason","high"],"reviewer":["strong","high"],"senior-worker":["strong","high"],
          "fast-worker":["fast","low"],"quick-worker":["cheap","low"],"web-researcher":["fast","medium"]},
 "pstack":{"budget":"medium (high)","feature, refactoring":["fast","high"],"hardest tasks":["strong","xhigh"],
           "arena runners":[["strong","high"],["fast","high"]],"...":"one entry per pstack label"},
 "omp":{"task":["fast","auto"],"advisor":["strong","medium"],"judge":{"literal":"<other-family model>:medium"},
        "plan":["reason","high"],"default":["cheap","medium"]},
 "codex":{"default":["strong","medium"]}}
```

```json
// models/tiers.json (model ids are examples observed on one machine; verify before use)
{"schema":1,
 "ladders":{"claude":["low","medium","high","xhigh","max"],"codex":["minimal","low","medium","high","xhigh"],
            "omp":["low","medium","high"],"cursor":["low","medium","high"]},
 "passthrough":{"omp":["auto"]},
 "tiers":{
  "reason":{"claude":"fable", "codex":"<codex model>","omp":"<provider>/<model>","cursor":"<slug>"},
  "strong":{"claude":"opus",  "codex":"<codex model>","omp":"<provider>/<model>","cursor":"<slug>"},
  "fast":  {"claude":"sonnet","codex":"<codex model>","omp":"<provider>/<model>","cursor":"<slug>"},
  "cheap": {"claude":"haiku", "codex":"<codex model>","omp":"<provider>/<model>","cursor":"<slug>"}}}
```

- Effort is canonical on the five-step ladder. `ladders` maps it per harness and clamps at the top. `auto` is an omp-only literal in `passthrough`, never a rung, so an escalation cannot land on it. The Codex and Cursor ladders are unverified (assumption A27).
- Codex has one model on the reference machine, so every tier maps to it and effort does the work.
- Cursor takes effort inside the model string: rig renders `<slug>[effort=<e>]`.

### Claude aliases and pins

Claude tiers default to aliases ([decision 0019](../decisions/0019-claude-aliases-with-optional-pins.md)). An alias resolves to the current model, so a Claude release needs no edit. A tier can be pinned to a full model id in `tiers.json`.

- The Agent tool `model` parameter accepts aliases only (verified). A pinned tier therefore renders the full id into agent frontmatter. The alternative is `ANTHROPIC_DEFAULT_<FAMILY>_MODEL`, which remaps the alias for every session.
- The orchestrator selects the agent type, not the model. For a pinned tier the dispatch omits `model`. Otherwise the alias in the parameter overrides the pinned frontmatter (section 12).
- `rig stats` reports what each alias resolved to and when the resolution changed, from `message.model` in transcripts (section 14). Verified on one machine: `opus` resolved to `claude-opus-5-5`, `sonnet` to `claude-sonnet-5-5`, `fable` to `claude-fable-5-1`.

### Render scope

rig renders model and effort values only. Every other byte of a hand-written file stays the user's. Each target record declares its model-bearing files and a kind per file. A renderer exists per kind, as core code.

| Harness | File | Kind | What rig renders |
|---|---|---|---|
| Claude Code | `~/.claude/agents/<fleet role>.md` | `frontmatter` | `model:` and `effort:` lines, and the model display name in `description` |
| Claude Code | `~/.claude/rules/orchestration.md` | `cells` | the "Model, effort" cell of each roster row and the default-effort cell of each effort-table row, matched by role name |
| Claude Code | `~/.claude/rules/pstack-models.md` | `whole` | the `# budget:` line and one line per pstack label. Header comment lines are copied verbatim. |
| Codex | `~/.codex/agents/<fleet role>.toml` | `whole` | `description`, `model`, `model_reasoning_effort`, `developer_instructions` from the agent body |
| Codex | `~/.codex/config.toml` `[agents]` | `block` | `default_subagent_model`, `default_subagent_reasoning_effort` between markers |
| omp | `~/.omp/agent/config.yml` `modelRoles` | `keys` | the values of the five `modelRoles` keys. No markers. |
| Cursor | `~/.cursor/agents/<fleet role>.md` | `frontmatter` | `model: <slug>[effort=<e>]` |
| Cursor | `~/.cursor/rules/pstack-models.mdc` | `whole` | the same lines as the Claude Code file, in `.mdc` form with `alwaysApply: true` |

- Raise and lower conditions, the retry rule, the "Use for" column and row order stay hand-written. rig does not store copies of them.
- Drift: rig keeps the hash of each rendered region in `~/.rig/installed.json`, not in a file comment. omp likely rewrites its `config.yml` (it has a lock file and keeps no comment lines), so a marker or comment could vanish (assumption A26). `doctor` compares the stored hash with the file on disk and names a hand-edited path.
- Codex agent TOML is a full config layer. Slice 3 runs `codex exec` once per rendered agent file.
- Scope rule: rig renders only roles listed in `roles.json`. Agent files outside it stay hand-managed. `doctor` lists them as info.
- pstack label drift: `pin check` for a pstack release diffs the role labels in `poteto-mode` and `setup-pstack` against `roles.json#pstack`. It blocks on a new or renamed label, because a wrong label makes pstack fall back to defaults that the Agent tool rejects.

### First-run adopt

rig never overwrites a model-bearing file that it has not adopted.

1. On the first `apply` for a file that exists and has no install record, rig renders its regions.
2. Every rendered region equals the bytes on disk: rig records the hashes and adopts the file. No write.
3. Any region differs: `apply` blocks and prints the diff. You align either side (edit `models/*.json` or the file) and run `apply` again.

## 7. Router slot

The router is a core policy slot ([decision 0010](../decisions/0010-router-slot-static-table.md)). Its filler renders the `Models` lines of the frame. The default filler is `static`:

- The role table from section 6 gives the starting model and effort.
- Raise effort per the effort-table conditions or after a verified failure. A verified failure is a non-zero gate exit or a reviewer rejection, nothing softer.
- Effort changes inside a session (Agent tool `effort` parameter, Codex `model_reasoning_effort`, the omp `:effort` suffix, the Cursor model-string effort). That keeps the prompt cache.
- The model changes only for a new dispatch, because a model switch loses the cache.
- Inside a provider's skill, the provider's role lines govern.

The retry rule itself (which role takes over after a second failure) stays hand-written in the user's orchestration rule on Claude Code. rig does not render it.

A classifier filler waits. Revisit when the transcript-derived metrics in section 14 show escalations per role over enough dispatches to compare against `static`. No fixed floor is set. Router evidence says routers rarely beat the best single model on coding ([routing and context](../research/2026-11-04-routing-and-context.md)), so a classifier must show a measured win on the user's own tasks. Proxy routers are out: they need an API key and break the cache on a switch.

## 8. Step-slots in v0

Two step-slots. Each has one stub skill with a stable name. `apply` renders the stub body from the filler. The stubs stay model-invocable, so a skill can call them. Each costs one description in the listing budget.

### doc-review

Contract: input is one file path. Output is feedback to apply, as a list that the caller works through.

- `redpen` (default). A local browser-based annotator. `redpen "<file>"` blocks until the user submits, then prints feedback to stdout.
- An overlay provider, for example a doc-review skill that a provider plugin ships. It may need that plugin enabled in the project.

```markdown
---
name: rig-doc-review
description: Review a markdown document with the configured doc-review provider. Use when a design doc, plan, or spec needs feedback before it is final.
---
Input: one file path. Output: feedback to apply.
Provider: redpen. Run `redpen "<path>"`. Apply each item it prints, then reply with what changed.
<!-- other provider -> "Invoke <provider entry> on <path>. If its plugin is not enabled here, ask the user to review <path>."; empty -> "Slot empty: ask the user to review <path>." -->
```

Callers: the frame line, and `office-hours` before the design doc is final.

### second-opinion

Contract: input is a question plus artifact paths. Output is an independent verdict with evidence per claim, from another model family where the provider allows it. The provider runs read-only.

| Provider | Call | Notes |
|---|---|---|
| `claude-cli` | `claude -p --output-format json --model <alias> "<prompt>"` | Flags verified locally. |
| `omp-cli` | `omp -p --mode json --model <provider/model> "<prompt>"` | Multi-vendor, fuzzy model match. Flags verified locally. |
| `codex-cli` | `codex exec "<prompt>"` | Read-only flag unverified. |
| `cursor-cli` | `cursor-agent -p --output-format json --model '<slug>[effort=<e>]' --mode ask "<prompt>"` | Flags verified locally. No token data in its output. |
| `native` | A model from another family inside a multi-vendor harness (omp, Cursor) | Needs no other CLI. |

The default filler is empty: "Slot empty: say that no second opinion is configured." The user picks a provider per machine in the overlay. On a single-vendor harness (Claude Code, Codex) only a CLI provider reaches another family. Caller: the frame line. pstack's cross-judge step skips on Claude Code today, and pstack does not call rig stubs, so the frame line is the only path there.

New step-slots (`verify`, `code-review`, `ship`) are v1 candidates. A candidate becomes a slot when you ran two real providers for one step within a month, counted from transcripts.

## 9. Product and business roles (ported from gstack)

One pack, `packs/product/`, ported and owned. gstack is MIT, so the pack ships `NOTICE.md`, `licenses/MIT-gstack.txt` and `pack.json` `ported_from: {source: gstack, sha: b244e6d}`.

- v0: `office-hours` as `/oh` (slice 5). `/boss` (orchestrator mode) sits beside `/craft` and `/oh` as an entry command ([decision 0016](../decisions/0016-entry-command-craft.md)).
- v1: `plan-ceo-review`, `plan-devex-review`, `retro`. `retro` has 772 lines, 33 bin mentions and a metrics helper to rewrite.
- Later: `spec`, `document-release`.
- These are not workflow providers. They work on design docs before a workflow starts.

Port rules:

- The preamble pieces worth keeping (ask-user format, completeness, confusion, evidence, completion status, search before building, voice, writing style, from gstack `scripts/resolvers/preamble.ts:90-109`) become `skills/office-hours/references/product-core.md`. About 60 lines, read on invocation.
- Calls to `gstack-paths`, `gstack-builder-profile` and `gstack-developer-profile` are dropped.
- `$GSTACK_STATE_ROOT/projects/<slug>/` becomes `docs/designs/<slug>.md`.
- `{{SECTION:...}}` placeholders become `references/` files.
- AskUserQuestion on Claude Code. `Q<N>` and `D<N>` prose on other harnesses.

Use: `/oh "idea"` runs the questions, writes `docs/designs/<slug>.md`, calls `rig-doc-review`, and closes with the active provider's `intake` line:

- pstack: "Next: `/craft feature docs/designs/<slug>.md`".
- OpenSpec: "Next: `/opsx:new <slug>`, then `/opsx:propose` with the design doc".
- An overlay provider: its own `intake` line.

`intake` is the only rig-owned glue between product roles and providers.

## 10. Safe seeding

### The gate

`rig audit`, `rig plan` and `rig apply` call one `gate()`. `pack add` and `pin check` run the same checks on the new tree. No pack is exempt, core included. `apply` writes only from the audited stack and re-hashes it before each write.

| Check | Finds | Severity |
|---|---|---|
| `pin` | lock mismatch, core seal mismatch | block, never ackable |
| `exec` | exec bit, shebang, script extension, binary magic, `hooks.json`, `.mcp.json`, `package.json` scripts, symlinks | block |
| `secret` | secrets | block |
| `unicode` | hidden Unicode, `curl \| sh`, eval of fetched data | block |
| `license` | a missing or disallowed license | block |
| `cve` | a high or critical CVE in a dependency manifest | block. Runs only when a manifest exists. With no `osv-scanner` and no cached result it blocks. |
| `injection` | injection phrases, URLs in prose, `npx` or `pip install` | warn |
| `telemetry` | a tool whose telemetry is on while no opt-out variable from its record is set | warn |
| `budget` | token and size budgets (below) | block where the harness drops or truncates text, warn where text costs money |
| `private_terms` | an overlay term in a repository pack | block |

Every check runs offline except the OSV refresh. Tool survey: [routing and context](../research/2026-11-04-routing-and-context.md).

**Telemetry check** ([decision 0022](../decisions/0022-generic-telemetry-check.md)). It reads each provider and pin record with a non-null `telemetry` field. It warns when that tool's telemetry is on and none of the record's `optout_env` variables is set. The warning prints `export DO_NOT_TRACK=1` when the record lists it, else the tool's own variable. With the variable set, the check passes and needs no ack.

**Budget check** ([decision 0012](../decisions/0012-token-budgets-and-cache-bust-lint.md)). It runs at render time over the rendered tree plus the hooks and instruction files that rig can see. Tokens are estimated at 4 characters per token (assumption A28). Thresholds are proposed, from the researcher budgets in [routing and context](../research/2026-11-04-routing-and-context.md). Only the 1,536-character description cap and the Codex `AGENTS.md` cap are harness facts, and the Codex cap comes from a third-party source.

| Metric | Threshold (proposed) | Severity | Measured on one machine |
|---|---|---|---|
| Always-on tokens per harness (frame, rules, `CLAUDE.md` or `AGENTS.md`, model rule) | 4,000 tokens | warn | 25,346 B on Claude Code, about 6,300 tokens |
| One description | over 1,536 characters (harness cap) | block | max 829 |
| One description | over 300 characters | warn | 8 own skills over 400 |
| Listing total, all sources rig can enumerate | 8,000 characters | warn | over |
| Body | over 500 lines or 5,000 tokens, or a median over 1,500 tokens | warn | 3 own skills over 400 lines |
| Worst-case co-load: always-on plus the three largest invocable bodies | 25,000 tokens (compaction pool) | warn | computed at render |
| SessionStart hooks: run each in the fixture HOME, sum stdout | 300 tokens | warn | 0 to 176 B per hook, plus a provider hook of about 9,200 B |
| Per-turn hooks: run each UserPromptSubmit and PreToolUse hook with a sample input | over 0 bytes | warn. A rig-owned hook over 0 bytes blocks. | one prompt hook: 0 B in an unindexed repository, 16,698 B in an indexed one |
| Cache-bust lint over rendered prefix content | timestamps, dates, session ids, random order, per-session paths, `git status` output | warn | |
| Reference depth | a skill that reads more than 3 files up front, or `references/` nested deeper than one level | warn | |
| Codex `AGENTS.md` | over 8 KiB warn, over 32 KiB block | warn, block | frame block only |

The hook meter runs each hook with a sample stdin JSON and the harness environment unset. State-dependent hooks then report their quiet value, and the report says so. The measured prompt hook injects into the user message, so the prefix cache holds. Its cost is window space, not cache writes.

Acks: `{id, check, pack, path, reason, expires}` in `audit.allow.json`. The id hashes check, pack, path and evidence bytes, so a changed upstream file blocks again. The loader rejects an empty reason or a missing expiry. The CLI prints the stanza and never writes it.

### Vendored packs

1. `rig pack add` clones at the SHA into a temporary directory, copies the paths, computes the tree sha256, writes the lock entry and a `pack.json` skeleton with the detected license.
2. The gate runs on the new pack.
3. The report prints each finding and an ack stanza per block.
4. You read the flagged file, paste the stanza with a reason and an expiry into `audit.allow.json`, and commit.
5. You list the pack in `packs`. `rig plan` shows the diff per harness. `rig apply` runs the gate again, writes through a temporary file and a rename, and records `~/.rig/installed.json`.

### Native plugins rig does not copy

1. `rig pin check <name> --sha S` clones the marketplace repository at S into a temporary directory and runs the gate on the plugin tree. It prints the report and the ack stanzas, and writes `candidate: {sha, tree}` into the lock. Hook scripts block once per version until acked.
2. You update the plugin in the harness (`claude plugin update` or `/plugin`).
3. `rig pin set <name>` reads `installed_plugins.json`. It refuses when `gitCommitSha` differs from the candidate. Otherwise it promotes the candidate to `current`. So a SHA that `pin check` did not see never enters the lock.
4. `doctor` compares `installed_plugins.json` version and `gitCommitSha` with the lock and blocks on a mismatch. It hashes the cache tree at warn level, because the harness may rewrite its cache. It flags stale cached versions.

Auto-update: `doctor` reads `autoUpdate` from `extraKnownMarketplaces` in the settings files first, then from `known_marketplaces.json`. It flags a marketplace that has auto-update on and serves a pinned plugin.

CVE on native caches: Claude Code installs plugin dependencies only when both `package.json` and a lockfile exist. `cve` runs on a native cache only when a lockfile exists. Otherwise `doctor` prints "no lockfile, no dependency install".

Cursor: rig installs its Cursor content as a local plugin in `~/.cursor/plugins/local/<name>`. The plugin holds skills, including `/craft`, that no shared directory already delivers to Cursor (read-set rule, section 3). Agents go to `~/.cursor/agents/`, because `.cursor` wins over `.claude/agents`. The `.mdc` rules go to `~/.cursor/rules/`, because pstack reads its model rule by path. A marketplace plugin with the same name wins over a local one, and GitHub marketplaces auto-refresh with no per-plugin off switch. `doctor` flags a marketplace plugin that shadows a rig local plugin. rig merges entries into `~/.cursor/hooks.json` and keeps every entry it did not write (slice 6 test). rig does not write to `~/.cursor/skills-cursor/`, which Cursor manages: the target record does not declare it.

## 11. Test doubles

[Decision 0015](../decisions/0015-test-doubles-per-kind.md).

| Kind | Decision | Smallest proving test |
|---|---|---|
| Audit checks on fixture packs | Keep, v0 | A shebang fixture blocks. One changed byte in an acked script blocks again. |
| Fixture HOME plus stub `claude`, `codex`, `omp`, `cursor-agent` | Keep, v0 | Fixture user settings with a provider off, project settings with it on, a fixture `installed_plugins.json`: `doctor --project` prints effective `true`, source `project`. |
| Fixture transcripts per harness | Keep, v0 | Slice 6 checks (section 15). |
| Provider approval gates with an auto-approve stub | Cut | Gates are prose, so a stub tests the model, not rig. |
| Simulated session-start injections | Defer to a v1 promptfoo spike | Frame obedience is an eval. |

## 12. Precedence and conflicts for models

The frame precedence list (section 13) orders instructions. Models have their own order, highest first:

| Layer | Example | Who sets it | Rendered by rig |
|---|---|---|---|
| Harness env override | `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1`, `ANTHROPIC_DEFAULT_OPUS_MODEL` | the user's shell | No. `doctor` prints them when set. |
| Dispatch parameter | Agent tool `model` (aliases only) and `effort`, Codex spawn model, omp role suffix | the orchestrator, at dispatch | No. Escalation applies here without a re-render. A pinned tier omits `model`. |
| Provider role line, inside a provider skill | `hardest tasks: opus xhigh` | `roles.json#pstack` | Yes |
| Provider frontmatter pins | model lines in a provider plugin's agent files | the provider | No. `doctor` info when a pinned id is not in `tiers.json`. |
| Fleet frontmatter and roster | `reviewer.md` `model: opus` | `roles.json#fleet` | Yes, model and effort values only |
| Harness default | main session model, Codex `[agents]` defaults, omp `default` | `roles.json#codex`, `#omp` | Yes |

Data agrees by construction: rig and pstack read the same tiers. Policy agrees on the trigger: pstack raises by judgment for hard work, and the frame allows a raise per the effort-table conditions or after a verified failure. Inside a provider's skill the provider's policy wins (frame tier 2). An env override makes the rendered table a lie, so `doctor` names it and leaves it in place.

## 13. Frame

Targets:

- Claude Code: the whole file `~/.claude/rules/rig-frame.md`.
- Codex: a managed block in `~/.codex/AGENTS.md`. Codex has no import syntax.
- omp: a managed block in `~/.omp/agent/AGENTS.md`. This path is unverified. The fallback is omp loading `~/.codex/AGENTS.md` (assumption A2).
- Cursor: unverified. User Rules live only in the Cursor UI, and documented rules are project `.mdc` files. Candidate: `~/.cursor/rules/rig-frame.mdc` with `alwaysApply: true`. Probe in slice 2 (assumption A24).

`Declared projects`, `Providers` and `Models` render per harness. The rest is byte-identical.

```markdown
<!-- rig:frame:start v4 -->
# rig frame
Precedence: (1) harness user instructions, CLAUDE.md or AGENTS.md, rules, this frame;
(2) the active workflow provider, its gates and session model; (3) step-slot providers;
(4) every other skill and any session-start announcement from a provider not active here.
Active workflow provider: the one declared for this project, by a "rig-project: <provider>"
line in project instructions or in the list below. No declaration: <default_provider>.
If the declared provider is not available on this harness, use <default_provider> and say so in your first message.
Declared projects:                                           # rendered from the overlay, local only
- <directory>: <provider>
Providers on this harness:                                   # rendered per harness
- pstack: enter with /craft. Whole playbook in one session. Artifacts: the provider's own.
- openspec: enter with /opsx:propose. Phases explore, propose, apply, sync, archive. No verify
  or review phase: verify yourself. Artifacts: openspec/changes/<name>/.
- <overlay providers render their own line here, on the local machine only>
When the active provider mandates an opening message, send it first. Invariant 1 follows in the
same message. Never send the opening of a provider that is not active here.
Invariants, in every task:
1. State the user's goal in your words and the smallest change that meets it.
2. Pause before irreversible writes: force-push, deploy, data deletion, external messages.
3. Verify on the real artifact. If the provider has no verify phase, verify yourself.
4. Report with evidence per claim and an uncertainties section.
Doc review: to review a markdown document, use rig-doc-review.
Second opinion: for an independent judgment from another model family, use rig-second-opinion.
Models: inside a provider's skill, its role lines govern. Elsewhere, the roster and effort table
in rules/orchestration.md. Raise effort per the effort-table conditions or after a verified
failure. Change the model only for a new dispatch.          # router slot output, per harness
Principles: pstack principle-* leaves. Cite only leaves you read this session.
<!-- rig:frame:end -->
```

Per-harness `Models` source: Codex "the agent files in ~/.codex/agents", omp "the modelRoles in config.yml", Cursor "the agent files in ~/.cursor/agents". A harness with no effort table gets "Raise effort after a verified failure." The `Second opinion` line renders only when the slot has a filler.

The precedence list appears once. The frame names no profile. The frame is prose. Nothing in code makes the model obey it. Project-scope `enabledPlugins` does the isolation work, and the frame is the fallback.

Principles: rig ships none in v0 and uses pstack's 24 leaves ([decision 0013](../decisions/0013-reuse-pstack-principles.md)).

## 14. Observability and self-feedback

rig measures how agents and rig itself behave, and turns the result into proposals that the user approves ([decision 0021](../decisions/0021-observability-and-self-feedback.md)). Metrics: tool usage, tokens (input, output, cache read, cache write), cost in USD, cache hit rate, and context management (compaction, hook injection, skill loads). Data stays on the machine.

### Sources per harness

rig reads harness transcripts on demand. It reads metadata fields only: usage, model, tool name, error flag, durations, unit names, byte lengths. It does not read message text, tool input or tool output. Mechanism: each reader keeps a path allowlist and a field allowlist, and a slice 6 canary test checks the store.

| Harness | Source | Notes |
|---|---|---|
| Claude Code | `~/.claude/projects/<slug>/<session>.jsonl`, `subagents/agent-<id>.jsonl` and `.meta.json` | Per-request usage with a 5-minute and 1-hour cache-write split, model per request, `cost-state` in some sessions, `tool_result` `is_error`, Agent `tool_use` with `subagent_type`, `model`, `effort` and result `resolvedModel`, Skill `tool_use`, `skill_listing` and `skill_mention` attachments, `attributionSkill`, `hook_success` with output bytes and `durationMs`, `compact_boundary` with pre and post tokens. |
| Codex | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`, and subagent edges in `state_5.sqlite` table `thread_spawn_edges` | `token_count` usage (input, cached input, output, reasoning). No cache write, no cost. Model per turn. Compaction events without sizes. No skill or hook records. |
| omp | `~/.omp/agent/sessions/**.jsonl` | Usage with cost recorded by omp, model per request, `contextSnapshot` (prompt tokens, tool-schema tokens, compaction epoch), tool results with `isError` and `wallTimeMs`, compaction tokens before and after, skill-prompt records. `~/.omp/stats.db` is preaggregated but lags. rig never reads `agent.db`, which holds credentials. |
| Cursor | `~/.cursor/projects/*/agent-transcripts/*.jsonl`, and the model field in `~/.cursor/ai-tracking/ai-code-tracking.db` | Tool calls and the subagent tree. No tokens or cost locally; usage data is on the vendor dashboard only. rig never reads the `chats/` store, which holds content. |

Derivability, as surveyed on one machine. D: derivable. P: partial. N: not available locally. ?: unverified.

| Metric | Claude Code | Codex | omp | Cursor |
|---|---|---|---|---|
| Tokens (input, output) | D | P | D | N |
| Cost in USD | P | N | D | N |
| Cache hit rate | D | D | D | N |
| Cache write | D | N | D | N |
| Tool error rate | D | P | D | ? |
| Skill loads | P | N | P | ? |
| Hook output bytes | D | N | N | N |
| Subagent fan-out | D | D | D | D |
| Compaction | D | P | D | N |
| Model mix | D | D | D | D |

Parse defensively. Undocumented fields drift between versions. A missing field yields "n/a", never zero. Date each record by its own timestamp, not by file mtime.

### Dedupe rules

- Claude Code repeats a message's usage on each content block. Count each `message.id` once. Without this the totals are about 3 times too high (measured on one machine).
- Subagent usage lives in separate files. Count each subagent file once and attach it to the parent session through the agent id.
- A session appears once per harness. The store key is `(harness, session)`. A later derivation replaces the earlier line.

### Aggregate store

`~/.local/state/rig/metrics.jsonl`, one line per session per harness. It is content-free: counts, token sums, durations, model ids, and unit names (skills, tools, agents, hooks). No prompt text, no tool input or output, no file content. A project appears as a hash of its path. rig writes the file through a temporary file and a rename.

Retention: Claude Code deletes transcripts after `cleanupPeriodDays`, 30 days by default (assumption A29). Codex showed no automatic cleanup. The omp policy is unknown. The store keeps aggregates after the transcripts are gone. It has no automatic expiry. You delete it to reset.

### Optional end-of-session hook

- Off by default. One config line enables it: `"metrics":{"session_hook":true}`.
- `apply` merges one entry into the harness settings: Claude Code `SessionEnd`, and the omp, Codex and Cursor equivalents where they exist (assumption A34). It keeps every entry it did not write.
- The hook runs `rig stats --record --session <id>`. It upserts that session's line in the store.
- It prints zero bytes to stdout. It exits 0 on every error and writes the error to `~/.local/state/rig/rig.log`.
- The gate audits it like any hook. The `budget` check counts its output.

Without the hook, `rig stats` derives on demand from the transcripts still on disk and updates the store.

### Report and self-feedback

`rig stats [--since D] [--harness H]` prints, per harness and model: tokens by type, cost with its source, cache hit rate (`cache_read / (cache_read + cache_write + input)`, proposed target 90 percent, from [routing and context](../research/2026-11-04-routing-and-context.md)), tool error rate per tool, loads per skill, hook output bytes per event, dispatches per role with model and effort mix, compaction count and tokens freed, and the alias resolution history.

`rig stats --suggest` adds self-feedback: a report plus a proposed diff against `rig.json`, the overlay or `models/*.json`, shown like `rig plan`. Example rules (proposed): a skill with no loads in the window gets a `disable` entry. A role with repeated escalations gets its default effort one step higher. A hook over its budget gets a disable entry or an ack stanza. Nothing applies automatically: `--suggest` only prints. You apply the diff to the configuration, commit it, and run `rig apply`. No data leaves the machine: `rig stats` makes no network call.

Escalation counts from transcripts are heuristic: a repeat dispatch of the same role in one parent session at a higher effort. Transcripts do not record the gate result in a uniform field.

### Cross-checks and OTel

- ccusage is an optional cross-check, never a dependency. It reads local files for Claude Code, Codex, pi, Hermes and OpenCode, and has `--json` and `--offline`. It has no per-skill, per-hook or compaction view. When it is on `PATH`, `rig stats` can print the daily token difference.
- OpenTelemetry only if a probe shows that transcript-based skill attribution is too weak (assumption A30). Claude Code OTel (`CLAUDE_CODE_ENABLE_TELEMETRY=1`) exports `token.usage` and `cost.usage` with `skill.name`, `plugin.name` and `agent.name` attributes, to a local Prometheus or OTLP sink. Content export is off by default. Codex has an `[otel]` exporter with request and tool events but no documented token metric.

## 15. Commands and slices

```
rig audit                              gate alone; exit 1 on an unacked block
rig plan                               per-harness add/update/remove; writes nothing in ~
rig apply [--only models]              gate, then write; the only writer of harness configuration; no skip flag
rig doctor [--project DIR]             drift (incl. model-bearing files), pins, autoUpdate, telemetry, env overrides,
                                       unmanaged agent files, alias reminder; with DIR: declared provider and source,
                                       footprints as info, enabledPlugins with source, the local-enable snippet
rig pack add <repo> --sha S --path P [--into overlay]
rig pin check <name> --sha S | rig pin set <name>
rig models [set <tier> <model> --harness H]
                                       no args: effective table per harness; set: edit tiers.json, run
                                       apply --only models, print the diff; --harness is required
rig stats [--since D] [--harness H] [--suggest] | rig stats --record --session ID
                                       metrics from transcripts and the store; writes only ~/.local/state/rig/
```

The argument parser exits 2 on an unknown flag, so no skip flag can exist. `rig models set` without `--harness` also exits 2. `rig models set` is sugar over `apply --only models`, so the one-writer rule holds and the gate runs.

v0 slices, each with falsifiable done-checks:

| Slice | Content | Done when |
|---|---|---|
| 1. Skeleton | World loader, compose, gate (`pin`, `exec`, `secret`, `unicode`, `license`), render, install. Core. The `own` pack. Four target records with read sets. Fixture HOME with stub binaries. | A second `apply` reports 0 changes. A hand edit makes `doctor` name the path. A shebang fixture exits 1. A `claude -p "/explain ..."` transcript shows a Read of the installed SKILL.md. A skill that `~/.claude/skills` delivers gets no Cursor copy, and a planted duplicate in `~/.cursor/skills` makes `audit` warn. |
| 2. Frame, providers, scope | pstack record, frame on four targets, `/craft` and the `/pm` alias, pack scope modes, `doctor --project`. | The four rendered blocks differ only in `Declared projects`, `Providers` and `Models`. A fixture repository with `openspec/` and no declaration makes `doctor --project` print `pstack`, source `default`, and `openspec/` as info. Adding `rig-project: openspec` prints `openspec`, source `instructions`. An overlay `projects` entry prints source `overlay`. A `project`-mode fixture pack is absent outside its project and invocable inside it on Claude Code. `doctor` prints the alias reminder. A `claude -p "/craft ..."` transcript shows a Read of `poteto-mode`. The Cursor frame probe has a recorded result. |
| 3. Models | `roles.json`, `tiers.json`, five renderer kinds, first-run adopt, `rig models`, `apply --only models`, drift by stored hash, Claude pins. | Adopt over fixture copies of the live files records hashes with no write. A fixture file whose model cell differs blocks `apply` with a diff and stays unchanged. `rig models set strong <id> --harness omp` changes only the omp `modelRoles` values (`git -C fixture-home diff --stat`). `rig models set strong <id>` exits 2. Pinning `reason` to a full id changes only the `model:` line of `agents/deep-reasoner.md`. `codex exec` exits 0 with each rendered agent TOML. A pstack fixture with a renamed role label blocks `pin check`. The omp rewrite probe has a recorded result. |
| 4. Pins, vendoring, overlay | `pin check`, `pin set`, `pack add` cursor-team-kit at `bb68f23`, acks, the overlay with a restrictive provider record and an overlay pack. | `pin set` on an unchecked SHA exits 1. A changed `gitCommitSha` byte blocks. An executable blocks, an ack clears it, a changed byte blocks again. The overlay pack renders hidden. A private term in a repository pack blocks. User scope `false` plus project scope `true` makes `doctor --project` print effective `true`, source `project`. |
| 5. OpenSpec, slots, checks, product pack | OpenSpec record. The `telemetry`, `budget`, `cve` and `injection` checks. `rig-doc-review` with redpen. `rig-second-opinion`. `office-hours` as `/oh` with `references/product-core.md`, `NOTICE.md` and `intake`. | `openspec init --tools claude,codex,pi` plus `rig-project: openspec` makes `doctor --project` print `openspec`. `audit` warns on telemetry until `DO_NOT_TRACK=1` or `OPENSPEC_TELEMETRY=0` is set, then passes with no ack. A stub `redpen` call appears in a headless `/rig-doc-review` transcript. With a stub `codex` on `PATH` and filler `codex-cli`, a headless `/rig-second-opinion` transcript shows the `codex exec` call. A 2,000-character description makes `audit` exit 1, and a 1,500-character one warns. A fixture UserPromptSubmit hook printing 400 bytes warns, and a rig-owned one blocks. A fixture pack with a lockfile and no OSV cache blocks on `cve`. An injection phrase warns. `/oh` writes `docs/designs/<slug>.md` with no `gstack-` call, and its closing line names `/craft` in a pstack repository and `/opsx:propose` in the OpenSpec repository. |
| 6. Observability | Transcript readers for four harnesses, the store, dedupe, alias history, the optional session hook, `--suggest`. | A fixture Claude transcript with one `message.id` over three content blocks counts its tokens once. A subagent file counts once. Aggregates of a fixture session remain in the store after its transcript is deleted. With the hook on, a session end writes one line for that session and prints 0 bytes. With an unwritable store the hook exits 0 and writes `rig.log`. A fixture `~/.cursor/hooks.json` with other entries keeps them after `apply`. A canary string from a fixture prompt has zero hits in the store. A fixture transcript with no usage field reports "n/a", not 0. A change of `message.model` for one alias shows in the alias history. `--suggest` on a fixture with an unused skill prints a `disable` diff and writes nothing outside `~/.local/state/rig/`. |

v1: the other product roles. Own principles with an index lint. pi target, Hermes record. SARIF scanners, online CVE refresh. A promptfoo spike on frame obedience. More slots on the two-providers trigger. `rig models sweep` on the user's own tasks before a tier switch. OTel if the attribution probe fails. A classifier review when metrics allow it.

## 16. Build versus adopt

Build rig and borrow ideas ([decision 0014](../decisions/0014-build-rig-borrow-from-apm.md)). From Microsoft APM: the lock with content hashes, the hidden-Unicode audit, tighten-only policy inheritance. From OpenSpec: named presets. From pstack's generator: one source, `--check` byte-diff, a TERMS table with an adapter-row rule, name lint. From gstack: the per-host record with capabilities and a skip list, the byte ceiling, and model tiers with a precedence inspector. Evidence: [prior art](../research/2026-11-04-prior-art.md) and [upstreams](../research/2026-11-04-upstreams.md).

## 17. Findings to sections

| Finding (v3 review or user decision) | Section | Status |
|---|---|---|
| Review 1: provider by footprint is inference, and usage-context wording | 3, 5, 13 | Fixed. Explicit declaration only. Footprints are `doctor` info. Scope stated as a requirement. |
| Review 1: scope machine-wide only in v0 | 3 | Fixed. Three modes from v0. |
| Review 2: rendered files overwrite hand-written text | 6 | Fixed. Model and effort values only, kinds per file, first-run adopt, model names in descriptions. |
| Review 3: frame raise rule contradicts the effort table | 7, 12, 13 | Fixed. "Per the effort-table conditions or after a verified failure". |
| Review 4: dispatch-log hook | 7, 14 | Dropped. Metrics come from transcripts. The classifier floor is replaced by "revisit when metrics exist". |
| Review 5: `cve` and injection checks dropped | 10 | Restored. |
| Review 6: `route()` signature has no caller | 7 | Cut. The router filler renders the `Models` lines. |
| Review 7: omp may rewrite `config.yml` | 6 | Hash in rig state. Probe in slice 3. |
| Review minor: five tiers | 6 | Four tiers. omp `judge` is a literal. |
| Review minor: `models set` without `--harness` | 15 | `--harness` required, exit 2. |
| Review minor: Codex agent TOML is a config layer | 6, 15 | `codex exec` per rendered file in slice 3. |
| Review minor: hook budget misses prompt and tool hooks | 10 | UserPromptSubmit and PreToolUse hooks metered. |
| Review minor: renderers are code | 6 | Target records declare model-bearing files and kinds. |
| Decision: per-pack scope, user chooses | 3 | Done ([0017](../decisions/0017-per-pack-scope-no-context-inference.md)). |
| Decision: entry command `/craft` | 5, 13 | Done ([0016](../decisions/0016-entry-command-craft.md)). |
| Decision: telemetry check | 10 | Done ([0022](../decisions/0022-generic-telemetry-check.md)). |
| Decision: four tiers and `second-opinion` | 6, 8 | Done ([0018](../decisions/0018-four-tiers-and-second-opinion-slot.md)). |
| Decision: Claude aliases with optional pins | 6, 12 | Done ([0019](../decisions/0019-claude-aliases-with-optional-pins.md)). |
| Decision: Cursor in v0, pi and Hermes in v1 | 1, 3, 6, 10, 13 | Done ([0020](../decisions/0020-cursor-in-v0.md)). |
| Decision: observability and self-feedback | 14, 15 | Done ([0021](../decisions/0021-observability-and-self-feedback.md)). |
| Decision: measure per-turn hook cost before any change | 10, 14 | `budget` meter and `rig stats` hook bytes ([0024](../decisions/0024-measure-per-turn-context-hook-first.md)). |
| v2 open: cache tree hash stability | 10 | v1 risk, warn-only, unchanged. |
| v2 open: Claude skills-delivery path for OpenSpec | 5 | Still open (assumption A8). |

## 18. Uncertainties

The scored assumptions, probes and open questions are in [assumptions and open questions](../assumptions-and-open-questions.md). Overall confidence: 7 out of 10. The model table and the provider rule rest on verified harness facts and explicit user decisions. The open risks are frame obedience, the omp and Cursor frame paths, Cursor skill dedupe, and the quality of transcript-based skill attribution.
