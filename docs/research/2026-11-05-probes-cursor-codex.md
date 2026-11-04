# Probes for slice 0: Cursor and Codex

Status: probe record, 2026-11-05. Five scripts in `probes/` ran against Cursor Agent 2026.10.22 and Codex CLI 0.166.0. The verdict JSON is `probes/results/cursor-codex.json`. Every run used a scratch workspace and a read-only mode (`cursor-agent --mode ask`, `codex exec -s read-only`). No probe wrote to a real harness directory.

## How to read the verdicts

Each script prints `{probe, claim, verdict, evidence, sets}`. `claim` names what PASS means for that probe. PASS confirms the claim, FAIL contradicts it, INCONCLUSIVE means the evidence does not settle it or an operator step is missing. `sets` holds the value for the target field.

Most evidence is model-reported. The model reads its own injected skill list or instructions and says what it sees. That is weaker than a tool-level listing, and neither CLI offers one (see probe b). Two guards reduce the risk. Each case ran twice, and each probe has a control that must pass first. Where the CLI gives an event stream (Codex `--json`, Cursor `stream-json` in probe j), the stream shows no tool call, so the text came from injected context and not from a file read. Probe b uses Cursor's `json` output, which has no event stream, so tool use there is unchecked (see "Weak spot in probe b").

Re-run all five:

```
for p in b-cursor-dedupe j-cursor-plugin-rules d-codex-agents-md-limit f-codex-skill-hiding i-cursor-codex-headless-flags; do
  node probes/$p.mjs --out "probes/results/$p.json"
done
```

`probes/results/cursor-codex.json` merges the five outputs under `probes[]`. The scripts use Node built-ins only and take `--scratch <dir>`, `--timeout <s>` and, for Cursor, `--model <id>`.

## Summary

| Probe | Verdict | Sets | Assumption |
|---|---|---|---|
| b, Cursor skill dedupe | FAIL | `cursor.reads.skills[].dedupe = by-name` | A23 refuted |
| j, Cursor plugin channel and rules | INCONCLUSIVE | plugin dir loads, project rules load, user rules open | A24 open |
| d, Codex `AGENTS.md` limit | PASS | `codex.instructions.byteLimit = 32768` | A32 confirmed |
| f, Codex skill hiding | PASS | `agents/openai.yaml` hides, `disable-model-invocation` does not | A12 half confirmed |
| i, headless flags | PASS | `cursor.headless`, `codex.headless` | none |

## b. Cursor skill dedupe

What ran. A scratch workspace per case, with the skill in `.cursor`, `.agents`, `.claude` and `.codex` under `skills/`. Case `dup` used identical bytes. Case `diff` used a different description token per copy. Case `link` used a real copy in `.agents` and symlinks in the other three. Case `ctl` put one uniquely named skill in each directory, plus `rigprobe-prec` in the three non-Cursor directories with a different token each. Each case ran twice with `cursor-agent -p --output-format json --mode ask --trust`. The prompt is the one in the task, plus a request for one `ENTRY | name | path | token` line per list entry. The script counts distinct source directories, because the model sometimes repeats one entry.

Evidence. `cursor-agent` and its subcommands have no command that lists skills without a model call (the script scans seven help screens for "skill" and finds none). In both runs of `ctl`, all four project directories contribute skills, so a missing copy means collapse and not "not read". In both runs of `dup`, `diff` and `link`, exactly one entry appears, always from `.cursor/skills`, and the `diff` entry carries the `.cursor` token. In `ctl`, the `rigprobe-prec` entry that survives comes from `.claude`, not from `.agents` or `.codex`.

Verdict. Cursor collapses a skill by name, even when the bytes differ. The first source wins. Observed order for project directories: `.cursor`, then `.claude`, then `.agents` or `.codex` (their relative order is not tested, because `.claude` beat both). A23 is refuted for project directories.

