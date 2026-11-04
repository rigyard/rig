# rig v0 delivery plan: six vertical slices

Status: plan, 2026-11-04. Not started. It cuts v0 into slices 0 to 5. The architecture lives in [rig-architecture.md](../design/rig-architecture.md). Command, flag, file, field and error names come from the v0 design decisions that it writes up. Names that those decisions do not define carry the mark `(proposed)`.

## Why this order

The order puts the riskiest unknown first. Each slice ends with done-checks that a command or a test can fail.

1. **Probes first (slice 0).** Eleven facts about the harnesses are unverified. Each fact decides a value in a target record: a `reads.skills[].dedupe` value, a `project_scope` channel, a `hooks.session_end` entry, an instruction cap. The writes in slices 2 to 5 depend on these values. A wrong value means rig writes a skill twice or into a directory that a harness ignores.
2. **Read-only doctor before any writer (slice 1).** `rig doctor` reads the four read-sets and reports duplicates. It writes nothing, so you can run it on the real machine without risk. It also forces the fixture HOME and the stub binaries into existence before the first write.
3. **Owned files before foreign-file cells (slice 2, then 3).** rig owns whole files in slice 2, so every byte is rig's and drift is a plain hash compare. The journal, recovery and undo get proved on these files. Slice 3 then patches cells inside files that people and harnesses also edit. By then the writer already converges.
4. **Supply chain and scope (slice 4).** Vendoring, pins and the overlay add network and a second config root. They reuse the gate and the single writer from slices 2 and 3. `rig pack add` and `rig pin` write only into config roots.
5. **Observability last (slice 5).** Metrics write only into the state root. The one exception is the opt-in `SessionEnd` hook, one `json-element` in `~/.claude/settings.json`. A bug here costs a report, not a harness config.

Probe dependencies per slice:

| Slice | Needs verdicts from |
|---|---|
| 1 | (b), (e) and (j) for the read-set records, (i) for the stub flag lists |
| 2 | (g) for the omp instruction file, (e) for the omp `/craft` path, (j) for the Cursor `/craft` skill and frame |
| 3 | (c) for the omp rewrite fixture, (i) for the `second-opinion` argv templates |
| 4 | (k) for the Claude `project` channel, (a) for the precedence that `doctor --project` reports, (f) for `machine-hidden` on Codex |
| 5 | (h) for the hook payload, (d) for the Codex `budget` block threshold |

## Shared test strategy

### Runner and layout

- Runner: Node built-in `node --test`. Zero npm dependencies, the same as rig.
- Test root `test/` (proposed layout): `test/fixtures/packs/`, `test/fixtures/home/`, `test/fixtures/transcripts/`, `test/stubs/`, `test/helpers/`.
- Every test builds a fresh temp root with three dirs. `home/` is the fixture HOME. `outside/` is a sibling that rig must never touch. `repo/` is a fixture git repository that serves as the working directory.
- The test helper sets `HOME` to `home/`. It unsets `XDG_STATE_HOME`, `XDG_DATA_HOME` and `XDG_CONFIG_HOME`, so the state root, the data dir and the overlay fall under the fixture HOME. It sets `PATH` to the stubs dir plus the dirs of `node` and `git` only.
- The helper refuses to start when `HOME` resolves to the real home of the user (`os.userInfo().homedir`). Tests then cannot write into the real `~`.

### Fixture packs

Good packs: a minimal `own`-shaped pack (one skill, one command, one agent, one rule) that passes every check. A second good pack uses one `{{rig:term}}` placeholder from core `terms.json`.

Hostile packs, one finding each:

| Fixture | Expected finding |
|---|---|
| a script with a `#!/bin/sh` shebang | `exec` block |
| a Markdown file with the exec bit set | `exec` block |
| a `hooks.json`, a `.mcp.json`, a symlink | `exec` block |
| a zero-width joiner and a bidi override in `SKILL.md` | `unicode` block |
| an injection phrase in prose | `unicode` warn |
| a string shaped like a cloud access key | `secret` block |
| a term from the overlay `private_terms` list in a repo pack | `secret` block (a sub-rule of `secret`, so the check list stays at eight) |
| no license file and no license field | `license` block |
| a dependency manifest with no OSV cache entry | `cve` block |
| a 2,000-character and a 400-character description | `budget` block, `budget` warn |
| an unknown `{{rig:...}}` placeholder | `E_TERM_UNKNOWN` |
| a unit named like a foreign skill in the fixture HOME | `E_CLASH` |

The test builds the secret-shaped string at run time by concatenation. The repo then holds no literal that a push-protection scanner flags.

### Fixture HOME builder

`test/helpers/fixture-home.mjs` (proposed) builds a HOME from a small spec. Default layout per harness:

| Harness | Dirs and files |
|---|---|
| Claude | `~/.claude/skills/` (real dirs, symlinks into `~/.agents/skills`, a `.trash/` dir), `~/.claude/agents/` (hand-written fleet agent files), `~/.claude/commands/`, `~/.claude/rules/`, `~/.claude/settings.json`, `~/.claude/plugins/installed_plugins.json`, a plugin cache tree |
| Codex | `~/.codex/skills/` (symlinks, a `.system/` dir), `~/.codex/prompts/`, `~/.codex/agents/` (empty), `~/.codex/AGENTS.md` with another tool's managed block, `~/.codex/config.toml` |
| omp | `~/.omp/agent/skills/`, `~/.omp/agent/commands/`, `~/.omp/agent/config.yml`, a 0-byte `config.yml.lock`, an extension file that rewrites `/pm` |
| Cursor | `~/.cursor/skills/` (relative and absolute symlinks), `~/.cursor/skills-cursor/` (built-ins plus `.sync-manifest.json`), `~/.cursor/plugins/local/` with one foreign local plugin, `~/.cursor/agents/` (hand-written fleet agent files), `~/.cursor/rules/`, `~/.cursor/hooks.json` with foreign entries |
| shared | `~/.agents/skills/` with a `.backup-<date>/` dir |

Real-shape foreign files, all with placeholder values (model names such as `model-a`, display names such as `ModelA`):

