# rig v1 first seed: design

Status: design, from an architect run on 2026-11-05 (two candidates, one synthesis). The user revised it the same day for the `craft` install shape (decisions below, and "Revision on 2026-11-05"). The user confirmed D1 to D6 and D8 in a review session. D7, D9 and D10 follow from them in the docs review and are open for review. It turns [rig-v1-concept.md](rig-v1-concept.md) into the data shape, the commands and the module changes for the first seed. The build order is [docs/plan/v1-first-seed-prs.md](../plan/v1-first-seed-prs.md).

## Decisions of 2026-11-05

| # | Decision |
|---|---|
| D1 | pstack's hub installs byte-identical as the file `craft/hub.md`, not as a skill. Its playbooks and `bugbot-triage.md` install next to it. |
| D2 | The mode skill is `craft` (`/craft`). An optional first argument names a domain, for example `/craft eng: ...`. |
| D3 | Each pack carries its mode data in `pack.json` `mode`. rig renders the shell, one file per domain and the adapter from that data. |
| D4 | Every skill carries the harness hide switch, `craft` included. Units in `rig.json` `auto` stay visible to the model. |
| D5 | Each vendored leaf copy gets a two-line anchor that links to `../craft/references/adapter.md`. |
| D6 | The Claude adapter is a port of upstream `docs/harness/claude-code.md`. The Codex, Cursor and omp adapters are rig-authored in the first seed. |
| D7 | The seed keeps the hub and `agents/poteto-agent.md`, and vendors `control-cli` and `control-ui`. The only pstack port source is `docs/harness/claude-code.md`. |
| D8 | The checks `E_MODE_NAME`, `E_PLAYBOOK_UNLABELED` and `E_ANCHOR_MISSING` screen a hub change at a pin move. |
| D9 | rig always renders `craft/references/adapter.md`. In a skill dir that several harnesses read, the file holds one section for each of them. |
| D10 | `packs/core/frame.md` gains one line, ``For multi-step work, type `/craft`, optionally with a domain: `/craft eng: ...`.`` |

## Goal

Seed the default config into Claude Code, Codex, Cursor and omp from these upstream commits:

| Upstream | Repo | Full commit | Version |
|---|---|---|---|
| pstack, cursor-team-kit, cli-for-agent | `https://github.com/cursor/plugins` | `2776ddd2355d6d6c8747d3964600f28daf62f049` | pstack 0.15.36 |
| gstack | `https://github.com/garrytan/gstack` | `b4068209809315ab1578c78e33e73512b29749ca` | 1.96.0.0 |

The `pstack/` tree at `2776ddd` equals the tree at `bb68f23`. Both commits give the same tree hash.

Scope guards for the first seed:

- gstack contributes only the existing `packs/product` port of `office-hours`, re-pinned. Business steps stay empty. No other gstack skill gets ported.
- Model roles come from rig's model table (`models/roles.json`). The vendored hub keeps its Subagents prose, and that prose says the `/setup-pstack` rule overrides its defaults. rig renders that rule from the table through `model_surfaces`.
- No agent step runs inside `rig plan` or `rig apply`.

## Usage

### Config repo after the first seed

```
rig.json                    team choices: harnesses, packs, fill, auto, disable, aliases, metrics
rig.lock.json               schema 2: core seal, one entry per pack (provenance, tree, port)
packs/
  core/                     sealed by lock.core.tree, rig's own
    frame.md                always-on block: invariants and the line that points to /craft (D10)
    domains.json            4 domains and their stages: the only list of step addresses
    terms.json              per-harness terms
    skills/craft/SKILL.md   mode skill shell template with {{mode:*}} variables
    commands/alias.md
  pstack/                   vendored upstream bytes of pstack/ at 2776ddd, minus excludes
    pack.json               rig-authored: model_surfaces and the mode block (adopt, playbooks, hooks, adapter)
    LICENSE  .gitignore  .cursor-plugin/plugin.json
    agents/comment-sicko.md  agents/poteto-agent.md
    docs/harness/claude-code.md             port source of the Claude Code adapter
    skills/<52 leaves>/...
    skills/poteto-mode/SKILL.md             the hub, upstream bytes, installed as craft/hub.md
    skills/poteto-mode/playbooks/*.md       23 files, upstream bytes, installed as craft/playbooks/
    skills/poteto-mode/references/bugbot-triage.md
  cursor-team-kit/          vendored: LICENSE, skills/deslop, skills/control-cli, skills/control-ui
  cli-for-agent/            vendored: LICENSE, skills/cli-for-agents
  product/                  rig-authored port of gstack office-hours
    pack.json               mode block: the brief artifact
    NOTICE.md  licenses/  skills/office-hours/...  commands/oh.md
.claude/skills/rig-port/SKILL.md            maintainer-only repo skill, never seeded
```

### Install layout per harness

`rig apply` writes this tree into each harness skill dir:

| Path | Source | Bytes |
|---|---|---|
| `craft/SKILL.md` | `packs/core/skills/craft/SKILL.md` | rig-rendered shell |
| `craft/hub.md` | `packs/pstack/skills/poteto-mode/SKILL.md` | upstream, byte-identical (A8) |
| `craft/playbooks/*.md` | `packs/pstack/skills/poteto-mode/playbooks/` | upstream, byte-identical (A8) |
| `craft/references/bugbot-triage.md` | `packs/pstack/skills/poteto-mode/references/bugbot-triage.md` | upstream, byte-identical (A8) |
| `craft/references/<domain>.md` | `packs/core/domains.json`, pack `mode` data, `rig.json` `fill` | rig-rendered, one file per domain |
| `craft/references/adapter.md` | pack `mode.adapter` for each harness that reads the dir | rig-rendered, one section per harness that reads the dir, always present (D9) |
| `<leaf>/SKILL.md` and its other files | a vendored leaf | upstream bytes, plus the hide keys of every harness that reads the dir and the adapter anchor (A8) |

rig renders `craft/references/adapter.md` in every skill dir that holds a `craft` copy. The file holds one section for each harness that reads the dir. Each section starts with a heading that names the harness, for example `## Codex`, so every reader finds its own mapping. A section holds the `mode.adapter` text of its harness. When no pack supplies an adapter for a harness, its section says that the skills use the harness's own names, and it lists no mapping. The adapter file therefore always exists, and the anchor of a leaf never dangles.

The shell `craft/SKILL.md` says these things, in this order:

1. Read the section for this harness in `references/adapter.md` first.
2. Read `hub.md` in full.
3. An optional first argument names a domain, for example `/craft eng: ...`. The prefix or the name selects `references/<domain>.md`. Without the argument, pick the domain from the task and read its file.
4. Where a domain file and the hub name the same step, the domain file wins.
5. A named skill that is not installed is skipped with one line that names it.
6. Leaf skills call this skill poteto-mode. It is this skill.

