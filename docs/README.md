# rig docs

rig is a version-pinned agent-skill stack and a seeder for coding-agent harnesses. These docs record the research, the decisions and the current design from the 2026-11-04 design work. A fresh planning session can start from the design draft, the decision log and the assumptions record.

## Design

| File | Status | Content |
|---|---|---|
| [design/rig-design-draft.md](design/rig-design-draft.md) | Draft design (v4) | Composition and pack scope, core, providers, model table, router and step-slots, product pack, safe seeding and checks, frame, observability and self-feedback, commands and six v0 slices, findings table. |
| [design/rig-architecture.md](design/rig-architecture.md) | v0 architecture sketch | CLI usage and three traced cases, config and state schemas, file ownership, type sketch, module map and boundary test, pipeline, read-set placement, cells and adopt, journal and recovery, gate, scope, `/craft`, rationale, scored assumptions. |
| [assumptions-and-open-questions.md](assumptions-and-open-questions.md) | Living record | Verified facts, scored assumptions with probes, overall confidence, open questions for the user. |

## Plan

| File | Status | Content |
|---|---|---|
| [plan/v0-slices.md](plan/v0-slices.md) | Plan, not started | v0 in six vertical slices: nine harness probes, read-only doctor, owned-file writer, models, supply chain and scope, observability. Shared test strategy, done-checks per slice, guarantee map, plan risks. |
| [plan/v0-prs.md](plan/v0-prs.md) | Program plan | The rest of v0 as small PRs in dependency order. Each PR has unit cases, live seed cases on real harnesses, a `rig plan` wall-time budget and its merge steps. Appendices hold the prototype evidence, rejected alternatives, risks and reading list. |

## Research

| File | Status | Content |
|---|---|---|
| [research/2026-11-04-prior-art.md](research/2026-11-04-prior-art.md) | Research record | Skill managers and sync tools, distro rules, native slot support, Harness², testing tools. |
| [research/2026-11-04-harness-surfaces.md](research/2026-11-04-harness-surfaces.md) | Research record | Claude Code, Codex, omp, Cursor, pi and Hermes formats, install, namespacing, budgets, model config, adapter fields. |
| [research/2026-11-04-upstreams.md](research/2026-11-04-upstreams.md) | Research record | pstack, gstack, cursor/plugins, superpowers and OpenSpec, and the writing chain comparison. |
| [research/2026-11-04-routing-and-context.md](research/2026-11-04-routing-and-context.md) | Research record | Router evidence, harness-native routing, context and caching, proposed budgets, scanner survey, observability sources. |

## Decision log

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

"Accepted" means the user stated or agreed to the decision. "Proposed" means the design work recommends it and the user has not confirmed it.