1. A Markdown fleet table in `~/.claude/rules/`: header `| Role | Model, effort | Use for |`, one cell with a third token (`ModelA, high, read-only`), one row with a dash, an effort table `| Role | Default | Lower to | Raise to |` with prose in the last two columns, and a prose line that repeats a model name outside any table.
2. Agent frontmatter: `model`, `effort`, a `description` with a `(ModelA)` token, plus one agent with `model: inherit` that belongs to another tool.
3. A pstack-style model rules file: three `#` lines (one contains `": "`), 17 `<label>: <value>[, <value>]` lines, labels that contain commas, panel values as comma lists. Plus its `.mdc` twin with frontmatter, fused ids (`model-a-high`) and the sentinel `auto`.
4. An omp-style YAML: mode 0600, `modelRoles:` as the first block with five keys, values `provider/model:effort`, one model id that ends in an effort-like word, one `auto` effort, no comments, other top-level keys after it.
5. A Codex-style TOML: mode 0600, top-level `model` and `model_reasoning_effort`, machine-appended tables, a `.bak` sibling, no `[agents]` table.

### Recording stubs

`test/stubs/` (proposed) holds `claude`, `codex`, `omp` and `cursor-agent`. Each stub:

- appends one JSON line to the file in `RIG_STUB_LOG` (proposed) with `argv`, `cwd` and an allowlist of env keys (`HOME`, `XDG_*`, `RIG_*`, `DO_NOT_TRACK`). The allowlist keeps secret values out of the log.
- returns canned output picked by argv from a table in `test/fixtures/`.
- exits 2 on a flag that is absent from the flag list that probe (i) captured from the real `--help`. This is the fidelity rule for stubs.

### Fault injection

The apply transaction has a fault-injection hook that is active only when `RIG_TEST=1`. The count comes from `RIG_TEST_ABORT_AFTER=<k>`. `lib/state.mjs` kills the process after op `k`, with no `commit` line in the journal. The hook is not a CLI flag.

### Boundary test

`test/boundaries.test.mjs` fails on every rule of the boundary table in the architecture doc (section 5). In short, it fails when:

- a module outside its allowlist imports a write primitive of `lib/fs.mjs`: `writeHome` only from `state`, `writeConfig` only from `lock` and `models`, `writeState` and `appendState` only from `state`, `metrics` and `gate`,
- any module other than `lib/fs.mjs` imports a write function of `node:fs`,
- any module uses a dynamic `import()`,
- any module spawns a path inside a pack,
- any module other than `lib/lock.mjs` imports `node:child_process`, `node:http`, `node:https` or `node:net`, or calls `fetch` (network only in `pack add` and `pin check`),
- any module other than `lib/state.mjs` and `lib/state/*` reads `RIG_TEST` or `RIG_TEST_ABORT_AFTER`,
- the `plan` or `doctor` code path reaches the logger.

The test has its own test: a planted temp module that breaks each rule makes it fail.

### Snapshot helper

`test/helpers/snapshot.mjs` (proposed) records path, size, mode, mtime and sha256 for every entry under a list of roots. Done-checks compare two snapshots. The "tree hash" in the done-checks is the sha256 over the sorted lines of files and symlinks (path, mode, sha256), without mtime. Directories count only through their entries, so an empty dir that a run created does not change it.

## Slice 0: probes

### Rules for every probe

- One script per probe under `probes/`. Scripts are `.mjs`: the same runtime as rig, built-in JSON parsing and sha256, and `fs.mkdtemp` for temp dirs. A shell version would need `jq` and would differ between BSD and GNU tools.
- The first output line is `PASS`, `FAIL` or `INCONCLUSIVE`, the probe letter and the derived value. Evidence lines follow. Evidence uses sentinel tokens and placeholder names only, so you can paste it into a commit.
- Isolation, in this order: a scratch HOME (`HOME=<tmp>`) plus the harness's config-dir override where one exists. When the harness cannot authenticate in scratch state, the probe prints `INCONCLUSIVE <letter> auth` and names the fallback. The fallback uses the real config dir and a scratch project as the working directory, and the probe lists every real path it touched. Probes pass API keys only as env references and do not copy credential files.
- Listings: a probe reads a machine-readable channel (a CLI list command, a session init event) where one exists. Otherwise it asks the model for sentinel tokens three times. Any disagreement between the runs gives `INCONCLUSIVE`.
- A probe never writes into the rig repo. You record the verdict in the target record by a reviewed commit.
- Order: (i) first, because it has no model call and confirms the flags that the other probes use. Then (b), (j), (e), (a), (k), (c), (d), (f), (g), (h).

### (a) Claude `enabledPlugins` precedence

- Script: `probes/a-enabledplugins-precedence.mjs`.
- Setup: scratch Claude config. A marketplace dir in the temp dir holds plugin `rig-probe-a` (one skill, sentinel in its description) and plugin `rig-probe-a2` (never installed). User settings set `rig-probe-a` to `false`. Scratch project P1 has a committed `.claude/settings.json` with `rig-probe-a` `true`. Project P2 has no setting. Project P3 sets `rig-probe-a2` `true` only.
- Run: in P1, P2 and P3, the CLI plugin listing where it reports effective state, else a `claude -p` sentinel question. Then list the scratch plugin cache.
- PASS: the sentinel shows in P1 and not in P2, and no cache dir for `rig-probe-a2` appears after P3.
- FAIL: P1 hides it, P2 shows it, or P3 creates a cache dir for `rig-probe-a2` (a project-only `true` fetches).
- INCONCLUSIVE: auth, or the runs disagree.
- Sets: the effective-state rule that `doctor --project` reports (the project value beats the user value, source `project`). It is the isolation base for a restrictive provider plugin. Probe (k) covers the rig-owned marketplace and `settings.local.json`.
- Resolves: A31.

### (b) Cursor dedupe across its skill dirs

