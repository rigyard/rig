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

`rig apply` prints three `claude plugin` commands and a `settings.local.json` snippet. Run the commands once and paste the snippet into the project. Codex, omp and Cursor get no project copy: commit the paths that `rig doctor --project ~/src/app` prints. [Scope packs to projects](./05-scope-and-projects.md) explains why rig never writes into the repository.

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

Put the render back from the diff, and make the change in the pack unit instead. A removed file blocks the same way (`E_DRIFT managed file ... was removed`). v0 has no command that writes it again, so keep rig's files in place.

**Setting a repo value in the overlay.** The overlay only adds. `metrics.session_hook`, `harnesses` and the Claude model cells are set in the repo's files, so an overlay value for them fails with `E_OVERLAY_CONFLICT` and exit 2. Change them in your checkout.

**Acking a `pin` finding.** A `pin` block means a pack tree or the core tree differs from the lock. An ack for it fails the schema with exit 2. Restore the files, or, after a core change you meant, run `rig pin check core` and `rig pin set core`.

**A hand-written command at a rendered path.** Your own `~/.claude/commands/oh.md` blocks the plan with `E_ADOPT_MISMATCH`, because the product pack renders `/oh` there. Rename your command, or disable `product/oh`.

**`models set` with an overlay `tiers.json`.** The command refuses with exit 2, because it would copy your overlay rows into the repo file. Edit the overlay by hand and run `rig apply`.

**Installing with `npm install -g`.** Node does not strip types inside `node_modules`, so a global install from a git URL fails to start. Use `npm link` in a checkout, as [Set up rig](./01-setup.md#install-from-a-checkout) shows.

**Running harness CLIs against your real config in tests.** The unit tests build a temporary HOME. Live tests run only with `RIG_LIVE=1`, and they check that your harness config files keep their hashes. Keep it that way when you add a test.

Back to [the guide index](./README.md).
