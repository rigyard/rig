# Docs review, 2026-11-04

Independent review of `docs/` (design Draft v4, decisions 0001-0023, assumptions, README) against the binding decisions recorded in the session notes. Status: open items are inputs for the architecture session. Items marked "fixed" were corrected in a follow-up edit.

Verdict: a fresh session can plan from these docs once the blocking items are fixed. The generic-repo grep is clean.

## Blocking (a decision is missing or contradicted)

1. (fixed) `design/rig-design-draft.md:459-461` hard-codes "No declaration: pstack" and "use pstack" in the frame. This contradicts `decisions/0008` ("frame is provider-agnostic") and the configurable `default_provider` (`design:46,84`). Render the default instead.
2. (fixed) The decision to measure the per-turn context hook first and disable it later on data appears only as a findings row (`design:619`). It has no decision record.
3. (fixed) The orchestrator-mode entry command `/boss` is a rig command next to `/craft` and `/oh`, but no doc mentions it.

## Important ambiguities (for the architecture session)

4. The CVE path never closes in v0. `cve` blocks when there is no cache (`design:364`, `0006:20`). `0003:15` calls the OSV refresh a v0 network operation, `design:589` defers "online CVE refresh" to v1, and no command in `design:560-574` runs it. Every pack with a manifest blocks unless `osv-scanner` is installed, and that dependency is undeclared.
5. The budget hook meter runs third-party hooks during `audit` (`design:384-385`, `0012:16`). That conflicts with "every check runs offline" (`design:370`) and executes unaudited code. It also uses "fixture HOME", a test concept (`design:422`).
6. Schemas are named but not specified: the target record ("closed enum fields", `0004:12`), the full `pack.json`, `rig.lock.json`, `installed.json`, and the `metrics.jsonl` line.
7. Agent-body ownership is unclear. Codex `whole` renders `developer_instructions` "from the agent body" (`design:253`); Cursor agents use `frontmatter` in an empty dir (`design:256`); first-run adopt only covers existing files (`design:267-271`). Who creates fleet agent files, and does the `own` pack own their bodies?
8. The read-set rule conflicts with per-harness rendering. Cursor skips skills that `~/.claude/skills` delivers (`design:109,413`), but skills render per harness (`design:341`), so Cursor gets the Claude rendering.
9. `hybrid` scope has only a proposed definition (`design:66`, `0017:24`, OQ8). The delivery table (`design:68-74`) has no hybrid mechanism on any harness.
10. The Cursor frame has a probe but no fallback (`design:449`, A24). omp has one (A2). On Cursor the frame is the only local provider declaration (`design:95`).
11. pstack on Cursor is unpinned. The pin record is Claude-only (`design:149,156`), and `doctor` reads only the Claude plugin registry.
12. No policy for existing files that carry no model values (core `rules/working.md`, `rules/writing.md` landing on hand-written files). Adopt covers model-bearing files only (`design:267`).
13. The alias-resolution report moved from `doctor --live` to `rig stats` (`design:242`, `0019:16`) without a recorded change.

## Minor

14. Eight top-level commands (`design:560-574`), with no init, remove or uninstall. The 7-command limit is not stated in the docs.
15. The mapping from a pinned model id to a display name (descriptions, roster cells) is unspecified (`design:250-251`, `0011:15`).
16. The frame text (`design:459-460`) omits the rule that an overlay entry beats a `rig-project:` line (`design:82-84`).
17. A "router" stub is listed in core (`design:113`, `0005:13`), but section 8 has only two skill stubs.
18. An empty `second-opinion` stub still costs a listing entry (`design:289`), while its frame line is omitted (`design:485`).
19. The telemetry record has no field for "telemetry on by default" (`design:148,366`).
