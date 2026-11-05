# rig docs

rig is a version-pinned agent-skill stack and a seeder for coding-agent harnesses. On 2026-11-05 the direction changed to v1. rig now vendors pstack and renders its own mode skill, `craft` (`/craft`), around pstack's hub, which installs byte-identical as `craft/hub.md`. Start a planning session from the v1 concept, the first-seed design and the first-seed plan. The v0 documents, the research and the decision log below are history. A v1 document confirms or replaces each v0 decision.

To use rig, read [the rig guide](guide/README.md) and [what rig writes per harness](harnesses.md). The pages below explain why rig works the way it does.

## Design

| File | Status | Content |
|---|---|---|
| [design/rig-v1-concept.md](design/rig-v1-concept.md) | v1 concept, current | Assumptions for review (Z1 to Z12, P1 to P6), the five nouns and four operations, domains and steps, artifacts, four layers, vendored versus ported content, why seeding is deterministic, roadmap, trade-off register. |
| [design/rig-v1-first-seed.md](design/rig-v1-first-seed.md) | v1 design, current | Config repo layout after the first seed, the `craft` install layout per harness, the pack and lock data shape, the first end-to-end test, the maintainer flow on a new upstream commit, the type sketch and module map, the synthesis decision, prototype evidence. |
| [design/rig-design-draft.md](design/rig-design-draft.md) | v0 draft design (v4), history | Composition and pack scope, core, providers, model table, router and step-slots, product pack, safe seeding and checks, frame, observability and self-feedback, commands and six v0 slices, findings table. |
| [design/rig-architecture.md](design/rig-architecture.md) | v0 architecture, implemented. Pipeline, gate, journal and scope sections stay valid for v1 | CLI usage and three traced cases, config and state schemas, file ownership, type sketch, module map and boundary test, pipeline, read-set placement, cells and adopt, journal and recovery, gate, scope, `/craft`, rationale, scored assumptions. |
| [assumptions-and-open-questions.md](assumptions-and-open-questions.md) | Living record | Verified facts, scored assumptions with probes, overall confidence, open questions for the user. |

## Plan