- Script: `probes/b-cursor-skill-dedupe.mjs`.
- Setup: scratch HOME. One control skill with a unique name in each of `~/.cursor/skills`, `~/.agents/skills`, `~/.claude/skills`, `~/.codex/skills`. `rig-probe-b-same`: identical bytes in `~/.cursor/skills` and `~/.claude/skills`. `rig-probe-b-diff`: one name, two different description sentinels, in `~/.agents/skills` and `~/.codex/skills`. `rig-probe-b-link`: a real dir in `~/.agents/skills` and a symlink to it in `~/.cursor/skills`.
- Run: `cursor-agent -p --output-format json --mode ask` with a prompt that asks for every skill name that starts with `rig-probe-b` and its description, three runs.
- PASS: all four controls show, and the entry counts map to exactly one value of `none | identical-bytes | by-name`. Same 1, diff 2, link 1 gives `identical-bytes`. All 1 gives `by-name`. All 2 gives `none`.
- FAIL: a control is missing, so the declared Cursor read list is wrong. Or the counts map to no enum value, for example link 1 and same 2 (a realpath rule). Each FAIL goes back to the orchestrator as a design change.
- INCONCLUSIVE: auth, or the runs disagree.
- Sets: Cursor `reads.skills[].dedupe` for each of the four dirs.
- Resolves: A23, grounding question 14.

### (c) omp rewrites `config.yml`

- Script: `probes/c-omp-config-rewrite.mjs`.
- Setup: scratch HOME with `~/.omp/agent/config.yml`, mode 0600, holding `modelRoles` with five placeholder values, a comment line, an unknown top-level key, keys in a non-default order, and a marker line `# rig:models:start`. The script records sha256, bytes, mode and the state of `config.yml.lock`.
- Run: one settings change through the smallest non-interactive path that omp documents. If none exists, the script prints one manual step (change one setting in an interactive omp session) and waits.
- PASS: the line-level `keys` kind finds all five `modelRoles` cells in the file that omp wrote.
- FAIL: omp writes `modelRoles` in a form the locator cannot read (flow style, multi-line values) or moves it under another key.
- INCONCLUSIVE: the file sha did not change, so no rewrite happened.
- Evidence, always: comment kept, unknown key kept, key order kept, marker kept, mode kept, lock file touched (yes or no each).
- Sets: the omp surface flag `harness_rewrites`, true when omp reserialized the file. Markers stay out of the omp config in either case. The probe confirms the omp model surface `{path, kind: keys, consumer: omp}`, and its output becomes the rewrite-shape fixture for check S3.6.
- Resolves: A26. Informs grounding question 11 (the lock file).

### (d) Codex `AGENTS.md` size limit

- Script: `probes/d-codex-agents-md-limit.mjs`.
- Setup: a 48 KiB `AGENTS.md` of filler lines with a canary token every 2 KiB. Each canary is `CANARY-<offset>-<random>`, so the model cannot guess one. The file goes to the Codex user-level path under the config-dir override. Fallback: a scratch project with the file as the project instructions file. That measures the project limit, which can differ, and the evidence says which path the probe used.
- Run: `codex exec` asks for every token that starts with `CANARY-`, in order, three runs. A second pass bisects between the last seen and the first missing canary to 1 KiB.
- PASS: a stable truncation point to within 1 KiB in every run.
- FAIL: every canary shows at 48 KiB. The limit is above 48 KiB and `budget` gets no block value from this probe.
- INCONCLUSIVE: auth, or the runs disagree.
- Sets: the Codex instruction cap that `budget` blocks above, field `budget.instructions_max_bytes` on the Codex target record.
- Resolves: A32.

### (e) omp skill dirs, command dir and dedupe rule

- Script: `probes/e-omp-skill-command-dirs.mjs`.
- Setup: scratch HOME. A unique control skill in each of `~/.omp/agent/skills`, `~/.claude/skills`, `~/.codex/skills` and `~/.agents/skills`. An identical pair across `~/.claude/skills` and `~/.codex/skills`. A pair with identical `SKILL.md` bytes where the Codex copy adds a sidecar `agents/openai.yaml`. A same-name pair with different bytes. A command `~/.omp/agent/commands/rig-probe-e.md` whose body prints a sentinel.
- Run: `omp -p --mode json` listing prompt, three runs, then `omp -p "/rig-probe-e"`.
- PASS: the read or not-read result of every control is the same in all three runs, the counts map to one dedupe enum value, and the command sentinel appears.
- FAIL: the counts map to no enum value. Example: the sidecar pair shows twice and the identical pair shows once (a whole-dir rule).
- INCONCLUSIVE: auth, or the runs disagree.
- Sets: omp `reads.skills[]` (which dirs) and each `reads.skills[].dedupe`. The command result sets the omp `/craft` path: verified, or degraded with no command file.
- Resolves: A13, A36 (omp part), grounding question 15.

### (f) Codex hides a skill

- Script: `probes/f-codex-skill-hiding.mjs`.
- Setup: scratch HOME, three skills in `~/.agents/skills`: one with `agents/openai.yaml` that sets `policy.allow_implicit_invocation: false`, one with frontmatter `disable-model-invocation: true`, one control. Each description holds a sentinel. Each body holds a second sentinel.
- Run: `codex exec` listing prompt, three runs. Then one explicit invocation by name per hidden skill, with the invocation syntax recorded in the evidence.
- PASS: at least one mechanism keeps the description out of the listing, and explicit invocation still returns the body sentinel.
- FAIL: neither mechanism hides the description. Then Codex `hide.method` becomes `none`, and a `machine-hidden` or `hybrid` pack would list on Codex. That goes to the orchestrator as a design change.
- INCONCLUSIVE: auth, or the runs disagree.
- Sets: the Codex `hide` record (`method: sidecar` or `frontmatter-key`) and `units.skill.sidecar`, which render `machine-hidden`.
- Resolves: A12.

### (g) omp user-level `AGENTS.md` path

- Script: `probes/g-omp-agents-md-path.mjs`.
- Setup: scratch HOME. `~/.omp/agent/AGENTS.md` holds sentinel G1. `~/.codex/AGENTS.md` holds G2.
- Run: `omp -p` asks to quote every line that starts with `PROBE-G`, three runs.
- PASS: G1 shows.
- FAIL: G1 is absent. The evidence says whether G2 shows (the A2 fallback).
- INCONCLUSIVE: auth, or the runs disagree.
- Sets: the omp instruction path, field `instructions.path`, and its instruction mode `whole-file` or `managed-block`.
- Resolves: A2, grounding question 13.

### (h) Claude `SessionEnd` payload

