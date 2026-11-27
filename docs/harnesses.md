# What rig writes per harness

This page lists, per harness, the dirs that the harness reads and the files that rig writes there. It also lists the dirs that rig never writes. Every path comes from `targets/<harness>.json`. rig expands `~` to your HOME and refuses a write outside it (architecture section 9). Run `rig plan` to see the exact list for your machine. It writes nothing.

## Read the terms

- **Read dirs.** The user-level skill dirs that a harness reads. `writable` says whether rig may place a copy there.
- **Dedupe.** How a harness collapses two skills with one name. `none` shows each copy. `identical-bytes` collapses copies with equal bytes. `by-name` keeps the first copy, whatever its bytes.
- **Shadow warning.** `rig doctor` warns when a harness reads a copy that you or another tool placed before the rig copy of the same name, and the two differ in bytes: the harness loads your copy, not the one rig seeded. A copy with the same bytes is the same skill and gets no warning. The warning needs a dedupe that keeps the first copy by name, so it applies to Cursor and Antigravity. The Cursor and Antigravity sections give an example. omp has no shadow warning, because it lists copies with different bytes separately. Claude Code and Codex list every copy.
- **Placement.** For each skill, rig picks the smallest set of writable dirs. Each target harness then sees exactly one copy after its dedupe rule. Every other harness sees at most one. When no such set exists, `rig plan` blocks with `E_READSET` and names the exits.
- **Hide control.** Every skill copy, `craft` included, carries the hide control of every harness that reads its dir. So a shared dir does not leak it into a listing. rig adds no hide control to a unit in `rig.json` `auto`, but a hide key that its source already sets stays, and `rig plan` prints an info line for it.
- **Mode skill.** rig places a `craft/` dir in every skill dir that holds a vendored leaf, and each harness reads one `craft`. Its `references/adapter.md` holds one section per harness that reads the dir, headed with the harness id, such as `## codex`. Each `SKILL.md` copy of a vendored pack links that file in two lines after its frontmatter. With the seeded default, rig writes `craft/` in `~/.claude/skills` and in `~/.agents/skills`. See [Run multi-step work with /craft](./guide/06-craft.md).
- **Frame triggers.** The frame of each harness lists the `rig.json` `fill` triggers that name no domain, one line each. A line has the form `<when>: read <path> and apply it.` The path names the copy of the unit in the first read dir of that harness that holds one, written with `~`, so the frame bytes do not depend on HOME. With the seeded default, the Claude Code frame names `~/.claude/skills`, and the Codex, omp, Cursor and Antigravity frames name `~/.agents/skills` (`test/frame.test.ts`). See [Run multi-step work with /craft](./guide/06-craft.md).
- **Never write.** Globs that rig refuses to render into. A render there is an `E_CONTAINMENT` error (`test/render.test.ts`, "nothing renders under a never_write glob").
- **Model surfaces.** Model-bearing files and their render kind. `frontmatter` patches the model keys of a file that you wrote. `whole` is a file that rig owns. `block` is a region between marker lines. `keys` patches YAML values line by line. `agent` sets the model keys in an agent file that rig renders from an agent unit, for the agents that the `agents` consumer of `roles.json` lists. A surface renders only when `models/tiers.json` names a model for that harness. On main it names models for all five harnesses. Antigravity declares only the `agent` surface. A harness that no tier names renders nothing, and `rig plan` says so:

```text
info absent cursor pstack/models: tiers.json names no cursor model, so ~/.cursor/rules/pstack-models.mdc does not render
```

