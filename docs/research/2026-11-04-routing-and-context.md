# Routing, context economics and the pre-seed gate

Status: research record, 2026-11-04. Three researchers produced the inputs. An orchestrator verified the items marked "verified". Paper and repository URLs were not recorded, so each claim names its source by title only. Numbers in the "Proposed budgets" section are researcher proposals. They are not vendor limits.

## Summary

- The evidence does not support a learned or classifier router for coding work today. A static role table with escalation on a real failure is the defensible default ([decision 0010](../decisions/0010-router-slot-static-table.md)).
- Change effort inside a session. Change the model only at a dispatch boundary, because a model switch loses the prompt cache.
- rig can measure context cost statically in the `budget` check. Live numbers come from harness transcripts, with OpenTelemetry as a fallback (section "Observability sources").
- The pre-seed gate needs six checks. All run offline except the CVE lookup.

## Router evidence

| Source | Result | Limit |
|---|---|---|
| RouteLLM (paper) | 3.66 times cheaper at 95% of GPT-4 quality on MT-Bench. MMLU 1.41 times at 92%. GSM8K 1.49 times at 87%. | Needs in-domain labels. MT-Bench only for the headline number. |
| LLMRouterBench (2026) | Many routers do not beat the best single model. OpenRouter routing scored -24.7%. A kNN router matches learned routers. | General tasks, not coding. |
| TwinRouterBench (preprint) | 100 SWE-bench cases. A trained router kept quality at 53% lower cost. Opus used as a router predicted "high" on 7 of 147 hard steps. Rule-based tiering was the most expensive. | The only coding evidence. Small sample. Preprint. |
| Arch-Router | Reports accuracy as a match to policy labels. | Not task outcomes. |
| Ares | A per-step effort router. 30% to 50% fewer tokens on TAU-Bench. | Not coding. |

Vendor controls:

- Anthropic effort is manual. Adaptive thinking runs under an effort ceiling. The documentation suggests `low` for subagents. On newer models a change of effort per message keeps the cache.
- OpenAI `reasoning.effort` is manual. `configuration_update` keeps the cache.

Conclusion: use a static table plus escalation on a real gate. Calibrate with sweeps on your own tasks. Add a classifier only after rig logs dispatch outcomes (role, model, effort, gate result) that can evaluate one.

## Harness-native routing

| Harness | Where model and effort live |
|---|---|
| Claude Code | Agent frontmatter `model` and `effort`. Agent tool `model` and `effort` parameters (`effort` verified in a live tool schema). Order: tool parameter, frontmatter, `CLAUDE_CODE_SUBAGENT_MODEL`, main model. `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` wins over all. Aliases resolve to the current model, so alias-based configuration may need no re-render on a release. `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU,FABLE}_MODEL` remap aliases. |
| Codex | `~/.codex/agents/*.toml` with `model` and `model_reasoning_effort`. `[agents] default_subagent_model` and `default_subagent_reasoning_effort`. `codex --profile` overlay. |
| omp | `~/.omp/agent/config.yml` `modelRoles` (`task`, `advisor`, `judge`, `plan`, `default`) as `provider/model:effort`. `defaultThinkingLevel`. |
| OpenCode | Per-agent `model` and a passthrough `reasoningEffort`. |
| pi | Depends on the extension. |

A runtime classifier is possible only through a proxy: claude-code-router (about 38k stars), LiteLLM, ccproxy. ccproxy's own README flags a terms-of-service risk. A proxy needs an API key and breaks the cache on each switch. Not recommended.

## Context economics and caching

Documented behavior (Claude Code, Anthropic API):

- The skill listing gets 1% of the context window. Each entry has a cap of 1,536 characters. On overflow the least-invoked descriptions go first.
- After compaction each invoked skill keeps its first 5,000 tokens, from a 25,000-token pool. Invoked bodies stay for the whole session.
- Cache write costs 1.25 times the input price for the 5-minute TTL and 2 times for the 1-hour TTL. Cache read costs 0.1 times (0.05 times on Opus and Sonnet 5.5, 0.025 times on Fable 5.1).
- Cache order: tools, then system, then messages. Any change in a prefix pays again. A model switch loses the cache.

