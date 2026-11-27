# What rig writes per harness

This page lists every directory each harness reads, every path rig writes, and every path rig refuses to touch. Values come from `targets/<harness>.json`. Run `rig plan` to inspect the exact list on your machine without writing a byte.

## Placement and shared terms

- **Read dirs and dedupe.** `writable` says whether rig may write a skill copy there. Dedupe rules per harness: `none` lists every copy, `identical-bytes` collapses equal bytes, and `by-name` keeps only the first copy.
- **Shadow warning.** When another copy outranks rig's copy by name and differs in bytes (`Cursor` and `Antigravity`), `rig doctor` warns because your copy shadows rig's copy. On `omp`, different bytes print a duplicate error instead.
- **Placement and hide control.** rig picks the minimal set of writable directories so each enabled harness sees one copy (`E_READSET` if impossible). Every skill copy carries the hide keys of all reading harnesses unless the unit appears in `rig.json` `auto`.
- **Mode skill and triggers.** `craft/` installs into every skill dir holding a vendored leaf (`~/.claude/skills` and `~/.agents/skills` by default). Frame triggers with no domain go into each harness's always-on `rig-frame` file using `~`-relative paths ([Run multi-step work with /craft](./guide/06-craft.md)).
- **Never write and model surfaces.** Writing under a `never_write` glob raises `E_CONTAINMENT`. Model surfaces render per role (`frontmatter`, `whole`, `block`, `keys`, `agent`) only when `models/tiers.json` names a model for that harness ([Pick and swap models](./guide/07-models.md)). Antigravity declares `agent` only.

## Claude Code

- **Read dirs:** `~/.claude/skills` (writable, dedupe `none`), `~/.claude/plugins/cache` (read-only).
- **Never write:** `~/.claude/plugins/**`. A plugin matching a seeded upstream blocks `rig plan` with `E_FOREIGN_INSTALL`.
- **Units:** Skills in `~/.claude/skills/<name>/` (hide `disable-model-invocation: true`), commands in `~/.claude/commands/<name>.md`, agents in `~/.claude/agents/<name>.md`, rules in `~/.claude/rules/<name>.md`, owned frame in `~/.claude/rules/rig-frame.md`.
- **Project packs:** Written to `~/.local/share/rig/marketplace` and enabled per repo in `.claude/settings.local.json` ([Scope packs to projects](./guide/05-scope-and-projects.md)).
- **Model surfaces:** Patches `model` and `effort` frontmatter plus model display token on existing `~/.claude/agents/{role}.md` files, and sets those fields on owned `rig-agent` and `rig-janitor`.
- **Session hook:** Adds one `SessionEnd` entry in `~/.claude/settings.json` running `rig stats --record` only when `metrics.session_hook` is `true` (`false` by default).

## Codex

- **Read dirs:** `~/.codex/skills` and `~/.agents/skills` (both writable, dedupe `none`). By default rig writes into `~/.agents/skills`, which `omp`, `Cursor`, and `Antigravity` share.
- **Foreign plugins:** Cached plugin in `~/.codex/plugins/cache/` enabled in `~/.codex/config.toml` blocks with `E_FOREIGN_INSTALL` (warns if `enabled = false`).
- **Units:** Skills hide via sidecar `agents/openai.yaml` (`policy.allow_implicit_invocation: false`), commands in `~/.codex/prompts/<name>.md` (`/prompts:<name>`), agents in `~/.codex/agents/<name>.toml`, no rule format, managed frame block in `~/.codex/AGENTS.md` between `<!-- rig:frame:start -->` and `<!-- rig:frame:end -->`.
- **Budgets:** `AGENTS.md` blocks above 32,768 bytes (warns above 8,192). Visible skill descriptions block above 1,024 characters.
- **Model surfaces:** Owned `~/.codex/agents/{role}.toml`, `[agents]` block in `~/.codex/config.toml` between `rig:models` markers, and `~/.codex/pstack-models.md`. No session hook.

## omp

- **Read dirs:** `~/.omp/agent/skills` (writable) and `~/.agents/skills` (read-only), both dedupe `identical-bytes`.
- **Never write:** `~/.omp/agent/extensions/**` and `~/.omp/agent/config.yml.lock`.
- **Units:** Skills hide with `hide: true`, commands in `~/.omp/agent/commands/<name>.md`, no agent or rule format, managed frame block in `~/.omp/agent/AGENTS.md`.
- **Model surfaces:** Patches `modelRoles` keys in `~/.omp/agent/config.yml` (skip if key absent; block map required) and owns `~/.omp/agent/pstack-models.md`. No session hook.

## Cursor

- **Read dirs:** `~/.cursor/skills`, `~/.agents/skills`, `~/.claude/skills`, `~/.codex/skills` (all read-only), and `~/.cursor/plugins/local/rig/skills` (writable), all dedupe `by-name`.
- **Never write:** `~/.cursor/skills-cursor/**`, `~/.cursor/hooks.json`, `~/.cursor/chats/**`. Matching upstream plugins under `~/.cursor/plugins/` block with `E_FOREIGN_INSTALL`.
- **Units:** Local plugin commands/skills under `~/.cursor/plugins/local/rig/skills/<name>/SKILL.md` (`disable-model-invocation: true`), agents in `~/.cursor/agents/<name>.md`, rules in `~/.cursor/rules/<name>.mdc` (`alwaysApply: true`), owned frame in `~/.cursor/rules/rig-frame.mdc`.
- **Model surfaces:** `model: <slug>[effort=<e>]` in `~/.cursor/agents/{role}.md` plus `~/.cursor/rules/pstack-models.mdc`. No session hook.

## Antigravity

- **Read dirs:** `~/.gemini/skills`, `~/.gemini/antigravity-cli/skills`, `~/.gemini/config/skills`, `~/.gemini/antigravity-cli/builtin/skills`, and `~/.agents/skills` via `~/.gemini/config/skills.json` (read-only, dedupe `by-name`).
- **Skills:** rig writes no separate skill folder; it manages `~/.gemini/config/skills.json` pointing cleanly with an absolute path to `~/.agents/skills` (which `Codex` writes). Running `[antigravity]` without a writer of `~/.agents/skills` fails with `E_READSET`.
- **Never write:** `~/.gemini/antigravity-cli/**`, `~/.gemini/GEMINI.md`, `~/.gemini/settings.json`, `~/.gemini/skills/**`, `~/.gemini/config/skills/**`, `~/.gemini/config/plugins/**`, and `~/.gemini/config/config.json`.
- **Units:** Agents in `~/.gemini/config/agents/<name>.md` (`model` uses `inherit`, `flash`, `flash_lite`, or `pro`), rules in `~/.gemini/config/rules/<name>.md` (`trigger: "always_on"`), owned frame in `~/.gemini/config/rules/rig-frame.md`. No command format, no session hook, and no transcript reader.

## Adding more harnesses

`pi` and `Hermes` have no shipped target record in v0 ([decision 0020](./decisions/0020-cursor-in-v0.md)), and additional targets such as `pi` are added as data records under `targets/<name>.json` ([Make it yours](./guide/09-make-it-yours.md#add-a-harness-as-data)). Probe notes live under [Claude Code](./research/2026-11-05-probes-claude.md), [Cursor and Codex](./research/2026-11-05-probes-cursor-codex.md), and [omp](./research/2026-11-05-probes-omp.md).