The shell also lists each domain file and each pack trigger with no domain. A `rig.json` `fill` trigger with no domain goes in the frame of each harness, not in the shell. With no pack that adopts `hub.md`, the shell leaves out item 2.

A domain file holds, for its domain, the stages from `domains.json`, the slot and the `before` and `after` hooks of each step, the artifacts whose `write_at` is in the domain, the playbooks that carry the domain label, and the triggers of the domain.

Each choice in this layout has one reason:

- **Mode data lives in packs, not in core.** Core holds rig's own parts, which are the shell template, the domain table and the frame. Each pack carries its contribution in `pack.json` `mode`. Drop a pack and its playbooks, hooks, artifacts and adapter drop with it. Core never names a pstack unit.
- **The lock owns provenance.** `pack.json` loses `source` and `ported_from`. The lock entry holds repo, commit, root, paths, excludes, tree and port sources. No fact sits in two files.
- **The hub installs as a file, not as a skill.** The file name `hub.md` is not `SKILL.md`, so no harness loads it as a skill, and one mode exists on disk. `discover()` (`lib/stack.ts:132`, skip at `:145`) skips every path that a pack's `mode.adopt` claims, so `skills/poteto-mode/` gives no unit. The placement keeps the hub's relative paths working. `../<name>/SKILL.md` (hub line 11) reaches the sibling leaves. `references/bugbot-triage.md` (line 35) and `playbooks/<title>.md` (line 124) resolve inside `craft/`. Playbooks name `../references/bugbot-triage.md`, which resolves from `craft/playbooks/`. These paths are code spans, so the links check does not see them. Assertion A17 covers them instead. Changed on 2026-11-05: the hub was excluded at vendor time and replaced by compiled mode data.
- **Leaves are sibling skills, and every skill is hidden.** Each leaf installs as its own skill next to `craft`, so the model loads a leaf only when the hub or a domain file names it. Every skill copy carries the hide switch of `targets/*.json` `hide`. That is `disable-model-invocation: true` on Claude Code and Cursor, `agents/openai.yaml` `policy.allow_implicit_invocation: false` on Codex, and `hide: true` on omp. On Codex the switch is a sidecar file, so each Codex copy, `craft` included, also holds `agents/openai.yaml`. `craft` carries it too, so `craft` runs only when the user types it. The user can still invoke each leaf. A unit in `rig.json` `auto` gets no hide switch, so the model may pick it, for example `product/office-hours`.
- **Each harness gets its own adapter section.** Upstream `docs/harness/claude-code.md` assumes a plugin install. It says to read `<pstack>/skills/<name>`, to type `/pstack:<name>` and to spawn `pstack:poteto-agent` (lines 12 and 20). None of that holds in rig's layout. The file is a port source, and its rig version is `mode.adapter.claude`. The Codex, Cursor and omp adapters are rig-authored in `mode.adapter`. Each adapter maps the Cursor tool names, the `/setup-pstack` rule path and the `<pstack>` paths to its harness. rig renders the adapter of each harness as its section of `craft/references/adapter.md`.
- **Each vendored leaf gets an adapter anchor.** At render time rig inserts two lines right after the closing `---` of the frontmatter in each `SKILL.md` copy of a vendored pack. Line 1 is `Read the section for your harness in [the rig adapter](../craft/references/adapter.md) once per session before you follow this skill.` Line 2 is empty. In a dir that several harnesses read, the anchor links the `adapter.md` in the same dir, and that file holds a section for each reader (A16). The pstack Claude Code installer does the same. The installed 0.15.36 plugin copy has an adapter line in 23 skills, and the repo at `2776ddd` has it in 1 (`poteto-help`, excluded). The repo bytes stay byte-identical. A leaf with no frontmatter close gives `E_ANCHOR_MISSING`. A8 compares a leaf copy after it removes this marker block. The hub, the playbooks, `bugbot-triage.md`, agents and authored packs such as `product` get no anchor.
- **The hub keeps its own Subagents section and principles index.** 24 leaf and playbook lines cite "the Subagents section" of the hub, and `hub.md` holds it. rig derives no principles index and renders no Subagents section.
- **No link rewrite is needed.** Only `poteto-help` links to `../poteto-mode/` (4 links, checked with `rg` at `bb68f23`), and the seed excludes `poteto-help`. 20 prose mentions of "poteto-mode" stay in kept files. Item 6 of the shell covers them.
- **Model surfaces move to the pack.** Leaf skills read `~/.claude/rules/pstack-models.md` and `~/.cursor/rules/pstack-models.mdc`. These entries move from `providers/pstack.json` to `packs/pstack/pack.json` `model_surfaces`.
- **Mode files name only kept units.** The gate check `mode` reads the vendored mode files, which are the hub and the playbooks. It blocks with `E_MODE_NAME` when a file names a unit that no kept unit matches. The seed therefore vendors `control-cli` and `control-ui` from cursor-team-kit, because hub line 31 and the `multi-phase-plan` playbook name them.

### rig.json

```json
{
  "schema": 2,
  "harnesses": ["claude", "codex", "omp", "cursor"],
  "packs": { "cli-for-agent": {}, "cursor-team-kit": {}, "product": {}, "pstack": {} },
  "fill": {
    "eng:ground": "pstack/how",
    "eng:design": "pstack/architect",
    "eng:ship.before": ["cursor-team-kit/deslop"],
    "prod:discover": "product/office-hours",
    "triggers": [{ "when": "Building or changing a CLI", "use": "cli-for-agent/cli-for-agents", "domain": "engineering" }]
  },
  "auto": [],
  "disable": [],
  "aliases": {},
  "metrics": { "session_hook": false }
}
```

`auto` lists the units that get no hide switch. It defaults to empty. The `mode` PR adds the key to rig.json schema 2 in `lib/world/schemas.ts`, together with the optional `domain` of a fill trigger.

The default fills restate four step-anchored hub triggers, so the domain file and the hub agree by default:

| Hub trigger | Step | Set in |
|---|---|---|
| "Nontrivial change, architecture decision, or 'are we sure?'" | `eng:ground` | `rig.json` `fill` |
| "Code crossing a function boundary" | `eng:design` | `rig.json` `fill` |
| "Before review" | `eng:review.before` | `packs/pstack/pack.json` `mode.hooks` |
| "Before commit" | `eng:ship.before` | `rig.json` `fill`, because `deslop` is in another pack |

A team fill that differs from the hub wins, by item 4 of the shell. The hub's other situational triggers stay in the hub.