Measurement tools:

- OpenTelemetry metric `claude_code.token.usage` with input, output, cacheRead, cacheCreation, model and query_source.
- `/context` and `/doctor` in Claude Code.
- `claude plugin eval` with token counts (documentation not found, unverified).
- skill-creator benchmark mode.

Upstream precedent: gstack enforces a byte ceiling per generated skill and keeps a size ledger and a token bill. pstack measures nothing. See [upstreams](2026-11-04-upstreams.md).

## Proposed static metrics for the `budget` check

Static, computed from files:

1. Always-on tokens per harness.
2. Listing characters against the harness budget.
3. Largest and mean body tokens, and the count of bodies over 500 lines.
4. Worst-case co-load against the 25,000-token compaction pool.
5. Hook output tokens.
6. Cache-bust lint: timestamps, git status, random order or per-session paths in text that sits in the prefix.
7. Reference depth.

Live, from telemetry later: cache hit rate, bust frequency, real skill-load cost, trigger accuracy.

## Proposed budgets

Source: researcher judgment in research summary R3 (routing), 2026-11-04. These are proposals for rig's own lint thresholds. No vendor sets them.

| Metric | Proposed value |
|---|---|
| Always-on core per harness | 4,000 tokens or fewer |
| Hook output | 300 tokens or fewer |
| Skill description | 300 characters or fewer |
| Skill body | median 1,500 tokens or fewer, cap 5,000 tokens and 500 lines |
| Listing per harness | 8,000 characters or fewer |
| Per-turn injections | zero |
| Cache hit rate | 90% or more |
| Co-load | core plus the 3 most common skills fit the 25,000-token pool |
| Codex `AGENTS.md` | target 8 KiB or less. The 32 KiB cap comes from a third-party source (unverified). |

`doctor` should also measure text that hooks inject at session start and on each prompt, because a per-turn hook breaks the zero-injection budget.

## Pre-seed scanner survey

Source: scanner research, 2026-11-04. Each tool is optional. If a tool is absent, rig skips it with a warning, except where a check says it blocks.

| Check | Tool | Offline | Severity |
|---|---|---|---|
| Dependency CVEs | `osv-scanner` (Go binary, Apache-2.0) | Yes, after a database download | Block high and critical |
| Secrets | `gitleaks dir` (MIT) | Yes | Block |
| Dangerous executable content | In-house regex: `curl \| sh`, eval of fetched data, base64 exec, `postinstall`, `chmod +x` binaries. Cisco `skill-scanner` static analyzers if installed (Apache-2.0, Python). | Yes | Block pipe-to-shell and eval of fetched data. Warn on the rest. |
| Prompt injection and hidden text | In-house lint: zero-width and bidi characters, HTML comments, "ignore previous instructions", base64 blobs. `skill-scanner` if installed. | Yes | Block hidden Unicode. Warn on phrases. |
| Network endpoints | Extract URLs and hosts and compare with an allowlist. | Yes | Warn on new hosts. Block raw IPs, paste hosts and webhook hosts. |
| License | SPDX allowlist. A LICENSE file must exist. | Yes | Block a missing or disallowed license. |

Also a rug-pull guard: a content hash per pinned SHA. Snyk Agent Scan is opt-in only, because it sends content to the vendor and needs a token. Anthropic's skill documentation says to audit every bundled file and to watch for skills that fetch external URLs.

## Minimal gate for v0

The design draft v4 adopts this set and adds `injection`, `budget` and `private_terms`. See [the design draft](../design/rig-design-draft.md), section "Safe seeding".

- Checks: `pin`, `exec`, `secret`, `unicode` with pipe-to-shell, `license`, `cve`, plus `telemetry` for providers.
- `cve` runs only when a dependency manifest exists. With no scanner and no cached result it blocks.
- Every check runs offline except the OSV refresh.
- The heuristic injection check can stop careless attacks only. It cannot be complete. If it warns on more than 20% of pstack's 58 skills, demote it to info (proposed threshold, from synthesis v1).

## Observability sources

