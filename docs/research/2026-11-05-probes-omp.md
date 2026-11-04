# Slice 0 probes: omp

Status: probe record, 2026-11-05. Harness: omp 18.16.0. Probes c, e, g and i (omp part). Raw verdicts: `probes/results/omp.json`.

## Summary

- All four probes return PASS.
- omp rewrites `config.yml` when you change a setting through `omp config set`. The rewrite drops comments and marker lines. It keeps unknown keys, key order, mode and `modelRoles` values.
- omp reads user skills from `<agent dir>/skills` and `~/.agents/skills`. It reads project skills from `.claude`, `.codex`, `.agents` and `.omp`. It does not read user `~/.claude/skills` or `~/.codex/skills` by default.
- omp collapses skills by `SKILL.md` bytes plus frontmatter. A sidecar file does not break the collapse.
- The user instructions file is `<agent dir>/AGENTS.md`. Assumption A2 holds.
- A headless run needs a closed stdin. An open stdin pipe hangs `omp -p` with no output.

## How the probes ran

- Each omp run used a fresh `PI_CODING_AGENT_DIR` and a fresh `HOME` under a `mkdtemp` scratch directory. Each script checks both paths before each run and stops if one resolves outside the scratch directory or inside the real `~/.omp`.
- The scripts remove `OMP_PROFILE`, `PI_PROFILE`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME` and `COPILOT_HOME` from the environment. The last three opt in to foreign user directories.
- Setting only `PI_CODING_AGENT_DIR` is not enough. In a first test omp still read the real `HOME` and tried to connect to MCP servers from other tools. The scratch `HOME` stops that.
- The isolated directory holds no credentials. Model calls still worked, so omp took its authentication from the environment. The scripts never read credential files or `agent.db`.
- The runs set `--model` through `RIG_PROBE_OMP_MODEL` or `--model <id>`. Evidence does not record the model id. The default model hit a provider spending limit during the work.
- Each script stats the real `~/.omp/agent/config.yml` before and after and records both modification times. The value was 1793773337346 ms both times in every probe.
- Run all four: `node probes/<script>.mjs --scratch <dir> --out <file>`. Each script prints the verdict line, then the JSON object.
- The slice plan names `probes/e-omp-skill-command-dirs.mjs` and `probes/i-headless-flags.mjs`. These scripts use the names `e-omp-skill-dirs-dedupe.mjs` and `i-omp-headless-flags.mjs`. The plan asks for a `PASS <letter> <value>` first line, and the scripts print `<VERDICT> <probe> <derived value>` followed by JSON.
- `probes/lib/omp.mjs` holds the shared helpers (isolation checks, process runner, redaction).

## Probe c: omp rewrites `config.yml`

**What ran.** The script wrote a `config.yml` (mode 0600) with five placeholder `modelRoles`, a comment line, a `# rig:models:start` marker, the unknown key `rigProbeUnknown: 1` and a custom key order. It then ran four kinds of command and compared the file each time.

**Verdict.** PASS. `harness_rewrites` is true.

**Evidence.**

| Command | File rewritten |
|---|---|
| `omp config list`, `omp config get modelRoles` | no |
| `omp -p` run (placeholder models, fallback model answered) | no |
| `omp config set symbolPreset ascii` | yes |
| `omp config set modelRoles '<json map>'` | yes |

After the rewrite:

- Comment lines: dropped.
- Marker line: dropped.
- Unknown key: kept.
- Key order: kept. The new key `symbolPreset` goes at the end.
- Mode: kept (0600).
- `config.yml.lock`: created on the first write. It is empty.
- Trailing newline: dropped on the first write. It was kept on the second write.
- `modelRoles`: still block style. All five cells are on separate lines with two-space indent, and the values are unchanged.
- `omp config set modelRoles.default <value>` fails with `Unknown setting`. You must set the whole map as JSON.

**Sets.** For the omp target, `config.yml`: `harness_rewrites: true`, locator `yaml-map-value`, comments and markers do not survive, unknown keys and key order survive, lock file `config.yml.lock`. Markers stay out of `config.yml`.

**Resolves.** A26: omp keeps `modelRoles` values when it rewrites the file.

**Other surface.** `--config <file>` loads an extra `config.yml`-style overlay for one run. rig could use it instead of editing `config.yml`. The probe did not test it.

## Probe e: skill directories, dedupe and commands

**What ran.** The script placed 8 unique control skills in 8 locations, plus four same-name pairs. It read the effective skill list through `omp read skill://<unknown>`, which prints `Available: ...` with no model call. It also asked the model for its skills list three times with no tool calls. All three runs matched each other and matched the read channel. It then ran four slash commands with `omp -p "/name"`.

**Verdict.** PASS.

**Evidence, locations.**

| Location | Read |
|---|---|
| `<agent dir>/skills` | yes |
| `~/.agents/skills` | yes |
| `~/.claude/skills` | no |
| `~/.codex/skills` | no |
| project `.claude/skills`, `.codex/skills`, `.agents/skills`, `.omp/skills` | yes |

The built-in documentation (`omp read omp://skills.md`) says foreign user directories need `enabledProviders`. This matches. The probe did not test that setting.

**Evidence, dedupe.**

