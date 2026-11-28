# Add an eval for another model

This guide shows you how to run an existing eval on a new model, harness or effort setting, and how to record the result. The 2026-11-28 Haiku smoke run tested the planning and recording steps on a small budget, with the maintainer's runner. No recorded trial has used the by-hand flow yet. The smoke run skipped the preregistration, so its verdict is descriptive. It also skipped the canary check. [REPORT.md](./REPORT.md) summarizes the results so far. [README.md](./README.md) is the reference for the file formats.

## Know what the repository holds

The repository holds everything that you need to run the unit `rule:bug-fix-callers` on fixtures fx3 and fx4b by hand. It does not hold a live trial runner or the other fixtures.

| Part | Where it is |
| --- | --- |
| Results, `summary.json`, preregistrations | `evals/runs/` and `evals/history.jsonl` |
| Schema and privacy gate | `scripts/evals-history.ts`, tested by `test/evals-history.test.ts` |
| Trend | `scripts/evals-trend.ts` |
| fx3 and fx4b: project trees, primary graders, prompts, and the rule text | `evals/fixtures/`. [fixtures/README.md](./fixtures/README.md) defines each fixture, its grader and its hashes |
| Prepare and grade one trial | `scripts/eval-fixture.ts`, tested by `test/eval-fixture.test.ts` |
| Suite planner | `scripts/eval-runner.ts`. It plans a suite and runs mock trials. It cannot run live trials, because it does not start a harness |
| The other fixtures and graders, the secondary fx4b grader, and the live trial runner of earlier runs | Not in the repository |

To test a unit whose fixtures are not in the repository, open an issue that names the unit, the harness, the model and the effort. A maintainer can run the cells.

Do not run `scripts/eval-runner.ts --record`. Without `--dry-run` it writes no trials, and with `--dry-run` it records mock cells. Both append lines to `history.jsonl`, and that file is append-only.

## Plan the run

1. Pick the unit and the fixtures from an earlier run. Reuse its fixture and grader hashes, so that your cells join the existing trend groups. `node scripts/eval-fixture.ts hash <fx>` prints them for fx3 and fx4b.
2. Name each configuration by three values: the harness, the model id as the harness reports it, and the effort. Use `default` when you pass no effort flag.
3. Keep the arms of the earlier run. For `rule:bug-fix-callers` the arms are `rule` and `none`.
4. Choose the number of trials per cell. Use 5 or more for a claim. A smoke run of 3 trials per cell checks the setup and gives descriptive numbers only.
5. Write `prereg.md` before the first trial. It names the question, the configurations, the arms, the decision rule, the trial count, the infra rules and the open assumptions. Use `runs/2026-11-11-rule-bug-fix-callers-matrix/prereg.md` as the model.

## Isolate the harness

The arms must differ by one thing only. Your own instructions, skills and MCP servers must not reach the model. The table gives the command and the isolation per harness. The rows for Claude Code, Codex, Cursor and Antigravity are what the 2026-11-11 matrix runner used. The omp row comes from rig's omp probes and from checks on 2026-11-28 with omp 18.16.0. The 2026-11-28 omp run, with `tencent/hy4-flash` through OpenRouter, used this row. Its summary lists the differences from the other recorded runs. Replace `<provider>`, `<id>`, `<level>`, `<dir>` and `<prompt>` with your values. `<trial>` is a scratch folder of the trial, outside `<dir>`.

