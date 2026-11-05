---
name: poteto-mode
description: Fixture hub for the rig mode tests. It routes a task to one playbook.
disable-model-invocation: true
---

# Fixture hub

## Triggers

- Code crossing a function boundary → the **architect** skill.
- A test fails, or a defect is reported → the Bug fix playbook.
- Long work → keep a resume note at `/tmp/<slug>-resume.md`, and poll with `/loop 1h`.
- Screenshots of a run go to `/tmp/swarm-<pr-id>/worker-<n>/<slug>.png`.

## Playbooks

Open the matched playbook at `playbooks/<title>.md` and copy its steps into your reply.

- **Bug fix.** A reported defect to reproduce, root-cause, and fix. File: `playbooks/bug-fix.md`.

Triage review comments per `references/bugbot-triage.md`.
