# Claude Code probes for slice 0

Date: 2026-11-05. Claude Code version: 2.1.318. Raw verdicts: `probes/results/claude.json`.

These probes settle Claude Code facts that rig's writer depends on. Each probe is one Node script in `probes/`. Each script prints a verdict JSON and takes `--out <file>`. Scratch files go under `RIG_PROBE_SCRATCH`. The default is a `rig-probes-claude` directory in the OS temp dir.

Rules the runs followed:

- Real `claude -p` runs happened only in scratch projects.
- No probe wrote to the user's Claude config. No probe ran `claude plugin install`, `uninstall`, `enable`, `disable` or `marketplace add`.
- Each run was capped with `--max-turns` and a timeout under 120 seconds.
- Probe (a) read two keys of two settings files with a JSON parse. It printed nothing else from them. The committed evidence replaces the plugin id with `<plugin>` and the project path with `<project>`.

To rerun: `node probes/<script>.mjs --out <file>`. The shared helper is `probes/_lib.mjs`.

## Summary

| Probe | Verdict | Sets |
|---|---|---|
| (a) `enabledPlugins` precedence | PASS | Effective-state rule behind `doctor --project` |
| (h) `SessionEnd` payload | PASS | Claude `hooks.session_end` |
| (k) project-only local plugin | INCONCLUSIVE (needs operator) | Claude `project_scope` |
| (i-claude) headless flags | PASS | argv template of the `claude-cli` provider record |
| (craft-claude) project command and skill | PASS | Claude `/craft` entry path |

## (a) `enabledPlugins` precedence

Script: `probes/a-enabledplugins-precedence.mjs`.

What it ran. The script walks the home directory (depth 5, skipping caches and `.worktrees`). It looks for a project whose git-tracked `.claude/settings.json` sets a plugin id to `true` while the user settings set the same id to `false`. It found several. It took the first one. It ran `claude plugin list --json` and `claude plugin list` with that project as cwd. As a control, it ran the same two commands in an empty scratch directory.

Verdict: PASS.

Evidence.

- `claude plugin list --json` exists. Each entry has `scope`, `enabled`, `projectEnabled`, `notes` and `noteDetails`.
- In the project, the plugin reports `enabled: true` and `projectEnabled: true`.
- The source message reads: "Disabled in ~/.claude/settings.json but still loads — project settings enable it, which overrides your user setting". The machine-readable note type is `ineffective-disable`.
- In the neutral directory, the same plugin reports `enabled: false`.
- The listing holds one row per recorded install. All rows for the plugin agree. The JSON groups them with a `count`.

Limits. The verdict rests on what `claude plugin list` reports. It does not check that the plugin's skills reach a model session. It does not run the plan's P3 case (a project-only `true` for a plugin that was never installed, to see whether a cache directory appears).

Sets: the effective-state rule that `doctor --project` reports. The project value beats the user value, and the CLI names that in a note.

Resolves: A31, for the precedence part. The no-fetch check stays open.

## (h) `SessionEnd` payload

Script: `probes/h-sessionend-payload.mjs`.

What it ran. A scratch project with `.claude/settings.json` holding a `SessionEnd` hook. The hook command writes its stdin to a file. Then `claude -p --max-turns 1 "reply ok"` in that project.

Verdict: PASS.

Evidence.

- The hook fired in `-p` mode. No trust step was needed. The help text says `-p` skips the workspace trust dialog.
- The CLI exited 0 and the reply contained "ok".
- The payload is JSON with six keys: `cwd`, `hook_event_name`, `prompt_id`, `reason`, `session_id`, `transcript_path`. All six values are strings.
- `hook_event_name` was `SessionEnd`. `reason` was `other` for a `-p` run. The script records those two enum values and no other value.
- The path in `transcript_path` exists on disk. The script checks existence only.

Sets: Claude `hooks.session_end`. PASS keeps the Claude session-end hook. The payload locates the session by `session_id` and `transcript_path`.

Resolves: A34, Claude part only. The other harnesses are untouched.

Limit. One run. The `reason` value for interactive exits (for example `clear` or `logout`) was not tested.

## (k) Project-only local plugin

Script: `probes/k-local-plugin-project.mjs`.

What it ran.

