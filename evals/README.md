# evals

Eval and benchmark results of rig, kept in the repo so that you can see over time whether a unit, a harness, a model or an effort setting got better or broke.

[REPORT.md](./REPORT.md) summarizes the results of every run. [CONTRIBUTING.md](./CONTRIBUTING.md) shows how to run an existing eval on another model and record it.

This directory holds results, plus the fixtures and graders of fx3 and fx4b under `fixtures/`. It holds no transcripts and no diffs. Every other fixture and grader is named by id and by sha256 only.

## Layout

```
evals/
  README.md
  REPORT.md                     results of every run, for people
  CONTRIBUTING.md               how to run an existing eval on another model
  history.jsonl                 one line per cell, append-only
  fixtures/                     fx3 and fx4b with their graders and prompts, and the rule text, see fixtures/README.md
  suites/
    <slug>.json                 declarative evaluation suite specification
  runs/<YYYY-MM-DD>-<slug>/
    summary.json                what the run asked, how it ended, the verdict
    analysis.txt                the analyzer output
    prereg.md                   the preregistration, when the run had one
    prereg-amendment-<n>.md     an amendment of the preregistration, written before any trial
    signoff.md                  an approval that the run recorded before its first trial, when it had one
    deviations.md               the run's own list of deviations from its preregistration, when it kept one
    calibration.txt             the calibration table that chose the tasks, when the run kept one and it has no history lines
```

`scripts/evals-trend.ts` prints the trend. `scripts/evals-history.ts` holds the schema and the privacy scan. `scripts/eval-runner.ts` runs automated evaluation suites. `scripts/eval-fixture.ts` prepares and grades one trial of fx3 or fx4b by hand.

```
node scripts/evals-trend.ts
node scripts/eval-runner.ts evals/suites/bug-fix-callers.json --dry-run
```

## history.jsonl

One JSON object per line. A line is a **cell**: one arm of one run on one fixture. Or it is a **judge** line: one judge model on one subset of a judge case set. Or it is a **metrics** line: the time and token fields of an older cell. The schema is closed. A line with an unknown field is invalid.

Cell lines:

| Field | Meaning |
| --- | --- |
| `schema` | always `1` |
| `kind` | `cell` |
| `run` | run id, equal to the run directory name, starts with `date` |
| `date` | run date, `YYYY-MM-DD` |
| `rig_commit` | rig commit the run used, or `null` when the run did not depend on one |
| `unit` | what is under test: `rule:<slug>`, `<pack>/<unit>@<commit>`, or `<pack>/<unit>` |
| `arm` | the condition: `rule`, `placebo`, `told`, `none` and so on. `none` is the baseline |
| `harness`, `harness_version` | for example `claude-code` and the version from the init event |
| `model` | model id as the harness reported it |
| `effort` | effort setting, `default` when the run set none |
| `fixture` | fixture id, see below |
| `fixture_sha256` | sha256 of the fixture file tree without `.git` |
| `grader_sha256` | sha256 of the grader file |
| `k`, `n` | trials that passed, usable trials |
| `mean_cost_usd`, `mean_turns` | mean over the `n` trials of the cell |
| `total_cost_usd` | sum of the cost of the `n` trials, in USD |
| `mean_duration_s`, `median_duration_s` | mean and median over the `n` trials of the wall time of a trial, in seconds |
| `mean_input_tokens` | mean number of input tokens that were not served from or written to the cache, per trial |
| `mean_output_tokens` | mean number of output tokens per trial |
| `mean_cache_read_tokens`, `mean_cache_write_tokens` | mean number of input tokens read from the cache and written to the cache, per trial |
| `mean_score`, `score_max` | optional, for a run whose outcome is a score and not pass or fail. `mean_score` is the mean score over the `n` trials and `score_max` the highest possible score. `k` then counts the trials with the top score |
| `note` | optional, one sentence on how to read this cell |

The seven fields from `total_cost_usd` to `mean_cache_write_tokens` come together: a cell has all of them or none. Each is a number, or `null` when the harness does not report it. A cell of a run that was committed before these fields existed has none of them and gets a metrics line instead (see below). The totals are over all turns of a trial. Tokens are counted, not priced, so a change of price does not move them.

