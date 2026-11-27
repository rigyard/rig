# Pick and swap models

Manage roles, four model tiers, Claude aliases or pins, and atomic one-command model swaps across all five harnesses.

## Roles and tiers

- `models/roles.json` maps named roles (`fleet` and `agents`) to a tier and effort level (`reviewer: ["strong", "high"]`).
- `models/tiers.json` maps the four tiers (`reason`, `strong`, `fast`, `cheap`) to concrete harness slugs and clamps requested effort to each harness's ladder ([decision 0018](../decisions/0018-four-tiers-and-second-opinion-slot.md)).

Inspect the active resolution table (including Claude `ANTHROPIC_DEFAULT_*_MODEL` env overrides) with `rig models`.

## Shipped core agents and safety guard

| Harness | `rig-agent` (`strong`, `medium`) | `rig-janitor` (`cheap`, `low`) |
|---|---|---|
| Claude Code | `model: "opus"`, `effort: "medium"` | `model: "haiku"`, `effort: "low"` |
| Codex | `model = "gpt-6.1-sol"`, `model_reasoning_effort = "medium"` | `model = "gpt-6-luna"`, `model_reasoning_effort = "low"` |
| Cursor | `model: "claude-opus-5-5[effort=medium]"` | `model: "claude-haiku-5-5[effort=low]"` |
| Antigravity | `model: "pro"` (`inherit`/`flash`/`flash_lite`/`pro`) | `model: "flash_lite"` |

rig blocks any agent definition using `xhigh`, `max`, or `-fast` model tokens (`E_AGENT_MODEL`). Existing `~/.claude/agents/<role>.md` files matching a `fleet` role must align on initial `rig apply` (`E_ADOPT_MISMATCH` otherwise).

## Swap or pin a tier

Update `models/tiers.json` and patch only model/effort cells in one journaled transaction:

```text
rig models set strong acme-strong-2 --harness claude
```

To pin a Claude tier to an exact model id instead of an alias ([decision 0019](../decisions/0019-claude-aliases-with-optional-pins.md)), replace the alias in `models/tiers.json` with `{"id": "acme-haiku-pinned", "display": "Haiku"}`. pstack role tables render to each harness's own rule file (`pstack-models.md`/`.mdc`, and `modelRoles` in `~/.omp/agent/config.yml`). Overlay `~/.config/rig/models/tiers.json` may add rows only for user-defined harnesses (`rig models set` exits 2 when an overlay `tiers.json` is active).

Next: [Read your usage](./08-stats.md).