The default `rig.json` also lists "Before review" and "Before commit" as `fill` triggers with no domain, so the frame names `no-comments` and `deslop` in every session. Inside `/craft` the step and the frame line would name the same unit twice. The domain file therefore prints `Replaces the frame trigger: "<when>"` under a step whose slot or hook holds the unit of a domain-less fill trigger, and the model runs the step in place of that line of the frame (`test/mode.test.ts`, "a step that holds the unit of a frame trigger quotes that trigger under the step, so the model runs the step and not the frame line"). Outside `/craft` the frame line is the only instruction.

Pack hooks are the defaults. A hook list in `rig.json` `fill` replaces the pack list at the same address. A slot comes only from `rig.json` `fill`. `disable` removes a unit from every step.

### pack.json mode block (excerpt)

pstack's `mode` block holds only `adopt`, `playbooks`, `artifacts`, `hooks` and `adapter`. It is about 25 lines, with one adapter string per harness.

```json
{
  "schema": 2,
  "name": "pstack",
  "scopes": ["machine-hidden"],
  "model_surfaces": [
    { "path": "~/.claude/rules/pstack-models.md", "harness": "claude", "consumer": "pstack",
      "kind": "whole", "keep_header": true, "grammar": "{model} {effort}" }
  ],
  "mode": {
    "adopt": {
      "hub.md": { "from": "skills/poteto-mode/SKILL.md" },
      "playbooks/": { "from": "skills/poteto-mode/playbooks/" },
      "references/bugbot-triage.md": { "from": "skills/poteto-mode/references/bugbot-triage.md" }
    },
    "playbooks": {
      "bug-fix": { "domain": "engineering", "file": "skills/poteto-mode/playbooks/bug-fix.md" },
      "worktree-cleanup": { "domain": "upkeep", "file": "skills/poteto-mode/playbooks/worktree-cleanup.md" }
    },
    "artifacts": {},
    "hooks": { "eng:review.before": ["pstack/no-comments"] },
    "adapter": { "claude": "# rig in Claude Code\n...", "codex": "...", "cursor": "...", "omp": "..." }
  }
}
```

The adopt key `hub.md` marks the hub. The `playbooks` map has one entry for each of the 23 adopted playbooks. A playbook `file` path is pack-relative, like an adopt `from`. The `seed` PR picks each domain label. `triggers` and `sections` stay in the type for a pack with no hub, such as `product`.

`packs/product/pack.json` carries one artifact:

```json
{ "mode": { "artifacts": { "brief": {
  "generates": "docs/designs/<slug>.md", "write_at": "prod:discover",
  "instruction": "Write the design doc from the office-hours session.", "requires": [] } } } }
```

### Build the seed (maintainer, once)

```sh
P=https://github.com/cursor/plugins; PS=2776ddd2355d6d6c8747d3964600f28daf62f049
G=https://github.com/garrytan/gstack; GS=b4068209809315ab1578c78e33e73512b29749ca

rig pack add $P --sha $PS --root pstack --path . \
  --exclude assets --exclude automations --exclude docs/guide --exclude README.md --exclude plugin.json \
  --exclude skills/poteto-mode/scripts \
  --exclude skills/statechart --exclude skills/create-formal-verification-skill \
  --exclude skills/show-me-your-work/scripts --exclude skills/make-bot-ui \
  --exclude skills/setup-pstack --exclude skills/poteto-help \
  --port docs/harness/claude-code.md
rig pack add $P --sha $PS --root cursor-team-kit \
  --path skills/deslop --path skills/control-cli --path skills/control-ui --path LICENSE
rig pack add $P --sha $PS --root cli-for-agent --path skills/cli-for-agents --path LICENSE
GB=b244e6d11a6466650c5147cd7dc023859968c4b5    # the commit packs/product was ported from
rig pack add $G --sha $GB --name product \
  --port office-hours/SKILL.md --port office-hours/sections --port LICENSE
rig pin set product --ported            # attest the existing hand port at b244e6d
rig pin check product --sha $GS         # "port fresh": office-hours did not change
rig pin set product                     # moves product to b406820 with no agent
# /rig-port pstack writes packs/pstack/pack.json mode (the Claude adapter is the port) and model_surfaces once, then:
rig pin set pstack --ported
rig plan
```

The pstack pack keeps 109 files (369,744 bytes). The excludes drop 5.9 MB (measured with `git ls-tree -l` at `2776ddd`). The cursor-team-kit pack keeps 4 files, and a scratch `rig pack add` of it at `2776ddd` gave 0 findings.

Each exclude has one reason:

| Exclude | Reason |
|---|---|
| `assets`, `automations`, `docs/guide`, `README.md`, `plugin.json` | not loaded by any harness |
| `skills/poteto-mode/scripts`, `skills/show-me-your-work/scripts` | 17 `exec` gate blocks |
| `skills/statechart` | 50 `exec` gate blocks |
| `skills/create-formal-verification-skill` | links to `../statechart/` |
| `skills/make-bot-ui` | `unicode` gate block: `curl ... \| sudo sh` at line 89 |
| `skills/setup-pstack` | writes the model rule that rig owns |
| `skills/poteto-help` | its 4 links to `../poteto-mode/` dangle, because no skill dir of that name installs |

Changed on 2026-11-05: `skills/poteto-mode/SKILL.md` and `agents/poteto-agent.md` were excluded. Both are kept now. The hub is no longer a port source, so the pstack port sources are only `docs/harness/claude-code.md`. gstack `office-hours` stays a port.

`--port` without `--path` adopts an authored pack. The pack folder must exist. rig vendors nothing, hashes the folder from disk, and records the port sources and their tree. Every `pack add --port` writes `reviewed_sha` and `reviewed_tree` as null, and null counts as stale. A new port therefore blocks `rig plan` until a maintainer runs `rig pin set <pack> --ported`.

### First end-to-end test

Three tests share one assertion helper in `test/helpers/seed.ts`.

| Test | Runs under | Inputs | Proves |
|---|---|---|---|
| `test/seed.test.ts` | `npm test` | synthetic upstreams built with `makeRepo` (`test/lock.helpers.ts`) | vendoring, excludes, port records, mode render, on small fixtures |
| `test/first-seed.test.ts` | `npm test` | the committed config of this repo | the real first seed, offline |
| `test/live/first-seed.test.ts` | `RIG_LIVE=1` | GitHub, real harness CLIs | re-vendoring reproduces the lock, and harnesses load the mode skill |

The offline transcript of `test/first-seed.test.ts`:

```sh
export RIG_ROOT=<copy of this repo> RIG_NOW=2026-11-05T00:00:00Z
HOME=$T/h1 rig plan                     # A1 exit 0, 0 blocks, links and pin checks have 0 findings
HOME=$T/h1 rig apply                    # A2 prints run id R1
HOME=$T/h1 rig plan                     # A3 "0 changes"
HOME=$T/h2 rig apply                    # A4 manifest(h1) == manifest(h2) == test/golden/first-seed.manifest
HOME=$T/h1 rig apply --undo R1          # A5 manifest(h1) == the manifest before A2
```