Where the numbers come from, for the `claude-code` harness. Each trial writes a stream of events, and the last one is the `result` event. `duration_ms` of that event, divided by 1000, is the trial's duration in seconds. `total_cost_usd` is the cost. `usage.input_tokens`, `usage.output_tokens`, `usage.cache_read_input_tokens` and `usage.cache_creation_input_tokens` are the four token fields, in that order, and `num_turns` is the turn count. The per-trial JSON files of a run keep `costUsd`, `turns` and `durationMs`, which equal the result event. They do not keep the tokens. A harness that does not report a number writes `null`.

A harness that reports no cost writes both `total_cost_usd` and `mean_cost_usd` as `null`. The trend prints `-` for such a cell and compares no cost.

A **metrics** line has `kind` `metrics`, the `run` and the full key of the cell it backfills (`unit`, `arm`, `harness`, `model`, `effort`, `fixture`), and the seven metric fields, all required. It has no date. It is for cells that were committed before the metric fields existed, and for nothing else. A new cell line carries the fields inline and gets no metrics line. The reader joins a metrics line to its cell. The line must come after its cell, must name an existing cell, must name a cell that has no inline fields, and may appear once per cell.

Judge lines have `kind` `judge` and: `run`, `date`, `judge_set`, `model` (a model name only), `subset`, `n`, `pairs` (`n / 2` or `null`), `auc`, `auc_ci95` (two numbers), `pair_acc` (or `null`), `cases_sha256`, and an optional `note`.

The group of a cell is `(unit, arm, harness, model, effort, fixture, fixture_sha256, grader_sha256)`. The key of a line is its kind, its run and its group, without the two hashes. Two lines never share a key.

Rules for writers:

- Append. Never edit or delete an older line. A cell that lacks the metric fields is corrected with a metrics line, not by editing the cell. To correct a wrong line, append the corrected run under a new run id and say why in its `summary.json` notes. The one exception is a version of `history.jsonl` that never reached main. The test lists such a version by its sha256 (see the pin table).
- `k` counts the same pass that the run's preregistration calls a pass. Trials that ended at the turn limit count when the preregistration says they are graded as they stand.
- Do not put a host name, an IP address, an absolute local path, a home-relative path or a cluster name in any file here. The privacy gate below checks the classes it lists. It is a pattern check, not a proof, so read your own diff too.

## summary.json

Fields: `schema`, `run`, `date`, `kind` (`experiment` or `judge`), `title`, `question`, `prereg` (`null` or `file`, `original_sha256`, `stored_sha256`, `redactions`, and optionally `amendments`, a list of the same three hash and redaction fields plus the `file` name `prereg-amendment-<n>.md`), `analysis` (`file`, `origin`, and optionally `redactions`), `lines` (cell and judge lines of the run, metrics lines not counted), `usable_trials`, `verdict`, `notes`.

`verdict.label` is one of:

| Label | Meaning |
| --- | --- |
| `claim-allowed` | the preregistered decision rule allows the claim |
| `hypothesis-supported` | the preregistered rule supports the hypothesis, with the wording the preregistration allows |
| `hypothesis-contradicted` | the preregistered rule contradicts the hypothesis |
| `no-claim` | the preregistered rule allows no claim |
| `descriptive` | no preregistered decision rule, numbers only |

`verdict.text` is the decision line of the analyzer, or one sentence for a run without an analyzer. `analysis.origin` is `analyzer` when `analysis.txt` is the analyzer output verbatim, and `backfill` when the backfill rendered it from the trial records or the results file. When `analysis.redactions` is present, the file is the analyzer output with exactly those redactions. A run whose outcome is a score says so in its `notes` and uses `mean_score` and `score_max` on its cells.

## The trend

`node scripts/evals-trend.ts [history.jsonl]` groups the cell lines by group (a changed fixture or grader hash is a new group, so runs on different fixture versions are never compared), orders each group by date and then by position in the file, and compares the latest run with the previous run of the same group.

The flag rule is a 95% Wilson score interval on `k / n` for both runs. The status is `DROP` when the latest interval lies fully below the previous one, `RISE` when it lies fully above, `noise` otherwise, and `first run` when the group has one run. This is a conservative bar. Two 15-trial runs flag 15/15 against 3/15 and stay quiet on 8/15 against 6/15.

### Cost, duration and tokens

