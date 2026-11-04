# Assumptions and open questions

Status: living record, last updated 2026-11-04 for design draft v4. It collects every scored assumption from synthesis v1 to v3, the original plan, the two design candidates and the v3 review. Verified facts are not scored. Scores run from 1 to 10. A score below 7 means the item needs a probe before you build on it.

## Verified, not scored

- `enabledPlugins` precedence: the highest-precedence source that mentions a plugin id wins (Claude Code docs, page plugins/loading). A live probe is still open (A31).
- Codex `AGENTS.md` has no import syntax.
- OpenSpec 1.5.0 command paths for Claude Code and Codex, its telemetry payload (command name, version, surface, anonymous id, IP off) and its opt-out variables.
- The example restrictive plugin's hooks, and that it ships `package.json` without a lockfile.
- pstack 0.15.36 has no hooks and no `package.json`.
- The Claude Code Agent tool takes an `effort` parameter. Its `model` parameter accepts aliases only.
- Claude aliases resolved to full ids in subagent transcripts (`message.model`), with no alias-remap variable set.
- Codex `~/.codex/agents/*.toml` role files and the `[agents]` defaults (Codex source, via documentation search).
- omp `modelRoles` keys (`task`, `advisor`, `judge`, `plan`, `default`) and the `:effort` suffix.
- Headless flags. Claude: `claude -p --output-format`. omp: `omp -p`, `--mode text|json|rpc`, `--model`. Cursor: `cursor-agent -p --output-format json|stream-json`, `--model 'x[effort=high]'`, `--mode plan|ask`, `--list-models`, `--plugin-dir`, `--trust`, `--workspace`.
- Claude Code transcripts repeat a message's usage on each content block. Subagent usage lives in separate files.
- Cursor skill, rule, agent, plugin and hook locations, from Cursor documentation and a local layout survey.
- Always-on text on one machine: 25,346 bytes on Claude Code. One prompt hook injects 16,698 bytes per discovery prompt in an indexed repository and 0 bytes elsewhere, into the user message.

## Scored assumptions