`manifest(home)` is a test helper. It lists sorted `relpath\0mode\0sha256` lines and leaves out rig's state directory.

More assertions:

| # | Assertion |
|---|---|
| A6 | Each harness read-set sees exactly one `craft/SKILL.md`, next to a `references/adapter.md` that holds a section for that harness. It carries the harness hide switch, so it runs only when typed. |
| A7 | With `auto` empty, every skill in every read-set carries the hide switch: the frontmatter key on Claude Code, Cursor and omp, the `agents/openai.yaml` sidecar on Codex. That covers `craft` and every pstack, cursor-team-kit, `cli-for-agents` and `office-hours` skill. |
| A8 | Byte identity. `craft/hub.md`, every `craft/playbooks/*.md` and `craft/references/bugbot-triage.md` equal their files under `packs/pstack/skills/poteto-mode/`, byte for byte. Each vendored leaf `SKILL.md` copy equals the pack file plus the hide keys of every harness that reads the dir, plus the two-line anchor block. The test removes the anchor block with `stripAnchor`, sets the same hide keys on the pack file, and compares bytes. A dir that only Codex reads gets no frontmatter key, because its hide switch is the sidecar. |
| A9 | Every relative Markdown link in every owned file resolves to an owned file of the same harness. This covers the anchor link of each leaf to `../craft/references/adapter.md`. The links check skips targets that are not paths, such as `url` in `skills/why/references/synthesizer-prompt.md:65`. |
| A10 | The Codex skill listing counts only visible units, which are the units in `auto`. With `auto` empty it counts none, and it stays under 8,000 characters. |
| A11 | Warns match a list committed from the first green run. Hidden skills get no description warns (`lib/gate/budget.ts:82`, applied at `:176`), and `craft` is hidden too. The committed list holds two `budget` warns, both reference chains inside upstream pstack skills: `skills/ketchup-video/SKILL.md` and `skills/principle-attack-the-premise/SKILL.md`, each 2 levels deep. Any other warn fails. |
| A12 | `craft/SKILL.md` names each domain file and the precedence rule. `references/engineering.md` names each `eng` fill of `rig.json`, the pack hook `eng:review.before`, and the `bug-fix` playbook. Under `eng:review` and `eng:ship` it prints `Replaces the frame trigger:` for "Before review" and "Before commit", and the frame names `no-comments` and `deslop` once. `references/product.md` names `prod:discover` and the `brief` artifact. |
| A13 | The degraded list matches. It holds 8 kept files. They are the `show-me-your-work` skill (no `scripts/`), the `multi-phase-plan` playbook (step 6 calls `check-plan.mjs`, and lines 37, 65 and 152 name repo-root `pstack/skills/<x>/SKILL.md` paths), the `worktree-cleanup` playbook (step 1 calls `worktree-audit.sh`), the `babysit` playbook (`scripts/watch-pr`), the `shipping` playbook (step 5 at line 9 runs `scripts/watch-pr/watch-pr`), the `figure-it-out` skill (line 13 names the Principles section of the **poteto-mode** skill), the `maintain-formal-verification-skill` skill (lines 9 and 28 name the excluded skill), and the `poteto-agent` agent (its fallback search for `skills/poteto-mode/SKILL.md` finds no file, and it reads `hub.md` only through the path its parent gives). The test pins the list with the A13 grep below this table. At `2776ddd` the grep gives exactly these 8 files, so an upstream change fails the test. |
| A14 | No file in a pack sits under a locked exclude prefix. |
| A15 | `rig plan` gives 0 `E_MODE_NAME` findings and 0 acks. Every unit that the hub and the playbooks name is kept or on the allowlist. |
| A16 | In each harness read-set, the anchor link of each vendored leaf reaches a `craft/references/adapter.md` that holds a section headed with the name of that harness. |
| A17 | Every relative path in a code span or link of `craft/hub.md` or a kept playbook that has the form `../<x>/SKILL.md`, `playbooks/<y>.md` or `references/<z>.md` resolves to an owned file in each harness read-set. The test resolves a path first from the dir of the file, then from `craft/`. Upstream playbooks name sibling playbooks from the skill root, for example `playbooks/shipping.md`. The test skips a path with a `<...>` placeholder, such as `../<name>/SKILL.md` and `playbooks/<title>.md`. |

The A13 grep runs in `packs/pstack/`. The `[^n]` guard skips `transcripts/`. The rig-authored `pack.json` stays out, because its adopt `from` names `skills/poteto-mode/SKILL.md`.

```sh
git grep -l -E '(^|[^n])scripts/|create-formal-verification-skill|Principles section of the \*\*poteto-mode\*\*|skills/poteto-mode/SKILL\.md' -- . ':!pack.json'
```

The live transcript of `test/live/first-seed.test.ts`:

```sh
RIG_ROOT=$T/cfg rig pack add ...        # the commands above, into a dir with rig.json, the pack.json files and packs/product
# L1 $T/cfg/rig.lock.json tree hashes == committed rig.lock.json tree hashes
rig pin check pstack --sha $PS          # L2 "unchanged, port fresh", exit 0
rig pin check product --sha $GS         # L2 same
# L3 claude -p in a scratch repo with the seeded units: /craft routes a bug report to the Bug fix playbook
# L4 codex, cursor-agent, omp: typed craft reads craft/hub.md, and the model-visible listing names no leaf
```

### Maintainer flow on a new commit

```sh
rig pin check pstack --sha <new 40-hex>
#  fetches, gates the candidate tree, hashes the vendored tree and the port sources,
#  records lock.packs.pstack.candidate, prints "14 files changed, port stale: docs/harness/claude-code.md"
rig pin set pstack                       # writes the new bytes, keeps pack.json; port.tree moves, reviewed_tree stays
rig plan                                 # BLOCK pin E_PORT_STALE pstack. Not ackable.
/rig-port pstack                         # in Claude Code, in the config repo: edits packs/pstack/pack.json mode.adapter
rig pin set pstack --ported              # reviewed_sha and reviewed_tree := sha and port.tree. No fetch.
rig plan                                 # green. Open a pull request. CI runs npm test with no model.
```

When no port source changed, `rig pin set` alone gives a green plan. A change to the hub or a playbook alone is such a case. `rig plan` then runs `E_MODE_NAME` and `E_PLAYBOOK_UNLABELED` over the new bytes, so a new unit name or a new playbook blocks until the maintainer vendors the unit, labels the playbook or acks the name.

The exclude list can change at a pin move. `rig pin check <pack> --sha <new> --exclude <p>...` replaces the list in the candidate, and `rig pin set` applies it. Two cases need this. A new upstream subtree with scripts makes the candidate gate block, and the maintainer adds an exclude. An excluded path that vanished upstream gives `E_PATH_MISSING`, and the maintainer drops it.