Limits. Model-reported. Project directories only. User-level directories (`~/.claude/skills`, `~/.cursor/skills`) need a real-directory write, so they are not tested. A development run (not in the JSON) showed Cursor's skill list holding roots under the user's `~/.claude/skills`, `~/.agents/skills` and `~/.claude/plugins/cache`. If that holds, a skill that rig delivers on the Claude plugin channel can also reach Cursor, and the by-name collapse then decides which copy Cursor shows. A follow-up with a fixture in a real home directory would settle that; it needs an operator.

Field. `cursor.reads.skills[].dedupe = by-name`.

## j. Cursor plugin channel and rules

What ran. A scratch plugin with `.cursor-plugin/plugin.json` and two skills: `rigprobe-plugin` with `disable-model-invocation: true`, and `rigprobe-plugin-shown`. Loaded with `--plugin-dir`. A scratch workspace held a hidden project skill and `.cursor/rules/rigprobe.mdc` with `alwaysApply: true` and a sentinel. The runs used `--output-format stream-json`.

Evidence and sub-verdicts.

| Check | Verdict | Evidence |
|---|---|---|
| `--plugin-dir` loads a plugin skill | PASS | The shown skill is in the list with a path in the plugin directory. |
| `disable-model-invocation` hides from the list | PASS | The hidden plugin skill and the hidden project skill are absent. |
| Hidden plugin skill is invocable | PASS | The prompt `/rigprobe-plugin` returns its sentinel. |
| Hidden project skill is invocable (control) | PASS | The prompt `/rigprobe-projhidden` returns its sentinel. |
| Project rule with `alwaysApply: true` | PASS | The model quotes the sentinel, and the stream has no tool event. |
| User-level `~/.cursor/rules/*.mdc` | INCONCLUSIVE | Needs operator. |
| User-level `~/.cursor/plugins/local/` | INCONCLUSIVE | Needs operator. |

Needs operator. Writing `~/.cursor/rules/rigprobe-user.mdc` and a fixture under `~/.cursor/plugins/local/` touches the real home directory. The script names both steps in `needsOperator`.

Weak supporting observation for A24. The script takes the first line of an existing user-level always-on rule and asks whether the headless context holds it. Its controls were unreliable. In the recorded run, the positive control (a project rule line) answered YES twice and the negative control NO twice, and the user rule line got NO twice, so the reading is "not in the headless context". In earlier runs the positive control answered NO at least once, so this reading is unproven. A second observation: the machine has a plugin in `~/.cursor/plugins/local/`, and the listing showed no entry from that path while it showed entries from `~/.cursor/plugins/cache/`. Treat both as hints that Cursor's headless mode may skip user-level rules and local plugins, to confirm with the operator step.

Overall verdict is the worst sub-verdict, so INCONCLUSIVE.

Fields. `cursor.channels.pluginDir` (flag `--plugin-dir`, manifest `.cursor-plugin/plugin.json`, loads skills). `cursor.skills.hiddenByDisableModelInvocation` (not listed, invocable by slash). `cursor.reads.projectRules.alwaysApply = true`. `cursor.reads.userRules` stays unset.

A24 stays open at score 5, with a lean toward "user rules not loaded in headless mode". Design note: rig can reach Cursor through `--plugin-dir` and project rules. It should not rely on `~/.cursor/rules` until the operator step passes.

## d. Codex `AGENTS.md` size limit

What ran. A scratch git repo with a 40,995-byte `AGENTS.md`. Nine sentinel lines sit at byte offsets 4096, 16384, 30720, 31744, 32700, 32800, 33280, 36864 and 39936. `codex exec -s read-only --ephemeral --ignore-user-config --ignore-rules --json` asked for every `RIGSENT-` line "in your instructions", with no file reads. Two runs at the default limit, one run with `-c project_doc_max_bytes=65536`.

Evidence. Both default runs list the first five sentinels (up to the one that ends at byte 32,714) and none of the last four (the first of them starts at 32,800). The raised-limit run lists all nine. The event stream has no tool item. The binary holds the default `project_doc_max_bytes = 32768`. `codex --help` and `codex exec --help` do not mention it.