A file that rig only adopts, such as `~/.omp/agent/config.yml` or a Cursor agent file, is skipped without a line while it is absent. An omp `config.yml` with no top-level `modelRoles` key is skipped the same way. One that has the key as a flow map (`modelRoles: {task: a}`) or with the key in quotes blocks with `E_LOCATOR`: edit it to a plain block map.

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
- Model surfaces: `~/.claude/agents/{role}.md`, kind `frontmatter`, keys `model` and `effort`, plus the model name in `description`. For the `fleet` roles in `models/roles.json`, rig patches the agent files that you wrote and creates none. The same path with kind `agent` sets `model` and `effort` in the files of `rig-agent` and `rig-janitor`, which rig owns. A pack can add its own surfaces in `pack.json` `model_surfaces`, for example a `whole` rules file that keeps its header lines.
- Session hook: one `SessionEnd` element in `~/.claude/settings.json` at `/hooks/SessionEnd`, only when `rig.json` or your overlay `rig.json` sets `metrics.session_hook` to `true`. The default is `false`. The element runs `rig stats --record` and keeps every hook entry that rig did not write (`test/scope.test.ts`, "a session-hook element whose command differs only in the node path" and "a session-hook element whose rig checkout path moved"). Another node path or another checkout path (a worktree, a moved clone) still finds the same element and rewrites it in place. That also means `rig apply` from a throwaway checkout, such as an agent worktree, repoints the global hook to that checkout, so run `rig apply` from a stable checkout. If a hook file holds several rig elements, for example after an old `rig apply --repair`, the next `rig apply` keeps one and removes the rest, and turning the hook off removes all of them (`test/scope.test.ts`, "an orphaned rig session-hook element left beside the current one by an old apply --repair").

## Codex

- Read dirs: `~/.codex/skills` and `~/.agents/skills`, both writable, dedupe `none`. On a default install, `rig plan` places Codex copies in `~/.agents/skills`, which omp, Cursor and Antigravity also read.
- Never write: none declared. rig reads the plugin cache `~/.codex/plugins/cache/<marketplace>/<name>` and `~/.codex/config.toml`. A cached plugin with the name of a seeded upstream, such as `pstack`, counts as installed only when `config.toml` has a `[plugins."<name>@<marketplace>"]` table for it; a cache dir with no table gives no finding, as Codex lists it as available, not installed. An installed one blocks `rig plan` with `E_FOREIGN_INSTALL` and the `codex plugin remove` command. It only warns when that table sets `enabled = false` (`test/foreign.test.ts`, "E_FOREIGN_INSTALL for Codex plugins").
- Skills: hide is the sidecar `agents/openai.yaml` with `policy.allow_implicit_invocation: false`. Codex ignores `disable-model-invocation` (probe (f)).
- Commands: `~/.codex/prompts/<name>.md`, body only, frontmatter dropped. You type `/prompts:<name>`.
- Agents: `~/.codex/agents/<name>.toml` with `name`, `description` and `developer_instructions`.
- Rules: no rule format. `rig plan` prints an `absent` info line for a rule unit.
- Frame: a managed block in `~/.codex/AGENTS.md`, between `<!-- rig:frame:start -->` and `<!-- rig:frame:end -->`. Your lines outside the markers keep their bytes (`test/render.test.ts`, "targets.patch: the rendered frame block appends, then converges").
- Instructions cap: probe (d) measured a 32,768-byte limit on `AGENTS.md`. The `budget` gate blocks above that cap and warns above 8,192 bytes. The warning level is a rig choice (`test/gate-cve-budget.test.ts`, "a 33,000-byte Codex instructions file blocks and a 9,000-byte one warns").
- Descriptions: the `budget` gate blocks a visible skill description above 1,024 characters.
- Listing: the `budget` gate does not count a skill whose sidecar hides it (`test/gate-cve-budget.test.ts`, "a Codex skill with the sidecar hide is not listed; a sidecar with another value is").
- Model surfaces: `~/.codex/agents/{role}.toml`, kind `whole`, with text from `~/.claude/agents/{role}.md`. The same path with kind `agent` adds `model` and `model_reasoning_effort` to the files of `rig-agent` and `rig-janitor`. `~/.codex/config.toml`, kind `block` between `rig:models` markers, the `[agents]` table with `default_subagent_model` and `default_subagent_reasoning_effort`. Markers go only around inserted blocks. That is an open decision, see [assumptions and open questions](./assumptions-and-open-questions.md). The pstack pack adds `~/.codex/pstack-models.md`, kind `whole`: one role line per pstack role, such as `swarm workers: gpt-6.1-terra high`.
- Session hook: none.

## omp