| Harness | Headless command, run in `<dir>` with stdin closed | Isolation | Instruction file for the `rule` arm | Effort |
| --- | --- | --- | --- | --- |
| Claude Code | `claude -p "<prompt>" --output-format stream-json --verbose --model <id> --effort <level> --max-turns 20 --permission-mode acceptEdits --allowedTools "Bash(node *)" "Bash(git *)" "Bash(ls *)" "Bash(cat *)" "Bash(grep *)" "Bash(find *)" --no-session-persistence --setting-sources project,local --strict-mcp-config` | The flags in the command. Subscription login, with `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` removed | `CLAUDE.md` | `--effort <level>`. Leave the flag out for `default`. The harness does not echo it |
| Codex | `codex exec -m <id> -c model_reasoning_effort="<level>" -c approval_policy="never" -s workspace-write --json -C <dir> "<prompt>"` | A fresh `HOME` and a fresh `CODEX_HOME` per trial. `CODEX_HOME` holds only `auth.json`, a link to your login file | `AGENTS.md` | `-c model_reasoning_effort`. The rollout file echoes it in `turn_context` |
| Cursor | `cursor-agent -p --output-format stream-json --model <id>-<level> --trust "<prompt>"` | A fresh `HOME` per trial that holds only `Library/Keychains`, a link to your login keychain, and `.cursor/cli-config.json` with `approvalMode` `allowlist` and the shell commands node, git, ls, cat, grep and find. `CURSOR_*` variables removed | `AGENTS.md` | The suffix of the model id. The init event echoes it in the model name |
| Antigravity | `agy -p "<prompt>" --output-format stream-json --model <id>-<level> --dangerously-skip-permissions --sandbox --print-timeout <seconds>s` | A fresh `HOME` per trial that holds only `Library/Keychains`, a link to your login keychain | `AGENTS.md`. agy also loads `GEMINI.md` and `.agents/rules/*.md` | The suffix of the model id. `init.model` echoes it |
| omp | `omp -p --mode json --no-session --model <provider>/<id> --thinking=<level> --max-time 5m "<prompt>"`. An open stdin pipe hangs it with no output. `--max-time` sets the wall-clock limit. omp has no turn cap flag | A fresh `PI_CODING_AGENT_DIR` and a fresh `HOME` per trial, both under `<trial>`. Remove `OMP_PROFILE`, `PI_PROFILE`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME` and `COPILOT_HOME` from the environment. omp took its login from the environment in every run, and the isolated agent dir holds none, so pass only the key variable of your provider. omp asks for no tool approval and has no sandbox flag: see "Sandbox omp" | `AGENTS.md`. Verified: omp loads a project-root `AGENTS.md`, also when `.git/info/exclude` lists it, and it wins over a `CLAUDE.md` at the same depth. omp does not load a project-root `GEMINI.md`. It reads that file only from `.gemini/`. Source: the built-in docs page `context-files.md`, which `omp read` prints with no model call, and one canary run | `--thinking=<level>`, one of off, minimal, low, medium, high, xhigh, max and auto, as `omp --help` lists them. Record `default` when you pass no flag. Verified echo: the assistant `message_end` event carries `message.provider` and `message.model`. For `--model openrouter/tencent/hy4-flash` they are `openrouter` and `tencent/hy4-flash` |

For Claude Code, Codex, Cursor and Antigravity, the runner also removed `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and the `ORCA_*`, `CODEX_*`, `AGY_*`, `ANTIGRAVITY_*` and `GEMINI_*` variables from the environment. For all of them except Claude Code it removed `OPENAI_API_KEY`. The login keychain links work on macOS only. Keep `<dir>` out of any folder that holds a `CLAUDE.md` or an `AGENTS.md`, because some harnesses also load the files of parent folders.

Before the first trial, check isolation with a canary. Put a unique word in the project instruction file and ask the model to quote its project instructions and any global instructions. The model must quote the canary and report no global instructions. Record the result in `deviations.md` before any trial.

### Sandbox omp

In print mode omp runs with the approval mode `yolo` (built-in docs page `approval-mode.md`, printed by `omp read`). The agent can run any shell command and edit any file without asking. omp has no sandbox flag. Run it inside an OS sandbox or a throwaway container, pass it only the key variable of your provider, and deny reads of your home folder. On macOS, a `sandbox-exec` profile like this one does that:

```
(version 1)
(allow default)
(deny file-read* (subpath "<home-root>"))
(deny file-write*)
(allow file-write* (subpath "<trial-root>") (subpath "<var-folders>") (subpath "/dev"))
```

Replace `<home-root>` with the root of the user home folders, `<trial-root>` with the folder that holds `<dir>` and `<trial>`, and `<var-folders>` with the `var/folders` folder under the macOS `private` root, where the per-user temp folders live. Put `<trial-root>` outside your home folder, or omp cannot read the fixture. The profile also blocks an omp or node binary installed under your home folder. In a check run with this profile, an agent that tried to write a scratch file in the system tmp folder got an error. Expect that, and use the same sandbox in both arms.

### Differences from the recorded runs

An omp cell differs from the recorded cells of the other harnesses in four ways. Name them in the note of each omp cell:

- omp approves every tool call by itself, where the recorded runs used an allowlist or a harness sandbox.
- The OS sandbox is yours, not the harness's.
- Writes outside the trial folder, the system tmp folder included, fail under the profile above.
- omp has no turn cap. Only `--max-time` limits a trial.

Record the harness version from `omp --version`, which prints `omp/18.16.0`. The `version` field of the JSON `session` event is the version of the session format, for example 3. It is not the omp version.

## Run a trial by hand

Run these commands from the rig checkout. Use a new, empty `<dir>` outside the checkout for each trial. `prepare` refuses a directory that is not empty or that is inside the checkout.

```sh
node scripts/eval-fixture.ts prepare fx4b rule <dir>
node scripts/eval-fixture.ts prompt fx4b
```

1. `prepare` copies the fixture into `<dir>`, runs `git init` and stages the files. In the `rule` arm it writes the rule text into the instruction file. The default file is `AGENTS.md`. For Claude Code, add `--instruction-file CLAUDE.md`. The `none` arm writes no instruction file. In both arms `.git/info/exclude` lists the instruction file, so the file does not show in the agent's diff.
2. Run your harness headless in `<dir>`, with the prompt that `prompt` prints. Take the command and the isolation from the table in "Isolate the harness". Keep the harness log outside `<dir>`. Earlier runs stopped a trial after 300 s on Claude Code and Codex, and after 900 s on Cursor and Antigravity. Set the agy `--print-timeout` 10 s below the trial timeout. After the run, search the log for `grader.check` and `evals/fixtures`. A hit means that the agent may have seen a grader. Move that trial to quarantine and rerun it.
3. Grade the trial:

```sh
node scripts/eval-fixture.ts grade fx4b <dir>
```

`grade` copies the grader into `<dir>`, runs it, removes it again and prints the result as JSON. It exits 0 when the trial passes, 1 when it fails, and 2 on a usage error. A trial passes only when all 4 tests run and pass.

For omp, step 2 looks like this. It closes stdin, gives omp a fresh home and agent dir, passes only `PATH` and your provider key variable `<KEY_VAR>`, and runs omp in the sandbox of "Sandbox omp" with the profile saved as `<trial-root>/omp.sb`. `env -i` starts from an empty environment, so the variables that the table removes are gone too. `<trial-root>`, `<trial>` and `<dir>` are absolute paths here, and the subshell keeps you in the rig checkout for step 3:

```sh
PROMPT="$(node scripts/eval-fixture.ts prompt fx4b)"
mkdir -p <trial>/user-home <trial>/agent-dir
(cd <dir> && env -i PATH="$PATH" HOME=<trial>/user-home PI_CODING_AGENT_DIR=<trial>/agent-dir <KEY_VAR>="$<KEY_VAR>" \
  sandbox-exec -f <trial-root>/omp.sb \
  omp -p --mode json --no-session --model <provider>/<id> --max-time 5m "$PROMPT" < /dev/null > <trial>/events.jsonl)
```

Repeat the three steps for each fixture, arm and trial, in the interleaved order of "Run the batch". Note the result of each trial with its fixture, arm and trial number, its wall time, and the turns, tokens and cost that the log reports. You need these values when you record the cells.

## Run a first chunk

1. Run 1 to 3 trials of one configuration.
2. Check the model id that the harness echoes. A different id is an infra failure, not a result. omp splits the id that you passed into two fields: compare `message.provider` and `message.model` with the `<provider>` and the `<id>` of `--model <provider>/<id>`.
3. Check the effort. Codex and Cursor echo it. Claude Code does not, so record the flag that you passed.
4. Check exposure. The rule arm must have the instruction file in context, and the baseline arm must not. Earlier runs compared the first-turn input tokens of the two arms for Claude Code, and read the rollout or chat store for Codex and Cursor.
5. Check the grade. The grader runs after the trial, and the agent never sees it.

If you change anything after the first chunk, delete those trials, rerun them and record the change in `deviations.md`.

## Run the batch

1. Interleave the order: for each trial number, run every configuration, fixture and arm, and flip the arm order on even trials.
2. Retry an infra failure once. An infra failure is a trial with no agent activity, a wrong model echo, or a usage-limit or rate-limit error. A second failure is a missing trial. It is neither a pass nor a fail.
3. Stop the batch on a usage limit. Wait, then run the trials that are not finished.
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
