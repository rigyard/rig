# Run multi-step work with /craft

Start multi-step engineering, product, business, and upkeep workflows with `/craft`, combine `pstack` and `gstack` `office-hours`, and customize steps with declarative hooks and triggers.

## Invoke the mode skill

Invoke `/craft` (Claude Code, Cursor, Antigravity), `$craft` (Codex), or `/skill:craft` (omp), optionally naming one of the four domains in `packs/core/domains.json` (`biz`, `prod`, `eng`, `upk`):

```text
/craft eng: design the boundary between the parser and the renderer
```

Every copy carries the hide switch so the agent runs it only when you ask.

## Compiled layout and harness adapters

rig writes `craft/` into every skill dir holding a vendored leaf (`~/.claude/skills/` and `~/.agents/skills/`):
- `craft/SKILL.md` (shell from `packs/core`)
- `craft/hub.md` and `craft/playbooks/*.md` (vendored from `packs/pstack`, 22 playbooks)
- `craft/references/<domain>.md` (compiled stages, slots, hooks, and triggers per domain)
- `craft/references/adapter.md` (per-harness tool name mapping)

Every vendored leaf adds a two-line anchor pointing to `craft/references/adapter.md` while keeping upstream pack bytes intact.

## Seeded workflows (`pstack` and `gstack`)

| Domain | Stage or hook | Unit | Source |
|---|---|---|---|
| `prod:discover` | slot | `product/office-hours` (`gstack` port) | `rig.json` `fill` |
| `eng:ground` | slot | `pstack/how` | `rig.json` `fill` |
| `eng:design` | slot | `pstack/architect` | `rig.json` `fill` |
| `eng:review` | `.before` hook | `pstack/no-comments` | `packs/pstack/pack.json` `mode.hooks` |
| `eng:ship` | `.before` hook | `cursor-team-kit/deslop` | `rig.json` `fill` |

Conditional `rig.json` triggers also fire `pstack/reframe` in `prod:discover`, `core/engineering-research` before `eng:design`, and `cli-for-agent/cli-for-agents` when building CLIs. Always-on triggers with no `domain` install directly into `rig-frame`:

| Frame trigger condition | Unit |
|---|---|
| `Any prose surface, your reply to the user included` | `pstack/unslop` |
| `Docs, RFCs, readmes, PR descriptions, or commit messages` | `pstack/technical-writing` |
| `Before commit` | `cursor-team-kit/deslop` |
| `Before review` | `pstack/no-comments` |

Inside `/craft`, `eng:review.before` and `eng:ship.before` emit `Replaces the frame trigger:` so those checks run at the right stage rather than repeating at random.

## Supply mode data, hooks, and triggers

In `pack.json`, a pack's `mode` object supplies `adopt` mappings (`hub.md`, `playbooks/`, `references/`), `playbooks` domain labels, `artifacts`, default step `hooks`, and per-harness `adapter` text. Use `rig.json` `fill` (or your overlay `~/.config/rig/rig.json`) to override stage slots (`<prefix>:<stage>`), replace step hooks (`.before`/`.after`), or add domain and frame `triggers`:

```json
{
  "fill": {
    "eng:design": "pstack/architect",
    "eng:ship.before": ["cursor-team-kit/deslop"],
    "triggers": [{ "when": "Building or changing a CLI", "use": "cli-for-agent/cli-for-agents", "domain": "engineering" }]
  }
}
```

Invalid addresses, unreferenced units, missing playbooks, missing frontmatter closes, and stale port rewrites raise unackable mode blocks (`E_FILL_UNKNOWN`, `E_ARTIFACT_DANGLING`, `E_PLAYBOOK_UNLABELED`, `E_ANCHOR_MISSING`, `E_MODE_REF`, `E_CLASH`).

Next: [Pick and swap models](./07-models.md).
