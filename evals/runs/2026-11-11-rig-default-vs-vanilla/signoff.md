# Orchestrator sign-off (recorded 2026-11-11T20:09:28Z, before the first non-probe trial)

Signed off by the orchestrator, relayed in the task brief to the run agent. prereg.md sha256 999e921364a988dbe2cf65659716382026333709ef8fd23f77d2c6aacb0062c3.

1. The 5-line path rewrite `~/.claude/` -> `.claude/` in rules/rig-frame.md (arms/rig/frame-rewrite.diff) is approved. It is a recorded difference from a real user install.
2. Set B (rig-repo fixtures d3, ab, st; WITH_GEN=1) is NOT run: an agent could run `rig apply` against the real HOME. Set A only: fx3 and fx4b, arms vanilla / rig / rig-told, models opus (default effort) and sonnet (--effort medium), n=6, 72 trials, cap 90.
3. Run-time constraint from the orchestrator: at most 2 Claude runs at once. The first chunk therefore uses --conc 2, not the plan's 3 (deviation from run-plan.md).
4. Rate/usage limits: wait 10 minutes and retry under the missing-trial rule; each attempt recorded.
