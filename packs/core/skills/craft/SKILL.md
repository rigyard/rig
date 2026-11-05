---
name: craft
description: "The rig mode skill for multi-step work. It reads the hub and one domain file of this rig. Type /craft, or /craft eng: <task>."
---

# craft

Do these steps in this order.

1. Read the section for this harness in [references/adapter.md](references/adapter.md) first.
{{mode:hub}}
1. An optional first argument names a domain, for example `/craft eng: ...`. The prefix or the domain name selects `references/<domain>.md`. If there is no argument, select the domain from the task. Then read the file of that domain.
1. If a domain file and the hub name the same step, obey the domain file.
1. If a step names a skill that is not installed, skip that skill. Write one line that names it.
1. Leaf skills call this skill poteto-mode. This skill is poteto-mode.

## Domain files

{{mode:domains}}

## Triggers with no domain

{{mode:triggers}}
