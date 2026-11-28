# Add an eval for another model

This guide shows you how to run an existing eval on a new model, harness or effort setting, and how to record the result. The 2026-11-28 Haiku smoke run tested these steps on a small budget. It skipped the preregistration, so its verdict is descriptive. It also skipped the canary check. [REPORT.md](./REPORT.md) summarizes the results so far. [README.md](./README.md) is the reference for the file formats.

## Know what the repository holds

The repository holds results, the history schema, the trend script and the privacy gate. It does not hold everything that you need to run a trial:

| Part | Where it is |
| --- | --- |
| Results, `summary.json`, preregistrations | `evals/runs/` and `evals/history.jsonl` |
| Schema and privacy gate | `scripts/evals-history.ts`, tested by `test/evals-history.test.ts` |
| Trend | `scripts/evals-trend.ts` |
| Suite planner | `scripts/eval-runner.ts`. It plans a suite and runs mock trials. It does not start a harness |
| Fixtures, graders and the live trial runner | Outside the repository. A maintainer holds them |

If you do not have the fixtures, open an issue that names the unit, the harness, the model and the effort that you want to test. A maintainer can run the cells, or share the fixture and grader for that unit.

Do not run `scripts/eval-runner.ts --record`. Without `--dry-run` it writes no trials, and with `--dry-run` it records mock cells. Both append lines to `history.jsonl`, and that file is append-only.

## Plan the run

1. Pick the unit and the fixtures from an earlier run. Reuse its fixture and grader hashes, so that your cells join the existing trend groups.
2. Name each configuration by three values: the harness, the model id as the harness reports it, and the effort. Use `default` when you pass no effort flag.
3. Keep the arms of the earlier run. For `rule:bug-fix-callers` the arms are `rule` and `none`.
4. Choose the number of trials per cell. Use 5 or more for a claim. A smoke run of 3 trials per cell checks the setup and gives descriptive numbers only.
5. Write `prereg.md` before the first trial. It names the question, the configurations, the arms, the decision rule, the trial count, the infra rules and the open assumptions. Use `runs/2026-11-11-rule-bug-fix-callers-matrix/prereg.md` as the model.

## Isolate the harness

The arms must differ by one thing only. Your own instructions, skills and MCP servers must not reach the model.

| Harness | Isolation that earlier runs used | Arm file |
| --- | --- | --- |
| Claude Code | `--setting-sources project,local --strict-mcp-config --no-session-persistence`, a fixed tool allowlist, API key variables removed | `CLAUDE.md` |
| Codex | A fresh `HOME` and `CODEX_HOME` per trial, with only a link to the login file | `AGENTS.md` |
| Cursor | A fresh `HOME` per trial, with only a link to the login keychain, and the shell commands node, git, ls, cat, grep and find allowed | `AGENTS.md` |
| Antigravity | A fresh `HOME` per trial, with only a link to the login keychain | `AGENTS.md` |

Before the first trial, check isolation with a canary. Put a unique word in the project instruction file and ask the model to quote any global instructions. The model must quote the canary and report no global instructions.

## Run a first chunk

1. Run 1 to 3 trials of one configuration.
2. Check the model id that the harness echoes. A different id is an infra failure, not a result.
3. Check the effort. Codex and Cursor echo it. Claude Code does not, so record the flag that you passed.
4. Check exposure. The rule arm must have the arm file in context, and the baseline arm must not. Earlier runs compared the first-turn input tokens of the two arms for Claude Code, and read the rollout or chat store for Codex and Cursor.
5. Check the grade. The grader runs after the trial, and the agent never sees it.

If you change anything after the first chunk, delete those trials, rerun them and record the change in `deviations.md`.

## Run the batch

1. Interleave the order: for each trial number, run every configuration, fixture and arm, and flip the arm order on even trials.
2. Retry an infra failure once. An infra failure is a trial with no agent activity, a wrong model echo, or a usage-limit or rate-limit error. A second failure is a missing trial. It is neither a pass nor a fail.
3. Stop the batch on a usage limit. Wait, then rerun the same command. Finished trials are skipped.
4. Grade a trial that timed out or hit the turn limit on the files that it left. Never grade a trial that a usage limit cut off. Move it to quarantine and rerun it.

## Record the result

1. Create `evals/runs/<YYYY-MM-DD>-<slug>/` with `summary.json`, `analysis.txt`, and `prereg.md` when the run has one. Add `deviations.md` when you deviated from the preregistration.
2. Append one cell line per configuration, fixture and arm to `evals/history.jsonl`. Include the seven time and token fields. Write `null` for a number that the harness does not report.
3. Remove host names, absolute paths and home paths from every file. The privacy gate lists the classes that it checks.
4. Add a row for the run to the "Runs recorded with the metric fields inline" table in [README.md](./README.md).
5. Add the verdict to [REPORT.md](./REPORT.md): one row in Appendix A, the cells in Appendix B, and at most one changed sentence in the body.
6. Run the checks:

```sh
npm test
node scripts/evals-trend.ts
```

## Keep the cost down

- Start with the cheapest configuration and one fixture.
- Use a smoke run of 3 trials per cell to find setup faults before a full run.
- Cap the number of harness runs per batch, retries included.
- Run at most 2 Claude Code trials at once on a shared subscription.