- Read dirs: `~/.omp/agent/skills` (writable) and `~/.agents/skills` (read-only in this record), both dedupe `identical-bytes`.
- Never write: `~/.omp/agent/extensions/**` and `~/.omp/agent/config.yml.lock`.
- Shadows: none. omp lists two copies of one name separately when their bytes differ, so `rig doctor` reports two listings, `error duplicates omp lists unslop 2 times: ~/.omp/agent/skills/unslop, ~/.agents/skills/unslop (one is managed: a placement bug)`, with your absolute paths. A copy in `~/.omp/agent/skills` with the bytes of the rig copy collapses into it and gets no line.
- Skills: hide is `hide: true` in the frontmatter.
- Commands: `~/.omp/agent/commands/<name>.md`, the source as is. A bare `/name` runs it (probe (e)).
- Agents and rules: no format. `rig plan` prints an `absent` info line for each.
- Frame: `~/.omp/agent/AGENTS.md`, a managed block between `<!-- rig:frame:start -->` and `<!-- rig:frame:end -->`. rig keeps your own text outside the block as it is.
- Model surfaces: `~/.omp/agent/config.yml`, kind `keys`, the `modelRoles` map. omp itself rewrites this file (probe (c)). The `keys` kind finds its values by structure and uses no markers. The pstack pack adds `~/.omp/agent/pstack-models.md`, kind `whole`, with lines such as `swarm workers: google-antigravity/gemini-3.8-flash:high`.
- Session hook: none.

## Cursor

