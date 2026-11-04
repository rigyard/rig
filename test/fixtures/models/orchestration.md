# Orchestration

Single authority on delegation.

## Roles

| Role                       | Model, effort           | Use for                                        |
|----------------------------|-------------------------|------------------------------------------------|
| orchestrator (this thread) | —                       | plan, decompose, synthesize                    |
| deep-reasoner              | Alpha, high             | one hard problem: architecture, debugging      |
| reviewer                   | Bravo, high, read-only  | independent adversarial pass over a diff       |
| senior-worker              | Bravo, high             | implementation that needs judgment             |
| fast-worker                | Charlie, low            | boilerplate, templates, tests                  |
| quick-worker               | Delta, low              | one bounded op: run a script, grep a log       |
| web-researcher             | Charlie, medium         | external sources: docs, release notes          |

## Effort per dispatch

| Role           | Default | Lower to                                 | Raise to                                   |
|----------------|---------|------------------------------------------|--------------------------------------------|
| quick-worker   | low     | —                                        | medium or high: the output is noisy        |
| fast-worker    | low     | —                                        | medium: only by the retry rule             |
| web-researcher | medium  | low: the answer is one fact              | high: the sources conflict                 |
| senior-worker  | high    | medium: a small edit, little judgment    | xhigh: concurrency or an unreproducible bug|
| reviewer       | high    | medium: a docs-only diff                 | xhigh: security, a migration               |
| deep-reasoner  | high    | medium: consolidation of known inputs    | max: independent pass, high stakes         |

## Discipline

Name the role, model and effort: `deep-reasoner (Alpha, high)`, `reviewer (Bravo, high)`.
