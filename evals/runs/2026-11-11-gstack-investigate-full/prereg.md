# Preregistration H-G-full: does the FULL gstack /investigate help Opus on bug-fix tasks?

Written 2026-11-11 (UTC), after one plumbing smoke trial and before any batch trial. Throwaway experiment. Replicates `../prereg-HG.md` with the shipped skill instead of the stripped copy. Everything not listed under Deviations is unchanged from `../prereg-HG.md`, which stays the reference text (arms, prompts, fixtures, graders, model, flags, interleaving, metrics, decision rule).

## Why this run exists

The earlier H-G result (told 8/16 vs none 13/16; fx4b 0/8 vs 5/8; verdict "not contradicted at n=8") used a copy of `investigate` with 183 non-blank lines removed (preamble, Prior Learnings, Scope Lock bash, skill-start/end, learnings logging, contract text). A fair challenge: the removed parts might carry the effect. This run installs the shipped skill, byte-identical except for path strings, and repeats the experiment.

Skill source: gstack commit `b4068209809315ab1578c78e33e73512b29749ca`, extracted with `git archive`, no build, no `bun install`, no network.

## Claim and testable form (unchanged)

Told arm (`/investigate ` prefix, skill installed as a project skill) does not pass more often than the none arm, and the told arm costs more per pass.

## Arms, prompts, fixtures, graders, model, flags (unchanged)

- told: `/investigate ` + task text, `.claude/skills/investigate/SKILL.md` present. none: task text, no skill. Prompts verbatim as in `../prereg-HG.md`.
- fixtures fx4b (storefront) and fx3 (member-directory), graders and tree hashes as in `../prereg-HG.md` (re-verified today, see hash table).
- `--model opus`, `--max-turns 30`, `--permission-mode acceptEdits`, `--no-session-persistence`, `--setting-sources project,local --strict-mcp-config`, subscription login, per-trial timeout 600 s.
- n = 8 per arm per fixture, 32 trials. Order: for n = 1..8, per fixture (fx4b, fx3), the two arms are queued together; within-pair order alternates (odd n: told first). Concurrency 1 (two other Claude sets run tonight), instead of 3.
- None-arm trials are fresh runs of today. Old none trials are not reused in the decision. The old none and old told trials appear only in the descriptive comparison block.

## How the full skill is installed (deviations from `../prereg-HG.md`, all stated before data)

1. Path rewrite only. The skill hard-codes `~/.claude/skills/gstack` and `$HOME/.claude/skills/gstack`. Real `HOME` is kept (a fake HOME logs `claude` out). In `investigate/SKILL.md` (32 occurrences) and `investigate/sections/preamble.md` (7) every such string is replaced by the absolute path of the extracted tree. The bins resolve themselves relative to `$0`, so no bin is edited. Proof: `prove-paths.mjs` checks, line by line, that old and new differ only in those strings, re-applies the inverse per occurrence and byte-compares to the saved original, and `diff -rq` against a fresh `git archive` lists exactly those two files (`path-rewrite-proof.txt`, `path-rewrite.diff`).
2. The extracted tree lives at a neutral path outside `hyp/` (the `full/gstack-b406820` entry is a symlink to it), because the model reads that absolute path and a path containing "eval" or "hyp" would leak the experiment. Work dirs are also under a neutral path.
3. Per trial, fresh `GSTACK_STATE_ROOT` and `GSTACK_LEASE_DIR` next to the work dir, seeded in both arms with `config.yaml` (`telemetry: off`, `update_check: false`, `routing_declined: true`, `cross_project_learnings: false`) and the six onboarding markers, so the run behaves like a returning user. Network paths: the update check is off by config and telemetry is off by config (there is no env var). No `settings.json` is written in either arm, so the optional timeline Stop hook is absent in both arms. The skill's own frontmatter hooks (freeze check) stay in place.
4. The allowlist is the earlier one plus five entries, identical in both arms: `Read(//<tree>/**)`, `Bash(<tree>/bin/*)`, `Bash(echo *)`, `Bash(test *)`, `Bash([ *)`. Without them the skill's own preamble bash blocks would be permission-denied in `-p` mode, which would measure the harness and not the skill. Denials are still counted per arm.
5. Exposure signals. Added `skillStart`: a Bash call `gstack-skill-start --skill "investigate"`. `skillRead` also matches a path containing `investigate/sections/` (the sections now live in the tree, not under `skills/investigate`). `exposedFinal` = skillCall OR skillRead OR skillStart OR markerSeen OR first-turn token excess. The token threshold is half of the full SKILL.md size (24,622 bytes) divided by 4 = 3,078 tokens. Delivery gate unchanged: at least 6 of 8 told trials exposed in each fixture, and no none trial exposed or listing the skill in init.
6. `RUN_CAP=35` runs for the batch (32 trials, 3 retries). The cap of 36 includes the one smoke trial.
7. Smoke trial (counted in the 36, not in the data). One told run on fx4b before this file. Result seen by the experimenter before writing: the skill ran its bins (skill-start, context-recovery, freeze acquire and release, skill-end) without error, `SESSION_KIND: interactive`, no AskUserQuestion, no permission denial, no `last-update-check`, no `analytics/skill-usage.jsonl`, real `<home>/.gstack` unchanged. The trial failed the grader (0 bugs fixed). Because the experimenter saw this, the batch re-runs fx4b-told-1 from scratch and the smoke trial is excluded from every count. Transcript kept in `smoke/`.

## Analysis and decision rule (verbatim from `../prereg-HG.md`)