Below the pass-rate table the script prints a second table. For each group it shows the previous mean and the latest mean of three numbers, with the relative change: cost in USD per trial, duration in seconds per trial, and tokens per trial. Tokens here are the sum of the four token fields: input, output, cache read and cache write. Cache reads are most of that sum, so it tracks how much context an agent re-reads more than how much it writes. Read `mean_output_tokens` in `history.jsonl` for the written part. Metrics lines are joined to their cells before the comparison. A group whose cell lacks a number, or has `null`, prints `-` for it.

The flag is the label **large change**. It is set for a number when its mean moves by more than 50% of the previous mean and both runs have at least 5 trials (`LARGE_CHANGE` and `LARGE_MIN_N` in `scripts/evals-trend.ts`). It is not a significance test. History keeps only means for these numbers, so there is no spread to test against.

Why 50% and 5 trials. The threshold was set from the trial-level data of the runs in this directory, which is not committed. Across 36 cells of 5 to 15 trials, the coefficient of variation of a trial's cost had median 0.13 and 90th percentile 0.33. For duration it was 0.15 and 0.47, and for total tokens 0.24 and 0.41. With 5 trials in both runs, the standard error of the relative difference of two means is about the coefficient of variation times 0.63. At the 90th percentile that is 0.21 for cost, 0.30 for duration and 0.26 for tokens. A change of 50% is at least 1.6 of those standard errors for the noisiest tenth of the groups, and far above them for the rest. As a check on the other side, four groups in this directory ran the same condition twice: the `rule` and `none` arms on fx4b in the pilot and in the powered run, and the `none` arms of the two H-G runs. Their cost, duration and tokens moved by 0% to 31% between the two runs. The rule is a screen for changes that are too big to be run-to-run noise. It misses a real change of 30%.

Limits you should know:

- The script compares two runs only. A drop that persists reads `noise` on the run after it. Read the older line or keep the first flag in the run notes.
- A change of harness version is printed next to the status. It is not part of the group, so a version bump and a real change look alike. Check the version before you blame a unit.
- A changed fixture or grader hash splits a group. The old group keeps its last run and the new group prints `first run`. The `fixture/grader sha` column shows the first eight hex digits of each hash, so two groups that differ only there stay apart in the table.
- The script does not compare arms of one run. The run's `analysis.txt` does that, with its preregistered test.
- The 50% rule looks at the latest two runs and at means. A rise of 10% per run never flags.
- A change of harness version, of tool allowlist or of effort moves cost and duration without a change in the unit. The group holds effort and model fixed. The tool allowlist and the harness version are not in the group.
- Judge lines are counted, not trended.
- Exit code is `0`. It is `2` when `history.jsonl` fails the schema.

## Evaluation runner and suites

`scripts/eval-runner.ts` executes declarative eval suites from `evals/suites/<slug>.json`.

Each suite specifies:
- `slug` and `title`: run identifier and description.
- `unit`: the unit under test (e.g. `rule:bug-fix-callers`).
- `arms`: test arms (e.g. `rule`, `none`, `placebo`).
- `matrix`: combination of harness, model, and effort settings.
- `fixtures`: list of fixtures with their expected sha256.
- `trials_per_cell`: number of repetitions per cell.
- `analysis`: statistical test rules (Fisher exact test alpha, min effect delta).

CLI flags:

| Flag | Meaning |
| --- | --- |
| `--dry-run` | Prints execution plan without running trials |
| `--mock` | Runs suite with simulated trial outcomes (for offline verification) |
| `--out <dir>` | Writes run outputs (`summary.json`, `analysis.txt`, `trials.jsonl`) to a custom directory |
| `--record` | Records run into `evals/runs/<date>-<slug>/` and appends cells to `evals/history.jsonl` |
| `--promote` | Updates `evidence.json` with the run's verdict and confidence bounds |

## Fixtures

