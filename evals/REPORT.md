# Eval report

| Field | Value |
| --- | --- |
| Status | Living record. Update it when a run lands in `history.jsonl` |
| Covers | 15 runs, 2026-11-10 to 2026-11-28 |
| Source | [`history.jsonl`](./history.jsonl) and each run's `summary.json` under [`runs/`](./runs/) |
| Last updated | 2026-11-28 |

## Summary

Short answers. The tables below hold the numbers.

- **The bug-fix rule helps** on the two tasks that were calibrated on Sonnet. It shows no effect on real rig bugs, where the baseline already passes 83%.
- **The rig default install helps Sonnet on one task.** On Opus one task is at the ceiling and the other has fewer passes with rig (descriptive).
- **Neither third-party skill helps.** pstack formal verification hurt on one task.

Verdict words: **Helps**, **Hurts**, **No effect detected**, **Ceiling**, **Floor**, **Smoke** and **Not tested**. Terms defines each. Read every "No effect detected" as "not detected at this sample size". Most cells have 5 to 8 trials, so only large effects reach a claim.

## Does rig help?

The table compares the rig default install with no rig. "With rig" loads the always-on frame. "With rig and `/craft`" starts the prompt with `/craft`, which loads the hub and the playbooks. Passes are pooled over the tasks in the first column.

| Model, effort, tasks | Without rig | With rig | With rig and `/craft` | Verdict |
| --- | --- | --- | --- | --- |
| Sonnet medium, fx3 and fx4b | 0/12 | 6/12 | 8/12 | **Helps** on fx3 only (0/6, 6/6, 6/6). fx4b is a **Floor** (0/6, 0/6, 2/6) |
| Opus default, fx3 and fx4b | 11/12 | 7/12 | 6/12 | **Ceiling** on fx3 (6/6 in every arm). Fewer passes on fx4b (5/6, 1/6, 0/6), descriptive |
| Opus default, fx4b and two SWE-rebench tasks | 13/18 | 9/18 | not run | **No effect detected**. Rig without the "smallest change" clause passed 11/18 |

The Sonnet "without rig" arm ran at effort medium with a restricted tool list, so it does not compare with the 15 of 30 in the rule table. Without `/craft` the model never opened the hub, so the "With rig" column measures the frame alone. Appendix D lists the runs.

## Does the bug-fix rule help?

The rule is one sentence in the project instruction file. Passes are pooled over fx3 and fx4b unless the row says otherwise.

| Model, effort | Without the rule | With the rule | Verdict |
| --- | --- | --- | --- |
| Sonnet default | 15/30 | 30/30 | **Helps**, preregistered. A placebo sentence passed 7/30 |
| Sonnet medium | 2/10 | 9/10 | **Helps**, exploratory |
| GPT-6.1 sol medium | 5/10 | 10/10 | **Helps**, exploratory |
| GPT-6 luna high | 0/10 | 4/10 | **Helps**, exploratory |
| Haiku medium | 1/6 | 4/6 | **Smoke**, leans toward helps |
| Haiku low | 1/6 | 2/6 | **Smoke**, no difference seen |
| Opus default | 8/10 | 10/10 | **No effect detected**. The baseline is already 80% |
| GPT-6.1 terra medium | 5/10 | 5/10 | **No effect detected**. **Ceiling** on fx3 (5/5 both), **Floor** on fx4b (0/5 both) |
| GPT-6 luna medium | 0/10 | 2/10 | **Floor**, no claim |
| Grok 4.7 medium | 5/10 | 6/10 | **No effect detected**. **Ceiling** on fx3 (5/5 both) |
| Grok 4.7 high | 5/10 | 6/10 | **No effect detected**. **Ceiling** on fx3 (5/5 both) |
| Sonnet default, three real rig bugs | 20/24 | 19/24 | **No effect detected**. The baseline is already 83% |

## Do the third-party skills help?

"With" starts the prompt with the skill's slash command. Passes are pooled over the tasks of the run.

| Skill, model | Without | With | Verdict |
| --- | --- | --- | --- |
| gstack investigate, Opus, stripped copy | 13/16 | 8/16 | **No effect detected**. **Ceiling** on fx3 (8/8 both). Fewer passes on fx4b (5/8, 0/8) |
| gstack investigate, Opus, full skill | 14/16 | 9/15 | **No effect detected**. **Ceiling** on fx3 (8/8, 7/7). Fewer passes on fx4b (6/8, 2/8) |
| pstack formal verification, Sonnet, order pipeline | 8/8 | 0/8 | **Hurts** (preregistered). The baseline is at the **Ceiling** |
| pstack formal verification, Sonnet, job hub audit | 1/8 | 1/8 | **No effect detected**. Bugs found per trial: 4.00 without, 3.75 with |
| pstack fix-root-causes principle, Sonnet | 11/20 | 11/20 | **Not tested**. The skill was read in 1 of 20 trials |

In the job hub row, a pass means that a trial found all five planted bugs.

## What the results mean for rig

