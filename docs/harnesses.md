# What rig writes per harness

This page lists, per harness, the dirs that the harness reads and the files that rig writes there. It also lists the dirs that rig never writes. Every path comes from `targets/<harness>.json`. rig expands `~` to your HOME and refuses a write outside it (architecture section 9). Run `rig plan` to see the exact list for your machine. It writes nothing.

## Read the terms

- **Read dirs.** The user-level skill dirs that a harness reads. `writable` says whether rig may place a copy there.
- **Dedupe.** How a harness collapses two skills with one name. `none` shows each copy. `identical-bytes` collapses copies with equal bytes. `by-name` keeps the first copy, whatever its bytes.
- **Placement.** For each skill, rig picks the smallest set of writable dirs. Each target harness then sees exactly one copy after its dedupe rule. Every other harness sees at most one. When no such set exists, `rig plan` blocks with `E_READSET` and names the exits.
- **Hide control.** Every skill copy, `craft` included, carries the hide control of every harness that reads its dir. So a shared dir does not leak it into a listing. rig adds no hide control to a unit in `rig.json` `auto`, but a hide key that its source already sets stays, and `rig plan` prints an info line for it.
- **Mode skill.** rig places a `craft/` dir in every skill dir that holds a vendored leaf, and each harness reads one `craft`. Its `references/adapter.md` holds one section per harness that reads the dir, headed with the harness id, such as `## codex`. Each `SKILL.md` copy of a vendored pack links that file in two lines after its frontmatter. With the seeded default, rig writes `craft/` in `~/.claude/skills` and in `~/.agents/skills`. See [Run multi-step work with /craft](./guide/06-craft.md).
- **Frame triggers.** The frame of each harness lists the `rig.json` `fill` triggers that name no domain, one line each. A line has the form `<when>: read <path> and apply it.` The path names the copy of the unit in the first read dir of that harness that holds one, written with `~`, so the frame bytes do not depend on HOME. With the seeded default, the Claude Code frame names `~/.claude/skills`, and the Codex, omp and Cursor frames name `~/.agents/skills` (`test/frame.test.ts`). See [Run multi-step work with /craft](./guide/06-craft.md).
- **Never write.** Globs that rig refuses to render into. A render there is an `E_CONTAINMENT` error (`test/render.test.ts`, "nothing renders under a never_write glob").
- **Model surfaces.** Model-bearing files and their render kind. `frontmatter` patches the model keys of a file that you wrote. `whole` is a file that rig owns. `block` is a region between marker lines. `keys` patches YAML values line by line. A surface renders only when `models/tiers.json` names a model for that harness. On main it names models for Claude Code only, so `rig plan` prints lines such as:

```text
info absent codex models/codex: tiers.json names no codex model, so ~/.codex/config.toml does not render
info absent omp models/omp: tiers.json names no omp model, so ~/.omp/agent/config.yml does not render
```

[Pick and swap models](./guide/07-models.md) covers `models/tiers.json`.

## Claude Code

- Read dirs: `~/.claude/skills` (writable, dedupe `none`) and `~/.claude/plugins/cache` (read-only, plugins, dedupe `none`).
- Never write: `~/.claude/plugins/**`. rig reads `~/.claude/plugins/installed_plugins.json`, and a plugin install of an upstream that a pack seeds blocks `rig plan` with `E_FOREIGN_INSTALL` and the `claude plugin uninstall` command.
- Skills: `~/.claude/skills/<name>/`. Hide: `disable-model-invocation: true` in the frontmatter.
- Commands: `~/.claude/commands/<name>.md`, the source as is.
- Agents: `~/.claude/agents/<name>.md`, the source as is.
- Rules: `~/.claude/rules/<name>.md`.
- Frame: `~/.claude/rules/rig-frame.md`, a whole file that rig owns.
- Project packs: a local plugin in the `rig-local` marketplace at `$XDG_DATA_HOME/rig/marketplace`, by default `~/.local/share/rig/marketplace`. You enable it in a project's `.claude/settings.local.json`. See [Scope packs to projects](./guide/05-scope-and-projects.md).
- Model surfaces: `~/.claude/agents/{role}.md`, kind `frontmatter`, keys `model` and `effort`, plus the model name in `description`. For the roles in `models/roles.json`, rig patches the agent files that you wrote and creates none. A pack can add its own surfaces in `pack.json` `model_surfaces`, for example a `whole` rules file that keeps its header lines.
- Session hook: one `SessionEnd` element in `~/.claude/settings.json` at `/hooks/SessionEnd`, only when `rig.json` sets `metrics.session_hook` to `true`. The default is `false`. The element runs `rig stats --record` and keeps every hook entry that rig did not write (`test/scope.test.ts`, "a session-hook element whose command differs only in the node path").

## Codex