| # | Assumption | Score | Reason | Blast radius | Resolution path | Falsification probe |
|---|---|---|---|---|---|---|
| A1 | Frame prose stops the model from acting on text injected by a provider that is not active. | 6 | Injected text marked as critical competes with user instructions. `enabledPlugins` does the main isolation work. | A phase table appears in a project that did not declare that provider. | Fallback only. Test in v1 with promptfoo. | Scratch repository with the restrictive plugin enabled and an `openspec/` directory. Count sessions that open with the phase table. |
| A2 | The omp user-level instructions file is `~/.omp/agent/AGENTS.md`. | 5 | Seen in binary strings only. | No frame in omp. | Fallback: omp loads `~/.codex/AGENTS.md`. | Write the file, ask omp to quote its first line. |
| A3 | Retired. Footprints no longer select a provider ([decision 0008](decisions/0008-per-project-provider-selection.md)). | | | | | |
| A4 | Hidden machine-wide units cost nothing in a project that does not use them. | 7 | Hidden units have no listing entry. | Listing budget or name clashes grow with every hidden pack. | `budget` check counts listing per harness. | Count listing characters with and without the hidden packs. |
| A5 | The plugin cache tree hash stays stable across harness restarts. | 5 | The harness may rewrite its cache. | Noisy `doctor`. | Warn-only. The primary pin check is `installed_plugins.json`. | Hash the cache before and after `/reload-plugins`. |
| A6 | The `office-hours` port fits one slice. | 5 | 379 template lines, 12 bin mentions, 18 placeholders. | Slice 5 slips. | Budget two days. | Search the template for `gstack-` and `{{` first. |
| A7 | "Two real providers within a month" is the right trigger for a new slot. | 6 | It prevents slots without a second provider. | A useful slot waits. | Review after a month. | List the steps where you ran two different tools. |
| A8 | OpenSpec delivers Claude Code skills somewhere in addition to commands. | 5 | Not found in `dist`. The commands path is verified. | `doctor --project` misses generated files. | Inspect after init. | `openspec init` in a scratch repository, then `git status`. |
| A9 | The heuristic injection check is quiet enough on pstack's 58 skills. | 5 | Rules often quote banned phrases. | Ack fatigue. | Demote to info above 20% warnings (proposed threshold, from synthesis v1). | Run the check over the pstack cache and over a rules directory. |
| A10 | rig needs no own principles in v0. | 7 | pstack's 24 cover the frame's invariants. | Instructions repeat across skills. | Review after a month. | Count instructions written twice. |
| A11 | A restrictive SDLC plugin on Claude Code only, absent on Codex, omp and Cursor, is acceptable. | 7 | Such plugins often exist only for Claude Code. | No provider flow on the other harnesses. | User decision. | Ask whether any task under that provider runs on another harness. |
| A12 | Codex accepts `disable-model-invocation`, and `openai.yaml` hides a skill description. | 6 | Not verified. | Codex listing budget overflows. | Slice 1 smoke test. | Install one hidden skill in `~/.codex/skills`, list skills with `codex exec`. |
| A13 | omp collapses duplicates by SKILL.md bytes, not by the whole directory. | 6 | Explorer claim. Codex directories add `agents/openai.yaml`. | A skill appears three times in omp. | Slice 1 check. | Count `explain` in the omp skill list after slice 1. |
| A14 | pi supports headless runs. omp does (verified: `omp -p`). | 6 | pi not checked. | pi smoke tests in v1 fall back to a manual checklist. | Read help output. | `pi --help`. |
| A15 | The Claude Code 1% listing budget is about 8,000 characters at 200k context. | 7 | Tokens versus characters. | Lint threshold off. | Measure. | A `claude -p` probe that asks which rig units the model sees. |
| A16 | A later public release with vendored MIT packs is acceptable. | 5 | MIT allows it with a NOTICE. User rules may carry private content. The repository is private for now ([decision 0023](decisions/0023-repository-identity.md)). | A leak or a license gap. | `private_terms` check, NOTICE, open question 3. | Run the leak grep over the repository before it goes public. |
| A17 | Closed declarative formats cover Claude Code, Codex, omp, Cursor, pi and Hermes without code. | 7 | gstack covers 13 hosts with one record type. Render kinds are core code. | Decision 0004 breaks. | Write `pi.json` and `hermes.json` before the v1 targets. | Hermes leaf folding into `references/`: if it needs a rewrite beyond a copy, the rule breaks. |
| A18 | Node 26 `--permission` can deny network access to the CLI. | 5 | Not tested. | Defense in depth is missing. | Optional layer. | `node --permission -e "fetch('https://osv.dev')"`. |
| A19 | gitleaks, osv-scanner and semgrep emit SARIF 2.1.0. | 7 | Known for some of them. | The SARIF adapter needs per-tool code. | v1 scanners. | Each tool's `--help`. |
| A20 | OSV `querybatch` works from Node `fetch` with no dependencies. | 7 | Plain HTTP POST. | `cve` refresh needs a dependency. | Slice 5. | One POST with a known-vulnerable package. |
| A21 | The proposed token budgets fit real use without constant warnings. | 5 | Researcher judgment. Only the 1,536-character cap and the Codex cap are harness facts. | Warning fatigue, or budgets too loose to matter. | Tune after one month of acks. | Run `audit` on the current tree and count warnings. |
| A22 | pstack on Claude Code honours `~/.claude/rules/pstack-models.md`, although its skills name the `.mdc` rule. | 7 | The rules directory loads as always-on context. Transcripts show no Reads of the Cursor path. | pstack falls back to defaults that the Agent tool rejects. | Slice 3. | Run `/craft` on a toy task and check the first dispatch's `model`. |
| A23 | Cursor does not collapse a skill that it finds in several directories, so rig must deliver each skill once. | 5 | Cursor documents several read paths and no dedupe rule. | Doubled listing on Cursor, or a needless skip rule. | Read-set matrix, slice 1. | Put one skill in `~/.claude/skills` and `~/.cursor/skills`, count listing entries in Cursor. |
| A24 | Cursor loads user-level `~/.cursor/rules/*.mdc` with `alwaysApply: true`. | 5 | Two such files exist locally. Documentation names only project rules and UI User Rules. | No frame on Cursor. | Slice 2 probe. | Write `rig-frame.mdc`, ask Cursor to quote the frame's first line. |
| A25 | A Claude Code plugin from a local marketplace, `false` at user scope and `true` in `.claude/settings.local.json`, loads in that project only. | 6 | Same precedence rule as A31, plus a local-path plugin. | `project` scope fails on Claude Code. | Slice 2. | Install a fixture plugin that way, list skills inside and outside the project. |
| A26 | omp keeps rig's `modelRoles` values when it rewrites `config.yml`. | 5 | The file has a lock file and no comment lines, so omp likely rewrites it. | Rendered values or markers vanish. | Hash in rig state, `keys` render kind. | Change a model in omp, diff the file. |
| A27 | The Codex effort ladder includes `minimal` and `xhigh`, and Cursor accepts `low`, `medium`, `high` in the model string. | 6 | Only `medium` is on disk for Codex. Documentation search showed another value too. | A clamp at the wrong top. | Slice 3. | `codex -c model_reasoning_effort=xhigh exec "hi"`, then `cursor-agent --list-models`. |
| A28 | 4 characters per token. | 7 | Standard estimate for English and code. | Thresholds off by about 20 percent. | Calibrate against usage fields. | Compare an estimate with `usage` input tokens for one known file. |
| A29 | Claude Code keeps transcripts 30 days by default. | 7 | `cleanupPeriodDays` unset, and transcript ages on one machine fit 30 days. | The store misses sessions when `rig stats` runs rarely. | Optional session hook. | Read the setting's documentation, then check the oldest transcript date. |
| A30 | Transcript fields (Skill `tool_use`, `attributionSkill`, `skill_listing`, `cost-state`) attribute skill loads and cost well enough. | 6 | Fields exist. Coverage per session is uneven (`cost-state` only in some). | Self-feedback proposes wrong disables. | OTel only if the probe fails. | Run one session set with Claude OTel on, compare `skill.name` counts and cost with transcript counts. |
| A31 | Project-scope `true` overrides user-scope `false` for a provider plugin in practice. | 8 | Documented rule. The user-scope flip is done on one machine. | The restrictive plugin loads everywhere or nowhere. | Slice 4. | `claude plugin list` in a project that enables it, and in one that does not. |
| A32 | The Codex `AGENTS.md` cap is 32 KiB. | 6 | Third-party source. | Frame truncated on Codex. | `budget` warns at 8 KiB. | Write a 40 KiB file with a canary at the end, ask Codex to quote it. |
| A33 | A per-message effort change keeps the prompt cache. | 7 | Router research says so for newer models. | Escalation costs a cache write. | Slice 6 metrics. | Two dispatches, compare cache read tokens in the transcript. |
| A34 | omp, Codex and Cursor have a session-end hook that `apply` can merge into. | 5 | Claude Code `SessionEnd` is documented. Cursor lists `stop`. Others unknown. | The hook covers Claude Code only. | On-demand `rig stats` works without it. | Read each harness's hook list. |
| A35 | Transcript readers survive harness updates with defensive parsing. | 6 | Formats are undocumented and drift. | Silent wrong totals. | "n/a" for missing fields, a fixture per version. | Re-run slice 6 fixtures after each harness update. |
| A36 | `/craft` renders as a native command on Codex and omp. | 6 | Codex uses `/prompts:<name>` for custom prompts. omp rewrote `/pm` through an extension, which rig cannot ship. | `/craft` missing on two harnesses. | Slice 2. | Install the rendered file, type `/craft` in each harness. |

