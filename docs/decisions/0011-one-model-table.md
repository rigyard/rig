# 0011. One model table with fast swap

- Status: Accepted
- Date: 2026-11-04

## Context

Model vocabulary lives in several files per machine: role rosters, agent frontmatter, a pstack model rule, omp `modelRoles`, Codex agent TOML, Cursor agent frontmatter. These files drift. New models ship as often as weekly. The user decided that rig owns one table. The v3 review found that full-file renders would overwrite hand-written text in the roster and effort tables.

## Decision

- rig owns one table in two files: `models/roles.json` (role to tier and default effort) and `models/tiers.json` (tier to model per harness, plus effort ladders). A model release touches only `tiers.json`.
- Four tiers: `reason`, `strong`, `fast`, `cheap` ([decision 0018](0018-four-tiers-and-second-opinion-slot.md)).
- rig renders model and effort values only. Each target record declares its model-bearing files and a render kind per file: `frontmatter`, `cells`, `whole`, `keys` or `block`. Raise and lower conditions, the retry rule, the "Use for" column and row order stay hand-written.
- Agent descriptions that name a model get the model display name rendered, so they do not go stale on a swap.
- First-run adopt: rig adopts an existing file only when its rendered regions equal the bytes on disk. Otherwise `apply` blocks with a diff. rig never overwrites a file it has not adopted.
- Drift: rig keeps the hash of each rendered region in its install record, not in file comments.
- A swap is one command, `rig models set <tier> <model> --harness H`, then a re-render of only the affected files.

## Consequences

- Running `setup-pstack` can overwrite a rendered file. `doctor` flags that drift.
- Claude aliases resolve to the current model, so most Claude releases need no edit ([decision 0019](0019-claude-aliases-with-optional-pins.md)).
- The design draft v4 contains the table.