- Read dirs: `~/.codex/skills` and `~/.agents/skills`, both writable, dedupe `none`. On a default install, `rig plan` places Codex copies in `~/.agents/skills`, which omp and Cursor also read.
- Never write: none declared. rig reads the plugin cache `~/.codex/plugins/cache/<marketplace>/<name>` and `~/.codex/config.toml`. A cached plugin with the name of a seeded upstream, such as `pstack`, counts as installed only when `config.toml` has a `[plugins."<name>@<marketplace>"]` table for it; a cache dir with no table gives no finding, as Codex lists it as available, not installed. An installed one blocks `rig plan` with `E_FOREIGN_INSTALL` and the `codex plugin remove` command. It only warns when that table sets `enabled = false` (`test/foreign.test.ts`, "E_FOREIGN_INSTALL for Codex plugins").
- Skills: hide is the sidecar `agents/openai.yaml` with `policy.allow_implicit_invocation: false`. Codex ignores `disable-model-invocation` (probe (f)).
- Commands: `~/.codex/prompts/<name>.md`, body only, frontmatter dropped. You type `/prompts:<name>`.
- Agents: `~/.codex/agents/<name>.toml` with `name`, `description` and `developer_instructions`.
- Rules: no rule format. `rig plan` prints an `absent` info line for a rule unit.
- Frame: a managed block in `~/.codex/AGENTS.md`, between `<!-- rig:frame:start -->` and `<!-- rig:frame:end -->`. Your lines outside the markers keep their bytes (`test/render.test.ts`, "targets.patch: the rendered frame block appends, then converges").
- Instructions cap: probe (d) measured a 32,768-byte limit on `AGENTS.md`. The `budget` gate blocks above that cap and warns above 8,192 bytes. The warning level is a rig choice (`test/gate-cve-budget.test.ts`, "a 33,000-byte Codex instructions file blocks and a 9,000-byte one warns").
- Descriptions: the `budget` gate blocks a visible skill description above 1,024 characters.
- Listing: the `budget` gate does not count a skill whose sidecar hides it (`test/gate-cve-budget.test.ts`, "a Codex skill with the sidecar hide is not listed; a sidecar with another value is").
- Model surfaces: `~/.codex/agents/{role}.toml`, kind `whole`, with text from `~/.claude/agents/{role}.md`. `~/.codex/config.toml`, kind `block` between `rig:models` markers, the `[agents]` table with `default_subagent_model` and `default_subagent_reasoning_effort`. Markers go only around inserted blocks. That is an open decision, see [assumptions and open questions](./assumptions-and-open-questions.md).
- Session hook: none.

## omp

- Read dirs: `~/.omp/agent/skills` (writable) and `~/.agents/skills` (read-only in this record), both dedupe `identical-bytes`.
- Never write: `~/.omp/agent/extensions/**` and `~/.omp/agent/config.yml.lock`.
- Skills: hide is `hide: true` in the frontmatter.
- Commands: `~/.omp/agent/commands/<name>.md`, the source as is. A bare `/name` runs it (probe (e)).
- Agents and rules: no format. `rig plan` prints an `absent` info line for each.
- Frame: `~/.omp/agent/AGENTS.md`, a managed block between `<!-- rig:frame:start -->` and `<!-- rig:frame:end -->`. rig keeps your own text outside the block as it is.
- Model surfaces: `~/.omp/agent/config.yml`, kind `keys`, the `modelRoles` map. omp itself rewrites this file (probe (c)). The `keys` kind finds its values by structure and uses no markers.
- Session hook: none.

## Cursor

- Read dirs, all dedupe `by-name`: `~/.cursor/skills`, `~/.agents/skills`, `~/.claude/skills` and `~/.codex/skills` (read-only), and `~/.cursor/plugins/local/rig/skills` (writable, rig's local plugin). Cursor keeps the first copy of a name (probe (b)).
- Never write: `~/.cursor/skills-cursor/**`, `~/.cursor/hooks.json` and `~/.cursor/chats/**`. Cursor owns its built-in skills in `~/.cursor/skills-cursor/`. A plugin folder under `~/.cursor/plugins/cache/<marketplace>/` or `~/.cursor/plugins/local/` with the name of a seeded upstream, such as `pstack`, blocks `rig plan` with `E_FOREIGN_INSTALL`.
- Skills: the only writable dir is the local plugin. Hide: `disable-model-invocation: true`.
- Commands: hidden skills at `~/.cursor/plugins/local/rig/skills/<name>/SKILL.md`, with `name` and `disable-model-invocation: true`. rig writes the manifest `~/.cursor/plugins/local/rig/.cursor-plugin/plugin.json` once a file lands in the plugin. The seed has no command, so on main rig writes no local plugin.
- Agents: `~/.cursor/agents/<name>.md` with `name`, `description` and the body. The Claude model keys stay out.
- Rules: `~/.cursor/rules/<name>.mdc`, with `alwaysApply: true` added.
- Frame: `~/.cursor/rules/rig-frame.mdc`, a whole file with `alwaysApply: true`. Whether Cursor loads user-level rules and local plugins is not verified (probe (j), assumption A24).
- Model surfaces: `~/.cursor/agents/{role}.md`, kind `frontmatter`, `model: <slug>[effort=<e>]`. A pack can add its own surfaces in `pack.json` `model_surfaces`.
- Session hook: none. Cursor's `stop` event fires once per turn, so it cannot carry a per-session hook (architecture section 13).

## Harnesses after v0

pi and Hermes have no target record in v0. They move to v1 ([decision 0020](./decisions/0020-cursor-in-v0.md)). Section 1 of the [architecture](./design/rig-architecture.md) lists the steps to add pi.

The probe records hold the evidence for each value above: [Claude Code](./research/2026-11-05-probes-claude.md), [Cursor and Codex](./research/2026-11-05-probes-cursor-codex.md), [omp](./research/2026-11-05-probes-omp.md).