- Script: `probes/h-claude-sessionend-payload.mjs`.
- Setup: scratch Claude config whose `settings.json` sets `hooks.SessionEnd` to a recorder in the temp dir. The recorder writes its stdin to a file and prints nothing.
- Run: `claude -p "reply ok"`. If no payload arrives, the script prints one manual step: open an interactive session in the scratch config and exit it.
- PASS: the payload parses as JSON and holds a session id and a transcript path that exists. The evidence lists every field name.
- FAIL: the hook fires in neither mode, or the payload has no transcript locator.
- INCONCLUSIVE: auth.
- Sets: Claude `hooks.session_end`. PASS keeps the Claude session-end hook. FAIL sets it to `null`, and slice 5 drops the hook and keeps on-demand `rig stats`.
- Resolves: A34 (Claude part).

### (i) Headless flags per CLI

- Script: `probes/i-headless-flags.mjs`.
- Setup: none beyond a temp dir. The probe needs the real binaries.
- Run, part 1 (no model call, no state): `--help` of `claude`, `codex exec`, `omp` and `cursor-agent`, plus `cursor-agent --list-models`. The probe checks every flag of the `second-opinion` argv templates and saves each flag list for the stubs. Part 2: one minimal JSON-output run per CLI. This touches only each harness's own session logs.
- PASS: every template flag is in the help text and every JSON output parses.
- FAIL: a template flag is missing. That provider record's argv template changes, or the filler drops on that harness.
- INCONCLUSIVE: a binary is absent.
- Sets: the argv templates of the `headless` provider records and the Cursor effort spellings behind `effort_syntax: bracket`.
- Resolves: A14 (omp part), A27 (Cursor part).

### (j) Cursor local plugin and user rules

- Script: `probes/j-cursor-local-plugin-rules.mjs`.
- Setup: scratch HOME. A local plugin `~/.cursor/plugins/local/rig/` in the layout the Cursor target renders, with skill `rig-probe-j` (sentinel J1 in its description, sentinel J2 in its body) and skill `rig-probe-j-hidden` with `disable-model-invocation: true` (sentinel J3 in its body). A user rule `~/.cursor/rules/rig-probe-j.mdc` with `alwaysApply: true` and sentinel J4.
- Run: `cursor-agent -p --output-format json --mode ask` asks for every skill name that starts with `rig-probe-j` and every line that starts with `PROBE-J`, three runs. Then one explicit invocation of `rig-probe-j-hidden`, with the invocation name recorded in the evidence.
- PASS: J1 and J4 show, `rig-probe-j-hidden` is absent from the listing, and the explicit invocation returns J3.
- FAIL: J1 is absent (Cursor does not load the local plugin), or J4 is absent (no user rules from `~/.cursor/rules`). Each FAIL goes back to the orchestrator as a design change.
- INCONCLUSIVE: auth, or the runs disagree.
- Sets: the Cursor writable skill dir `~/.cursor/plugins/local/rig/skills`, the plugin manifest layout, the `/craft` invocation name, and `instructions.path` (`~/.cursor/rules/rig-frame.mdc`).
- Resolves: A24. The local plugin path has no A-number.

### (k) Claude local-path plugin from a rig-owned marketplace

- Script: `probes/k-claude-local-marketplace.mjs`.
- Setup: scratch Claude config. A marketplace under `<tmp>/xdg-data/rig/marketplace`, in the layout `lib/targets.mjs` renders, holds plugin `rig-probe-k` with one skill (sentinel in its description). The script runs the registration commands that `rig apply` would print, then sets `rig-probe-k` to `false` at user scope. Scratch project K1 has `.claude/settings.local.json` with `rig-probe-k` `true`. Project K2 has no setting.
- Run: in K1 and K2, the CLI plugin listing where it reports effective state, else a `claude -p` sentinel question, three runs.
- PASS: the sentinel shows in K1 and not in K2, and the plugin loads from the local path with no fetch.
- FAIL: K1 hides it, K2 shows it, or the registration needs a network fetch.
- INCONCLUSIVE: auth, or the runs disagree.
- Sets: Claude `project_scope`. PASS keeps the local-marketplace channel for `project` scope. FAIL sets `project_scope: null`, so the project part of a `project` or `hybrid` pack is absent on all four harnesses and slice 4 shrinks.
- Resolves: A25.

Done-check for slice 0: for each of the eleven scripts, `node probes/<script>` prints a first line that starts with `PASS`, `FAIL` or `INCONCLUSIVE`. The four target records carry the values that the verdicts set. Slice 0 fails if any probe ends in `INCONCLUSIVE` with no recorded fallback decision.

## Slice 1: read-only first

Goal: rig sees the read-sets of the four harnesses and reports effective duplicates. It writes nothing.

Content:

- Test harness: fixture HOME builder, recording stubs, snapshot helper, boundary test, `node --test` wiring.
- `bin/rig.mjs`: the command table with the `doctor` row, the strict parser, exit codes.
- `lib/world.mjs`: the target record schema (closed keys, `schema` field) and `loadWorld(env)` for `targets/` only.
- `lib/targets.mjs`: `readSet(world)` and `place()`.
- `lib/fs.mjs`: read primitives and realpath containment.
- `targets/<h>.json` for Claude, Codex, omp and Cursor, with `reads`, `never_write` and the probe values.

Done-checks:

- **S1.1** The fixture HOME holds `dup-copy` (identical real copies in `~/.claude/skills` and `~/.agents/skills`), `dup-link` (a symlink in `~/.cursor/skills` to `~/.agents/skills/dup-link`), three unique skills, and a same-name skill inside `.trash/` and `.backup-<date>/`. `HOME=<fixture> rig doctor` exits 0 and lists, per harness, exactly the duplicates that the test states as a literal. The test author derives that literal by hand from the layout and the `reads` lists. Fails if a duplicate is missing, a third one appears, or the output names a dot dir.
- **S1.2** `rig doctor --no-such-flag` exits 2. The flag is undefined on purpose. `rig no-such-command` exits 2.
- **S1.3** On the fixture HOME, the snapshot before and after `rig doctor` is identical, and the state root does not exist afterwards. Fails on any changed entry or a new `log/` file.
- **S1.4** On the real machine, you take a snapshot of every read dir and the state root, run `rig doctor`, and take a second snapshot. The diff is empty. Directory mtimes alone do not prove this, because reads change no directory mtime. The snapshot covers every file.
- **S1.5** Unit tests of `place()` cover each `dedupe` value of probe (b). A unit for Claude, Codex and Cursor lands so that each harness sees it once. Where no such placement exists, `place()` gives `E_READSET` naming Cursor and the colliding dirs. No result matches a `never_write` glob.
- **S1.6** Inside a test, `command -v claude codex omp cursor-agent` resolves into `test/stubs/`. A stub called with an unlisted flag exits 2 and logs the call. The test helper, started with `HOME` set to the real home, refuses to run.
- **S1.7** The boundary test passes on the tree and fails on each planted violation.