| Fixture id | Fixture | Source | Tests |
| --- | --- | --- | --- |
| `fx4b` | storefront: two concurrent checkouts sell the last unit twice. The grader also checks the shared root cause (concurrent point awards) | synthetic project that a rig maintainer wrote for these evals. In `fixtures/fx4b/` | 4 |
| `fx3` | member directory: names with accents sort after Z | synthetic project that a rig maintainer wrote for these evals. In `fixtures/fx3/` | 4 |
| `ord` | order pipeline: three planted bugs in an implicit order state machine | synthetic project that a rig maintainer wrote for these evals. Not in the repo | 4 |
| `job-hub` | job hub: five planted bugs in implicit state machines, found by audit. The outcome is a score of 0 to 5 | synthetic project that a rig maintainer wrote for these evals. Not in the repo | 5 bugs |
| `rig-d3dc4ce` | rig at the commit before the fix of PR 45: `rig doctor` counts skills in orphaned plugin cache versions as duplicates | the public rig repository at the parent commit of the fix PR, graded by hidden tests written from that PR. Not in the repo | 51 |
| `rig-ab8d5ec` | rig at the commit before the fix of PR 53: `rig doctor` prints a drift error and the line that managed files match | same as `rig-d3dc4ce` | 21 |
| `rig-069847a` | rig at the commit before the fix of PR 47: `rig plan` blocks on an owned entry that changed kind. The grader drops the unit test of a helper that the prompt cannot name | same as `rig-d3dc4ce` | 3 |
| `swerebench-tox-dev__tox-3683` | SWE-rebench task: a real bug fix in tox, graded by hidden fail-to-pass tests. Prompt plus one line that names `./run-tests` | a task of the public SWE-rebench benchmark, graded by its fail-to-pass tests. Not in the repo | hidden tests |
| `swerebench-joke2k__django-environ-592` | SWE-rebench task: a real bug fix in django-environ, graded by hidden fail-to-pass tests. Prompt plus one line that names `./run-tests` | same as `swerebench-tox-dev__tox-3683` | hidden tests |

The sha256 values are in `history.jsonl`. fx3 and fx4b are in `fixtures/` with their primary graders. [fixtures/README.md](./fixtures/README.md) says what each one plants and what its grader checks. The other fixtures and graders are not in the repo. The `rig-<commit>` and `swerebench-<instance>` fixtures are full checkouts of public repositories, and their graders are hidden tests.

## Privacy gate and redaction

`scanPrivacy` in `scripts/evals-history.ts` scans every file under `evals/` and flags:

- a URL whose host is not `github.com`. `github.com` is the only allowed host. No committed file needs `huggingface.co` or `arxiv.org`, so they are not allowed.
- a `host:port` pair: a dotted host name or the loopback host name, followed by a colon and digits. A `file.ts:41` reference is not a host, so a name that ends in a common file extension passes.
- the loopback host name, and a host name that ends in `.local`, `.lan`, `.internal`, `.home`, `.corp` or `.intra`.
- an IPv4 address (four octets, each 0 to 255) and an IPv6 address in full or compressed form, including the loopback and link-local forms. A version such as `2.1.322` or a time such as `22:44:53` is not an address. A four-part version with every part below 256 looks like an address and is flagged.
- an absolute path under the macOS user root, the Linux home root, or the private, tmp, var-folders and Volumes roots, and a Windows path under a drive's Users root.
- a path that starts with a tilde and a slash, except under `~/.claude`, `~/.codex`, `~/.agents`, `~/.cursor`, `~/.config`, `~/.cache`, `~/.vscode` and `~/Library`. These are directories that every user of the tool or OS has. They name no person and no machine.
- a cluster name.

What the gate cannot see: a host name written with no scheme, no port and no private suffix, such as `example.org/path`. The gate does not scan `git log`, commit messages or file names. A new class goes into `scanPrivacy` and into its test together.

`prereg.md` and each amendment are copied verbatim, except for the redactions listed in `prereg.redactions` and in each amendment's `redactions`. A few preregistrations named a local clone path, a work folder or a home-relative state folder. That run's `summary.json` records the sha256 of the original file, the sha256 of the stored file, and the redaction. `analysis.txt` can carry redactions the same way, listed in `analysis.redactions`. The originals are not in the repo, so no test can show that the redaction is the only difference. The tests pin the stored hash and the rule that the two hashes differ exactly when a redaction is listed. They cannot pin that rule for `analysis.txt`, which has no hashes.

## What is backfilled

| Run | Source | Notes |
| --- | --- | --- |
| `2026-11-10-pilot-fx4b` | pilot, 5 trials per arm | no preregistration, fixture and grader hashes taken at backfill time, `analysis.txt` is backfill-rendered |
| `2026-11-10-rule-bug-fix-callers` | powered three-arm run | preregistered, analyzer output verbatim |
| `2026-11-10-hg-gstack-investigate` | H-G | preregistered, analyzer output verbatim |
| `2026-11-10-hp-pstack-formal-verification` | H-P | preregistered, analyzer output verbatim, one path redacted |
| `2026-11-10-judge-basal` | judge, 42 code and prose cases | dated 2026-11-10, the day the set ran, per `docs/design/rig-v1-concept.md`. The first backfill said 2026-11-11 and was corrected before the run reached main. The sources carry no run date |
| `2026-11-11-judge-prose` | judge, prose pairs | date is the recording date, the sources carry no run date |

