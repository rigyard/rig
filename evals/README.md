# evals

Eval and benchmark results of rig, kept in the repo so that you can see over time whether a unit, a harness, a model or an effort setting got better or broke.

This directory holds results only. It holds no transcripts, no diffs and no fixture source. Fixtures and graders are named by id and by sha256.

## Layout

```
evals/
  README.md
  history.jsonl                 one line per cell, append-only
  runs/<YYYY-MM-DD>-<slug>/
    summary.json                what the run asked, how it ended, the verdict
    analysis.txt                the analyzer output
    prereg.md                   the preregistration, when the run had one
```

`scripts/evals-trend.ts` prints the trend. `scripts/evals-history.ts` holds the schema and the privacy scan.

```
node scripts/evals-trend.ts
```

## history.jsonl

One JSON object per line. A line is a **cell**: one arm of one run on one fixture. Or it is a **judge** line: one judge model on one subset of a judge case set. The schema is closed. A line with an unknown field is invalid.

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
| `note` | optional, one sentence on how to read this cell |

Judge lines have `kind` `judge` and: `run`, `date`, `judge_set`, `model` (a model name only), `subset`, `n`, `pairs` (`n / 2` or `null`), `auc`, `auc_ci95` (two numbers), `pair_acc` (or `null`), `cases_sha256`, and an optional `note`.

The group of a cell is `(unit, arm, harness, model, effort, fixture, fixture_sha256, grader_sha256)`. The key of a line is its kind, its run and its group, without the two hashes. Two lines never share a key.

Rules for writers:

- Append. Never edit or delete an older line. To correct a wrong line, append the corrected run under a new run id and say why in its `summary.json` notes. The one exception is a version of `history.jsonl` that never reached main. The test lists such a version by its sha256 (see the pin table).
- `k` counts the same pass that the run's preregistration calls a pass. Trials that ended at the turn limit count when the preregistration says they are graded as they stand.
- Do not put a host name, an IP address, an absolute local path, a home-relative path or a cluster name in any file here. The privacy gate below checks the classes it lists. It is a pattern check, not a proof, so read your own diff too.

## summary.json

Fields: `schema`, `run`, `date`, `kind` (`experiment` or `judge`), `title`, `question`, `prereg` (`null` or `file`, `original_sha256`, `stored_sha256`, `redactions`), `analysis` (`file` and `origin`), `lines` (history lines of the run), `usable_trials`, `verdict`, `notes`.

`verdict.label` is one of:

| Label | Meaning |
| --- | --- |
| `claim-allowed` | the preregistered decision rule allows the claim |
| `hypothesis-supported` | the preregistered rule supports the hypothesis, with the wording the preregistration allows |
| `hypothesis-contradicted` | the preregistered rule contradicts the hypothesis |
| `no-claim` | the preregistered rule allows no claim |
| `descriptive` | no preregistered decision rule, numbers only |

`verdict.text` is the decision line of the analyzer, or one sentence for a run without an analyzer. `analysis.origin` is `analyzer` when `analysis.txt` is the analyzer output verbatim, and `backfill` when the backfill rendered it from the trial records or the results file.

## The trend

`node scripts/evals-trend.ts [history.jsonl]` groups the cell lines by group (a changed fixture or grader hash is a new group, so runs on different fixture versions are never compared), orders each group by date and then by position in the file, and compares the latest run with the previous run of the same group.

The flag rule is a 95% Wilson score interval on `k / n` for both runs. The status is `DROP` when the latest interval lies fully below the previous one, `RISE` when it lies fully above, `noise` otherwise, and `first run` when the group has one run. This is a conservative bar. Two 15-trial runs flag 15/15 against 3/15 and stay quiet on 8/15 against 6/15.

Limits you should know:

- The script compares two runs only. A drop that persists reads `noise` on the run after it. Read the older line or keep the first flag in the run notes.
- A change of harness version is printed next to the status. It is not part of the group, so a version bump and a real change look alike. Check the version before you blame a unit.
- A changed fixture or grader hash splits a group. The old group keeps its last run and the new group prints `first run`. The `fixture/grader sha` column shows the first eight hex digits of each hash, so two groups that differ only there stay apart in the table.
- The script does not compare arms of one run. The run's `analysis.txt` does that, with its preregistered test.
- Judge lines are counted, not trended.
- Exit code is `0`. It is `2` when `history.jsonl` fails the schema.

