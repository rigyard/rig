# Plan, apply, undo

Preview changes with `rig plan`, apply them as one transaction with `rig apply`, adopt pre-existing files, repair drift, and roll back any run with `--undo`.

## Preview and apply

`rig plan` composes packs, workflows, hooks, triggers, and models, runs the ten-check gate, and diffs against disk without touching any file:

```text
...
create  owned  claude  ~/.claude/rules/rig-frame.md                                                              core/rig-frame
create  block  codex   ~/.codex/AGENTS.md                                                                        core/rig-frame
...
279 changes, 0 blocks
```

Run `rig apply` to execute the verified plan. Pre-existing unmanaged files with matching bytes are adopted; managed block markers (`<!-- rig:frame:start -->` / `<!-- rig:frame:end -->`) keep surrounding user lines intact and back up the prior bytes under `~/.local/state/rig/backups/<run-id>/`:

```text
...
update  block  codex   ~/.codex/AGENTS.md                                                                        core/rig-frame
...
279 changes, 0 blocks
run 20261105T204938.618Z-1: 279 ops applied
```

Re-running `rig apply` prints `0 changes, 0 blocks` with no journal write.

## Adopt unmanaged files

rig never overwrites an unmanaged file whose bytes differ. It blocks `rig plan` and `rig apply` with `E_ADOPT_MISMATCH` and prints a diff:

```text
block   owned  claude  ~/.claude/rules/rig-frame.md                                                              E_ADOPT_MISMATCH ~/.claude/rules/rig-frame.md exists and is not managed: bytes differ; rig never deletes what it does not own, so move or delete it by hand (diff below)
```

Move your file aside (for example `mv ~/.claude/rules/rig-frame.md ~/rig-frame-mine.md`) or fold it into a pack, then run `rig apply` again.

## Undo and repair

Pass the printed run id to `--undo` to restore every modified file byte for byte and move newly created files into backup storage:

```text
rig apply --undo 20261105T204938.618Z-1
```

Before restoring, rig verifies that every path still matches the post-run hash (`E_UNDO_CONFLICT` aborts with nothing restored if edited afterward). Edited or deleted managed files raise `E_DRIFT`; run `rig plan --repair` and `rig apply --repair` to restore rendered content through the same journaled backup path.

## Crash recovery and blocked plans

If an apply stops mid-run, the next `rig apply` inspects the open journal, counts already-written ops as done, finishes the remainder, and seals recovery (`E_RECOVERY_CONFLICT` if a third party modified a target mid-crash). When any gate check blocks (such as an executable `run.sh`), `rig apply` prints the finding and optional `ack:` stanza, exits 1, and writes zero bytes.

Next: [Pass the gate](./03-the-gate.md).
