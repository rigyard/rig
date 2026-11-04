# Harness surfaces: Claude Code, Codex, omp, Cursor, pi, Hermes

Status: research record, 2026-11-04. Sources: official harness documentation as summarized by researchers (URLs not recorded), local inspection of installed harnesses, and binary strings. Items marked "unverified" have no first-hand check. Hermes was not installed, so every Hermes fact is from documentation only. The Cursor section adds Cursor documentation (cursor.com/docs) and a local layout survey that read no content files.

## Summary

- SKILL.md is the only unit that every harness reads. Commands, agents and hooks need a per-harness format.
- One plugin repository can serve Claude Code, Codex and omp: a shared `skills/` tree, a `.claude-plugin/` directory (Codex reads it as a fallback) and a `package.json` for omp.
- Each harness has a different control to hide a skill from the model. Hermes has none.
- Cursor reads skills from its own directories and from the Claude Code, Codex and shared skill directories. One skill can reach it several times.
- Each harness configures model and effort in a different file. rig renders all of them from one table ([decision 0011](../decisions/0011-one-model-table.md)).

## Claude Code

- **Plugin format.** `.claude-plugin/plugin.json` plus `skills/`, `commands/`, `agents/`, `hooks/`, `.mcp.json`.
- **Local install.** `claude plugin marketplace add ./mkt`, then `claude plugin install x@mkt`. A plugin with a relative path in a local-path marketplace loads in place. Edits apply after `/reload-plugins`.
- **Namespacing.** Plugin skills always have the form `/plugin:skill`. A bare `/name` needs a user-level `~/.claude/commands/name.md`, a `~/.claude/skills/name/` directory, or a skills-directory plugin with a root SKILL.md.
- **Invocation control.** `disable-model-invocation: true` removes the description from context. The Skill tool then refuses the skill, so the model must read it by path or the user must type the slash command. `skillOverrides` in settings (name-only, user-invocable-only, off) does not apply to plugin skills.
- **Listing budget.** The skill listing uses 1% of the context window (`skillListingBudgetFraction`). Each entry (description plus `when_to_use`) has a cap of 1,536 characters. On overflow, Claude Code drops the descriptions of the least recently invoked skills first.
- **Compaction.** After compaction each invoked skill keeps its first 5,000 tokens, from a shared pool of 25,000 tokens. Invoked skill bodies stay for the whole session.
- **Plugin enablement.** `enabledPlugins` in user, project and local settings. Documentation, page plugins/loading: "For each plugin id, the value that applies is the one from the highest-precedence source that mentions the id." Local beats project beats user, key by key. A project-only `true` does not fetch a plugin, so the install record must exist. `claude plugin list` in a project prints "Disabled in ~/.claude/settings.json but still loads" for a project override.
- **Dependencies.** Claude Code installs plugin dependencies only when both `package.json` and a lockfile exist (documentation, page plugins/loading).
- **Instructions.** `~/.claude/rules/*.md` loads at session start. The `rules/` directory is read recursively, so an archived file in a subdirectory still loads. `CLAUDE.local.md` is uncommitted and per project. If `CLAUDE.local.md` exists, Claude skips a repository `AGENTS.md` unless project instructions are set to `claude-md-and-agents-md` (documentation, page memory).
- **Model and effort.** Agent frontmatter `model` (alias `sonnet`, `opus`, `haiku`, `fable`, a full ID, or `inherit`) and `effort` (`low` to `max`). Resolution order: Agent tool `model` parameter, frontmatter, `CLAUDE_CODE_SUBAGENT_MODEL`, main model. `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` overrides all. The Agent tool also takes an `effort` parameter (verified in a live tool schema). Aliases resolve to the current model, and `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU,FABLE}_MODEL` remaps them. Settings have `opusplan`, `effortLevel` and `modelSettings`.
- **Marketplace auto-update.** `autoUpdate` per marketplace, read from `extraKnownMarketplaces` in settings files first, then from `known_marketplaces.json`. The update pass can run up to ten minutes after the first message.

## Codex

