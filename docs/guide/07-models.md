# Pick and swap models

In this page you read the model table that rig renders into each harness, swap the model of one tier, and pin a Claude tier to a full model id. You get one place to change a model after a vendor release, and a guarantee that rig changes only the model and effort cells of your files.

## Know the two files

rig keeps model choices in two files under `models/`:

- `models/roles.json` maps each role to a tier and an effort. The `fleet` consumer says, for example, that `reviewer` is `["strong", "high"]` and `quick-worker` is `["cheap", "low"]`.
- `models/tiers.json` maps each of the four tiers `reason`, `strong`, `fast` and `cheap` to a model per harness. It also holds the effort ladder of each harness, for example `low`, `medium`, `high` on Cursor.

A vendor release changes `tiers.json` only. Roles stay as they are. When a role asks for an effort that the harness does not have, rig uses the highest rung of the ladder at or below it, so `xhigh` becomes `high` on Cursor. Read [decision 0018](../decisions/0018-four-tiers-and-second-opinion-slot.md) for why there are four tiers.

On main, `tiers.json` names a model per tier for all four harnesses. Claude tiers are aliases. The Codex, Cursor and omp values are ids that each harness lists, and you can change any of them with `rig models set`. The pstack role values in `roles.json` are an open decision: see [assumptions and open questions](../assumptions-and-open-questions.md).

## Read the effective table

```text
rig models
harness  tier    model                                source
claude   reason  fable                                tiers.json
claude   strong  opus                                 tiers.json
claude   fast    sonnet                               tiers.json
claude   cheap   haiku                                tiers.json
codex    reason  gpt-6-astra                          tiers.json
codex    strong  gpt-6.1-sol                          tiers.json
codex    fast    gpt-6.1-terra                        tiers.json
codex    cheap   gpt-6-luna                           tiers.json
omp      reason  google-antigravity/gemini-4-argon    tiers.json
omp      strong  google-antigravity/claude-opus-5-5   tiers.json
omp      fast    google-antigravity/gemini-3.8-flash  tiers.json
omp      cheap   google-antigravity/gemini-3.8-flash  tiers.json
cursor   reason  claude-opus-5-5                      tiers.json
cursor   strong  claude-opus-5-5                      tiers.json
cursor   fast    claude-sonnet-5-5                    tiers.json
cursor   cheap   claude-haiku-5-5                     tiers.json
```

The `source` column tells you where each value comes from. Claude tiers are aliases, so `opus` always resolves to the current model of that family. Claude Code can remap an alias for every session through an environment variable, and `rig models` shows that:

```text
ANTHROPIC_DEFAULT_OPUS_MODEL=acme-opus-test rig models
harness  tier    model           source
claude   reason  fable           tiers.json
claude   strong  acme-opus-test  env override (ANTHROPIC_DEFAULT_OPUS_MODEL)
claude   fast    sonnet          tiers.json
claude   cheap   haiku           tiers.json
...
```

`rig models` reads only. Most Claude releases need no edit at all, because the alias follows the release ([decision 0019](../decisions/0019-claude-aliases-with-optional-pins.md)).

## Let rig adopt your agent files

rig does not ship Claude agent files. When `~/.claude/agents/<role>.md` exists for a `fleet` role, rig manages its `model` and `effort` lines and the model name in parentheses in `description`. The first plan compares your cells with the render:

```text
rig plan
...
adopt  cells  claude  ~/.claude/agents/reviewer.md      models/claude
block  cells  claude  ~/.claude/agents/quick-worker.md  E_ADOPT_MISMATCH ~/.claude/agents/quick-worker.md: current values differ from the render (diff below)
~/.claude/agents/quick-worker.md 0/quick-worker/0/model: "sonnet" -> "haiku"
~/.claude/agents/quick-worker.md 0/quick-worker/0/display: "Sonnet" -> "Haiku"
1 change, 1 block
```

A file whose cells equal the render is adopted, and rig records it. A file that differs blocks, and rig names each cell. Fix the cell or the role, then plan again. An agent file that does not exist is skipped without a line.

## Swap a model