## Deterministic versus agent split

The test is this. A CI runner with no language model, given only the committed config repo, produces byte-identical fresh HOMEs. Every seeding step passes it. `plan`, `apply`, `apply --undo` and `doctor` read only committed files, HOME and `RIG_NOW`. Render is pure (`lib/targets.ts:48`). `pack add`, `pin check` and `pin set` need git and OSV over the network, and no model. Assertion L1 proves they reproduce the lock. The `cve` check reads the OSV cache only for packs with a dependency manifest. The first seed has none, because the excludes drop `skills/poteto-mode/scripts/package.json`.

One step needs an agent or a person. It is the re-port after an upstream source of a port changed.

| | |
|---|---|
| Where | `.claude/skills/rig-port/SKILL.md` in the config repo. A maintainer-only repo skill. It is not a CLI subcommand, not a seeded unit, and not a mode skill playbook, because users who seed never port. |
| Reads | `rig pin check <pack> --diff`: a unified diff of the port paths between `reviewed_sha` and `sha`. Also the current `pack.json` mode block or the product files, and the new vendored bytes. |
| Writes | `packs/pstack/pack.json` `mode.adapter`, or files under `packs/product/`. Then it runs `rig pin set <pack> --ported`. |
| Detector | `lock.packs[p].port.tree !== port.reviewed_tree` gives the `pin` check block `E_PORT_STALE` in every `plan`. It reads only the committed lock, so CI catches a pin move that skipped the port review. |
| Validators after the edit | `E_MODE_REF`, `E_FILL_UNKNOWN`, `E_ARTIFACT_DANGLING`, `E_PLAYBOOK_UNLABELED`, the `mode` check, the `links` check, the `budget` check, the pin tree check. |
| Model | the maintainer's session. The skill spawns nothing. It may write a throwaway parser script as a lever. The committed `pack.json` stays the source of truth. |

## Type sketch

