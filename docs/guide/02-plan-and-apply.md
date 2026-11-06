# Plan, apply, undo

In this page you preview a plan, write it with one journaled apply, adopt files you already have, and undo a run. You also see what rig does when an apply dies halfway and when the gate blocks. At the end you can change your harness files and get the old bytes back.

## Preview the plan

Run `rig plan`. It composes the stack, renders it per harness, runs the gate and compares the result with disk and with `installed.json`. On a fresh HOME it prints:

```text
warn budget pstack/skills/ketchup-video/SKILL.md: reference chain skills/ketchup-video/SKILL.md -> skills/ketchup/SKILL.md -> skills/bro/SKILL.md is 2 levels deep; keep references one level from SKILL.md
...
info budget */harness:claude: always-on: 1,289 characters, 323 tokens
...
info absent codex models/codex: ~/.claude/agents/deep-reasoner.md is absent, so ~/.codex/agents/deep-reasoner.toml does not render
create  owned  claude  ~/.claude/rules/rig-frame.md                                                              core/rig-frame
create  block  codex   ~/.codex/AGENTS.md                                                                        core/rig-frame
...
create  owned  claude  ~/.claude/skills/craft/SKILL.md                                                           core/craft
...
create  owned  claude  ~/.claude/skills/craft/hub.md                                                             core/craft
...
309 changes, 0 blocks
```

The checkout seeds pstack, cursor-team-kit, cli-for-agent and product, so a fresh HOME gets 309 files. The two `warn budget` lines are reference chains inside upstream pstack skills. rig does not edit upstream text to clear them. Gate findings come first, then `info` lines, then one line per op. Each op line names the op, the entry kind, the harness, the path and the unit. An `owned` file belongs to rig as a whole. A `block` entry is one marked region inside a file that you also edit, such as `~/.codex/AGENTS.md`. The last line counts the changes and the blocks.

`rig plan` writes nothing and logs nothing. After the run above, the temp HOME was still empty. It exits 1 when anything blocks, else 0.

## Write the plan

Run `rig apply`. It runs the same pipeline and then writes the ops. Start from a HOME that already has a hand-written `~/.codex/AGENTS.md`. The plan now shows an update for that path, not a create:

```text
...
update  block  codex   ~/.codex/AGENTS.md                                                                        core/rig-frame
...
309 changes, 0 blocks
run 20261105T204938.618Z-1: 309 ops applied
```

Every write into a harness file goes through this journaled transaction. `rig apply` runs it for the whole plan. `rig models set` runs it for the model cells only, as [Models](./07-models.md) shows. For each op, the transaction copies the current bytes into `backups/<run-id>/` and appends an intent line to the journal. Then it checks the file once more and writes through a temp file and a rename. After the last op it replaces `installed.json` and appends a `commit` line. The state root now holds:

```text
~/.local/state/rig/installed.json
~/.local/state/rig/journal/20261105T204938.618Z-1.jsonl
~/.local/state/rig/log/rig.log
~/.local/state/rig/backups/20261105T204938.618Z-1/.codex/AGENTS.md
```

rig appended its frame between `<!-- rig:frame:start -->` and `<!-- rig:frame:end -->` and left your lines above it as they were. The backup holds your original file. A created file has no pre-image, so it gets no backup.

## Run it again

Run `rig apply` a second time:

```text
...
0 changes, 0 blocks
```

Nothing changed, so rig prints no run line and writes no journal. You can run `rig apply` as often as you like. It converges on the same files.

## Adopt files you already have

On the first run, rig meets files it does not manage yet. When a file has the same bytes as the render, rig adopts it. rig records the file in `installed.json` and writes nothing to it. A file with other bytes blocks with `E_ADOPT_MISMATCH` and a diff. Start from another fresh HOME. It already has a hand-written `~/.claude/rules/rig-frame.md` that holds `my own frame`. The test "an unmanaged file at a rendered path blocks with E_ADOPT_MISMATCH and a diff; apply writes nothing" uses the same frame file. The plan shows:

```text
...
block   owned  claude  ~/.claude/rules/rig-frame.md                                                              E_ADOPT_MISMATCH ~/.claude/rules/rig-frame.md exists and is not managed: bytes differ; rig never deletes what it does not own, so move or delete it by hand (diff below)
...
--- ~/.claude/rules/rig-frame.md (current)
+++ ~/.claude/rules/rig-frame.md (desired)
+# rig frame
...
-my own frame
 
<n> changes, 1 block
```

`rig plan` exits 1. `rig apply` prints the same report, then `blocked: nothing written`, and exits 1. It creates no state root. rig never replaces a file it does not manage. Model files and marked regions follow the same rules per cell or per block, as section 8 of the [architecture](../design/rig-architecture.md) shows. Move your file away, or make it equal to the render. After `mv ~/.claude/rules/rig-frame.md ~/rig-frame-mine.md`, the next apply passes:

