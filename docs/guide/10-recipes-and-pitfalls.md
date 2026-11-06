# Recipes and pitfalls

In this page you get command sequences to copy, then the mistakes that cost a blocked plan the first time. Swap in your own paths, tiers and commits. Each recipe links the page that explains it.

## Seed a machine you already use

```text
rig doctor
rig plan
```

Read every `block` line before you change anything. On a machine with hand-written commands and agents, the usual block is `E_ADOPT_MISMATCH`: a file exists where rig wants to write, and its bytes differ from the render. Move your file away, or fold its content into a pack, then plan again. When the plan shows `0 blocks`, run `rig apply`. [Plan, apply, undo](./02-plan-and-apply.md#adopt-files-you-already-have) shows the diff format.

## Swap a model after a vendor release

```text
rig models
rig models set strong <model> --harness claude
```

`rig models` shows each cell and the file it comes from. `rig models set` changes one cell in `models/tiers.json` and re-renders only the model and effort cells, through the gate and the journal. A plain `rig apply` after it prints `0 changes`. Commit `models/tiers.json` in your checkout. [Pick and swap models](./07-models.md#swap-a-model) covers pinned ids and overlay rows.

## Try a pack in one project

Put the pack in project scope in `~/.config/rig/rig.json`:

```json
{
  "schema": 2,
  "packs": {"product": {"scope": "project", "projects": ["~/src/app"]}}
}
```

```text
rig plan
rig apply
```

`rig apply` prints three `claude plugin` commands and a `settings.local.json` snippet. Run the commands once and paste the snippet into the project. Codex, omp, Cursor and Antigravity get no project copy: commit the paths that `rig doctor --project ~/src/app` prints. [Scope packs to projects](./05-scope-and-projects.md) explains why rig never writes into the repository.

## Review a week of usage

```text
rig stats --since 7d
rig stats --since 7d --suggest
```

The first command prints sessions, tokens and cache hits per harness. The second adds a proposed diff, for example a skill that no session loaded, and saves it as a patch under `~/.local/state/rig/proposals/`. rig applies none of it. You run `git apply` on the patch in your checkout, commit it, then run `rig apply`. [Read your usage](./08-stats.md#get-a-suggested-diff) shows a full report.

## Roll back the last apply

`rig apply` prints the run id on its last line, `run <run-id>: <n> ops applied`. Pass it to `--undo`:

```text
rig apply --undo <run-id>
```

The undo is a new run, so you can undo it too. It restores nothing when any path changed after the run. [Plan, apply, undo](./02-plan-and-apply.md#undo-a-run) shows the conflict report.

## Pitfalls

**Editing a file rig wrote.** The next plan blocks with `E_DRIFT` and shows the diff between your bytes and the render:

```text
block  owned  claude  ~/.claude/rules/rig-frame.md  E_DRIFT ~/.claude/rules/rig-frame.md changed since rig wrote it (diff below)
```

To keep your edit, make the change in the pack unit instead, then plan again. To drop the edit, run `rig apply --repair`. It writes the render back, and `rig apply --undo <run-id>` restores your bytes. A removed file blocks the same way (`E_DRIFT managed file ... was removed`), and `rig apply --repair` writes it again. [Write a drifted file again](./02-plan-and-apply.md#write-a-drifted-file-again) shows the plan.

A change of mode alone blocks the same way. After `chmod 600` on `~/.claude/rules/rig-frame.md`, the plan prints the same `E_DRIFT ... changed since rig wrote it (diff below)` line, and the diff holds only the two header lines `--- ... (current)` and `+++ ... (desired)`, with no changed line. An empty diff means the bytes match and the mode differs. Restore the mode rig wrote (`chmod 644` for that file), and the next plan shows 0 blocks.

When a harness record moves a file from a whole-file write to a managed block, rig converts the entry without a block if the file still has the bytes and mode rig recorded: the plan shows an `update` and apply replaces the file with the block. A file you edited keeps the `E_DRIFT ... is recorded as owned, desired as block` block. Move your text out of the file, then plan again. A changed mode keeps the block too, even when the bytes match: `chmod` the file back to the mode rig wrote, then plan again.

**Setting a repo value in the overlay.** The overlay only adds. `harnesses` and the model cells of the four seeded harnesses are set in the repo's files, so an overlay value for them fails with `E_OVERLAY_CONFLICT` and exit 2. Change them in your checkout. The one exception is `metrics.session_hook` (guide 9).

**Acking a `pin` finding.** A `pin` block means a pack tree or the core tree differs from the lock, or a port is not reviewed (`E_PORT_STALE`). An ack for it fails the schema with exit 2. Restore the files, or, after a core change you meant, run `rig pin check core` and `rig pin set core`. For `E_PORT_STALE`, update the port, then run `rig pin set <pack> --ported`.

**pstack is already installed as a plugin.** The seed installs pstack, cursor-team-kit, cli-for-agent and gstack's `office-hours` as rig skills. A Claude Code or Cursor plugin install of the same upstream gives the model two copies, so `rig plan` blocks. The test "a Claude Code plugin record of pstack: rig plan prints E_FOREIGN_INSTALL pstack and exits 1, and apply keeps the record" prints:

```text
block pin */harness:claude: E_FOREIGN_INSTALL pstack: Claude Code has the plugin pstack@cursor-plugins installed (scope user), and pack pstack seeds the same upstream; rig never deletes what it does not own, so run claude plugin uninstall pstack@cursor-plugins --scope user
```

rig gives one finding per install entry of `installed_plugins.json`. A project install names its scope and project path, so run the uninstall command in that project. An install that `enabledPlugins` in the settings of its scope sets to `false` warns instead of blocking. For a Cursor plugin, the finding names the folder under `~/.cursor/plugins/`. `cursor-agent` has no command that uninstalls a plugin, so uninstall it in Cursor, or delete the folder by hand. For omp, the finding names the package in `~/.omp/plugins/omp-plugins.lock.json`, such as `@casualjim/pi-pstack`, and the command `omp plugin uninstall <package>`. A disabled omp plugin warns.

A skill dir that rig does not manage can also hold a seeded upstream. `~/.claude/skills/gstack`, a gstack clone or link, blocks. So does a skill dir with a name that a pack excludes as `skills/<x>` or adopts, when the pack lists the name in `foreign_block`. pstack lists `poteto-mode`, a second hub, and `setup-pstack`, which rewrites the pstack model rule that rig owns. The other left-out pstack names (`statechart`, `make-bot-ui`, `poteto-help`, `create-formal-verification-skill`) warn. You remove each of these once per machine. The finding is a `pin` block, so you cannot ack it.

**A hand-written file at a rendered path.** Your own `~/.agents/skills/architect/SKILL.md` blocks the plan with `E_ADOPT_MISMATCH`, because the pstack pack renders the `architect` skill there. rig never deletes a file that it does not own. Move your skill away, or disable `pstack/architect`. With the unit disabled, `rig plan` still gives 0 blocks: the hub line that names `architect` becomes an `info mode` line.

**A symlinked dir inside a harness dir.** rig writes no file through a symlink. When a dir below the first folder of a rendered path is a link, such as `~/.claude/skills/how` pointing to `~/mine/how`, `rig plan` blocks that path with `E_CONTAINMENT` and names the link and its target, and `rig apply` writes nothing. Replace the link with a real dir, or move it away. A link at the first folder, such as `~/.codex` pointing to a dotfiles checkout, still works.

**`models set` with an overlay `tiers.json`.** The command refuses with exit 2, because it would copy your overlay rows into the repo file. Edit the overlay by hand and run `rig apply`.

**Installing with `npm install -g`.** Node does not strip types inside `node_modules`, so a global install from a git URL fails to start. Use `npm link` in a checkout, as [Set up rig](./01-setup.md#install-from-a-checkout) shows.

**Running harness CLIs against your real config in tests.** The unit tests build a temporary HOME. Live tests run only with `RIG_LIVE=1`, and they check that your harness config files keep their hashes. Keep it that way when you add a test.

Back to [the guide index](./README.md).