```text
rig models set strong acme-strong-2 --harness claude
models/tiers.json: tiers.strong.claude: opus -> acme-strong-2
patch-cells  cells  claude  ~/.claude/agents/reviewer.md  models/claude
1 change, 0 blocks
run 20261105T055313.336Z-2: 1 ops applied
```

`rig models set` runs one journaled apply on the model files only, then writes `models/tiers.json`. You do not need a separate `rig apply`. The next `rig apply` prints `0 changes, 0 blocks`. If the plan blocks, for example because you hand-edited a cell, rig writes nothing, and `tiers.json` keeps its bytes. Commit `models/tiers.json` after the swap.

In `reviewer.md`, the swap changed `model: opus` to `model: acme-strong-2` and the description token `(Opus)` to `(Acme-strong-2)`. Every other byte stayed. The tests `swap: every tier on every harness changes only cell lines, converges, and reverts byte-exact` in `test/models.test.ts` and `rig models set changes exactly the expected cells` in `test/models-render.test.ts` pin that.

`set` takes a tier that `tiers.json` knows, a harness that `rig.json` lists, and one model token without spaces. Anything else exits 2, for example `rig models: E_USAGE: unknown tier ultra`.

## Pin a Claude tier to a full id

To stop an alias from moving, pin the tier by hand in `models/tiers.json`:

```text
"cheap": {
  "claude": {"id": "acme-haiku-pinned", "display": "Haiku"}
}
```

```text
rig models
...
claude   cheap   acme-haiku-pinned  pinned id
rig plan
...
patch-cells  cells  claude  ~/.claude/agents/quick-worker.md  models/claude
1 change, 0 blocks
```

A pin renders the full id into the agent's `model` line and keeps the display token. The environment override does not apply to a pinned tier. Later swaps of a pinned tier go through `rig models set` and keep the pin shape.

## Read the pstack role table of each harness

The pstack skills pick a model per role from a rule file. rig writes one per harness from the table above:

| Harness | File | Line |
| --- | --- | --- |
| Claude Code | `~/.claude/rules/pstack-models.md` | `swarm workers: sonnet high` |
| Codex | `~/.codex/pstack-models.md` | `swarm workers: gpt-6.1-terra high` |
| Cursor | `~/.cursor/rules/pstack-models.mdc` | `swarm workers: claude-sonnet-5-5-high` |
| omp | `~/.omp/agent/pstack-models.md` | `swarm workers: google-antigravity/gemini-3.8-flash:high` |

Codex passes the `model` and `reasoning_effort` of the line to `spawn_agent`. Cursor reads the fused slug. omp passes the value as `model` only when `task.perCallModel` allows it and, when `task.perCallModelAllow` is set, lists it. Those two settings are yours: rig adopts and patches only the `modelRoles` map in `~/.omp/agent/config.yml`, and no other key there. A rung that a harness lacks clamps to the top of its ladder, so `xhigh` is `high` on Cursor and omp. Change one cell with `rig models set strong <model> --harness codex`.

## Add a harness's models

The overlay at `~/.config/rig/models/tiers.json` adds the rows that the repo does not set. The repo names all four seeded harnesses, so the overlay is for a harness that you add as a target ([Make it yours](./09-make-it-yours.md)). For a harness `acme`:

```text
{
  "schema": 1,
  "tiers": {
    "reason": {"acme": "acme-max"},
    "strong": {"acme": "acme-pro"},
    "fast": {"acme": "acme-mini"},
    "cheap": {"acme": "acme-nano"}
  }
}
```

`rig models` then shows four `acme` rows, and the model surfaces of the `acme` target render. A harness that no tier names renders none of its model surfaces, and `rig plan` prints an `info absent` line for each.

The overlay can only add. A cell that the repo already sets, such as `codex` on `strong`, fails with `E_OVERLAY_CONFLICT`. With an overlay `tiers.json` present, `rig models set` refuses with exit 2, because it would copy your overlay values into the repo file. Edit the overlay file by hand and run `rig apply`. That path uses the same writer. The same add-only rule holds for an overlay `models/roles.json`.

Next: [Read your usage](./08-stats.md).