- Keep the bug-fix rule. Its effect is large on the two tasks that were calibrated on Sonnet, and it costs about 1.7 to 1.9 times more per trial there.
- Do not ship gstack investigate or pstack formal verification as defaults on the strength of these runs.
- Treat the Opus result on fx4b as an open question, not a confirmed regression. With rig, Opus changed one or two files in 6 of 6 trials and passed 0 of 6. Without rig it changed four files in 6 of 6 trials and passed 6 of 6. The arm without the "smallest change" clause passed 3 of 6. These numbers are descriptive and not promotable. On two real SWE-rebench tasks rig was not worse (5/6 against 4/6, 4/6 against 3/6). On 2026-11-15 the frame gained a sentence that asks for every site of the same fault. No recorded eval run has measured that version.

## Gaps

- Every rig-arm trial that did not start with `/craft` left the craft hub unread: 0 of 60 trials. Those arms measured the always-loaded frame, not rig. The one arm that typed `/craft` first opened the hub in 21 of 24 trials and still passed 0 of 6 on fx4b with Opus.
- The fixtures and graders are not in this repository. An outside contributor cannot rerun a cell. [CONTRIBUTING.md](./CONTRIBUTING.md) says what a contributor can do today.
- Antigravity and omp have no recorded cells. The Antigravity trials hit server capacity errors and timeouts and were quarantined.
- Only two tasks back most claims, and both were calibrated on Sonnet.

## Open questions

1. Does the 2026-11-15 frame fix the Opus result on fx4b? A run of rig with `/craft` against `none` on the same tasks answers it.
2. Should the fixtures and graders be published so that contributors can rerun cells?
3. Should a run with fewer than 5 trials per cell, such as the Haiku smoke run in Appendix E, stay in `history.jsonl` as descriptive data?

## Terms

- **Arm**: one condition of a run, for example `rule`, `placebo` or `none`. `none` is the baseline.
- **Cell**: one arm of one run on one task, with its passes `k` out of `n` trials.
- **Preregistration**: the question, design and decision rule, written before the first trial.
- **Helps**: the preregistered rule allows the claim, because the confidence interval of with minus without lies above 0. **Exploratory** means one of a family of configurations, so replicate it before you rely on it.
- **Hurts**: the same interval lies below 0.
- **No effect detected**: the interval includes 0. This is not evidence of zero effect.
- **Ceiling**: the baseline already passes 90% or more, so a helping unit cannot show.
- **Floor**: both arms pass almost nothing, so the task cannot tell them apart.
- **Smoke**: fewer than 5 trials per cell and no preregistration. Descriptive only.
- **Not tested**: the unit was not in the model's context, so the run did not measure it.
- **told**: in Appendix B, the arm whose prompt starts with a slash command. It is a skill's command, or `/craft` for rig.
- **fx3** and **fx4b**: the two synthetic bug-fix tasks. fx3 sorts accented names. fx4b sells the last item twice under concurrent checkout.

## Appendices