Tests: the fixture HOME builder with the duplicate layout of S1.1, the stubs on `PATH`, the snapshot helper for S1.3 and S1.4, unit tests for `place()`. No fixture HOME or stub existed in prior art (decision 0015 assumes one did), so slice 1 builds them from scratch.

Risks: the fixture layout encodes the read-set matrix, so a wrong probe verdict passes S1.1 and fails on the real machine. S1.4 is the only real-machine check, and the user runs it by hand.

Leaves out: every writer, compose, the gate, models, `doctor --project`.

## Slice 2: owned-file writer

Goal: rig writes whole files that it owns, converges after a crash, and undoes a run byte-exact.

Content:

- `lib/world.mjs`: schemas of `rig.json`, `pack.json`, `providers/<p>.json`, `audit.allow.json`, and a read of `rig.lock.json`.
- `lib/stack.mjs`: `compose(world)` with the core seal, the `own` pack, the four customization operations, slot stubs, `E_CLASH`, `E_CORE_SHADOW`, `E_SLOT_TWICE`.
- `lib/targets.mjs`: `render()` for owned skills, commands, agents and rules, instruction modes, core `terms.json` and `{{rig:term}}`, `/craft` and `/pm` per harness, the Cursor local plugin `~/.cursor/plugins/local/rig`.
- Provider records for pstack and OpenSpec.
- `lib/gate.mjs`: the registry with `pin`, `exec`, `secret`, `unicode`, `license`, ack parsing and id hashing.
- `lib/state.mjs`: `observe`, `plan`, `apply` with the journal, recovery, `undo`, `installed.json`, whole-file adopt.
- `lib/fs.mjs`: write primitives (temp file in the same dir, fsync, rename, mode kept), refusal of a backup path inside any read-set.
- `lib/lock.mjs`: tree hashing for the core seal (read side only).
- `bin/rig.mjs`: rows `plan` and `apply [--undo <run-id>]`. Doctor gains owned-file drift and the `/pm` alias reminder.

Done-checks:

- **S2.1** On a fresh fixture, the full snapshot (state root included) is the same before and after `rig plan`. `rig apply` exits 0. Then `rig plan` lists no ops and exits 0, and a second `rig apply` reports 0 changes. The fixture HOME tree hash outside the state root is the same before and after the second apply.
- **S2.2** For every `k` from 1 to N (N = op count of the first plan), on a fresh fixture: `RIG_TEST=1 RIG_TEST_ABORT_AFTER=k rig apply` dies with no `commit` line. Then `rig apply` exits 0, the tree hash equals that of an uninterrupted run, and `rig plan` lists no ops. Fails for any `k`.
- **S2.3** After an abort at `k`, the test writes foreign bytes to the path of op `k`. The next `rig apply` exits 1, names the path, and the path keeps the foreign bytes. Unit tests over hand-built journals classify each intent as done, not done or conflict.
- **S2.4** Snapshot before run R, `rig apply`, then `rig apply --undo <R>` exits 0. The tree hash outside the state root equals the pre-run tree hash, modes included. Files that R created now sit in the backups of the undo run, not deleted.
- **S2.5** After R, the test edits two files that R wrote. `rig apply --undo <R>` exits 1 and names both paths with `E_UNDO_CONFLICT`. It writes nothing: the tree hash outside the state root equals the hash before the undo, so the edited files keep their bytes and no other path of R restores.
- **S2.6** A fixture pack with a shebang script: `rig plan` exits 1 and names `exec` and the path. `rig apply` exits 1 and the fixture HOME tree hash does not change.
- **S2.7** You paste the stanza that `rig plan` printed into `audit.allow.json` with a reason and an expiry. `rig plan` exits 0. One changed byte in the script makes `rig plan` exit 1 again. A stanza with an empty reason makes `rig plan` exit 2 with `E_SCHEMA` and name the line. With a stanza for a `pin` finding, `rig plan` still exits 1 with `pin`.
- **S2.8** `audit.allow.json` keeps its bytes (or stays absent) across every `rig plan` and `rig apply` in this slice.
- **S2.9** A hand edit of an owned file: `rig doctor` exits 1 and names the path. `rig plan` exits 1 and names the path. `rig apply` exits 1 and the file keeps the hand edit.
- **S2.10** A fixture `~/.claude/commands/pm.md` with the bytes rig would render: `rig plan` shows `adopt`, and `rig apply` leaves the file sha unchanged. With other bytes: `rig plan` exits 1 with `E_ADOPT_MISMATCH`, names the path and prints a diff. `rig apply` exits 1 and the file keeps its bytes. After the test moves the file away, `rig apply` exits 0 and creates the alias. The same holds for any other unmanaged file at a rendered path.
- **S2.11** Rendered `/craft` and `/pm` files exist at the per-harness paths of the architecture doc (section 12). On Cursor both are skills in `~/.cursor/plugins/local/rig/skills/` with `disable-model-invocation: true`. The Claude `craft.md` names the plugin-cache path with the version from the fixture lock and contains no `sort` or `tail`. `rig doctor` prints the alias reminder while `rig.json` holds the alias. A fixture marketplace plugin named `rig` makes `rig doctor` flag the shadowed Cursor local plugin.
- **S2.12** Containment. `~/.claude/skills` as a symlink to `outside/`: `rig apply` exits 1, names the path, and the `outside/` tree hash does not change. A fixture target record that places a unit under a `never_write` glob: `rig plan` exits 1 and names the glob. With `repo/` as the working directory, `git -C repo status --porcelain` prints nothing after `rig apply`, and the `repo/` tree hash does not change.
- **S2.13** One changed byte under `packs/core`: `rig plan` exits 1 with `pin`.
- **S2.14** Clash fixtures give `E_CLASH`, `E_CORE_SHADOW` and `E_SLOT_TWICE`, and an unknown placeholder gives `E_TERM_UNKNOWN`. Each makes `rig plan` exit 1 before any write.
- **S2.15** With `XDG_STATE_HOME` set to a dir inside `outside/`, `rig plan` and `rig apply` exit 2 with `E_STATE_ROOT`, and the `outside/` tree hash does not change.