```ts
// lib/lock/lockfile.ts
/** Full 40-hex commit. Parsed once at the CLI boundary. A short SHA is E_USAGE (git fetch by short SHA fails). */
export type Sha = string & { readonly __brand: "sha40" };
export type TreeHash = `sha256:${string}`;
export type PortLock = {
  /** Upstream paths, relative to PackLock.root. Hashed from the fetched tree, so a port path may also be excluded. */
  paths: string[];
  /** treeHash over `paths` at PackLock.sha. Written only by pack add, pin check and pin set. */
  tree: TreeHash;
  /** Commit and tree of the last attested port. Null after pack add. Stale exactly when reviewed_tree is null or differs from tree. */
  reviewed_sha: Sha | null;
  reviewed_tree: TreeHash | null;
};
export type PackLock = {
  repo: string;
  sha: Sha;
  /** Upstream folder that maps to the pack root. Structure under it is kept. */
  root: string;
  /** Root-relative includes. [] means an authored pack: nothing vendored. */
  paths: string[];
  /** Root-relative, applied after paths. Each entry matched a path at sha. Excluded bytes never reach the repo or the gate. */
  exclude: string[];
  license: string;
  /** treeHash of every file in packs/<name>/ except pack.json. */
  tree: TreeHash;
  port: PortLock | null;
  /** exclude since port (#38). license since #39. pin set detects the license again and refuses when it differs or is absent. */
  candidate: { sha: Sha; exclude: string[]; tree: TreeHash; port_tree: TreeHash | null; license?: string; checked: string } | null;
};
/** Schema 2 drops `pins`: rig no longer pins installed plugins. Every non-core pack folder has an entry. */
export type Lock = { schema: 2; core: { tree: TreeHash | null; candidate: TreeHash | null } | null; packs: Record<string, PackLock> };

// lib/lock.ts (with lib/lock/git.ts, the only modules that spawn git)
export type VendorArgs = {
  repo: string; sha: Sha; root?: string; paths?: string[]; exclude?: string[];
  /** Port sources. With no paths, adopt mode: the pack folder must exist, nothing is vendored. */
  port?: string[];
  /** Default basename(root), or the repo basename when root is ".". */
  name?: string;
  into?: "repo" | "overlay";
};
/** rig pack add. An exclude that matches nothing is E_PATH_MISSING. An upstream pack.json at the pack root is refused. Same args, same bytes: no-op. */
export async function vendor(world: World, args: VendorArgs): Promise<{ pack: string; tree: TreeHash; noop: boolean }> {
  throw new Error("not implemented");
}
export type PinCheck = {
  pack: string;
  changed: { added: string[]; removed: string[]; modified: string[] };
  port: "none" | "fresh" | "stale";
  diff: string | null;
  findings: Finding[];
  blocked: boolean;
};
/** rig pin check <pack> [--sha] [--diff] [--exclude]. `exclude` replaces the candidate's list. Writes only lock.packs[pack].candidate, and only when not blocked. */
export async function pinCheck(world: World, pack: string, sha: Sha | null, opts: { diff?: boolean; exclude?: string[] }): Promise<PinCheck> {
  throw new Error("not implemented");
}
/**
 * rig pin set <pack> [--ported]. Without --ported: re-fetch candidate.sha, verify candidate.tree, rewrite vendored files,
 * delete files upstream removed, keep pack.json, set sha, tree and port.tree. With --ported: reviewed := (sha, port.tree),
 * and for an authored pack also tree := treeHash(disk). No fetch. A second call with nothing to do is a no-op.
 */
export async function pinSet(world: World, pack: string, opts: { ported?: boolean }): Promise<{ promoted: boolean; port: PinCheck["port"] }> {
  throw new Error("not implemented");
}

// lib/mode.ts (new): owns the mode skill data, compile and render
export type UnitRef = `${string}/${string}`;
export type DomainName = "business" | "product" | "engineering" | "upkeep";
export type DomainPrefix = "biz" | "prod" | "eng" | "upk";
export type StepAddress = `${DomainPrefix}:${string}`;
export type HookAddress = `${StepAddress}.before` | `${StepAddress}.after`;
/** packs/core/domains.json. Its stage names are the only valid step addresses. */
export type DomainTable = { domains: Record<DomainName, { prefix: DomainPrefix; stages: string[] }> };
export type ArtifactDef = {
  generates: string; write_at: StepAddress; instruction: string; requires: string[];
  template?: string; ready_when?: string; check?: string;
};
/**
 * pack.json `mode`. Prose fields may hold {{skill:<pack>/<unit>}}. Nothing else is substituted.
 * A pack with a hub uses adopt, playbooks, artifacts, hooks and adapter only. triggers and sections serve a pack with no hub.
 */
export type ModeData = {
  /** Install path under craft/ to a pack-relative source. The key "hub.md" marks the hub. A key that ends in "/" adopts a folder. */
  adopt?: Record<string, { from: string }>;
  /** One entry per adopted playbook file. `file` is pack-relative, like adopt `from`. A missing entry is E_PLAYBOOK_UNLABELED. */
  playbooks?: Record<string, { domain: DomainName; file: string; title?: string; when?: string }>;
  artifacts?: Record<string, ArtifactDef>;
  /** Default hook lists. A rig.json fill at the same address replaces the list. */
  hooks?: Partial<Record<HookAddress, UnitRef[]>>;
  /** Markdown per harness id, rendered as the section of that harness in craft/references/adapter.md. */
  adapter?: Record<string, string>;
  triggers?: { when: string; then: string; domain?: DomainName }[];
  sections?: Record<string, { domain: DomainName; text: string }>;
};
export type Step = { before: UnitRef[]; slot: UnitRef | null; after: UnitRef[] };
/** rig.json `fill`. compileMode parses the address grammar against DomainTable (E_FILL_UNKNOWN). */
export type Fill = { triggers?: { when: string; use: UnitRef; domain?: DomainName }[] } & Record<string, unknown>;
export type DomainView = {
  name: DomainName;
  prefix: DomainPrefix;
  steps: Map<StepAddress, Step>;
  playbooks: { id: string; file: string; pack: string; title?: string; when?: string }[];
  artifacts: Map<string, ArtifactDef & { pack: string }>;
  triggers: { when: string; then: string }[];
  sections: { title: string; text: string; pack: string }[];
};
/**
 * The compiled mode skill. Invariants: every ref names a kept unit. Every adopted playbook has a domain label. Artifact ids
 * are unique across packs, and every `requires` has a writer. Adopted paths do not clash across packs, at most one pack
 * adopts "hub.md", and no adopted path is a rendered path (SKILL.md, references/<domain>.md, references/adapter.md).
 */
export type Mode = {
  hub: { pack: string } | null;
  domains: DomainView[];
  /** Triggers with no domain. The frame lists a fill trigger, which carries `use`. The shell lists a pack trigger, which carries `then`. */
  triggers: ({ when: string; use: UnitRef } | { when: string; then: string })[];
  adapters: Map<string, { text: string; pack: string }>;
  /** Adopted files under craft/. Render copies them with no change. */
  files: Map<string, { bytes: Uint8Array; mode: number; pack: string }>;
  /** rig.json `auto`. These units render with no hide switch. */
  auto: Set<UnitRef>;
};
/** Pure. compose calls it after disable and replace. Errors: E_MODE_REF, E_FILL_UNKNOWN, E_ARTIFACT_DANGLING, E_CLASH, E_PLAYBOOK_UNLABELED. */
export function compileMode(units: Unit[], packs: World["packs"], domains: DomainTable, fill: Fill, auto: UnitRef[]): { mode: Mode; errors: RigError[] } {
  throw new Error("not implemented");
}
/**
 * Per-dir view. `harness` is the format owner of the dir. `readers` are the harnesses that read the dir, as in skillCopy.
 * `link` returns a path relative to the rendered file `from`, so the output does not depend on HOME.
 */
export type ModeView = { harness: string; readers: string[]; link: (ref: UnitRef, from: string) => string | null };
/**
 * The craft/ files of one skill dir. They are SKILL.md from the shell template ({{mode:domains|triggers}}), references/<domain>.md,
 * references/adapter.md, and the adopted files. adapter.md always exists and holds one section per reader, headed with the
 * harness name. A reader with no mode.adapter text gets a section that says the skills use its own names. An unknown
 * template name is E_TERM_UNKNOWN.
 */
export function modeFiles(mode: Mode, template: string, view: ModeView): { files: Map<string, { bytes: Uint8Array; mode: number }>; errors: RigError[] } {
  throw new Error("not implemented");
}
/** Inserts the two-line marker block after the frontmatter close of a vendored leaf SKILL.md. No close is E_ANCHOR_MISSING. */
export function insertAnchor(text: string, link: string): { text: string; error: RigError | null } {
  throw new Error("not implemented");
}
/** Removes the marker block that insertAnchor wrote. A8 compares the result with the pack bytes. */
export function stripAnchor(text: string): string {
  throw new Error("not implemented");
}

// lib/gate/mode.ts: check `mode`, block, ackable. E_MODE_NAME when a vendored mode file (the hub or a playbook) names a unit
// in a closed spelling, no kept unit has that name, and the name is not on the allowlist.
// Closed spellings: **x** skill, `/x`, bare /x, and bare `x` for the names control-cli and control-ui.
// A name is a run of letters, digits and hyphens. It ends at a space, a backtick or other punctuation, and it never
// continues across "/". A token runs to the next space or backtick, minus trailing punctuation. A `/x` or bare /x
// spelling counts only when the whole token is /name. So `/tmp/<slug>-resume.md` and `/tmp/swarm-<pr-id>/...` give no name, `/poteto-mode,`
// gives poteto-mode, and `/loop 1h` gives loop.
// Allowlist: loop, create-skill, poteto-mode, setup-pstack.
export function runModeNames(ctx: GateCtx): RawFinding[] {
  throw new Error("not implemented");
}

// lib/gate/links.ts: block, ackable. Every relative Markdown link in an owned .md entry resolves to an owned path of the same harness.
export function runLinks(ctx: GateCtx): RawFinding[] {
  throw new Error("not implemented");
}
```

## Module map

