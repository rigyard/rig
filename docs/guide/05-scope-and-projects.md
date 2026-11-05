# Scope packs to projects

In this page you choose where each pack is active: on the whole machine, or only in the projects you list. You also learn how `rig doctor --project` checks one project. rig infers nothing from a project. Every choice is a line that you write.

## Pick a scope mode per pack

A pack's `pack.json` lists the scope modes that it supports. You pick one mode per pack in `rig.json` or in your overlay `~/.config/rig/rig.json`. rig never picks a mode for you ([decision 0017](../decisions/0017-per-pack-scope-no-context-inference.md)).

| Mode | What rig renders |
|---|---|
| `machine-hidden` | A copy in the harness dirs. Each skill copy carries the hide control of every harness that reads its dir, so the model does not pick it on its own. You invoke it by name. This is the default when the pack entry has no `scope` key. |
| `project` | No machine copy. On Claude Code, a local plugin that you enable per project. On Codex, omp and Cursor, nothing: rig prints the repository paths for you to commit. |
| `hybrid` | The hidden machine copy, plus the Claude Code project plugin. |

This overlay puts the `product` pack in project mode for one project:

```json
{
  "schema": 2,
  "packs": {"product": {"scope": "project", "projects": ["~/src/app"]}}
}
```

The overlay only adds keys. The repo entry `"product": {}` sets no scope, so the overlay can add one. A mode that `pack.json` does not list stops `plan` and `apply` with `E_SCOPE_MODE` and exit 2, before any write. A value outside the three modes, such as `machine`, fails with `E_SCHEMA` (`test/scope.test.ts`, "S4.12").

The exact meaning of `hybrid` is still open (question 8 in [assumptions and open questions](../assumptions-and-open-questions.md)). The table shows what rig renders on main today.

## Plan a project pack

Run `rig plan` with the overlay above. Output trimmed:

```text
...
info scope codex product: project part absent: commit its files (doctor --project)
info scope omp product: project part absent: commit its files (doctor --project)
info scope cursor product: project part absent: commit its files (doctor --project)
...
create  owned  claude  ~/.local/share/rig/marketplace/plugins/product/skills/office-hours/SKILL.md                          product/office-hours
...
create  owned  claude  ~/.local/share/rig/marketplace/plugins/product/commands/oh.md                                        product/oh
...
create  owned  claude  ~/.local/share/rig/marketplace/plugins/product/.claude-plugin/plugin.json                            product/plugin
create  owned  claude  ~/.local/share/rig/marketplace/.claude-plugin/marketplace.json                                       core/marketplace
25 changes, 0 blocks
```

rig renders the plugin under its data root, in a marketplace named `rig-local`. The pack gets no copy in `~/.claude/skills`. The plugin version is a hash of the plugin files, for example `0.0.0-ac3a624d57fe`, so a changed pack gets a new version.

## Register the plugin and enable it per project

`rig apply` writes the files, then prints what you do next:

```text
...
run 20261105T055333.405Z-1: 25 ops applied
register claude: run once; it installs each project pack and disables it at user scope:
  claude plugin marketplace add ~/.local/share/rig/marketplace
  claude plugin install product@rig-local
  claude plugin disable --scope user product@rig-local
enable in ~/src/app: paste into ~/src/app/.claude/settings.local.json (uncommitted)
  {"enabledPlugins": {"product@rig-local": true}}
```

Run the three `claude` commands once. Then paste the snippet into `.claude/settings.local.json` in each listed project. rig runs no `claude` command. The only process it starts is `git`, in `lib/lock/git.ts` (`test/boundaries.test.ts`). It writes no `enabledPlugins` entry and nothing into the project. `test/scope.test.ts` ("S4.8") checks that `~/.claude/settings.json` and the project tree keep their bytes, and that a second `apply` prints `0 changes, 0 blocks`.

One part is not verified end to end. Probe (k) did not check that Claude Code loads a `rig-local` plugin only in the project that enables it. That check needs `claude plugin marketplace add` in a scratch config ([Claude probe record](../research/2026-11-05-probes-claude.md), assumption A25).

## Commit files where no project channel exists

Codex, omp and Cursor have no known per-project channel that stays out of the repository. On those harnesses the project part of a pack stays absent until you commit its files. `rig doctor --project` prints the paths: `.agents/skills/<name>/` for Codex, `.omp/skills/<name>/` for omp and `.cursor/skills/<name>/` for Cursor. Only skills have a known project path. A command such as `product/oh` gets a "no known project path" line. On Claude Code a rule unit has no plugin component, so `plan` prints an `absent` info line for it.

## Check a project with rig doctor --project

Before you paste the snippet, the plugin is off:

```text
$ rig doctor --project ~/src/app
info  drift managed files match installed.json and the render
warn  scope claude pack product is declared for this project but not enabled: paste {"enabledPlugins": {"product@rig-local": true}} into ~/src/app/.claude/settings.local.json
info  scope codex pack product: commit .agents/skills/office-hours/ (a copy of ~/rig/packs/product/skills/office-hours/)
info  scope codex pack product: product/oh has no known project path on codex
...
0 errors, 1 warnings
```

Then add the snippet:

```text
$ rig doctor --project ~/src/app
info  drift managed files match installed.json and the render
info  scope claude pack product is enabled here (local)
...
0 errors, 0 warnings
```

`doctor` reads the project and writes nothing. For `enabledPlugins` it follows the precedence of Claude Code: local beats project, project beats user. The `(local)` tag names the file that decided.

Next: [Run multi-step work with /craft](./06-craft.md).