- A. [Verdict of each run](#a-verdict-of-each-run)
- B. [Cells by run](#b-cells-by-run)
- C. [Judge lines](#c-judge-lines)
- D. [Sources of the body claims](#d-sources-of-the-body-claims)
- E. [2026-11-28 Haiku smoke run](#e-2026-11-28-haiku-smoke-run)

### A. Verdict of each run

Source: `verdict` of each `runs/<run>/summary.json`, copied verbatim by script on 2026-11-28.


| Run | Label | Verdict text, verbatim from `summary.json` |
| --- | --- | --- |
| [`2026-11-10-hg-gstack-investigate`](./runs/2026-11-10-hg-gstack-investigate/) | `hypothesis-supported` | DECISION: H-G SUPPORTED (not contradicted at n=8; ceiling in fx3). This is absence of a detected benefit, not evidence of zero effect. |
| [`2026-11-10-hp-pstack-formal-verification`](./runs/2026-11-10-hp-pstack-formal-verification/) | `hypothesis-contradicted` | DECISION: H-P CONTRADICTED: told fixes fewer planted bugs (CI upper bound < 0) |
| [`2026-11-10-judge-basal`](./runs/2026-11-10-judge-basal/) | `descriptive` | AUC per tier and subset; no preregistered decision rule |
| [`2026-11-10-pilot-fx4b`](./runs/2026-11-10-pilot-fx4b/) | `descriptive` | pilot only, 5 trials per arm, no claim: rule 5/5, none 3/5 |
| [`2026-11-10-rule-bug-fix-callers`](./runs/2026-11-10-rule-bug-fix-callers/) | `claim-allowed` | DECISION (pooled rule-minus-placebo): CI excludes 0 (positive): 'rule helps' claim allowed |
| [`2026-11-11-gstack-investigate-full`](./runs/2026-11-11-gstack-investigate-full/) | `hypothesis-supported` | DECISION: H-G SUPPORTED (not contradicted at n=8; ceiling in fx3). This is absence of a detected benefit, not evidence of zero effect. |
| [`2026-11-11-hp-formal-verification-audit`](./runs/2026-11-11-hp-formal-verification-audit/) | `no-claim` | DECISION: H-A NOT SUPPORTED: no detected difference at this n |
| [`2026-11-11-judge-prose`](./runs/2026-11-11-judge-prose/) | `descriptive` | AUC per tier and subset; no preregistered decision rule |
| [`2026-11-11-pilot-principle-fix-root-causes`](./runs/2026-11-11-pilot-principle-fix-root-causes/) | `no-claim` | DECISION for pstack/principle-fix-root-causes: untested  (exposure 5% < 90%: the with arm mostly never opened the unit; underpowered: CI [-0.300, +0.300] not inside +-0.25) |
| [`2026-11-11-rig-default-vs-vanilla`](./runs/2026-11-11-rig-default-vs-vanilla/) | `claim-allowed` | opus: ceiling (vanilla pooled 0.92 >= 0.9): uninformative, no claim. sonnet: rig helps |
| [`2026-11-11-rule-bug-fix-callers-matrix`](./runs/2026-11-11-rule-bug-fix-callers-matrix/) | `claim-allowed` | Per configuration, rule minus none, pooled over fx3 and fx4b: claude-opus-default no claim, claude-sonnet-medium rule helps, codex-luna-high rule helps, codex-luna-medium no claim, codex-sol-medium rule helps, codex-terra-medium no claim |
| [`2026-11-11-rule-bug-fix-callers-rig-history`](./runs/2026-11-11-rule-bug-fix-callers-rig-history/) | `no-claim` | DECISION (primary pool, rule minus placebo): CI includes 0: no claim that the rule generalizes |
| [`2026-11-12-opus-frame-ablation`](./runs/2026-11-12-opus-frame-ablation/) | `no-claim` | no claim: the CI of rig-ablated minus rig spans 0 (a null is not evidence that the sentence is harmless) |
| [`2026-11-12-rule-bug-fix-callers-matrix-cursor`](./runs/2026-11-12-rule-bug-fix-callers-matrix-cursor/) | `no-claim` | Per configuration, rule minus none, pooled over fx3 and fx4b: cursor-grok47-high no claim, cursor-grok47-medium no claim |
| [`2026-11-28-rule-bug-fix-callers-haiku`](./runs/2026-11-28-rule-bug-fix-callers-haiku/) | `descriptive` | smoke run without preregistration, 3 trials per cell, no claim: pooled rule 2/6 against none 1/6 at effort low, rule 4/6 against none 1/6 at effort medium |

### B. Cells by run

Source: the cell lines of `history.jsonl`, rendered by script on 2026-11-28. Costs and turns are means per trial. A dash means that the harness reports no cost.

`2026-11-10-pilot-fx4b`

| Unit | Model, effort | Fixture | Arm | Pass k/n | Mean cost USD | Mean turns |
| --- | --- | --- | --- | --- | --- | --- |
| `rule:bug-fix-callers` | claude-code claude-sonnet-5-5, default | `fx4b` | `rule` | 5/5 | 0.170 | 16.8 |
| `rule:bug-fix-callers` | claude-code claude-sonnet-5-5, default | `fx4b` | `none` | 3/5 | 0.098 | 10.6 |

`2026-11-10-rule-bug-fix-callers`

| Unit | Model, effort | Fixture | Arm | Pass k/n | Mean cost USD | Mean turns |
| --- | --- | --- | --- | --- | --- | --- |
| `rule:bug-fix-callers` | claude-code claude-sonnet-5-5, default | `fx4b` | `rule` | 15/15 | 0.159 | 16.4 |
| `rule:bug-fix-callers` | claude-code claude-sonnet-5-5, default | `fx4b` | `placebo` | 1/15 | 0.083 | 8.3 |
| `rule:bug-fix-callers` | claude-code claude-sonnet-5-5, default | `fx4b` | `none` | 8/15 | 0.095 | 10.7 |
| `rule:bug-fix-callers` | claude-code claude-sonnet-5-5, default | `fx3` | `rule` | 15/15 | 0.128 | 16.3 |
| `rule:bug-fix-callers` | claude-code claude-sonnet-5-5, default | `fx3` | `placebo` | 6/15 | 0.054 | 5.8 |
| `rule:bug-fix-callers` | claude-code claude-sonnet-5-5, default | `fx3` | `none` | 7/15 | 0.068 | 8 |

`2026-11-10-hg-gstack-investigate`

| Unit | Model, effort | Fixture | Arm | Pass k/n | Mean cost USD | Mean turns |
| --- | --- | --- | --- | --- | --- | --- |
| `gstack/investigate@b406820` | claude-code claude-opus-5-5, default | `fx4b` | `told` | 0/8 | 0.343 | 13.5 |
| `gstack/investigate@b406820` | claude-code claude-opus-5-5, default | `fx4b` | `none` | 5/8 | 0.277 | 12.8 |
| `gstack/investigate@b406820` | claude-code claude-opus-5-5, default | `fx3` | `told` | 8/8 | 0.291 | 12.1 |
| `gstack/investigate@b406820` | claude-code claude-opus-5-5, default | `fx3` | `none` | 8/8 | 0.209 | 11.1 |

`2026-11-10-hp-pstack-formal-verification`

| Unit | Model, effort | Fixture | Arm | Pass k/n | Mean cost USD | Mean turns |
| --- | --- | --- | --- | --- | --- | --- |
| `pstack/create-formal-verification-skill@34b1b7c` | claude-code claude-sonnet-5-5, default | `ord` | `told` | 0/8 | 0.471 | 26.5 |
| `pstack/create-formal-verification-skill@34b1b7c` | claude-code claude-sonnet-5-5, default | `ord` | `none` | 8/8 | 0.153 | 8.9 |

`2026-11-11-pilot-principle-fix-root-causes`

| Unit | Model, effort | Fixture | Arm | Pass k/n | Mean cost USD | Mean turns |
| --- | --- | --- | --- | --- | --- | --- |
| `pstack/principle-fix-root-causes@2776ddd` | claude-code claude-sonnet-5-5, default | `fx4b` | `with` | 3/10 | 0.181 | 16.6 |
| `pstack/principle-fix-root-causes@2776ddd` | claude-code claude-sonnet-5-5, default | `fx4b` | `none` | 4/10 | 0.196 | 18.3 |
| `pstack/principle-fix-root-causes@2776ddd` | claude-code claude-sonnet-5-5, default | `fx3` | `with` | 8/10 | 0.139 | 13.7 |
| `pstack/principle-fix-root-causes@2776ddd` | claude-code claude-sonnet-5-5, default | `fx3` | `none` | 7/10 | 0.137 | 12.8 |

`2026-11-11-hp-formal-verification-audit`

| Unit | Model, effort | Fixture | Arm | Pass k/n | Mean cost USD | Mean turns |
| --- | --- | --- | --- | --- | --- | --- |
| `pstack/create-formal-verification-skill@34b1b7c` | claude-code claude-sonnet-5-5, default | `job-hub` | `told` | 1/8 | 0.294 | 19.1 |
| `pstack/create-formal-verification-skill@34b1b7c` | claude-code claude-sonnet-5-5, default | `job-hub` | `none` | 1/8 | 0.188 | 17.4 |

`2026-11-11-gstack-investigate-full`

| Unit | Model, effort | Fixture | Arm | Pass k/n | Mean cost USD | Mean turns |
| --- | --- | --- | --- | --- | --- | --- |
| `gstack/investigate@b406820` | claude-code claude-opus-5-5, default | `fx3` | `told-full` | 7/7 | 0.468 | 17.3 |
| `gstack/investigate@b406820` | claude-code claude-opus-5-5, default | `fx3` | `none` | 8/8 | 0.234 | 13.4 |
| `gstack/investigate@b406820` | claude-code claude-opus-5-5, default | `fx4b` | `told-full` | 2/8 | 0.557 | 17.5 |
| `gstack/investigate@b406820` | claude-code claude-opus-5-5, default | `fx4b` | `none` | 6/8 | 0.317 | 15.5 |

`2026-11-11-rig-default-vs-vanilla`

| Unit | Model, effort | Fixture | Arm | Pass k/n | Mean cost USD | Mean turns |
| --- | --- | --- | --- | --- | --- | --- |
| `rig/default@2dbce75` | claude-code claude-opus-5-5, default | `fx3` | `none` | 6/6 | 0.196 | 12.7 |
| `rig/default@2dbce75` | claude-code claude-opus-5-5, default | `fx3` | `rig` | 6/6 | 0.226 | 12 |
| `rig/default@2dbce75` | claude-code claude-opus-5-5, default | `fx3` | `told` | 6/6 | 0.401 | 18.3 |
| `rig/default@2dbce75` | claude-code claude-opus-5-5, default | `fx4b` | `none` | 5/6 | 0.276 | 14.8 |
| `rig/default@2dbce75` | claude-code claude-opus-5-5, default | `fx4b` | `rig` | 1/6 | 0.242 | 10.3 |
| `rig/default@2dbce75` | claude-code claude-opus-5-5, default | `fx4b` | `told` | 0/6 | 0.487 | 23.8 |
| `rig/default@2dbce75` | claude-code claude-sonnet-5-5, medium | `fx3` | `none` | 0/6 | 0.051 | 5.5 |
| `rig/default@2dbce75` | claude-code claude-sonnet-5-5, medium | `fx3` | `rig` | 6/6 | 0.106 | 15 |
| `rig/default@2dbce75` | claude-code claude-sonnet-5-5, medium | `fx3` | `told` | 6/6 | 0.173 | 17.2 |
| `rig/default@2dbce75` | claude-code claude-sonnet-5-5, medium | `fx4b` | `none` | 0/6 | 0.072 | 8.2 |
| `rig/default@2dbce75` | claude-code claude-sonnet-5-5, medium | `fx4b` | `rig` | 0/6 | 0.113 | 11.7 |
| `rig/default@2dbce75` | claude-code claude-sonnet-5-5, medium | `fx4b` | `told` | 2/6 | 0.188 | 19.7 |

`2026-11-11-rule-bug-fix-callers-rig-history`

| Unit | Model, effort | Fixture | Arm | Pass k/n | Mean cost USD | Mean turns |
| --- | --- | --- | --- | --- | --- | --- |
| `rule:bug-fix-callers` | claude-code claude-sonnet-5-5, default | `rig-d3dc4ce` | `rule` | 9/12 | 0.190 | 17 |
| `rule:bug-fix-callers` | claude-code claude-sonnet-5-5, default | `rig-d3dc4ce` | `placebo-v2` | 9/12 | 0.143 | 14.9 |
| `rule:bug-fix-callers` | claude-code claude-sonnet-5-5, default | `rig-d3dc4ce` | `none` | 10/12 | 0.166 | 17.8 |
| `rule:bug-fix-callers` | claude-code claude-sonnet-5-5, default | `rig-ab8d5ec` | `rule` | 12/12 | 0.164 | 16.9 |
| `rule:bug-fix-callers` | claude-code claude-sonnet-5-5, default | `rig-ab8d5ec` | `placebo-v2` | 12/12 | 0.085 | 9.8 |
| `rule:bug-fix-callers` | claude-code claude-sonnet-5-5, default | `rig-ab8d5ec` | `none` | 12/12 | 0.095 | 11.2 |
| `rule:bug-fix-callers` | claude-code claude-sonnet-5-5, default | `rig-069847a` | `rule` | 10/12 | 0.270 | 16.8 |
| `rule:bug-fix-callers` | claude-code claude-sonnet-5-5, default | `rig-069847a` | `placebo-v2` | 9/12 | 0.242 | 15.8 |
| `rule:bug-fix-callers` | claude-code claude-sonnet-5-5, default | `rig-069847a` | `none` | 10/12 | 0.239 | 15.9 |
| `rule:bug-fix-callers` | claude-code claude-sonnet-5-5, default | `fx4b` | `rule` | 4/5 | 0.138 | 15.4 |
| `rule:bug-fix-callers` | claude-code claude-sonnet-5-5, default | `fx4b` | `placebo-v2` | 0/5 | 0.077 | 8.6 |
| `rule:bug-fix-callers` | claude-code claude-sonnet-5-5, default | `fx4b` | `none` | 3/5 | 0.094 | 12.6 |
| `rule:bug-fix-callers` | claude-code claude-sonnet-5-5, default | `fx3` | `rule` | 5/5 | 0.124 | 16 |
| `rule:bug-fix-callers` | claude-code claude-sonnet-5-5, default | `fx3` | `placebo-v2` | 0/5 | 0.045 | 4.8 |
| `rule:bug-fix-callers` | claude-code claude-sonnet-5-5, default | `fx3` | `none` | 0/5 | 0.053 | 5.8 |

`2026-11-11-rule-bug-fix-callers-matrix`

| Unit | Model, effort | Fixture | Arm | Pass k/n | Mean cost USD | Mean turns |
| --- | --- | --- | --- | --- | --- | --- |
| `rule:bug-fix-callers` | claude-code claude-opus-5-5, default | `fx4b` | `rule` | 5/5 | 0.284 | 16.4 |
| `rule:bug-fix-callers` | claude-code claude-opus-5-5, default | `fx4b` | `none` | 3/5 | 0.260 | 14 |
| `rule:bug-fix-callers` | claude-code claude-opus-5-5, default | `fx3` | `rule` | 5/5 | 0.245 | 16.8 |
| `rule:bug-fix-callers` | claude-code claude-opus-5-5, default | `fx3` | `none` | 5/5 | 0.211 | 13.6 |
| `rule:bug-fix-callers` | claude-code claude-sonnet-5-5, medium | `fx4b` | `rule` | 4/5 | 0.142 | 15.4 |
| `rule:bug-fix-callers` | claude-code claude-sonnet-5-5, medium | `fx4b` | `none` | 1/5 | 0.086 | 9.4 |
| `rule:bug-fix-callers` | claude-code claude-sonnet-5-5, medium | `fx3` | `rule` | 5/5 | 0.109 | 16 |
| `rule:bug-fix-callers` | claude-code claude-sonnet-5-5, medium | `fx3` | `none` | 1/5 | 0.051 | 6.4 |
| `rule:bug-fix-callers` | codex gpt-6.1-sol, medium | `fx4b` | `rule` | 5/5 | - | 1 |
| `rule:bug-fix-callers` | codex gpt-6.1-sol, medium | `fx4b` | `none` | 0/5 | - | 1 |
| `rule:bug-fix-callers` | codex gpt-6.1-sol, medium | `fx3` | `rule` | 5/5 | - | 1 |
| `rule:bug-fix-callers` | codex gpt-6.1-sol, medium | `fx3` | `none` | 5/5 | - | 1 |
| `rule:bug-fix-callers` | codex gpt-6.1-terra, medium | `fx4b` | `rule` | 0/5 | - | 1 |
| `rule:bug-fix-callers` | codex gpt-6.1-terra, medium | `fx4b` | `none` | 0/5 | - | 1 |
| `rule:bug-fix-callers` | codex gpt-6.1-terra, medium | `fx3` | `rule` | 5/5 | - | 1 |
| `rule:bug-fix-callers` | codex gpt-6.1-terra, medium | `fx3` | `none` | 5/5 | - | 1 |
| `rule:bug-fix-callers` | codex gpt-6-luna, medium | `fx4b` | `rule` | 0/5 | - | 1 |
| `rule:bug-fix-callers` | codex gpt-6-luna, medium | `fx4b` | `none` | 0/5 | - | 1 |
| `rule:bug-fix-callers` | codex gpt-6-luna, medium | `fx3` | `rule` | 2/5 | - | 1 |
| `rule:bug-fix-callers` | codex gpt-6-luna, medium | `fx3` | `none` | 0/5 | - | 1 |
| `rule:bug-fix-callers` | codex gpt-6-luna, high | `fx4b` | `rule` | 0/5 | - | 1 |
| `rule:bug-fix-callers` | codex gpt-6-luna, high | `fx4b` | `none` | 0/5 | - | 1 |
| `rule:bug-fix-callers` | codex gpt-6-luna, high | `fx3` | `rule` | 4/5 | - | 1 |
| `rule:bug-fix-callers` | codex gpt-6-luna, high | `fx3` | `none` | 0/5 | - | 1 |

`2026-11-12-opus-frame-ablation`

| Unit | Model, effort | Fixture | Arm | Pass k/n | Mean cost USD | Mean turns |
| --- | --- | --- | --- | --- | --- | --- |
| `rig/frame-ablation@2dbce75` | claude-code claude-opus-5-5, default | `fx4b` | `none` | 6/6 | 0.266 | 15 |
| `rig/frame-ablation@2dbce75` | claude-code claude-opus-5-5, default | `fx4b` | `rig` | 0/6 | 0.240 | 11.3 |
| `rig/frame-ablation@2dbce75` | claude-code claude-opus-5-5, default | `fx4b` | `rig-ablated` | 3/6 | 0.309 | 16 |
| `rig/frame-ablation@2dbce75` | claude-code claude-opus-5-5, default | `swerebench-tox-dev__tox-3683` | `none` | 4/6 | 0.788 | 28 |
| `rig/frame-ablation@2dbce75` | claude-code claude-opus-5-5, default | `swerebench-tox-dev__tox-3683` | `rig` | 5/6 | 0.902 | 39 |
| `rig/frame-ablation@2dbce75` | claude-code claude-opus-5-5, default | `swerebench-tox-dev__tox-3683` | `rig-ablated` | 4/6 | 0.930 | 34.7 |
| `rig/frame-ablation@2dbce75` | claude-code claude-opus-5-5, default | `swerebench-joke2k__django-environ-592` | `none` | 3/6 | 0.349 | 15.7 |
| `rig/frame-ablation@2dbce75` | claude-code claude-opus-5-5, default | `swerebench-joke2k__django-environ-592` | `rig` | 4/6 | 0.358 | 14.3 |
| `rig/frame-ablation@2dbce75` | claude-code claude-opus-5-5, default | `swerebench-joke2k__django-environ-592` | `rig-ablated` | 4/6 | 0.369 | 17 |

`2026-11-12-rule-bug-fix-callers-matrix-cursor`

| Unit | Model, effort | Fixture | Arm | Pass k/n | Mean cost USD | Mean turns |
| --- | --- | --- | --- | --- | --- | --- |
| `rule:bug-fix-callers` | cursor grok-4.7, medium | `fx4b` | `rule` | 1/5 | - | 3.8 |
| `rule:bug-fix-callers` | cursor grok-4.7, medium | `fx4b` | `none` | 0/5 | - | 3.2 |
| `rule:bug-fix-callers` | cursor grok-4.7, medium | `fx3` | `rule` | 5/5 | - | 4.2 |
| `rule:bug-fix-callers` | cursor grok-4.7, medium | `fx3` | `none` | 5/5 | - | 3.4 |
| `rule:bug-fix-callers` | cursor grok-4.7, high | `fx4b` | `rule` | 1/5 | - | 4.4 |
| `rule:bug-fix-callers` | cursor grok-4.7, high | `fx4b` | `none` | 0/5 | - | 3.6 |
| `rule:bug-fix-callers` | cursor grok-4.7, high | `fx3` | `rule` | 5/5 | - | 5.2 |
| `rule:bug-fix-callers` | cursor grok-4.7, high | `fx3` | `none` | 5/5 | - | 4 |

`2026-11-28-rule-bug-fix-callers-haiku`

| Unit | Model, effort | Fixture | Arm | Pass k/n | Mean cost USD | Mean turns |
| --- | --- | --- | --- | --- | --- | --- |
| `rule:bug-fix-callers` | claude-code claude-haiku-5-5, low | `fx4b` | `rule` | 0/3 | 0.009 | 12.3 |
| `rule:bug-fix-callers` | claude-code claude-haiku-5-5, low | `fx4b` | `none` | 0/3 | 0.008 | 13.3 |
| `rule:bug-fix-callers` | claude-code claude-haiku-5-5, low | `fx3` | `rule` | 2/3 | 0.008 | 12.7 |
| `rule:bug-fix-callers` | claude-code claude-haiku-5-5, low | `fx3` | `none` | 1/3 | 0.005 | 8.0 |
| `rule:bug-fix-callers` | claude-code claude-haiku-5-5, medium | `fx4b` | `rule` | 1/3 | 0.010 | 13.0 |
| `rule:bug-fix-callers` | claude-code claude-haiku-5-5, medium | `fx4b` | `none` | 0/3 | 0.010 | 14.7 |
| `rule:bug-fix-callers` | claude-code claude-haiku-5-5, medium | `fx3` | `rule` | 3/3 | 0.010 | 16.7 |
| `rule:bug-fix-callers` | claude-code claude-haiku-5-5, medium | `fx3` | `none` | 1/3 | 0.005 | 7.7 |

### C. Judge lines

Source: the judge lines of `history.jsonl`, rendered by script on 2026-11-28.

| Run | Judge set | Model | Subset | n | AUC | AUC 95% CI | Pair accuracy |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `2026-11-10-judge-basal` | `basal-code-prose` | pico | all | 42 | 0.85 | 0.72 to 0.94 | - |
| `2026-11-10-judge-basal` | `basal-code-prose` | pico | code | 30 | 0.88 | 0.75 to 0.98 | - |
| `2026-11-10-judge-basal` | `basal-code-prose` | pico | prose | 12 | 0.75 | 0.38 to 1.00 | - |
| `2026-11-10-judge-basal` | `basal-code-prose` | mini | all | 42 | 0.76 | 0.60 to 0.89 | - |
| `2026-11-10-judge-basal` | `basal-code-prose` | mini | code | 30 | 0.87 | 0.72 to 1.00 | - |
| `2026-11-10-judge-basal` | `basal-code-prose` | mini | prose | 12 | 0.75 | 0.41 to 1.00 | - |
| `2026-11-11-judge-prose` | `prose-pairs` | pico | all | 48 | 0.85 | 0.74 to 0.94 | 0.79 |
| `2026-11-11-judge-prose` | `prose-pairs` | pico | R1 | 16 | 0.98 | 0.90 to 1.00 | 1 |
| `2026-11-11-judge-prose` | `prose-pairs` | pico | R2 | 16 | 0.45 | 0.15 to 0.77 | 0.38 |
| `2026-11-11-judge-prose` | `prose-pairs` | pico | R3 | 16 | 1.00 | 1.00 to 1.00 | 1 |
| `2026-11-11-judge-prose` | `prose-pairs` | pico | EN | 36 | 0.86 | 0.75 to 0.96 | 0.83 |
| `2026-11-11-judge-prose` | `prose-pairs` | pico | PL | 12 | 0.81 | 0.50 to 1.00 | 0.67 |
| `2026-11-11-judge-prose` | `prose-pairs` | mini | all | 48 | 0.74 | 0.58 to 0.87 | 0.88 |
| `2026-11-11-judge-prose` | `prose-pairs` | mini | R1 | 16 | 0.97 | 0.85 to 1.00 | 0.88 |
| `2026-11-11-judge-prose` | `prose-pairs` | mini | R2 | 16 | 0.69 | 0.37 to 0.95 | 0.75 |
| `2026-11-11-judge-prose` | `prose-pairs` | mini | R3 | 16 | 0.92 | 0.74 to 1.00 | 1 |
| `2026-11-11-judge-prose` | `prose-pairs` | mini | EN | 36 | 0.77 | 0.62 to 0.91 | 0.89 |
| `2026-11-11-judge-prose` | `prose-pairs` | mini | PL | 12 | 0.67 | 0.30 to 1.00 | 0.83 |

### D. Sources of the body claims

Source: the `notes` of each run's `summary.json`, the preregistrations, and git history, read on 2026-11-28. Quotes are verbatim.

| Body claim | Source |
| --- | --- |
| Run behind each table row | Rig table: `2026-11-11-rig-default-vs-vanilla` (rows 1 and 2), `2026-11-12-opus-frame-ablation` (row 3). Rule table: `2026-11-10-rule-bug-fix-callers` (row 1), `2026-11-11-rule-bug-fix-callers-matrix` (rows 2 to 4 and 7 to 9), `2026-11-28-rule-bug-fix-callers-haiku` (rows 5 and 6), `2026-11-12-rule-bug-fix-callers-matrix-cursor` (rows 10 and 11), `2026-11-11-rule-bug-fix-callers-rig-history` (row 12, tasks d3 and st). Skill table: `2026-11-10-hg-gstack-investigate`, `2026-11-11-gstack-investigate-full`, `2026-11-10-hp-pstack-formal-verification`, `2026-11-11-hp-formal-verification-audit`, `2026-11-11-pilot-principle-fix-root-causes` |
| Every pooled pass count in the three tables | Sums of `k` and `n` over the cells of Appendix B that match the row's run, model, effort and tasks. Computed by script from `history.jsonl` on 2026-11-28. Verdict words come from the `verdict` of each run's `summary.json` (Appendix A) and the preregistered rules |
| Rule pass rate 30 of 30, placebo 7 of 30, none 15 of 30 on Sonnet | Appendix B, run `2026-11-10-rule-bug-fix-callers`: fx4b 15/15, 1/15, 8/15 and fx3 15/15, 6/15, 7/15 |
| The rule costs about 1.7 to 1.9 times more per trial | Appendix B, same run: mean cost rule 0.159 against none 0.095 on fx4b, and 0.128 against 0.068 on fx3 |
| No rule effect on real rig bugs | `2026-11-11-rule-bug-fix-callers-rig-history` notes: "On the new fixtures there is no rule effect (d3 9/12 against 10/12 for none, st 10/12 against 10/12)." |
| Matrix labels are exploratory | `2026-11-11-rule-bug-fix-callers-matrix` notes: "The preregistration calls them exploratory, because the configurations are a family and no between-config test is preregistered." |
| gstack investigate worse on one task | `2026-11-10-hg-gstack-investigate` notes: "the told arm passed less on fx4b (0/8 vs 5/8)." The full skill: fx4b 2/8 against 6/8 (Appendix B) |
| pstack formal verification 0 of 8 against 8 of 8 | Appendix B, run `2026-11-10-hp-pstack-formal-verification`, fixture `ord` |
| Opus with rig changed one or two files | `2026-11-12-opus-frame-ablation` notes: "rig changed 1 or 2 files in 6 of 6 trials, none changed 4 files in 6 of 6, and rig-ablated changed 4 or 5 files in 3 of 6 and 2 files in 3 of 6." |
| The arm without the "smallest change" clause passed 3 of 6 on fx4b | Same run notes: "On fx4b the arms are none 6/6, rig 0/6 and rig-ablated 3/6." |
| The frame gained a sentence on 2026-11-15 | Commit `1b2872e`, "fix(frame): fix every site of the same fault, not only the reported one", on `packs/core/frame.md` |
| 0 of 60 rig-arm trials without `/craft` opened the hub | 24 trials: `2026-11-12-opus-frame-ablation/prereg.md`, "The hub was opened in 0 of 24 rig-arm trials without `/craft`". 36 trials: the same run's notes, "opened in 0 of 54 trials (0 of 18 per arm)", for the arms `rig` and `rig-ablated` |
| The `/craft` arm opened the hub in 21 of 24 trials | `2026-11-11-rig-default-vs-vanilla` notes: "The agent opened the hub itself in 21 of 24 told trials." |
| Antigravity trials were quarantined | `2026-11-12-rule-bug-fix-callers-matrix-cursor` notes: "27 of 40 agy trials ended in status ERROR: 16 with a server 503 \"no capacity\" and 11 at the 890 s print timeout." |
| Both tasks were calibrated on Sonnet | `2026-11-11-rule-bug-fix-callers-matrix/prereg.md`: "The fixtures were calibrated on Sonnet: none arm 15/30, rule arm 30/30." |

### E. 2026-11-28 Haiku smoke run

Source: [`runs/2026-11-28-rule-bug-fix-callers-haiku/`](./runs/2026-11-28-rule-bug-fix-callers-haiku/), run on 2026-11-28.

The run tested the steps of [CONTRIBUTING.md](./CONTRIBUTING.md) on a small budget: Claude Code 2.1.332, `claude-haiku-5-5` at effort low and medium, arms `rule` and `none`, fixtures fx3 and fx4b, 3 trials per cell, 24 trials, 0.20 USD in total. It had no preregistration, so its verdict is `descriptive`. It also did not repeat the canary isolation check.

| Configuration | fx4b rule | fx4b none | fx3 rule | fx3 none | Pooled rule minus none, 95% CI |
| --- | --- | --- | --- | --- | --- |
| Haiku, effort low | 0/3 | 0/3 | 2/3 | 1/3 | +0.17, -0.17 to +0.50 |
| Haiku, effort medium | 1/3 | 0/3 | 3/3 | 1/3 | +0.50, +0.17 to +0.83 |

Setup checks that passed: the model echo matched in 24 of 24 trials, the rule reached the first turn in 12 of 12 rule trials and in 0 of 12 none trials, and no trial timed out, failed for infra or saw the grader. The fixture hashes equal the recorded fx3 and fx4b values.

Caveats: Claude Code does not echo the effort, so the effort is the flag that the runner passed. The analyzer's "rule helps" line for effort medium applies the matrix decision rule to a run that did not preregister it. A preregistered run with 5 or more trials per cell can turn it into a claim.