Source: web research and a local log-format survey, 2026-11-04. The survey read metadata fields only, no message content.

### External tools

- **ccusage.** Reads local files for Claude Code, Codex, pi, Hermes and OpenCode. Daily, session and block views, cache read and cache create columns, USD from the LiteLLM price table, `--offline`, `--json`, `--by-agent`. No per-skill, per-tool, per-hook or compaction view.
- **Claude Code OpenTelemetry.** `CLAUDE_CODE_ENABLE_TELEMETRY=1`. Metrics `token.usage` by type and `cost.usage` in USD, with attributes `skill.name`, `plugin.name`, `agent.name` and MCP server or tool. Events `api_request` with cost and the 5-minute and 1-hour cache split, `tool_result` with success, duration and error. Content export is off by default. `OTEL_LOG_TOOL_DETAILS=1` adds tool details. Exporters: Prometheus on localhost or OTLP. Claude Code computes the cost.
- **Codex OpenTelemetry.** `[otel]` exporter `none`, `otlp-http` or `grpc`. Events `api_request`, `tool_result` and others. No documented token or cost metric. `[analytics] enabled=false` turns analytics off.
- **Tracing plugins.** Langfuse plugins for Claude Code and Codex (the Codex one parses rollout files and tags `skill:<name>`). Phoenix for Claude Code. Community pi extensions read session JSONL.

What none of them gives: a cross-harness join by session, Codex and omp skill attribution, hook-injection and compaction cost, unused-skill and error analytics, and an A/B view with and without a skill.

### Local formats

| Harness | Files | Fields of interest | Gaps |
|---|---|---|---|
| Claude Code | `~/.claude/projects/<slug>/<session>.jsonl`, `subagents/agent-<id>.jsonl`, `.meta.json` | Per-request usage (input, output, cache read, cache creation with 5-minute and 1-hour split, thinking tokens), model per request, request parameters including context management, `cost-state` in some sessions, `tool_use` and `tool_result` `is_error`, Agent `tool_use` with `subagent_type`, `model`, `effort` and result `agentId` and `resolvedModel`, Skill `tool_use`, `skill_listing` and `skill_mention` attachments, `attributionSkill` and `attributionPlugin`, `hook_success` with output, exit code and `durationMs`, `compact_boundary` with pre and post tokens, turn duration | Usage repeats per content block: dedupe by `message.id`, otherwise totals run about 3 times too high. Subagent usage is in separate files. Transcripts expire after `cleanupPeriodDays`, 30 days by default. |
| Codex | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`, `state_5.sqlite` table `thread_spawn_edges` | `token_count` last and total usage (input, cached input, output, reasoning), model per turn, tool calls by `call_id`, subagent edges, compaction events | No cache write, no cost, no compaction sizes, no skill or hook records. No automatic cleanup seen. |
| omp | `~/.omp/agent/sessions/**.jsonl`, `~/.omp/stats.db` | Usage with cost recorded by omp, model per request, `contextSnapshot` (prompt tokens, tool-schema tokens, compaction epoch), tool results with `isError` and `wallTimeMs`, compaction tokens before and after, skill-prompt and injection records | `stats.db` is preaggregated but lags. `agent.db` holds credentials: never read it. |
| Cursor | `~/.cursor/projects/*/agent-transcripts/*.jsonl`, `~/.cursor/ai-tracking/ai-code-tracking.db` | Tool calls, subagent tree, per-request model | No tokens or cost. The `chats/` store holds content: never read it. |

Derivability (D derivable, P partial, N not available, ? unverified):

| Metric | Claude Code | Codex | omp | Cursor |
|---|---|---|---|---|
| Tokens | D | P | D | N |
| Cost in USD | P | N | D | N |
| Cache hit rate | D | D | D | N |
| Cache write | D | N | D | N |
| Tool error rate | D | P | D | ? |
| Skill loads | P | N | P | ? |
| Hook output bytes | D | N | N | N |
| Subagent fan-out | D | D | D | D |
| Compaction | D | P | D | N |

Parse defensively: undocumented fields drift between versions. Date each record by its timestamp, not by file mtime.