Overall confidence: 7 out of 10. The data shape, the gate, the provider rule and the model table rest on verified facts and explicit user decisions. The open risks are frame obedience (A1), the omp and Cursor frame paths (A2, A24), Cursor skill dedupe (A23), omp config rewrites (A26) and transcript-based skill attribution (A30).

## Open questions for the user

1. **Core membership.** The small core in decision 0005, or the larger set from design candidate 1 (mode skill, principle leaves, writing skills)? Do language-specific skills belong in the overlay?
2. **CVE without a cache.** On the first offline apply, should `cve` block (current draft) or warn?
3. **Public release.** When does the repository go public, and which vendored packs ship in it?
4. **First vendored pack.** cursor-team-kit or gstack `office-hours`?
5. **Binary name.** `rig`, or `rigctl` to avoid the Homebrew `rig` clash?
6. **Budget severities.** Confirm the proposed rule in decision 0012: block where the harness truncates, warn where text costs money.
7. **Codex pstack channel.** Keep unpinned copies in `~/.agents/skills`, vendor a generated tree for Codex, or skip pstack in Codex?
8. **Hybrid scope.** Is `hybrid` "hidden machine-wide, invocable in the listed projects", or something else?
9. **Cost source.** Where a harness records no cost, should rig compute cost from tokens and a price table that it maintains, or report tokens only?
10. **Alias retirement.** When does the `/pm` alias go: on a date, or when `rig stats` shows no use for a set period?

Machine-level questions (user-scope plugin flags, stale caches, account actions) are tracked outside this repository.
