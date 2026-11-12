# Preregistration amendment 1 (H-A)

Written 2026-11-11T20:06:55Z, before any trial. No `claude` process has run for this hypothesis. `results/` is empty.
Amends `prereg-audit.md` (sha256 6a213270e6f7e579943cda7a7f7713914028b7fdf1f854ed1d5b83751105f80a, unchanged).

## What changes

The runner is now `run-audit-v2.ts` (sha256 33f5cbf27e131cd6f356b034c5d496d9361aa8fc2060365ef33c1dcb88bc83e1). It is a copy of `run-audit.ts` with only the permission setup changed, identically in both arms.

| Item | Before (`run-audit.ts`) | After (`run-audit-v2.ts`) |
| --- | --- | --- |
| permission mode | `bypassPermissions` | `acceptEdits` |
| `--allowedTools` | none | the H-P allowlist from `../run-hyp.ts` (`HP_TOOLS`): `Bash(node *)`, `git`, `ls`, `cat`, `grep`, `find`, `java`, `curl`, `mkdir`, `cp`, `mv`, `chmod`, `sed`, `echo`, `head`, `tail`, `wc`, `diff`, `sort`, `which` (each as `Bash(<cmd> *)`). It already contains node, java and curl. |
| `--disallowedTools` | `git push`, `gh`, `sudo`, `~/.claude` read, edit, write, three Bash `.claude` patterns | unchanged |
| probe check | `permissionMode == bypassPermissions` | `permissionMode == acceptEdits` (forced by the flag change) |
| selfcheck line | flags pin `bypassPermissions` | flags pin `acceptEdits` (forced by the flag change) |

Everything else is byte-identical: prompts, model, 40 turns, 6 USD cap, 1500 s kill, isolation flags, fixture, grader, analysis, decision rule, exposure rule. Verify with `diff run-audit.ts run-audit-v2.ts` (4 hunks).

## Why

`bypassPermissions` gives every unattended trial the whole machine. The orchestrator rejected that. The H-P setup limits tools to an allowlist.

## Consequences, stated before data

- Writes to `.claude/` in the work dir are a protected path. They are expected to be denied in both arms. The told arm's skill-generation deliverable is therefore likely to fail, as in H-P. The grader scores only `FINDINGS.md` and `repro/*.ts`, so the score does not need the skill file. This makes the test one of "told with a restricted skill workflow" against none. A null or negative result must be read with that in mind.
- Bash commands outside the allowlist, and compound commands, may be denied in both arms. Denial counts per arm are recorded as exploratory. `.claude` write denials are counted from the raw logs.
- The delivery gate, usable-trial rule, decision rule and turn-limit reading in `prereg-audit.md` stay as written. The "Uncertainties" row on `bypassPermissions` is void. Its falsification probe is replaced by the `acceptEdits` check in the probe.
- Execution: Claude concurrency 1 (three other Claude experiments run on the subscription), not 3. No design effect.

## Files

`SHA256SUMS-amend` lists `run-audit-v2.ts` and this file. `SHA256SUMS` stays unchanged and must still pass.