Tests: the good and hostile fixture packs, the fault-injection hook for S2.2, hand-built journals for S2.3, the snapshot tree hash for S2.1, S2.4 and S2.12.

Risks: this is the largest slice. If it runs over, split it into 2a (writer, journal, recovery and undo on the `own` pack) and 2b (`/craft`, providers, whole-file adopt). Rename and fsync behaviour can differ by filesystem. The tests run on one.

Leaves out: cells and markers, models, network, scope other than `machine-hidden`, `cve`, `telemetry`, `budget`, hooks.

## Slice 3: models

Goal: one tier change reaches every model cell through the same gate and writer, and changes no other byte.

Content:

- `lib/world.mjs`: schemas of `models/roles.json`, `models/tiers.json`, and the overlay `rig.json` `model_surfaces` list.
- `lib/models.mjs`: roles x tiers to cell values per harness and consumer, ladders and clamping, aliases versus pinned ids, `setTier()`, the effective table.
- `lib/targets.mjs`: the five render kinds (`frontmatter`, `cells`, `whole`, `keys`, `block`), the four `effort_syntax` values, cell rendering, fleet agent frontmatter on hand-written files, Codex agent TOML as `whole` files with text from the Claude fleet agent file of the same role.
- `lib/state.mjs`: ops `patch-cells` and `insert-markers`, cell and block adopt, drift by the digests in `installed.json`.
- `lib/stack.mjs`: the `second-opinion` slot and `E_SAME_FAMILY`.
- `bin/rig.mjs`: row `models [set <tier> <model> --harness <h>]`. Doctor gains cell drift, model env overrides and stale prose mentions as info.

Done-checks:

- **S3.1** Fixture copies of the five real-shape files, with cells equal to the render: `rig plan` shows `adopt` for each existing surface, `insert-markers` for the Markdown fleet file only, one `update` that appends the `[agents]` block to the Codex config, and one `create` per Codex fleet agent TOML. After `rig apply`, `diff` shows one marker pair around each fleet table, the appended block between `# rig:models:start` and `# rig:models:end`, the new Codex agent files, and no other change in any file.
- **S3.2** One cell differs from the render: `rig plan` exits 1 with a per-cell diff (file, row, column). `rig apply` exits 1 and the file keeps its bytes.
- **S3.3** A tier change touches every cell. In each surface, every changed line holds a cell. The bytes outside the cell span stay equal. This covers the third token `read-only`, a role label with commas, the header lines of the `whole` pstack model rules files (only the `# budget:` value may change), and an omp id that ends in an effort-like word (split on the last colon).
- **S3.4** `rig models set strong <model-id> --harness omp` exits 0. `diff` of the fixture omp config shows exactly one changed line (the fixture `roles.json` maps one omp key to `strong`). `models/tiers.json` changes in that one value. Every other fixture HOME file keeps its bytes.
- **S3.5** `rig models set strong <model-id>` without `--harness` exits 2.
- **S3.6** The test replaces the fixture omp config with the rewrite shape from probe (c), with the same cells. `rig doctor` exits 0 and reports no drift for that path. `rig plan` lists no ops. A hand edit of one cell then makes `rig doctor` and `rig plan` exit 1 and name the cell.
- **S3.7** A pinned full id for tier `reason` changes only the `model:` line and the display token of the fleet agent file that maps to `reason`.
- **S3.8** `rig models` prints each tier per harness with its source. A model env override in the test env shows as the source for that value.
- **S3.9** A `second-opinion` filler whose CLI is the current harness, with the record flag set: `rig plan` exits 1 with `E_SAME_FAMILY`. For a valid filler, the test runs the argv from the rendered `rig-second-opinion` body against the stub. The stub log holds that argv, and the stub accepts every flag.
- **S3.10** The Codex `block` surface with no marker pair and no `[agents]` table: `rig plan` shows the block append as a planned op. With an `[agents]` table outside the markers: `rig plan` exits 1 with `E_LOCATOR`, and the config keeps its bytes.
- **S3.11** A `roles.json` label that differs by one byte from the label in the fixture pstack model rules file: `rig plan` exits 1 with `E_ADOPT_MISMATCH`, and the diff names the label line.
- **S3.12** A fleet role in `roles.json` with no agent file in `~/.cursor/agents/`: `rig plan` prints an info line, and `rig apply` creates no file there. A fleet role with no Claude agent file: `rig plan` prints an info line, and no Codex agent TOML appears for it.

Tests: the five real-shape fixture files, the probe (c) rewrite fixture for S3.6, a line `diff` per surface, the stubs for S3.9.

Risks: Markdown table grammar (padding, escaped pipes) can break the `cells` kind on real files. S3.1 on fixtures does not prove the real files parse. After this slice, a read-only `rig plan` on the real machine must show only `adopt` lines or per-cell diffs.

Leaves out: rewriting prose outside cells, `models sweep`, running a second-opinion dispatch.

## Slice 4: supply chain and scope

Goal: rig vendors and pins third-party content, merges the overlay, and delivers per-project packs without writing into a repository.

Content:

- `lib/lock.mjs`: `pack add` (clone at SHA into a temp dir, copy paths, tree sha256, lock entry, `pack.json` skeleton), `pin check`, `pin set`, the OSV refresh inside those two commands.
- `lib/gate.mjs`: `cve`, `telemetry`, and `private_terms` as a sub-rule of `secret`.
- `lib/world.mjs`: overlay merge (adds only, core references rejected), the `projects` map, per-pack scope choice.
- `lib/world.mjs` and `lib/stack.mjs`: scopes `machine-hidden`, `project`, `hybrid`, the `machine-hidden` default, `E_SCOPE_MODE`, and the info line for a project part that is absent on a harness.
- `lib/targets.mjs`: the Claude local plugin render into `$XDG_DATA_HOME/rig/marketplace`, and the registration commands that `rig apply` prints.
- `bin/rig.mjs`: rows `pack add` and `pin check` / `pin set`. Doctor gains pins versus installed plugins, `autoUpdate` marketplaces, telemetry env and `--project`.