The backfill was a one-shot script over a private scratch directory. It is not committed. The pilot results for fx2, fx3 and fx4 had a no-rule arm only and are not backfilled. Harness version and model id come from the init events of the trials. `rig_commit` is `null` for these runs: none of them depended on a rig commit.

Time and token fields were added after the first six runs. The four experiment runs of 2026-11-10 got 14 metrics lines, one per cell. The per-trial files of each run gave the duration, and the raw event stream of each trial gave the tokens. The backfill script reproduced `k`, `n`, `mean_cost_usd` and `mean_turns` of every one of these cells from the same files before it wrote the lines. No committed test repeats that check. The judge runs have no metrics.

Runs recorded with the metric fields inline:

| Run | Source | Notes |
| --- | --- | --- |
| `2026-11-11-pilot-principle-fix-root-causes` | pilot, 10 trials per arm and fixture | preregistered, analyzer output verbatim. Arms `with` and `none`. The unit was read in 1 of 20 `with` trials, so the verdict is `no-claim` |
| `2026-11-11-hp-formal-verification-audit` | H-A, 8 trials per arm | preregistered with one amendment. The outcome is bugs found, so `k` counts trials with all five bugs and `mean_score` carries the mean out of `score_max` 5 |
| `2026-11-11-gstack-investigate-full` | H-G repeated with the full shipped skill | preregistered, one path redacted in the preregistration and in the analysis. The skill arm is `told-full`, a different group from the stripped `told` arm. The `none` arm is a same-day rerun and shares its group with the earlier `none` arm |
| `2026-11-11-rig-default-vs-vanilla` | rig default install against vanilla, set A | preregistered, signed off, analyzer output verbatim. The sonnet cells ran at effort `medium`, so the `none` arm there is not comparable to the default-effort `none` arm of `2026-11-10-rule-bug-fix-callers`. The summary notes say so |
| `2026-11-11-rule-bug-fix-callers-rig-history` | rule, `placebo-v2` and none on three bugs from rig's own history (fixture ids `rig-<commit>`) plus fx4b and fx3, Sonnet | preregistered, signed off, analyzer output verbatim, one path and one home-relative path redacted. The verdict is `no-claim`. `placebo-v2` is a new placebo text, so it is a different group from the `placebo` arm of `2026-11-10-rule-bug-fix-callers` |
| `2026-11-11-rule-bug-fix-callers-matrix` | rule against none on fx3 and fx4b across Claude Code and codex, six configurations | preregistered, analyzer output verbatim, three paths redacted. Codex reports no cost, so its cells carry `null` and a `0` placeholder. agy was not run and has no cells |
| `2026-11-12-opus-frame-ablation` | Opus, rig default install against the same install with the clause "and the smallest change that meets it" removed from the frame, on fx4b and two SWE-rebench tasks (fixture ids `swerebench-<instance>`) | preregistered, analyzer output verbatim, no redaction. The verdict is `no-claim`. The run calls its baseline arm `vanilla`, the history calls it `none`. The unit is `rig/frame-ablation@2dbce75`, not `rig/default@2dbce75`, because the fx4b cells ran at 30 max turns and the 2026-11-11 run used 40. The 16-task calibration is kept as `calibration.txt` and has no history lines |
| `2026-11-12-rule-bug-fix-callers-matrix-cursor` | rule against none on fx3 and fx4b on Cursor with Grok 4.7 at medium and high effort, the cursor cells of the 2026-11-11 matrix | same preregistration as that run, which does not name Cursor (deviation 8), analyzer output verbatim, three paths redacted in the preregistration. The verdict is `no-claim`. Cursor reports no cost, so its cells carry `null`. The trial timeout was 900 s against 300 s for claude and codex, so durations are not comparable. agy cells of the matrix are not recorded: 27 of 40 trials ended in status ERROR and were quarantined |
| `2026-11-28-rule-bug-fix-callers-haiku` | smoke run of the steps in `CONTRIBUTING.md`: rule against none on fx3 and fx4b, Claude Code with Haiku at effort low and medium, 3 trials per cell | no preregistration, analyzer output verbatim, no redaction. The verdict is `descriptive`. It reuses the runner and isolation of the 2026-11-11 matrix on Claude Code 2.1.332 |
| `2026-11-28-rig-default-vs-vanilla-haiku` | rig default install at rig main 5064f66 against vanilla on fx3 and fx4b, Claude Code with Haiku at effort medium, arms none, rig and told (rig plus `/craft`), 5 trials per cell | no preregistration, analyzer output verbatim, no redaction. The verdict is `descriptive`. The unit is `rig/default@5064f66`, a new trend group. Two told trials have several result events and carry summed turns, tokens and duration, see the summary notes |

