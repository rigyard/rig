---
name: craft
description: "The rig mode skill for multi-step work. It reads the hub and one domain file of this rig. Type the name of this skill to start it. An optional first argument names a domain, for example eng:."
---

# craft

Do these steps in this order.

1. Read the section for this harness in [references/adapter.md](references/adapter.md) first.
{{mode:hub}}
1. An optional first argument names a domain, for example `eng: ...`. The prefix or the domain name selects `references/<domain>.md`. If there is no argument, select the domain from the task. Then read the file of that domain.
1. Hub triggers are keyed by situation, not by step. A step of the domain file can have a `Replaces the hub trigger:` line or a `Replaces the frame trigger:` line. Run that step in place of the line it quotes, inside `/craft`. Every other hub and frame trigger still applies.
1. If a step names a skill that is not installed, skip that skill. Write one line that names it.
1. Leaf skills call this skill poteto-mode. This skill is poteto-mode.

## Domain files

{{mode:domains}}

## Triggers with no domain

The rig frame lists the triggers of rig.json `fill` that name no domain. Every session loads it. The pack triggers with no domain follow.

{{mode:triggers}}