Tests use local `file://` bare git repositories and a fixture OSV cache. No test touches the network.

Done-checks:

- **S4.1** `rig pack add file://<fixture-repo> --sha <sha> --path <path>` creates `packs/<name>/`, a lock entry whose tree sha256 equals an independent recount, and a `pack.json` skeleton. It prints findings and ack stanzas. `audit.allow.json` and the fixture HOME keep their bytes. With `--into overlay`, only the overlay root and its lock change.
- **S4.2** One changed byte in a vendored pack: `rig plan` exits 1 with `pin`.
- **S4.3** `rig pin check <name> --sha <sha>` records the candidate. With the fixture `installed_plugins.json` `gitCommitSha` equal to it, `rig pin set <name>` exits 0 and promotes it. With another SHA, `rig pin set <name>` exits 1 and the lock keeps its bytes.
- **S4.4** A sentinel term in the overlay list appears in a repo pack: `rig plan` exits 1 with a `secret` finding. The same term in an overlay pack gives no finding.
- **S4.5** A pack with a dependency manifest, no OSV cache entry and no scanner: `rig plan` exits 1 with `cve`. With a clean cached result: no `cve` finding. With no manifest: `cve` does not run.
- **S4.6** A provider record with telemetry on: `rig plan` warns and exits 0. With `DO_NOT_TRACK=1`: no finding and no ack needed.
- **S4.7** A `project` pack that lists Codex: `rig plan` exits 0 and prints one info line that names the pack and Codex. No file for that pack appears under `~/.codex/`. `rig doctor --project <dir>` prints the repository paths to commit for Codex. The fixture project tree hash does not change.
- **S4.8** The same pack on Claude renders under the marketplace dir in the fixture HOME, and `rig apply` and `rig doctor --project <dir>` print the snippet for `.claude/settings.local.json`. The fixture project tree hash does not change. With the snippet in place, `rig doctor --project <dir>` reports the pack enabled with source `local`. Without it, the pack shows as not enabled.
- **S4.9** `rig doctor --project <dir>`: a `rig-project: openspec` line gives provider `openspec`. No line gives `default_provider`. An `openspec/` dir without a line shows as info and the provider stays the default.
- **S4.10** An overlay pack renders. An overlay entry that references a core unit fails `loadWorld`.
- **S4.11** A fixture `installed_plugins.json` whose `gitCommitSha` differs from the lock: `rig doctor` exits 1. A marketplace with `autoUpdate` on that serves a pinned plugin: `rig doctor` names it.
- **S4.12** A pack entry with no `scope` key renders hidden (`machine-hidden`). A `rig.json` scope that the pack's `pack.json` does not list: `rig plan` exits 2 with `E_SCOPE_MODE` before any write. No scope value `machine` parses.

Risks: who registers the local marketplace with Claude is open. The architecture doc recommends printed commands (section 15). A `file://` clone does not exercise network failures.

Leaves out: SARIF scanners, an OSV refresh in `plan` or `apply`, `project` scope on Codex, omp and Cursor.

## Slice 5: observability and budget

Goal: rig measures usage from transcripts, stores no content, and proposes changes that the user applies.

Content:

- `lib/metrics.mjs`: transcript readers for `claude-jsonl`, `codex-rollout`, `omp-jsonl` and `cursor-agent-jsonl`, dedupe by message id, content-free aggregates, `record()`, the report, proposals.
- `lib/gate.mjs`: `budget` over rendered bytes plus the always-on files rig can read.
- `lib/state.mjs`: the `json-element` op, a JSON merge that keeps every entry rig did not write, for `~/.claude/settings.json` `hooks.SessionEnd`.
- `bin/rig.mjs`: rows `stats [--since <dur>] [--harness <h>] [--suggest]` and `stats --record [--session <id>]`.

Fixture transcripts are synthetic files in the shapes the readers expect. They carry a unique sentinel in every prompt and response.

Done-checks:

- **S5.1** A Claude fixture transcript repeats one message id with its usage over three content blocks. `rig stats` counts that message once, and the totals equal the literal in the test. A subagent file counts once.
- **S5.2** After `rig stats --suggest` and `rig stats --record`, `grep -c <sentinel>` over `metrics.jsonl`, `proposals/` and `log/` prints 0 for every file. Each `metrics.jsonl` line parses and is under 4 KiB.
- **S5.3** `printf 'not json' | rig stats --record` prints 0 bytes to stdout, exits 0, and writes one error line under `log/`. With a valid payload (fields from probe (h)), `metrics.jsonl` gains one line. The same payload twice leaves the report with one session. With an unwritable state root, the hook still prints 0 bytes and exits 0. `rig stats --record --session <id>` with a fixture session id records that session and reads no stdin. `rig stats --record --since 7d` and `rig stats --session <id>` exit 2.
- **S5.4** A 2,000-character description: `rig plan` exits 1 with `budget`. A 400-character one warns and exits 0. A Codex instruction file above the probe (d) cap exits 1.
- **S5.5** With `"metrics": {"session_hook": true}` and a canonical fixture `settings.json` that holds foreign hook entries: `rig apply` adds one element to `hooks.SessionEnd`, and the diff shows only that element. A second `rig apply` reports 0 changes. A non-canonical `settings.json` (4-space indent): `rig plan` exits 1 with `E_JSON_ROUNDTRIP`, prints the snippet, and the file keeps its bytes. Codex, omp and Cursor hook files keep their bytes.
- **S5.6** `rig stats --suggest` on a fixture with an unused unit prints a `rig.json` disable diff and writes it to `proposals/<date>.patch`. Plain `rig stats` writes no file under `proposals/`. The repo tree hash and every harness file keep their bytes.
- **S5.7** A fixture transcript with no usage field reports `n/a`, not 0.
- **S5.8** A unit test runs `targets.patch` with the hook element on a fixture Cursor `hooks.json` that holds foreign entries. Every foreign entry keeps its value and order, and the result holds exactly one rig element. The same primitive, run twice, gives the same bytes.