- It checked `claude --help` for `--plugin-dir`. The flag is listed.
- It built a scratch plugin with one command, `rigprobe-k`, in a scratch project.
- It ran `claude -p "/rigprobe-k" --plugin-dir <dir>` and `claude -p "/rigprobe:rigprobe-k" --plugin-dir <dir>`.
- As a control, it ran `/rigprobe-k` without the flag.

Verdict: INCONCLUSIVE. Reason: `needs operator: the full variant (rig-owned marketplace, user false, project-local true) needs claude plugin marketplace add and a user settings write`. The script did not run that part.

Evidence for the variant that needs no config write (local verdict PASS).

- Both the bare form `/rigprobe-k` and the namespaced form `/rigprobe:rigprobe-k` ran the command in `-p` mode.
- Without the flag, the marker did not appear, and the CLI still exited 0. So the plugin loads for that invocation only.

What this does not show. `--plugin-dir` is a per-run flag. It is not the channel that `rig apply` would write. It proves that a plugin directory can add a command in `-p` mode. It says nothing about `settings.local.json` overriding a user `false` for a marketplace plugin.

Sets: Claude `project_scope`. Not set. The local-marketplace channel stays unverified.

Resolves: nothing. A25 stays open.

## (i-claude) Headless flags

Script: `probes/i-claude-headless-flags.mjs`.

What it ran. It parsed `claude --help`. Then it ran one small `claude -p --max-turns 1` call per behaviour check: `--output-format json`, `--output-format stream-json`, `--setting-sources`, `--append-system-prompt` and `--model`. A control run passed a made-up flag and confirmed the CLI rejects unknown flags.

Verdict: PASS. All seven flags exist.

Evidence.

- Listed in `--help`: `-p`, `--output-format`, `--model`, `--plugin-dir`, `--setting-sources`, `--append-system-prompt`.
- `--max-turns` is not listed in `--help` in this version. The CLI accepts it, and the control run shows that it rejects unknown flags. Treat it as an undocumented flag that can change.
- `--output-format` accepts `text`, `json` and `stream-json`.
- `json` output is one object with the keys `result`, `session_id`, `is_error`, `num_turns`, `total_cost_usd`, `usage`, `modelUsage` and others. The full list is in the JSON.
- `stream-json` needs `--verbose` with `-p`. Without it the CLI exits 1 and the error names `--verbose`. With it, the event types were `system`, `assistant`, `rate_limit_event` and `result`.
- `--setting-sources` takes `user`, `project`, `local`.
- `--append-system-prompt` took effect: the reply followed the appended instruction.
- `--plugin-dir` behaviour is covered by probe (k).

Sets: the argv template of the `claude-cli` headless provider record. The template can use `-p --output-format json --model {model}`. It must not rely on `--max-turns` without a fallback.

Resolves: no A-number. A14 covers omp and the Cursor flags belong to A27.

## (craft-claude) Project command and skill, headless

Script: `probes/craft-claude-project-units.mjs`.

What it ran. A scratch project with `.claude/commands/rigprobe-cmd.md` (body: reply `cmd-ok`) and `.claude/skills/rigprobe-skill/SKILL.md` with `disable-model-invocation: true` (body: reply `skill-ok`). Then `claude -p "/rigprobe-cmd"` and `claude -p "/rigprobe-skill"`.

Verdict: PASS.

Evidence.

- `/rigprobe-cmd` printed `cmd-ok`. Exit 0.
- `/rigprobe-skill` printed `skill-ok`. Exit 0. A skill that the model cannot pick on its own still runs when the user types its slash name.

Sets: the Claude `/craft` entry path. A project-level command file and a hidden skill are both reachable headless. This is the shape that rig's `/craft` uses.

Resolves: no A-number. A36 covers Codex and omp only.

## Needs operator

- Probe (k), full variant. It needs `claude plugin marketplace add` for a rig-owned marketplace, a user-level `false`, and a project-local `true` in `.claude/settings.local.json`. Run it only in a scratch Claude config, as the plan describes. The command changes the user's plugin config.
- Probe (a), plan case P3. A project-only `true` for a plugin that is not installed, plus a check that no cache directory appears. It needs a marketplace to exist, so it hits the same `marketplace add` step.