- **Plugin format.** `.codex-plugin/plugin.json` (or a root `plugin.json`) plus `skills/`, `mcp.json` and hooks (hooks in the desktop app only).
- **Local install.** `codex plugin marketplace add ./path` (it also reads `.claude-plugin/marketplace.json` as a fallback), then `codex plugin add`. Codex copies the plugin into its cache with version `local`. Edits do not apply live.
- **Namespacing.** Custom prompts live only in `~/.codex/prompts/`, are invoked as `/prompts:name`, and are deprecated in favor of skills. Plugins cannot bundle them. A bare `/name` prompt is not possible.
- **Skill discovery.** `~/.codex/skills` and `~/.agents/skills`. Codex follows symlinks. Same-name skills are not merged. Both show.
- **Invocation control.** `agents/openai.yaml` with `policy.allow_implicit_invocation: false` is the nearest equivalent of `disable-model-invocation`. Whether the description still appears in the listing: unverified. Whether Codex accepts the Claude frontmatter key: unverified. `[[skills.config]]` in `config.toml` disables a skill by path or name.
- **Listing budget.** About 2% of context, with 8,000 characters as the fallback. `skills.max_context_tokens` has a maximum of 10,000. On overflow Codex first shortens descriptions, then drops skills.
- **Instructions.** `~/.codex/AGENTS.md` has no import syntax (verified absent). `AGENTS.override.md` is global only. No uncommitted per-project instruction file exists. A 32 KiB cap for `AGENTS.md` comes from a third-party source (unverified).
- **Model and effort.** Custom agents as TOML in `~/.codex/agents/` with `model` and `model_reasoning_effort`. `[agents]` sets `default_subagent_model` and `default_subagent_reasoning_effort`. `codex --profile` loads an overlay file.

## omp (version 18.16.0)

- **Plugin format.** An npm-style `package.json` (`omp.extensions`, legacy `pi.*` keys) plus `skills/`, `commands/`, `rules/`, `prompts/`, `agents/`, `hooks/`, `tools/`, `.mcp.json`. omp also accepts `.claude-plugin/marketplace.json`.
- **Local install.** `omp plugin link ./dir` creates a symlink, so edits apply after `/reload-plugins`. Extensions need a restart.
- **Namespacing.** Plugin commands have a namespace. Skills are bare unless names collide. The loser of a collision gets `<ns>/<name>`. A bare command needs `~/.omp/agent/commands/*.md` or an extension.
- **Discovery.** omp also reads the `.claude` and `.codex` skill directories. Identical skills collapse into one entry. Different ones get a namespace. Whether omp compares SKILL.md bytes or the whole directory: unverified. Discovery goes one level deep. `skill://name/path` reads a file inside a skill.
- **Invocation control.** `hide: true` or `disable-model-invocation`. `skills.manualSkills` globs and `skills.ignoredSkills`.
- **Instructions.** omp reads `AGENTS.md` and `CLAUDE.md`. The user-level file path `~/.omp/agent/AGENTS.md` comes from binary strings only (unverified). omp can also load `~/.codex/AGENTS.md`, which is the fallback.
- **Model and effort.** `~/.omp/agent/config.yml`, key `modelRoles` (`task`, `advisor`, `judge`, `plan`, `default`) with values `provider/model:effort`. `defaultThinkingLevel`.
- **Headless runs.** `omp -p` (`--print`), `--mode text|json|rpc`, `--model` (verified in help output). Model matching is fuzzy.

## Cursor (CLI 2026.10.22)

- **Plugin format.** `.cursor-plugin/plugin.json` (`name` required) plus skills and agents. Local install by copy or symlink into `~/.cursor/plugins/local/<name>`. `--plugin-dir` for the CLI. A marketplace plugin with the same name wins over a local one. GitHub marketplaces auto-refresh, with no per-plugin off switch.
- **Skill discovery.** `~/.cursor/skills`, `~/.agents/skills`, project `.cursor/skills` and `.agents/skills`. Cursor also loads `.claude/skills`, `.codex/skills`, `~/.claude/skills` and `~/.codex/skills`. No dedupe rule is documented (unverified). Only `~/.cursor/skills` syncs to Cloud Agents. `~/.cursor/skills-cursor/` holds Cursor-bundled skills and auto-syncs, so a seeder must not write there.
- **Skill frontmatter.** `name` (equal to the folder), `description`, `paths` or `globs`, `disable-model-invocation`, `icon`, `color`, `metadata`. Local files also use `environments` and `disabled-environments`. No listing budget is documented.
- **Rules.** Project `.cursor/rules/*.mdc` with `alwaysApply`, `globs` and `description`. Plain `.md` files there are ignored. User Rules live only in the UI, so a seeder cannot write them. `AGENTS.md` works at the project root and nested. Guidance: under 500 lines per rule. Whether user-level `~/.cursor/rules/*.mdc` files load: unverified, although such files exist on one machine.
- **Commands.** Legacy. Use skills with `disable-model-invocation: true`.
- **Subagents and models.** `.cursor/agents`, `.claude/agents`, `.codex/agents` and the `~/` variants. `.cursor` wins. Frontmatter `name`, `description`, `model` (default `inherit`), `readonly`, `is_background`. Effort goes inside the model string: `<slug>[effort=high,context=300k,fast=false]`. A blocked model falls back silently. Nesting goes one level deep.
- **Hooks.** `~/.cursor/hooks.json`. `sessionStart` and `postToolUse` can inject `additional_context`. `stop` and `subagentStop` can return a `followup_message`. Other tools may already own entries there, so a seeder merges and never overwrites.
- **Headless runs.** `cursor-agent -p --output-format json|stream-json --model '<slug>[effort=..]' --mode plan|ask --trust --workspace <dir> "<prompt>"`, `--list-models` (verified in help output). The JSON output has no token usage.
- **Usage data.** No tokens or cost locally. `projects/*/agent-transcripts/*.jsonl` hold tool calls and the subagent tree. `ai-tracking/ai-code-tracking.db` has a per-request model field for code attribution. The `chats/` store holds content and is out of bounds. Usage numbers are on the vendor dashboard. OTel export is an enterprise beta.