Verdict. The cut sits between byte 32,714 and byte 32,800. That fits 32,768 bytes (32 KiB). The sentinel spacing leaves 86 bytes of uncertainty. The key `project_doc_max_bytes` raises the limit.

Limit of the test. The user-level `~/.codex/AGENTS.md` stayed in place. It may not load under `--ignore-user-config`. The cut near 32,768 shows it did not shrink the project budget in this run.

Field. `codex.instructions.byteLimit = 32768`. Resolves A32. The `budget` warning at 8 KiB stays a rig choice, not a harness fact.

## f. Codex skill hiding

What ran. A scratch git repo with `.agents/skills/` holding `rigprobe-shown`, `rigprobe-hidden` (with `agents/openai.yaml` setting `policy.allow_implicit_invocation: false`) and `rigprobe-dmi` (with `disable-model-invocation: true` in the frontmatter). `codex exec` asked for the list of skills starting with `rigprobe`, twice. Then it invoked `$rigprobe-hidden` and `$rigprobe-dmi`.

Evidence. Codex reads repo `.agents/skills`: the control is listed in both runs. Both runs list `rigprobe-shown` and `rigprobe-dmi` and not `rigprobe-hidden`. Both explicit invocations return their sentinel. The binary holds the string `allowImplicitInvocation`.

Verdict. `agents/openai.yaml` with `policy.allow_implicit_invocation: false` removes a skill from the listing, and `$name` still invokes it. The Claude-style `disable-model-invocation` key does nothing on Codex.

Limit. Repo skills only. `~/.agents/skills` and `~/.codex/skills` are not tested.

Field. `codex.skills.hide = agents/openai.yaml policy.allow_implicit_invocation: false`. A12 is half confirmed: `openai.yaml` hides a skill, and Codex does not accept `disable-model-invocation`. rig must render the YAML file for Codex.

## i. Headless flags (Cursor and Codex)

What ran. The script reads `cursor-agent --help`, `codex exec --help` and `codex --help` and checks each expected flag. No model call.

Cursor: `-p, --print`, `--output-format text|json|stream-json`, `--model` (with bracket overrides such as `[effort=high]`), `--mode plan|ask` for read-only, `--workspace`, `--sandbox enabled|disabled`, `--trust`, `--plugin-dir`, `-f/--force`, `--list-models`. The help says print mode "has access to all tools, including write and shell", so a read-only probe needs `--mode ask`.

Codex: `codex exec` with `--json`, `-m`, `-s read-only|workspace-write|danger-full-access`, `-C`, `--skip-git-repo-check`, `--ephemeral`, `-o`, `--output-schema`, `-c key=value`, `--ignore-user-config`, `--ignore-rules`. The approval flag `-a` exists on `codex` and not on `codex exec`.

Verdict. PASS. Fields: `cursor.headless` and `codex.headless` in the JSON.

## Weak spot in probe b

In a probe b development run, the model named folders that were in the workspace but not in its list. It can see the directory tree, and `json` output cannot show whether it looked at the files. The `ctl` control (all four directories produce entries) and the identical result in all eight runs make a systematic error unlikely, and it is not ruled out. A tool-level listing or an IDE check would remove the doubt.

## Assumption changes

| # | Change |
|---|---|
| A12 | Half confirmed. `openai.yaml` hides. `disable-model-invocation` is ignored on Codex. |
| A23 | Refuted for project directories. Cursor collapses by name, first source wins. |
| A24 | Open. Project rules confirmed. User rules need an operator step. Weak hint that headless mode skips them. |
| A32 | Confirmed. The cap is 32,768 bytes and `project_doc_max_bytes` changes it. |

## Not run

- User-level Cursor rules and local plugins (real-directory write).
- Cursor and Codex user-level skill directories (real-directory write).
- Cursor interactive (IDE) behavior. All Cursor results are for `cursor-agent -p`.