## What pins each guarantee

All tests are in `test/evals-history.test.ts` unless named otherwise.

| Guarantee | Test |
| --- | --- |
| Every history line fits the schema, and no two lines share a key | "history.jsonl schema" |
| The fixtures and graders in `fixtures/` hash to the values of every recorded fx3 and fx4b cell | `test/eval-fixture.test.ts`, "published fixtures" |
| The validator rejects bad lines | "the validator rejects each kind of bad line" |
| The seven metric fields come together on a cell, null is allowed, a score has its maximum | "history.jsonl schema": "a cell may carry the time and token fields inline, all or none, and null means the harness did not report them" and "a cell whose outcome is a score carries mean_score and score_max together" |
| A metrics line names the full cell key and carries every metric field, and nothing else | "history.jsonl schema": "a metrics line names the full cell key and carries every metric field" |
| A metrics line backfills an earlier cell, once, and never a cell that has the fields inline | "history.jsonl schema": "a metrics line backfills an earlier cell line and joins it" and "a metrics line is rejected without an earlier cell, for a second line of the same cell, or for a cell that carries the fields inline" |
| Every committed cell has the metrics, and metrics lines cover only the four runs that predate them | "time and token metrics in the committed history" |
| `total_cost_usd` equals `n` times `mean_cost_usd` for every cell that reports a cost | same group, "total_cost_usd equals n times mean_cost_usd" |
| Summaries accept amendments and analysis redactions and reject malformed ones | "summary.json schema"; the amendment hashes are pinned in "run directories" |
| Append-only: each git version of `history.jsonl` is a prefix of the next and of the working tree | "append-only history": "every git version of history.jsonl is a prefix of the next one and of the working tree", and the temp-repo tests for accepted appends and rejected edits |
| The append-only test cannot pass vacuously: a shallow clone that shows one commit fails, and CI checks out with `fetch-depth: 0` | "append-only history": "fails, and names fetch-depth, on a shallow clone" and "CI checks out the full history" |
| Every run id has a directory, a valid `summary.json`, an analysis file, and a `prereg.md` whose sha256 matches `stored_sha256` | "run directories" |
| `usable_trials` of an experiment run equals the sum of `n` over its lines, and is `null` for a judge run | "run directories" and "usable_trials" |
| The privacy gate flags each class listed above, passes the allowed forms, and passes versions, times and file references | "privacy gate": "URLs", "host and port", "the loopback name, private top-level names and cluster names", "IPv4 addresses", "IPv6 addresses", "absolute local paths", "home paths", "the scanner does not flag versions, times, units, file references or relative paths" |
| No file under `evals/` triggers the gate | "privacy gate": "no file under evals/ carries a private host, path, address or cluster name" |
| The trend flags a drop and a rise outside the noise, stays quiet inside it, and handles a first run | `test/evals-trend.test.ts`, "trend" |
| The trend flags a large change above 50% with 5 or more trials on both sides, and nothing at 50% or below, with fewer trials, or with a missing number | `test/evals-trend.test.ts`, "large change in cost, duration and tokens" |
| The trend joins a backfilled metrics line to its own cell only | same group, "a backfilled metrics line joins its cell before the comparison" and "does not mix a different group's metrics" |
| The report prints cost, duration and tokens with the rule, a dash for a missing number, and the score of a score cell | `test/evals-trend.test.ts`, "report and CLI" |
| The trend never compares groups that differ in unit, arm, harness, model, effort, fixture, fixture hash or grader hash | same file, "never compares groups" and "a changed fixture or grader hash starts a new group" |