| File | Status | Content |
|---|---|---|
| [plan/v1-first-seed-prs.md](plan/v1-first-seed-prs.md) | Program plan, in progress: `subtract`, `links`, `vendor` and `port` merged (#35 to #38), `mode` and `seed` open | Six PRs to the first seeded rig: `subtract`, `vendor`, `links`, `mode`, `port`, `seed`. Each PR has unit cases, live lanes on real harnesses and a `rig plan` wall-time budget. |
| [plan/v0-slices.md](plan/v0-slices.md) | v0 plan, delivered | v0 in six vertical slices: nine harness probes, read-only doctor, owned-file writer, models, supply chain and scope, observability. Shared test strategy, done-checks per slice, guarantee map, plan risks. |
| [plan/v0-prs.md](plan/v0-prs.md) | v0 program plan, delivered | The rest of v0 as small PRs in dependency order. Each PR has unit cases, live seed cases on real harnesses, a `rig plan` wall-time budget and its merge steps. Appendices hold the prototype evidence, rejected alternatives, risks and reading list. |

## Research

| File | Status | Content |
|---|---|---|
| [research/2026-11-04-prior-art.md](research/2026-11-04-prior-art.md) | Research record | Skill managers and sync tools, distro rules, native slot support, Harness², testing tools. |
| [research/2026-11-04-harness-surfaces.md](research/2026-11-04-harness-surfaces.md) | Research record | Claude Code, Codex, omp, Cursor, pi and Hermes formats, install, namespacing, budgets, model config, adapter fields. |
| [research/2026-11-04-upstreams.md](research/2026-11-04-upstreams.md) | Research record | pstack, gstack, cursor/plugins, superpowers and OpenSpec, and the writing chain comparison. |
| [research/2026-11-04-routing-and-context.md](research/2026-11-04-routing-and-context.md) | Research record | Router evidence, harness-native routing, context and caching, proposed budgets, scanner survey, observability sources. |

## Decision log

The v1 concept supersedes 0007 to 0010 (workflow providers, step-slots, the router slot), and changes 0013 (rig vendors pstack instead of reusing an installed copy). It changes 0016. The name `/craft` returns as the v1 mode skill, and the `/pm` alias stays removed. The other records stand until a v1 document replaces them.

| Record | Status | Decision |
|---|---|---|
| [0001](decisions/0001-name-rig-and-rigyard.md) | Accepted | Name the project rig and the organization rigyard. |
| [0002](decisions/0002-generic-repo-private-overlay.md) | Accepted | Generic repository, private content in an overlay. |
| [0003](decisions/0003-copies-and-lockfile.md) | Accepted | Copies pinned by a lockfile, not symlinks. |
| [0004](decisions/0004-packs-and-targets-as-data.md) | Proposed | Packs and targets are data, no code plugins. |
| [0005](decisions/0005-sealed-core.md) | Proposed | A named, sealed core with four customization operations. |
| [0006](decisions/0006-one-gate-before-apply.md) | Proposed | One gate before every write, no skip flag. |
| [0007](decisions/0007-workflow-providers-and-step-slots.md) | Proposed | One workflow provider per project, step-slots for narrow contracts. |
| [0008](decisions/0008-per-project-provider-selection.md) | Accepted | Select the workflow provider per project, by explicit declaration only. |
| [0009](decisions/0009-openspec-proof-restrictive-plugin-stretch.md) | Accepted (priority), threshold Proposed | OpenSpec proves pluggability, a restrictive SDLC plugin is a stretch. |
| [0010](decisions/0010-router-slot-static-table.md) | Accepted | Router as a core slot with a static table and escalation. |
| [0011](decisions/0011-one-model-table.md) | Accepted | One model table with fast swap, model and effort values only. |
| [0012](decisions/0012-token-budgets-and-cache-bust-lint.md) | Proposed | Token budgets and a cache-bust lint in the gate. |
| [0013](decisions/0013-reuse-pstack-principles.md) | Proposed | Reuse pstack principles in v0. |
| [0014](decisions/0014-build-rig-borrow-from-apm.md) | Proposed | Build rig, borrow ideas from APM. |
| [0015](decisions/0015-test-doubles-per-kind.md) | Proposed | Fixture packs and fixture HOME yes, gate stubs no, hook simulation later. |
| [0016](decisions/0016-entry-command-craft.md) | Accepted | Entry command `/craft`, with `/pm` as a temporary alias. |
| [0017](decisions/0017-per-pack-scope-no-context-inference.md) | Accepted | Per-pack scope, chosen by the user, with no context inference. |
| [0018](decisions/0018-four-tiers-and-second-opinion-slot.md) | Accepted | Four model tiers, and a second-opinion step-slot for cross-family judgment. |
| [0019](decisions/0019-claude-aliases-with-optional-pins.md) | Accepted | Claude tiers as aliases, with optional pinned ids. |
| [0020](decisions/0020-cursor-in-v0.md) | Accepted | Cursor is a v0 target, pi and Hermes move to v1. |
| [0021](decisions/0021-observability-and-self-feedback.md) | Accepted | Observability from transcripts, and self-feedback that the user approves. |
| [0022](decisions/0022-generic-telemetry-check.md) | Accepted | A generic telemetry check in the gate. |
| [0023](decisions/0023-repository-identity.md) | Accepted | Repository commit identity and visibility. |
| [0024](decisions/0024-measure-per-turn-context-hook-first.md) | Accepted | Measure a per-turn context hook first, decide on disabling it later on data. |
| [0025](decisions/0025-typescript-native-type-stripping.md) | Accepted | TypeScript through Node native type stripping, a strict tsc ratchet in CI, no runtime dependencies. |
| [0026](decisions/0026-product-pack-in-v0.md) | Accepted | The product pack (`/oh`) is back in v0. |

"Accepted" means the user stated or agreed to the decision. "Proposed" means the design work recommends it and the user has not confirmed it.