| Pair | Entries |
|---|---|
| Identical bytes in project `.claude`, `.codex`, `.agents` | 1 |
| Identical `SKILL.md`, the `.codex` copy adds `agents/openai.yaml` | 1 |
| Same name, different description (`.claude` and `.codex`) | 2: `rigprobe-diff` and `codex/rigprobe-diff` |
| Agent dir copy plus project `.claude` copy, identical | 1 |

For identical copies, the surviving copy comes from the higher-priority directory. With different bytes, the bare name resolves to `.claude`. The `codex/` name resolves to `.codex`.

**Evidence, commands.**

| Location | Read |
|---|---|
| `<agent dir>/commands/*.md` | yes |
| project `.claude/commands` | yes |
| `~/.agents/commands` | yes |
| `~/.claude/commands` | no |

A bare `/rigprobe-cmd` works in `-p` mode. omp replaces the prompt with the file body.

**Sets.** omp `reads[]` as above. `reads[].dedupe` is `skill-md-bytes`: identical `SKILL.md` bytes and frontmatter collapse, sidecars do not matter, and differing copies get a `<provider>/<name>` entry. The user command directory is `<agent dir>/commands`. `/craft` can use a native bare command file there.

**Resolves.** A13. A36, omp part: a bare command needs no extension.

## Probe g: user instructions file

**What ran.** Scenario A: `<agent dir>/AGENTS.md` held a user line and a `rig:begin` / `rig:end` block, each with a random sentinel. `~/.codex/AGENTS.md` held a second sentinel. Scenario B: no file in the agent dir, and six rival paths each held a sentinel. Each scenario ran three times with `--no-tools`. The model answered from its instructions only.

**Verdict.** PASS. All three runs of scenario A quoted the user line and the block line, and saw both marker lines.

**Evidence.**

- The `~/.codex/AGENTS.md` sentinel was absent in all three scenario A runs.
- In scenario B only `~/.agents/AGENTS.md` appeared. These paths stayed unseen: `~/.codex/AGENTS.md`, `~/.claude/CLAUDE.md`, `<agent dir>/../AGENTS.md`, `~/.omp/AGENTS.md`, and `~/.omp/agent/AGENTS.md` under the scratch `HOME`.
- The last path shows that `PI_CODING_AGENT_DIR` relocates the native file.
- The documentation says omp keeps one user-level file. A path hidden behind the winner is not proof of "never read". The `.codex` and `.claude` results match the documented opt-in rule.

**Sets.** `instructions.path` is `<agent dir>/AGENTS.md`, which is `~/.omp/agent/AGENTS.md` by default. Mode is `whole-file`. omp passes the file verbatim, so a managed block with marker lines also reaches the model. The fallback when the native file is absent is `~/.agents/AGENTS.md`, not `~/.codex/AGENTS.md`.

**Resolves.** A2.

## Probe i (omp part): headless flags

**What ran.** The script parsed `omp --help` (58 flags). It checked 22 flags for headless use. It ran one JSON run, one run with an open stdin pipe, and three `omp config path` calls with different overrides.

**Verdict.** PASS. No required flag is missing.

**Evidence.**

- Present: `--print` (`-p`), `--mode` (`text`, `json`, `rpc`, `rpc-ui`), `--model`, `--profile`, `--cwd`, `--session-dir`, `--no-session`, `--no-tools`, `--thinking`, `--config`, `--add-dir`, `--skills`, `--no-skills`, `--no-context-files`, `--system-prompt`, `--append-system-prompt`, `--max-time`, `--approval-mode`, `--auto-approve`, `--smol`, `--slow`, `--plan`.
- `PI_CODING_AGENT_DIR` and `OMP_PROFILE` are environment variables, not flags.
- `--mode json` prints one JSON object per line. The first event is `session` (with `cwd`). The last event is `agent_end`. The assistant `message_end` event carries `usage` with `cost.total`.
- With an open stdin pipe, `omp -p` printed nothing for 15 s and had to be killed. With stdin set to `ignore` it exits 0. Rendered argv and stubs must close stdin.
- `--profile` and `OMP_PROFILE` override `PI_CODING_AGENT_DIR`. They resolve to `<HOME>/.omp/profiles/<name>/agent`.
- `omp config` has the actions `list`, `get`, `set`, `reset`, `path` and `init-xdg`.

**Sets.** The omp headless argv template is `omp -p --mode json --no-session [--model <id>] [--thinking <level>] [--cwd <dir>] "<prompt>"` with closed stdin.

**Resolves.** A14, omp part.

## Not run

- Probes a, b, d, f and h. They target other harnesses.
- The `enabledProviders` setting. The documentation describes it. No probe set it.
- `--config <overlay>` as a writer surface.
- An interactive settings change (`/model`, `/settings`). `omp config set` covered the rewrite question without a TUI.
- Any run on a second omp version.

## Uncertainties and assumptions

| Assumption | Score | Blast radius | Falsification probe |
|---|---|---|---|
| An interactive `/model` change rewrites the file the same way as `omp config set`. | 6 | The rewrite shape could differ. | Change a model in the TUI, then diff the file. Open risk. |
| A listing by a small model is stable beyond three runs. | 7 | Wrong dedupe value. | The no-model `Available:` channel agrees with all three runs. Checked. |
| Probe g, scenario B: unseen paths are unread, not hidden. | 5 | A fallback path may be wrong. | Remove `~/.agents/AGENTS.md`, rerun. Open risk. |

Overall confidence: 8 out of 10 for the recorded values on omp 18.16.0.