Pass rate per arm and fixture; told minus none pooled with a 95% percentile CI from a stratified bootstrap (10,000 resamples, seed 20261110, mulberry32); per fixture difference, CI and two-sided Fisher p. Cost per pass = total `total_cost_usd` of usable trials in the arm divided by passes; ratio told over none pooled and per fixture (zero-pass handling as in the earlier file). Intent to treat is primary; per-protocol (exposed told plus all none) is a sensitivity analysis. Code: `analyze-full.mjs` (derived from `analyze-hyp.mjs`; the diff is exposure, results dir, hygiene lines and the comparison block, none of which touch the decision logic).

Decision rule:

- H-G REJECTED if the pooled pass-rate difference CI lower bound is above 0 (told passes more).
- H-G REJECTED on cost if the pass-rate condition holds and the pooled cost-per-pass ratio told/none is 1 or less.
- H-G SUPPORTED if the CI lower bound is 0 or below AND the ratio is above 1. The only permitted wording is "not contradicted at n = 8". It is absence of a detected benefit, not evidence of zero effect.
- Ceiling clause. A fixture is at ceiling if the none arm passes at least 7 of 8. If every fixture is at ceiling, the outcome is "NOT TESTABLE on pass rate" and no "supported" claim is made. If one fixture is at ceiling, the pooled rule applies and the report names it.
- If the delivery gate failed, or cost per pass is undefined in both arms, there is no verdict.
- Nothing else is promoted to a claim.

## Comparison block (descriptive, outside the decision rule)

Full-told versus earlier stripped-told pass rate, per fixture and pooled, with Fisher p values, plus fresh none versus earlier none (a same-day reproducibility check of the baseline), and mean cost and turns. No threshold, no claim. If full-told and stripped-told differ, the report says the removed parts may matter; if they match, it says the removal did not explain the earlier result at this n.

## Power statement and threats

Same as `../prereg-HG.md`: n = 8 per cell detects only differences of about 0.4 to 0.5. A null result is weak and two fixtures are a small sample. Additional threats: the skill's AskUserQuestion stops cannot be answered in `-p` mode (the smoke showed none fired); the full skill adds turns, and the 30-turn cap may cut told runs (max-turns hits are reported); the model may be nudged by absolute tool paths in transcripts (neutral path used); the `-p` slash delivery differs from an interactive session (the delivery gate guards it).

## Uncertainties and assumptions

| Assumption | Score (1-10) | Why | Blast radius | Falsification probe, resolution |
| --- | --- | --- | --- | --- |
| The path rewrite preserves the skill's behavior | 9 | Byte-level proof, bins resolve via `$0` | Told arm differs from shipped skill | Smoke ran every preamble bin; per-trial `gstackBinCalls` and state files are recorded |
| Real `HOME` leaks nothing between trials or to the real state | 8 | State root, lease dir fresh per trial; bins read `<home>/.claude.json` only if it mentions gbrain (it does not) | Cross-trial contamination | Real `<home>/.gstack` listing compared before and after; `homeTouches` scanned per trial |
| Network and telemetry stay off | 8 | Config-gated; no env var exists | Hidden egress | No `last-update-check`, no `analytics/skill-usage.jsonl` per trial |
| Opus is not at ceiling on fx4b | 6 | Earlier none 5/8 | Pass-rate half uninformative | Ceiling clause already fixed |
| Extra allowlist entries do not help the none arm | 8 | Same entries in both arms, none arm has no reason to use them | Small asymmetry | Per-arm denial counts reported |

Overall confidence that this design tests the stated claim fairly: 6 of 10.

## Frozen files (sha256, taken before the batch)

| File | sha256 |
| --- | --- |
| `run-hyp-full.ts` | 2d4c3977296ddf5453b94f5091d53765515c262e8ef7990b5f8e2bcec6c22038 |
| `analyze-full.mjs` | 1608632129a7c70515451620a1c5fe895c9b513f4f41cbca4f8e71ce626df90c |
| `run-env.sh` (tree path, run cap, extra allowlist) | 7e030af1b348747c9f3c9fe8fc569b0ddb89b5db57e068b79daf6bd495824eb4 |
| `rewrite-paths.mjs` | 04061549c146b964d73bb366cb4f43b5c09f5aa4fb205f6bb74ea067814d1579 |
| `prove-paths.mjs` | 75d1c9cc0e718cca43452b23a8540549eb7642e9668078384535bb2a365b1e6e |
| `path-rewrite.diff` | 05d8b6de6d8c26ac7af5183761506130cee310008e890f798276ebf4296ba9d6 |
| rewritten `investigate/SKILL.md` | 59548478c78227fd5ffb8605fc0252f3b6cd6bf6860f145893dfdef1b09fc620 |
| original `investigate/SKILL.md` (b406820) | 200b669d7cca41fd5dd38983fbfd87546e66941bb75d74dd33d7d27b19db1337 |
| rewritten tree, all files | cd5766ae66c2aa892b2716aacec5c6ea3328f1c291ca4730bc0274d9eea10d64 |
| grader `storefront/check.ts` | f8a946000b8d25b51ab6825eafee1bad017dbac975973a6b6a3fdfe0b5aa02e3 |
| grader `member-directory/check.ts` | 2a63cd895b5f963abbb56ec7120083b124a8383c6c84afa0f0239daf9859d695 |
| fixture tree fx4b | e7b90d2411894ded157629570babf3c3df5c503f30d230be465cf8f595073565 |
| fixture tree fx3 | 1dc4cff312ea7ccf47c95c2acd721cbfb959d78e90ff88dbae780ae72debfd5b |

Edit nothing after the first batch trial. A change after that point is a deviation and is reported as one.