## Fixtures

| Fixture id | Fixture | Tests |
| --- | --- | --- |
| `fx4b` | storefront: two concurrent checkouts sell the last unit twice. The grader also checks the shared root cause (concurrent point awards) | 4 |
| `fx3` | member directory: names with accents sort after Z | 4 |
| `ord` | order pipeline: three planted bugs in an implicit order state machine | 4 |

The sha256 values are in `history.jsonl`. The fixtures and graders live outside this repo.

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

`prereg.md` is copied verbatim, except for the redactions listed in `prereg.redactions`. One preregistration named a local clone path in a source line. That run's `summary.json` records the sha256 of the original file, the sha256 of the stored file, and the redaction. The original is not in the repo, so no test can show that the redaction is the only difference. The tests pin the stored hash and the rule that the two hashes differ exactly when a redaction is listed.

## What is backfilled

| Run | Source | Notes |
| --- | --- | --- |
| `2026-11-10-pilot-fx4b` | pilot, 5 trials per arm | no preregistration, fixture and grader hashes taken at backfill time, `analysis.txt` is backfill-rendered |
| `2026-11-10-rule-bug-fix-callers` | powered three-arm run | preregistered, analyzer output verbatim |
| `2026-11-10-hg-gstack-investigate` | H-G | preregistered, analyzer output verbatim |
| `2026-11-10-hp-pstack-formal-verification` | H-P | preregistered, analyzer output verbatim, one path redacted |
| `2026-11-10-judge-basal` | judge, 42 code and prose cases | dated 2026-11-10, the day the set ran, per `docs/design/rig-v1-concept.md`. The first backfill said 2026-11-11 and was corrected before the run reached main. The sources carry no run date |
| `2026-11-11-judge-prose` | judge, prose pairs | date is the recording date, the sources carry no run date |

The backfill was a one-shot script over a private scratch directory. It is not committed. The pilot results for fx2, fx3 and fx4 had a no-rule arm only and are not backfilled. Harness version and model id come from the init events of the trials. `rig_commit` is `null` everywhere: none of these runs depended on a rig commit.

## What pins each guarantee

All tests are in `test/evals-history.test.ts` unless named otherwise.

| Guarantee | Test |
| --- | --- |
| Every history line fits the schema, and no two lines share a key | "history.jsonl schema" |
| The validator rejects bad lines | "the validator rejects each kind of bad line" |
| Append-only: each git version of `history.jsonl` is a prefix of the next and of the working tree | "append-only history": "every git version of history.jsonl is a prefix of the next one and of the working tree", and the temp-repo tests for accepted appends and rejected edits |
| The append-only test cannot pass vacuously: a shallow clone that shows one commit fails, and CI checks out with `fetch-depth: 0` | "append-only history": "fails, and names fetch-depth, on a shallow clone" and "CI checks out the full history" |
| Every run id has a directory, a valid `summary.json`, an analysis file, and a `prereg.md` whose sha256 matches `stored_sha256` | "run directories" |
| `usable_trials` of an experiment run equals the sum of `n` over its lines, and is `null` for a judge run | "run directories" and "usable_trials" |
| The privacy gate flags each class listed above, passes the allowed forms, and passes versions, times and file references | "privacy gate": "URLs", "host and port", "the loopback name, private top-level names and cluster names", "IPv4 addresses", "IPv6 addresses", "absolute local paths", "home paths", "the scanner does not flag versions, times, units, file references or relative paths" |
| No file under `evals/` triggers the gate | "privacy gate": "no file under evals/ carries a private host, path, address or cluster name" |
| The trend flags a drop and a rise outside the noise, stays quiet inside it, and handles a first run | `test/evals-trend.test.ts`, "trend" |
| The trend never compares groups that differ in unit, arm, harness, model, effort, fixture, fixture hash or grader hash | same file, "never compares groups" and "a changed fixture or grader hash starts a new group" |