| File | Change |
|---|---|
| `lib/lock.ts`, `lib/lock/*` | `vendor` gains root, exclude, port, name and the 40-hex check, and writes pack.json schema 2 without `source`. `select` keeps structure under root. `pinCheck` and `pinSet` work on packs. Delete the installed-plugin branches inside `lib/lock.ts:156-275`. The `core` branches stay. |
| `lib/world/schemas.ts`, `lib/lock/lockfile.ts` | The closed-key `LOCK` validator lives in `lib/world/schemas.ts:206-235` (at `adae5ed`). Lock schema 2 drops `pins` and adds `root`, `exclude`, `port` and `candidate`. `port` (#38) added `candidate.exclude`, and #39 added the optional `candidate.license`. rig.json schema 2: drop `pins`, `providers`, `default_provider`, `slots`, add `fill`. pack.json schema 2: drop `source` and `ported_from`, add `mode`, `model_surfaces` and `telemetry`. The `mode` PR adds rig.json `auto` (a list of unit refs, default empty, a union in the overlay) and the optional `domain` of a fill trigger (`lib/world/schemas.ts:75-92`). |
| `lib/mode.ts` | New. |
| `lib/stack.ts` | `discover` (`lib/stack.ts:132`) maps core `skills/craft/` to unit type `mode`, and skips every path that a pack's `mode.adopt` claims. `compose` calls `compileMode`. |
| `lib/targets.ts` | `renderMode` runs after every other unit, so `link` reads leaf paths from the rendered entries. It writes the `craft/` files of each skill dir, with one `adapter.md` section per reader of the dir (`readersOf`, `lib/targets.ts:107`). `hidden = !isCore(unit)` (`lib/targets.ts:97`) becomes `hidden = !mode.auto.has(unit.id)`, so `craft` gets the hide switch too. `skillCopy` calls `insertAnchor` on each skill of a vendored pack. Model surfaces come from pack.json. |
| `lib/gate/registry.ts`, `lib/gate/links.ts`, `lib/gate/mode.ts` | Remove plugin and provider text from the `pin` and `telemetry` rows. Add the `links` check. The `telemetry` check reads `telemetry` from pack.json. The `mode` PR adds the `mode` check (`E_MODE_NAME`). |
| `lib/gate/pin.ts` | Every pack folder needs a lock entry. Add `E_PORT_STALE` and the exclude-prefix check. Delete the installed-plugin pin checks (`lib/gate/pin.ts:58-118`). Add `E_FOREIGN_INSTALL`: a harness plugin install of a seeded upstream blocks, not ackable, with the removal command in the message. |
| `lib/gate/budget.ts` | `hidden()` honors the sidecar method (`lib/gate/budget.ts:82`). |
| `lib/commands/pack.ts`, `lib/commands/pin.ts` | New flags, `pin check --diff`, `pin set --ported`. |
| `packs/core` | Add `skills/craft/SKILL.md` and `domains.json`. Delete `principles.md`, `commands/craft.md`, `skills/rig-doc-review`, `skills/rig-second-opinion`. `frame.md` loses `{{providers}}`, `{{default_provider}}` and `{{slots}}` (done in `subtract`), and `mode` adds the `/craft` line of D10. |
| Provider and slot readers | `lib/world/project.ts`, `lib/world/merge.ts:43-46`, `lib/commands/doctor.ts:91-134`, `lib/commands/models.ts:29`, `lib/commands/shared.ts:36`, `lib/targets/models-render.ts:24-46`. |
| `packs/product` | `pack.json` drops `source` and `ported_from`. `skills/office-hours/references/design-doc.md:135,159-171` and `SKILL.md:115` drop the slot and provider text and the `{{rig:intake}}` term. |
| Deleted | `providers/` (`pstack.json`, `openspec.json`), `test/openspec.*`, `probes/craft-claude-project-units.ts`, the slot and provider tests, the `pm` to `craft` alias. OpenSpec returns in phase 4 as an artifact pack. |

## Rationale

### Revision on 2026-11-05

The user replaced "compile the hub from data" with "install the hub as a file". pstack's hub installs byte-identical as `craft/hub.md`. rig renders the shell, the domain files and the adapters around it. The reasons:

- With an empty `fill` the mode behaves as pstack does, because the model reads pstack's own hub.
- No port restates 5,336 tokens of hub prose. A hub change arrives with `rig pin set`, and `E_MODE_NAME` and `E_PLAYBOOK_UNLABELED` screen it.
- The pack `mode` data shrinks to about 25 lines.

The cost is that "the domain file wins over the hub" is a prose rule. Only a live lane checks that the model follows it (`mode` lane 6).

### Synthesis decision

Two runners designed the first seed independently from the same grounding. They were candidate A (Opus) and candidate B (Sonnet). The cross-judge step did not run. The judge pool holds only Claude models, and the arena rule forbids a judge from the parent's family. An independent reviewer reads this design instead.

Candidate A is the base. It ports the hub once into `pack.json` and detects stale ports with one derived check. Candidate B derives the mode skill at every seed with a parser over the pinned hub and binds rig steps to numbered playbook steps.

A won on three rubric points:

- It matches C1 (port and own) without a parser that keeps rig downstream of pstack's prose format.
- It has fewer moving parts. It needs no section rules, no line-prefix skip list and no step anchors.
- One detector (`E_PORT_STALE`) covers both ports, the pstack hub and the gstack product pack.

Grafts from B:

- An exclude that matches nothing upstream is an error (`E_PATH_MISSING`), and the pin check refuses a file under a locked exclude prefix. Excluded code cannot return unnoticed.
- The mode skill shell states that leaf skills call it poteto-mode.
- Codex, Cursor and omp get a rig-authored adapter from the pack `mode.adapter` data, in the first seed. Changed on 2026-11-05: phase 4 was to render it from `terms.json`.
- B's history evidence sets the condition for revisiting the parser. Over 25 hub versions the 7 H2 sections never changed, while the bullet count grew from 22 to 52.

### Trade-offs accepted

- The seed loses 5 pstack skills, and 8 kept files degrade (A13). In exchange it needs no acks (A15), and the links check passes once it skips non-path targets.
- `--ported` is an attestation the CLI cannot check for meaning. Pull request review checks what the port says.
- A rig-authored `pack.json` sits inside a vendored folder and stays out of the tree hash. In exchange anyone can recompute the vendored tree from upstream, and dropping a pack drops its mode data.
- The model applies "the domain file wins over the hub" as prose. In exchange the hub stays upstream bytes. `mode` lane 6 checks the rule on Claude Code.
- `rig pack add` fetches one commit three times, because rig keeps no fetch cache. That is cheaper than a new kind of cache state.

### Alternatives rejected

| Alternative | Why it lost |
|---|---|
| Parse the hub at every seed (candidate B) | rig stays downstream of pstack's prose format, step bindings are ordinal, and a misparse can go silent |
| Mode data in sealed core | core would name pstack units and break with pstack disabled, and the core seal would follow a pack commit |
| Keep `poteto-mode` as a hidden unit and route to it | two modes on disk, and the 5,336-token hub stays invocable. Changed on 2026-11-05: decision D1 answers this case. The hub installs as the file `craft/hub.md`, not as a skill, so one mode exists and no harness lists the hub. |
| Port the hub into pack `mode` data (C1) | the port restates the hub prose, the default behavior drifts from pstack, and each hub change needs a re-port. Rejected on 2026-11-05. |
| `playbook` as a unit type | playbooks have no frontmatter and no placement of their own, so a unit type adds a render path for files only the mode skill reads |
| Ack the 68 gate findings | approves 121 KB of Bun code to run on a developer machine, one ack per file |
| A `rig seed` command with built-in recipes per commit | a second way to vendor, and a recipe list to keep in sync |
| Run gstack's own generator (`bun run gen:skill-docs`) | adds Bun to the toolchain, and the output still calls gstack binaries |

### Red-flag screen

- Shallow module: no. `compileMode` hides adoption, ref resolution, fill and hook merge, playbook labels and the artifact graph behind one function.
- Information leakage: the lock alone holds provenance. pack.json no longer repeats it.
- Split ownership: `pin set` writes vendored bytes, the port writes `pack.json`. The files do not overlap.
- Two ways to do one task: `exclude` acts on bytes at vendor time, `disable` acts on units at compose time. They act on different objects.
- Hand-synced list: the degraded list is pinned by a test grep, and `E_PLAYBOOK_UNLABELED` pins the playbook labels to the adopted files.

## Uncertainties

| Uncertainty | Score | Reason | Blast radius | Falsification probe |
|---|---|---|---|---|
| `place()` puts the mode skill and the leaves where relative links resolve on every harness | 6 | Cursor reads `~/.claude/skills`, so its mode skill copy may sit elsewhere | A9 fails on Cursor | Run `rig plan` on the seed, then the links check on the Cursor read-set |
| A Claude Code agent maps Cursor names through `craft/references/adapter.md` | 6 | Upstream relies on the same mechanism, unmeasured | Leaves spawn the wrong tool | `seed` lane 3. The bug-fix route uses `Agent`, not `Task` |
| The model applies "the domain file wins over the hub" | 6 | It is a prose rule in the shell. No code enforces it. | A team fill does not change what the model runs | `mode` lane 6. A fill sets `eng:design` to a fixture unit. Pass when the transcript reads the fixture unit and not `architect`. |
| Leaves work on Codex and omp through the rig-authored adapters | 4 | No upstream adapter exists for them | Leaves misfire on Codex and omp | `mode` lane 7. `$architect` typed on Codex reads the adapter. A live run of a leaf that says `AskQuestion` stays open. |
| `craft/SKILL.md` stays under the skill body budget | 7 | The shell is short. The 5,336-token hub is a separate file that the model reads on each `/craft`. | A budget warn, and a read cost on every `/craft` | Render it and count |
| Pack hooks as defaults, replaced by a `fill` at the same address | 6 | The user named "default hooks" but no merge rule | A team cannot add one hook without repeating the defaults | A team config that adds a second `eng:review.before` hook |
| A fill trigger carries an optional `domain`, and a fill trigger with no domain goes in the frame | 6 | The domain files hold "domain triggers", and v0 triggers had no domain. A pack trigger with no domain still goes in the shell. | The CLI trigger lands in the wrong file | Render the seed and read `references/engineering.md` and the frame |
| The typed skill form on Cursor and omp is `/craft` | 5 | Only Claude Code (`/craft`) and Codex (`$craft`) are known | The `mode` lanes 4 and 5 test the wrong input | The lane records the form that worked in `versions.txt` |
| The product port sources are complete | 7 | Resolver changes upstream move the generated outputs | A stale port goes unnoticed | Diff a resolver-only change upstream and check the outputs move |
| The exclude list is link-closed | 8 | The reviewer found no kept link to an excluded skill at `2776ddd` | `plan` blocks | Run the links check on the vendored tree first |
| `craft` copies and leaf copies work in a shared read dir | 4 | Codex, omp and Cursor share `~/.agents/skills`, and Cursor keeps the first copy of a name. One `adapter.md` and one copy of each leaf there serve every reader. A leaf copy carries the hide key of each reader, and the model must pick the section of its own harness. | A harness follows the mapping of another harness, a hide key of one harness changes how another reads the copy, or omp sees two `craft` copies | The `mode` unit case that renders all four harnesses and runs `place()` on the result, A16, and `mode` lanes 3 to 5 |
| Vendoring `control-cli` and `control-ui` from cursor-team-kit is right for the seed | 6 | The seed keeps them so that `E_MODE_NAME` finds the names in hub line 31 and the `multi-phase-plan` playbook. `control-ui` drives a local browser or Electron UI, and no lane runs either skill on any harness. | Two hidden skills that misfire on a harness without the tools they assume, and a later pin can add scripts to them | Read both `SKILL.md` files for tool names that no adapter maps. A scratch `rig pack add` at `2776ddd` gave 0 gate findings for the 4 kept files. |
| The adopt key `hub.md` is enough to mark the hub | 7 | One key holds both the install path and the role. A pack whose hub needs another install name cannot mark it. | `Mode.hub` stays null, and the shell leaves out item 2 with no error | A second hub-carrying upstream in phase 4. Check that `hub.md` still fits as its install name. |
| `E_MODE_NAME` is an ackable gate check | 6 | An ack lets the hub name a unit that no pack keeps. Shell item 5 then makes the model skip it with one line. | The model meets a step it cannot run, and an ack can outlive the pin move that needed it | The unit case where an ack clears the finding. Then move the fixture pin so that the same file names a second unknown unit. Pass when the old ack does not clear the new finding. |
| `modeFiles` replaces the earlier name `modeMarkdown` | 8 | The function returns adopted bytes and the adapter too, not only rendered Markdown. An earlier draft of this design used the old name. | An owner who reads the old draft writes a second function | `rg modeMarkdown docs lib test` printed no line at this commit |
| `poteto-agent` is degraded, not broken (A13) | 6 | Its fallback search for `skills/poteto-mode/SKILL.md` finds no file. It reads `craft/hub.md` only when its parent passes the path, as hub line 11 asks. | A spawned agent works without the hub's principles and Subagents rules | `seed` lane 3. Read the prompt of the `Agent` call. Pass when it holds the absolute path of `craft/hub.md`. |

Overall confidence: 7 of 10. The vendoring and determinism half is 8, because it reuses code that exists and passed the prototype. The mode skill half is new code, and its precedence rule rests on model behavior.

## Appendix A. Prototype evidence

The prototype ran on 2026-11-05 against a scratch copy of this repo and a fixture HOME. Commands: `node bin/rig.ts pack add file:///home/you/os/plugins --sha <sha> --path <p>`, then `plan` and `apply`.

1. A short SHA (`2776ddd`) fails with `E_FETCH`. A full SHA works.
2. `--path pstack/skills` names the pack `skills` (`lib/lock.ts:36-38`). The design adds `--root` and `--name`.
3. `--path pstack` vendors 573 files, 6.3 MB in git (7.5 MB on disk), with license MIT and a tree hash.
4. The gate blocks 68 findings: 67 `exec` (50 in statechart, 16 in `poteto-mode/scripts`, 1 in `show-me-your-work`) and 1 `unicode` (`make-bot-ui`).
5. With the pack enabled, compose finds 58 skills and 2 agents and plans 1,166 file creates across four harnesses.
6. `disable` of the blocked units leaves all 67 `exec` blocks, because the gate scans the whole vendored tree. `apply` writes nothing.
7. `rig plan` took 0.19 s with the trunk config and 0.40 s with the vendored pstack, each the median of 5 runs.