## pi (version 0.84.1)

- **Format.** Skills in `~/.pi/agent/skills` and `~/.agents/skills`. Prompts in `~/.pi/agent/prompts/*.md`, invoked as a bare `/name`. Extensions in `~/.pi/agent/extensions/*.ts`. `AGENTS.md` in `~/.pi/agent`. `PI_CODING_AGENT_DIR` overrides the root.
- **Install.** Symlinks work (verified on one skill). Pinned sources do not auto-update. `PI_OFFLINE=1` disables network fetches.
- **Namespacing.** Skills are invoked as `/skill:name`. On a name collision the first wins, with a warning.
- **Invocation control.** Follows the specification: name up to 64 characters, description up to 1,024, `disable-model-invocation` supported.
- **Subagents and models.** No core subagents. An example extension adds `agents/*.md`. Model and effort depend on the extension.
- **Headless runs.** Unverified.

## Hermes (not installed, documentation only)

- **Format.** Skills in `~/.hermes/skills`. Extra directories through `skills.external_dirs` in `config.yaml`. `SOUL.md` holds global identity. Plugins in `~/.hermes/plugins/<n>/` (`plugin.yaml` plus `__init__.py`). `plugins.auto_apply` is false by default.
- **Install.** `hermes update` copies bundled skills again into `~/.hermes/skills` (an opt-out exists). So rig installs into its own directory and registers it in `skills.external_dirs`.
- **Namespacing.** Skills are bare `/name`.
- **Invocation control.** None. Only platform or toolset conditions exist. The index costs about 3,000 tokens. rig folds leaf skills into the `references/` of a mode skill on Hermes.
- **Subagents and models.** `delegate_task`. By default all children use one model.

## Caching notes

Source: research summary R3 (routing), 2026-11-04. Details and numbers are in [routing and context](2026-11-04-routing-and-context.md).

- Prompt-cache order is tools, then system, then messages. Any change in a prefix pays the cache write again. A model switch loses the cache.
- Static, byte-stable skill and instruction files help the cache. Text that changes per session in the prefix (timestamps, git status, random order, per-session paths) breaks it.
- Anthropic: a change of effort per message keeps the cache on newer models. OpenAI: `configuration_update` keeps the cache.

## Adapter contract fields

A target record is data with closed enums. These fields come from the plan, the two design candidates and research summary R4:

| Field | Purpose |
|---|---|
| `name` | Harness id. |
| `root` | Install root under `$HOME`. The writer refuses anything outside it. |
| `skills_dir`, `sidecar` | Where skills go. Sidecar template, for example `openai.yaml` on Codex. |
| `commands` `{dir, format}` | Command directory and format enum (`md-frontmatter`, `md-body`, `as-skill`, `none`). |
| `agents` `{dir, format}` or null | Agent directory and format enum. |
| `instructions_file`, mode | User-level instructions file and how rig writes it (whole file or managed block). |
| `invocation_control` | Frontmatter key, sidecar key, or `none`. |
| `leaf_fallback` | `references` or `skip`, for harnesses without invocation control. |
| `listing_budget_chars`, `name_max`, `desc_max` | Lint limits. |
| `model_mapping` | Where the rendered model table goes. |
| `command_namespace` | How a command name appears to the user. |
| `hook_mechanism` | Recorded for `doctor` and the `budget` hook meter. rig writes one hook only: the optional end-of-session metrics hook ([decision 0021](../decisions/0021-observability-and-self-feedback.md)), merged into the harness settings. |
| `install_mode` | Copy. Registration hint where the harness needs one (Hermes `external_dirs`). |
| `autoupdate_off` | How to confirm that auto-update is off. |
| `headless_cmd` or null | Smoke-test command. |
| `transcripts_root` | Where `rig stats`, `doctor` and future evals read transcripts. |
| `read_set` | Every directory the harness reads units from, including other harnesses' directories. `plan` uses it to deliver each unit once. |
| `model_files` | Model-bearing files with a render kind each: `frontmatter`, `cells`, `whole`, `keys`, `block`. |
| `requires` | Files and lines that must exist. `plan` and `doctor` check them. rig never edits them. |
| capability gaps | Text for each `degraded` support entry. |

A bad combination of fields fails schema validation before render. A harness that is absent from a unit's `support` map receives nothing from it, so a new harness gets no unit by accident.