- Read dirs, all dedupe `by-name`: `~/.cursor/skills`, `~/.agents/skills`, `~/.claude/skills` and `~/.codex/skills` (read-only), and `~/.cursor/plugins/local/rig/skills` (writable, rig's local plugin). Cursor keeps the first copy of a name (probe (b)).
- Never write: `~/.cursor/skills-cursor/**`, `~/.cursor/hooks.json` and `~/.cursor/chats/**`. Cursor owns its built-in skills in `~/.cursor/skills-cursor/`. A plugin folder under `~/.cursor/plugins/cache/<marketplace>/` or `~/.cursor/plugins/local/` with the name of a seeded upstream, such as `pstack`, blocks `rig plan` with `E_FOREIGN_INSTALL`.
- Skills: the only writable dir is the local plugin. Hide: `disable-model-invocation: true`.
- Shadows: Cursor keeps the first copy of a name, so a copy of yours in `~/.cursor/skills` hides the rig copy in `~/.agents/skills`. When the bytes differ, `rig doctor` warns, for example `warn duplicates cursor loads unslop from /home/you/.cursor/skills/unslop, which shadows the rig copy at /home/you/.agents/skills/unslop`. A copy with the bytes of the rig copy gets no warning.
- Commands: hidden skills at `~/.cursor/plugins/local/rig/skills/<name>/SKILL.md`, with `name` and `disable-model-invocation: true`. rig writes the manifest `~/.cursor/plugins/local/rig/.cursor-plugin/plugin.json` once a file lands in the plugin. The seed has no command, so on main rig writes no local plugin.
- Agents: `~/.cursor/agents/<name>.md` with `name`, `description` and the body. The Claude model keys stay out.
- Rules: `~/.cursor/rules/<name>.mdc`, with `alwaysApply: true` added.
- Frame: `~/.cursor/rules/rig-frame.mdc`, a whole file with `alwaysApply: true`. Whether Cursor loads user-level rules and local plugins is not verified (probe (j), assumption A24).
- Model surfaces: `~/.cursor/agents/{role}.md`, kind `frontmatter`, `model: <slug>[effort=<e>]`. The same path with kind `agent` writes that line into the files of `rig-agent` and `rig-janitor`. The pstack pack adds `~/.cursor/rules/pstack-models.mdc`, kind `whole`, with fused slugs such as `claude-sonnet-5-5-high`. A pack can add its own surfaces in `pack.json` `model_surfaces`.
- Session hook: none. Cursor's `stop` event fires once per turn, so it cannot carry a per-session hook (architecture section 13).

## Antigravity

- Read dirs, all read-only and dedupe `by-name`, highest rank first: `~/.gemini/skills` and `~/.gemini/antigravity-cli/skills`, `~/.gemini/config/skills` (global discovery), `~/.gemini/antigravity-cli/builtin/skills` (the builtin skills) and `~/.agents/skills` (through `skills.json`, the lowest rank). The agy-customizations builtin docs of agy 1.5.2 rank global discovery (`~/.gemini/config/`) above built-in customizations and those above "Global Declared Configurations", the entries of a global JSON config such as `~/.gemini/config/skills.json`. The rank of `~/.gemini/skills` and `~/.gemini/antigravity-cli/skills` is not in those docs: rig reads them first as an assumption, not verified.
- Skills: rig writes no copy for Antigravity. It owns `~/.gemini/config/skills.json`, `{"entries": [{"path": "/home/you/.agents/skills"}]}`, so agy reads the copies that rig writes for Codex. The path is absolute: agy 1.5.15 skips a `~/` entry with `must be an absolute path` in its log. A later edit by agy or by you is `E_DRIFT`, which `rig apply --repair` writes back. Hide: `disable-model-invocation: true`, the key that Cursor uses, so the shared copies already carry it. agy parses this key (the string is in the agy binary), but no agy doc names it as the hide key, and it is not verified live.
- Shadows: a skill in a higher-ranked dir hides the rig copy of the same name. When the bytes differ, `rig doctor` prints a warning for each, with absolute paths, for example `warn duplicates antigravity loads unslop from /home/you/.gemini/skills/unslop, which shadows the rig copy at /home/you/.agents/skills/unslop`. A builtin skill with the name of a seeded unit gets the same warning, for example `warn duplicates antigravity loads how from /home/you/.gemini/antigravity-cli/builtin/skills/how, which shadows the rig copy at /home/you/.agents/skills/how`, because the builtin skills outrank `skills.json` entries. A copy with the bytes of the rig copy, or a link to it such as one in `~/.gemini/config/skills`, is the same skill and gets none.
- Placement: Antigravity reads only `~/.agents/skills`, so `craft` must sit there. A vendored pack that `rig.json` limits to `codex` or `omp` puts its `craft` in that harness's own dir as well, and `rig plan` blocks with `E_READSET`. Add `antigravity` to the pack's `harnesses`, or remove it from `rig.json` `harnesses`. No writable dir reaches Antigravity when `~/.agents/skills` has no writer in the installed set: `rig.json` `harnesses` of `[antigravity]`, `[claude, antigravity]`, `[cursor, antigravity]` or `[omp, antigravity]` block with `E_READSET` (`test/mode.test.ts`). Add `codex` to `harnesses`, whose `~/.agents/skills` is the one writable dir that Antigravity reads.
- Never write: `~/.gemini/antigravity-cli/**`, `~/.gemini/GEMINI.md`, `~/.gemini/settings.json`, `~/.gemini/skills/**`, `~/.gemini/config/skills/**`, `~/.gemini/config/plugins/**` and `~/.gemini/config/config.json`. A plugin dir under `~/.gemini/config/plugins/` whose name or manifest `name` is a seeded upstream, such as `pstack`, blocks `rig plan` with `E_FOREIGN_INSTALL` and the `agy plugin uninstall` command. It warns when `config.json` or the manifest turns the plugin off.
- Commands: no format. `rig plan` prints an `absent` info line for a command unit.
- Agents: `~/.gemini/config/agents/<name>.md` with `name`, `description` and the body, as for Cursor. `agy agents` lists them (live lane, agy 1.5.2).
- Rules: `~/.gemini/config/rules/<name>.md`, with `trigger: "always_on"` added. The agy docs say a rule with a missing or invalid trigger is discarded.
- Frame: `~/.gemini/config/rules/rig-frame.md`, a whole file with `trigger: "always_on"`. rig leaves `~/.gemini/GEMINI.md` alone.
- Model surfaces: `~/.gemini/config/agents/{role}.md`, kind `agent`, the `model` line of `rig-agent` (`pro`) and `rig-janitor` (`flash_lite`). In a scratch HOME, agy 1.5.15 listed agent files whose `model` was `inherit`, `flash`, `flash_lite` or `pro`, and skipped files with `opus` or an unknown value. rig knows no effort key for an agent file, and `invoke_subagent` takes no model, so rig writes no other model file for Antigravity.
- Session hook: none. Transcripts: none that rig reads.

## Harnesses after v0

pi and Hermes have no target record in v0. They move to v1 ([decision 0020](./decisions/0020-cursor-in-v0.md)). Section 1 of the [architecture](./design/rig-architecture.md) lists the steps to add pi.

The probe records hold the evidence for each value above: [Claude Code](./research/2026-11-05-probes-claude.md), [Cursor and Codex](./research/2026-11-05-probes-cursor-codex.md), [omp](./research/2026-11-05-probes-omp.md).