```text
...
create  owned  claude  ~/.claude/rules/rig-frame.md                                                              core/rig-frame
...
<n> changes, 0 blocks
run 20261105T205009.647Z-1: <n> ops applied
```

## Undo a run

Pass the run id of the AGENTS.md run to `--undo`. `rig apply --undo 20261105T204938.618Z-1` prints:

```text
undid run 20261105T204938.618Z-1 as run 20261105T204954.970Z-2: 309 ops restored
```

rig walks the journal of that run in reverse. Each file it changed gets its pre-image back, byte for byte. Each file it created moves into the backups of the new run, because rig never deletes. Here `cmp` found `~/.codex/AGENTS.md` identical to the hand-written original, and `installed.json` went back to `"entries": {}`.

The undo is a new journaled run with its own backups. Before it writes, it checks that every path still has the bytes the run left. If any path differs, it lists every conflict, restores nothing, and exits 1. A second undo of the same run shows this:

```text
conflict E_UNDO_CONFLICT ~/.claude/rules/pstack-models.md: ~/.claude/rules/pstack-models.md no longer has the after hash of run 20261105T204938.618Z-1
...
309 conflicts: nothing restored
```

## Write a drifted file again

A file that rig wrote and you removed or edited blocks the plan with `E_DRIFT`, and a plain `rig apply` leaves it alone. Pass `--repair` to plan the drifted entries as writes that put the render back. This example removes `~/.claude/rules/rig-frame.md` and appends a line to `~/.claude/rules/pstack-models.md`. `rig plan --repair` writes nothing and prints:

```text
...
create  owned  claude  ~/.claude/rules/rig-frame.md      core/rig-frame (repair)
update  owned  claude  ~/.claude/rules/pstack-models.md  pstack/models (repair, diff below)
--- ~/.claude/rules/pstack-models.md (current)
+++ ~/.claude/rules/pstack-models.md (desired)
@@
 architect runners: opus high, sonnet high
 interrogate reviewers: opus high, sonnet high
-hand
...
```

`rig apply --repair` writes the same plan through the same journaled transaction as any apply. The backup holds the bytes you had, so `rig apply --undo <run-id>` brings them back. Rules:

- A repair rewrites only entries that `installed.json` records. A file that exists and that rig never wrote still blocks with `E_ADOPT_MISMATCH`.
- In a file with a managed block, only the text between the markers is rewritten. Your lines around it stay.
- A file that rig recorded as one kind of entry and now renders as another keeps its `E_DRIFT` block, and so does a file that is no longer rendered.
- Any block that remains stops the whole apply, with or without `--repair`.

## Recover from a crash

If an apply dies halfway, the next `rig apply` reads the open journal and recovers first. An op whose file has the new bytes counts as done. An op whose file still has the old bytes goes back into the plan. The tests simulate the crash with `RIG_TEST=1 RIG_TEST_ABORT_AFTER=<n>`, which kills rig after n writes. It is a test hook, not a CLI flag. With `n=5` on a fresh HOME, apply exits 137, and the next plan shows:

```text
info run 20261105T205051.505Z-1 was interrupted; rig apply recovers it first
<n> changes, 0 blocks
```

The next apply writes the 300 ops and closes the old journal with `{"type":"recovered","by":"20261105T205052.321Z-2","done":[1,2,3,4,5]}`. The apply after that prints `0 changes, 0 blocks`. `done` names the 5 ops that the crashed run finished, so an undo of the crashed run restores those 5 ops only and keeps the 300 ops of the later run. If a third party changed a file during the crashed run, recovery stops with `E_RECOVERY_CONFLICT` and names the path. Section 9 of the [architecture](../design/rig-architecture.md) lists every crash point.

## Let the gate stop a write

The gate runs inside the plan, so it blocks before the first byte. A pack script with an exec bit and a shebang, added to a copy of the checkout, gives:

```text
block pin product/.: tree sha256:3782a8f1ace9... differs from locked sha256:b5191d96c33f...
block exec product/skills/office-hours/scripts/run.sh: exec bit, shebang, script extension; mode 755, sha256 299001868fb8
  ack: {"id":"a7e004059f9b28ae","check":"exec","pack":"product","path":"skills/office-hours/scripts/run.sh","reason":"","expires":""}
...
<n> changes, 2 blocks
blocked: nothing written
```

The `pin` block comes first, because the new file also changes the pack tree that `rig.lock.json` locks. `rig apply` exits 1 and leaves HOME and the state root as they were. No flag skips the gate. The `ack:` stanza under the finding is how you accept a finding on purpose. The next page covers it.

Next: [Pass the gate](./03-the-gate.md).