Risks: transcript formats are undocumented and drift (A35). The fixtures copy today's shapes. Budget thresholds can warn too often (A21).

Leaves out: OpenTelemetry, cost from a price table, session-end hooks on Codex, omp and Cursor.

## Guarantees and the checks that pin them

| Guarantee | Done-check |
|---|---|
| A second apply reports 0 changes | S2.1, S5.5 |
| An interrupted apply converges | S2.2, S2.3 |
| Undo restores byte-exact | S2.4 |
| Undo never overwrites a later edit, and a conflict stops it before any write | S2.5 |
| rig never replaces an unmanaged file | S2.10 |
| Adopt changes zero bytes outside cells and markers | S3.1, S3.3 |
| One swap changes exactly the expected lines | S3.4, S3.7 |
| A harness rewrite outside cells is not drift | S3.6 |
| The metrics store holds no content | S5.2 |
| The hook prints 0 bytes | S5.3 |
| The JSON merge keeps every foreign entry | S5.5, S5.8 |
| A project part absent on a harness is info, not an error | S4.7 |
| An unlisted scope mode is a parse error (exit 2) | S4.12 |
| A state root outside HOME exits 2 | S2.15 |
| A private term blocks | S4.4 |
| No write into a repository | S2.12, S4.8, S5.6 |
| No write outside HOME | S2.12, S2.15 |
| No write under `never_write` globs | S1.5, S2.12 |
| `plan` and `doctor` write nothing | S1.3, S1.4, S2.1 |
| The CLI never writes acks | S2.8, S4.1 |
| `pin` is never ackable | S2.7 |
| No skip flag exists | S1.2 (an unknown flag exits 2) |
| No test writes into the real `~` | S1.6 |
| Network only in `pack add` and `pin check` | boundary test (network rule), S1.7 |

## After v0

- Product pack (`office-hours`). Draft v4 put it in slice 5. The placement is an open question in the architecture doc (section 15).
- pi and Hermes targets.
- `doctor --live`.
- `models sweep`.
- More slots.

## Open questions for the orchestrator

The architecture doc (section 15) now decides the five questions that this plan raised. Each decision waits for confirmation at the checkpoint:

1. **Logger versus read-only commands.** `plan` and `doctor` write no log. Only `apply`, `stats`, `pack`, `pin` and `models set` log. S1.3 and S2.1 pin it.
2. **Partial or atomic undo.** A conflict stops the undo before any write, and the output lists every conflicting path. S2.5 pins it.
3. **Local marketplace registration.** Recommended: `rig apply` prints the commands, and the user runs them. Probe (k) runs the same commands.
4. **State root outside HOME.** The state root and the data root must resolve inside HOME, else exit 2 with `E_STATE_ROOT`. S2.15 pins it.
5. **Exit code for config parse errors.** A config parse error exits 2. S2.7 and S4.12 pin it.

The product pack placement stays open (see "After v0").

## Uncertainties and assumptions

Plan risks only. Verified facts and the numbered design assumptions stay in [assumptions-and-open-questions.md](../assumptions-and-open-questions.md). No plan risk below repeats one of them.

| Assumption | Score | Reason | Blast radius | Resolution path | Falsification probe |
|---|---|---|---|---|---|
| Slice 2 fits one slice. | 5 | It holds compose, render, five checks, the journal, recovery, undo, adopt and `/craft`, with 15 done-checks. | Slice 2 slips and blocks slices 3 to 5. | Split into 2a and 2b as the slice text says. | If 2a (writer, journal, undo on the `own` pack) is not green after half the time budget, split. |
| Probes can authenticate in scratch state. | 5 | Credentials can sit in an OS keychain or under the config dir. The research docs name no config-dir override for Claude, Codex, omp or Cursor. | Probes fall back to the real config dir or stay `INCONCLUSIVE`, and slices wait. | Probe (i) reads the help text for an override. API keys pass by env reference. | Run `claude -p "ok"` with `HOME` set to an empty temp dir. A login prompt means the fallback is needed. |
| Model-reported listings agree across three runs. | 6 | Probes (b), (e), (f), (g) and (j) ask the model when no list command exists. | Those probes end `INCONCLUSIVE`. | Sentinel tokens, a machine-readable channel where one exists. | Run the probe (b) prompt three times on the control skills only. |
| omp has a non-interactive settings change. | 4 | No source names one. | Probe (c) needs one manual step. | The script prints the step and waits. | `omp --help` lists no config or settings subcommand. |
| `SessionEnd` fires in `claude -p`. | 5 | The hook is documented for sessions. Headless runs are not mentioned. | Probe (h) needs one manual step. S5.3 still uses the captured payload. | Manual fallback in the script. | Probe (h) part 1 writes no payload file. |
| Stubs that check flags against probe (i) output are faithful enough. | 6 | Stubs model argv, not behaviour. CLIs change flags between releases. | A rendered `second-opinion` argv passes S3.9 and fails in a real harness. | Re-run probe (i) after each harness update. One manual headless run per harness before v0 ships. | Diff the probe (i) flag lists of two CLI versions. |
| Placeholder fixtures reproduce the real file shapes. | 6 | They follow the grounding shapes, not the real bytes. | The render kinds pass on fixtures and fail on real files. | A read-only `rig plan` on the real machine after slice 3. | A real fleet table with alignment padding or an escaped pipe. |
| Abort after op `k` covers the crash windows. | 6 | A crash inside one op (after the intent line, before the rename) falls between counts. | A recovery bug ships untested. | Unit tests over hand-built journals for done, not done and conflict (S2.3). | Kill the process with SIGKILL during a write of a large file, then run `rig apply`. |
| `node --test` covers the needs with no dependency. | 8 | It has subtests, mocks and a spec reporter. | A test dependency, which breaks zero-dependency. | Keep helpers in `test/helpers/`. | A check that needs a feature `node:test` lacks, such as snapshot files. |

Overall confidence: 6 out of 10. The order and the done-checks follow the agreed slice outline, and each check can fail. The weak points are probe feasibility in scratch state and the size of slice 2.
