# rig v1 first seed: design

Status: design, from an architect run on 2026-11-05 (two candidates, one synthesis). It turns [rig-v1-concept.md](rig-v1-concept.md) into the data shape, the commands and the module changes for the first seed. The build order is [docs/plan/v1-first-seed-prs.md](../plan/v1-first-seed-prs.md).

## Goal

Seed the default config into Claude Code, Codex, Cursor and omp from these upstream commits:

| Upstream | Repo | Full commit | Version |
|---|---|---|---|
| pstack, cursor-team-kit, cli-for-agent | `https://github.com/cursor/plugins` | `2776ddd2355d6d6c8747d3964600f28daf62f049` | pstack 0.15.36 |
| gstack | `https://github.com/garrytan/gstack` | `b4068209809315ab1578c78e33e73512b29749ca` | 1.96.0.0 |

The `pstack/` tree at `2776ddd` equals the tree at `bb68f23`. Both commits give the same tree hash.

Scope guards for the first seed:

- gstack contributes only the existing `packs/product` port of `office-hours`, re-pinned. Business steps stay empty. No other gstack skill gets ported.
- Model roles come from rig's model table (`models/roles.json`), not from pstack's Subagents prose.
- No agent step runs inside `rig plan` or `rig apply`.

## Usage

### Config repo after the first seed

```
rig.json                    team choices: harnesses, packs, fill, disable, aliases, metrics
rig.lock.json               schema 2: core seal, one entry per pack (provenance, tree, port)
packs/
  core/                     sealed by lock.core.tree, rig's own
    frame.md                always-on block: invariants and "use the mode skill"
    domains.json              4 domains and their stages: the only list of step addresses
    terms.json              per-harness terms
    skills/rig-mode/SKILL.md    mode skill template with {{mode:*}} variables
    commands/alias.md
  pstack/                   vendored upstream bytes of pstack/ at 2776ddd, minus excludes
    pack.json               rig-authored: model_surfaces and the mode block (the hub and adapter port)
    LICENSE  .gitignore  .cursor-plugin/plugin.json
    agents/comment-sicko.md
    docs/harness/claude-code.md
    skills/<52 leaves>/...
    skills/poteto-mode/playbooks/*.md       23 files, upstream bytes, adopted by the mode skill
    skills/poteto-mode/references/bugbot-triage.md
  cursor-team-kit/          vendored: LICENSE, skills/deslop
  cli-for-agent/            vendored: LICENSE, skills/cli-for-agents
  product/                  rig-authored port of gstack office-hours
    pack.json               mode block: the brief artifact
    NOTICE.md  licenses/  skills/office-hours/...  commands/oh.md
.claude/skills/rig-port/SKILL.md            maintainer-only repo skill, never seeded
```

Each choice in this layout has one reason:

- **Mode data lives in packs, not in core.** Core holds rig's own parts, which are the template, the domain table and the frame. Each pack carries its contribution in `pack.json` `mode`. Drop a pack and its triggers, playbooks and artifacts drop with it. Core never names a pstack unit.
- **The lock owns provenance.** `pack.json` loses `source` and `ported_from`. The lock entry holds repo, commit, root, paths, excludes, tree and port sources. No fact sits in two files.
- **The hub `SKILL.md` is excluded at vendor time.** With no `SKILL.md` in `skills/poteto-mode/`, `discover()` (`lib/stack.ts:151`, skip at `:164`) finds no unit there. The mode skill adopts `playbooks/` and `references/` from that folder. It installs them at `rig-mode/playbooks/` and `rig-mode/references/`, so the path `../references/bugbot-triage.md` that playbooks name still resolves. The playbooks write it as a code span, so the links check does not see it. Assertion A8 covers it instead.
- **The Claude Code adapter is ported, not adopted.** Upstream `docs/harness/claude-code.md` assumes a plugin install. It says to read `<pstack>/skills/<name>`, to type `/pstack:<name>` and to spawn `pstack:poteto-agent` (lines 12 and 20). None of that holds in rig's layout. The adapter is a port source, and its rig version is the `adapter` section of the mode block. The mode skill renders it to `rig-mode/references/adapter.md` on Claude Code only.
- **The mode skill keeps a Subagents section.** 24 leaf and playbook lines cite "the Subagents section" of the hub. The mode skill renders one from `models/roles.json` plus the ported delegation rules.
- **No link rewrite is needed.** Only `poteto-help` links to `../poteto-mode/` (4 links, checked with `rg` at `bb68f23`), and the seed excludes `poteto-help`. 20 prose mentions of "poteto-mode" stay in kept files. The mode skill template says once: "Leaf skills call this skill poteto-mode. It is this skill."
- **The principles index is derived.** Each `principle-*` leaf description already holds the hub entry's "when" clause and rule. The mode skill lists every kept `principle-*` unit. That gives one source.
- **Model surfaces move to the pack.** Leaf skills read `~/.claude/rules/pstack-models.md` and `~/.cursor/rules/pstack-models.mdc`. These entries move from `providers/pstack.json` to `packs/pstack/pack.json` `model_surfaces`.

### rig.json

```json
{
  "schema": 2,
  "harnesses": ["claude", "codex", "omp", "cursor"],
  "packs": { "cli-for-agent": {}, "cursor-team-kit": {}, "product": {}, "pstack": {} },
  "fill": {
    "eng:ground": "pstack/how",
    "eng:design": "pstack/architect",
    "eng:review.before": ["pstack/no-comments"],
    "eng:ship.before": ["cursor-team-kit/deslop"],
    "prod:discover": "product/office-hours",
    "triggers": [{ "when": "Building or changing a CLI", "use": "cli-for-agent/cli-for-agents" }]
  },
  "disable": [],
  "aliases": {},
  "metrics": { "session_hook": false }
}
```

Four default fills come from step-anchored hub triggers:

| Hub trigger | Fill |
|---|---|
| "Nontrivial change, architecture decision, or 'are we sure?'" | `eng:ground` |
| "Code crossing a function boundary" | `eng:design` |
| "Before review" | `eng:review.before` |
| "Before commit" | `eng:ship.before` |

The port moves these rows from the trigger list into fills. Situational triggers stay triggers.

### pack.json mode block (excerpt)

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
      "playbooks/": { "from": "skills/poteto-mode/playbooks/" },
      "references/bugbot-triage.md": { "from": "skills/poteto-mode/references/bugbot-triage.md" }
    },
    "triggers": [
      { "when": "Contested design", "then": "Run {{skill:pstack/interrogate}} before shipping." }
    ],
    "playbooks": {
      "bug-fix": { "title": "Bug fix", "domain": "engineering", "file": "playbooks/bug-fix.md",
                   "when": "A reported defect to reproduce, root-cause, and fix with runtime evidence." }
    },
    "sections": { "autonomy": "...", "subagents": "...", "reply": "...", "comments": "...",
                  "adapter": { "harnesses": ["claude"], "text": "..." } }
  }
}
```

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
  --exclude skills/poteto-mode/SKILL.md --exclude skills/poteto-mode/scripts \
  --exclude skills/statechart --exclude skills/create-formal-verification-skill \
  --exclude skills/show-me-your-work/scripts --exclude skills/make-bot-ui \
  --exclude skills/setup-pstack --exclude skills/poteto-help --exclude agents/poteto-agent.md \
  --port skills/poteto-mode/SKILL.md --port docs/harness/claude-code.md
rig pack add $P --sha $PS --root cursor-team-kit --path skills/deslop --path LICENSE
rig pack add $P --sha $PS --root cli-for-agent --path skills/cli-for-agents --path LICENSE
GB=b244e6d11a6466650c5147cd7dc023859968c4b5    # the commit packs/product was ported from
rig pack add $G --sha $GB --name product \
  --port office-hours/SKILL.md --port office-hours/sections --port LICENSE
rig pin set product --ported            # attest the existing hand port at b244e6d
rig pin check product --sha $GS         # "port fresh": office-hours did not change
rig pin set product                     # moves product to b406820 with no agent
# /rig-port pstack writes packs/pstack/pack.json mode and model_surfaces once, then:
rig pin set pstack --ported
rig plan
```

The pstack pack keeps 107 files (347 KB). The excludes drop 5.9 MB (measured with `git ls-tree -l` at `2776ddd`).

Each exclude has one reason:

| Exclude | Reason |
|---|---|
| `assets`, `automations`, `docs/guide`, `README.md`, `plugin.json` | not loaded by any harness |
| `skills/poteto-mode/SKILL.md` | the hub, replaced by the mode skill, kept as a port source |
| `skills/poteto-mode/scripts`, `skills/show-me-your-work/scripts` | 17 `exec` gate blocks |
| `skills/statechart` | 50 `exec` gate blocks |
| `skills/create-formal-verification-skill` | links to `../statechart/` |
| `skills/make-bot-ui` | `unicode` gate block: `curl ... \| sudo sh` at line 89 |
| `skills/setup-pstack` | writes the model rule that rig owns |
| `skills/poteto-help`, `agents/poteto-agent.md` | both exist to read the hub |

`--port` without `--path` adopts an authored pack. The pack folder must exist. rig vendors nothing, hashes the folder from disk, and records the port sources and their tree. Every `pack add --port` writes `reviewed_sha` and `reviewed_tree` as null, and null counts as stale. A new port therefore blocks `rig plan` until a maintainer runs `rig pin set <pack> --ported`.

### First end-to-end test

Three tests share one assertion helper in `test/helpers/seed.ts`.

| Test | Runs under | Inputs | Proves |
|---|---|---|---|
| `test/seed.test.ts` | `npm test` | synthetic upstreams built with `makeRepo` (`test/lock.helpers.ts`) | vendoring, excludes, port records, mode compile, on small fixtures |
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
| A6 | Each harness read-set sees exactly one `rig-mode/SKILL.md`, and it is visible. Core units carry no hide marker (`lib/targets.ts:104-105`). |
| A7 | Every pstack, `deslop`, `cli-for-agents` and `office-hours` skill is hidden: a frontmatter key on Claude Code, Cursor and omp, the `agents/openai.yaml` sidecar on Codex. |
| A8 | `rig-mode/playbooks/bug-fix.md` bytes equal `packs/pstack/skills/poteto-mode/playbooks/bug-fix.md`. |
| A9 | Every relative Markdown link in every owned file resolves to an owned file of the same harness. The links check skips targets that are not paths, such as `url` in `skills/why/references/synthesizer-prompt.md:65`. |
| A10 | The Codex skill listing counts only visible units and stays under 8,000 characters. |
| A11 | Warns match a list committed from the first green run. Hidden skills get no description warns (`lib/gate/budget.ts:155`), so the list holds at most the mode skill body warn. Any other warn fails. |
| A12 | The mode skill names each step fill of `rig.json` and the `brief` artifact, and it has a Subagents section. |
| A13 | The degraded list matches. It holds the `show-me-your-work` skill (no `scripts/`), the `multi-phase-plan` playbook (step 6 calls `check-plan.mjs`, line 7 names `poteto-agent`), the `worktree-cleanup` playbook (step 1 calls `worktree-audit.sh`), the `babysit` playbook (`scripts/watch-pr`), the `figure-it-out` skill (prose "poteto-mode"), and the `maintain-formal-verification-skill` skill (lines 9 and 28 name the excluded skill). A grep over the vendored tree pins the list, so an upstream change fails the test. |
| A14 | No file in a pack sits under a locked exclude prefix. |

The live transcript of `test/live/first-seed.test.ts`:

```sh
RIG_ROOT=$T/cfg rig pack add ...        # the commands above, into a dir with rig.json, the pack.json files and packs/product
# L1 $T/cfg/rig.lock.json tree hashes == committed rig.lock.json tree hashes
rig pin check pstack --sha $PS          # L2 "unchanged, port fresh", exit 0
rig pin check product --sha $GS         # L2 same
# L3 claude -p in a scratch repo with the seeded units: /rig-mode routes a bug report to the Bug fix playbook
# L4 codex, cursor-agent, omp: the mode skill skill is listed, a hidden leaf is not
```

### Maintainer flow on a new commit

```sh
rig pin check pstack --sha <new 40-hex>
#  fetches, gates the candidate tree, hashes the vendored tree and the port sources,
#  records lock.packs.pstack.candidate, prints "14 files changed, port stale: skills/poteto-mode/SKILL.md"
rig pin set pstack                       # writes the new bytes, keeps pack.json; port.tree moves, reviewed_tree stays
rig plan                                 # BLOCK pin E_PORT_STALE pstack. Not ackable.
/rig-port pstack                         # in Claude Code, in the config repo: edits packs/pstack/pack.json mode
rig pin set pstack --ported              # reviewed_sha and reviewed_tree := sha and port.tree. No fetch.
rig plan                                 # green. Open a pull request. CI runs npm test with no model.
```

When no port source changed, `rig pin set` alone gives a green plan.

The exclude list can change at a pin move. `rig pin check <pack> --sha <new> --exclude <p>...` replaces the list in the candidate, and `rig pin set` applies it. Two cases need this. A new upstream subtree with scripts makes the candidate gate block, and the maintainer adds an exclude. An excluded path that vanished upstream gives `E_PATH_MISSING`, and the maintainer drops it.

## Deterministic versus agent split

The test is this. A CI runner with no language model, given only the committed config repo, produces byte-identical fresh HOMEs. Every seeding step passes it. `plan`, `apply`, `apply --undo` and `doctor` read only committed files, HOME and `RIG_NOW`. Render is pure (`lib/targets.ts:48`). `pack add`, `pin check` and `pin set` need git and OSV over the network, and no model. Assertion L1 proves they reproduce the lock. The `cve` check reads the OSV cache only for packs with a dependency manifest. The first seed has none, because the excludes drop `skills/poteto-mode/scripts/package.json`.

One step needs an agent or a person. It is the re-port after an upstream source of a port changed.

| | |
|---|---|
| Where | `.claude/skills/rig-port/SKILL.md` in the config repo. A maintainer-only repo skill. It is not a CLI subcommand, not a seeded unit, and not a mode skill playbook, because users who seed never port. |
| Reads | `rig pin check <pack> --diff`: a unified diff of the port paths between `reviewed_sha` and `sha`. Also the current `pack.json` mode block or the product files, and the new vendored bytes. |
| Writes | `packs/pstack/pack.json` `mode`, or files under `packs/product/`. Then it runs `rig pin set <pack> --ported`. |
| Detector | `lock.packs[p].port.tree !== port.reviewed_tree` gives the `pin` check block `E_PORT_STALE` in every `plan`. It reads only the committed lock, so CI catches a pin move that skipped the port review. |
| Validators after the edit | `E_MODE_REF`, `E_FILL_UNKNOWN`, `E_ARTIFACT_DANGLING`, the `links` check, the `budget` check, the pin tree check. |
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
  candidate: { sha: Sha; tree: TreeHash; port_tree: TreeHash | null; checked: string } | null;
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

// lib/mode.ts (new): owns the mode skill format, compile and Markdown
export type UnitRef = `${string}/${string}`;
export type DomainPrefix = "biz" | "prod" | "eng" | "upk";
export type StepAddress = `${DomainPrefix}:${string}`;
/** packs/core/domains.json. Its stage names are the only valid step addresses. */
export type DomainTable = { domains: Record<"business" | "product" | "engineering" | "upkeep", { prefix: DomainPrefix; stages: string[] }> };
export type ArtifactDef = {
  generates: string; write_at: StepAddress; instruction: string; requires: string[];
  template?: string; ready_when?: string; check?: string;
};
/** pack.json `mode`. Prose fields may hold {{skill:<pack>/<unit>}}. Nothing else is substituted. */
export type ModeData = {
  adopt?: Record<string, { from: string; harnesses?: string[] }>;
  triggers?: { when: string; then: string }[];
  playbooks?: Record<string, { title: string; when: string; domain: keyof DomainTable["domains"]; file: string }>;
  sections?: { autonomy?: string; subagents?: string; reply?: string; comments?: string; adapter?: { harnesses: string[]; text: string } };
  artifacts?: Record<string, ArtifactDef>;
};
export type Step = { before: UnitRef[]; slot: UnitRef | null; after: UnitRef[] };
/** rig.json `fill`. compileMode parses the address grammar against DomainTable (E_FILL_UNKNOWN). */
export type Fill = { triggers?: { when: string; use: UnitRef }[] } & Record<string, unknown>;
/**
 * The compiled mode skill. Invariants: every ref names a kept unit. Every playbook file is an adopted path. Artifact ids are
 * unique across packs, and every `requires` has a writer. Adopted paths do not clash across packs.
 */
export type Mode = {
  triggers: { when: string; then: string }[];
  principles: UnitRef[];
  playbooks: { id: string; title: string; when: string; domain: string; file: string; pack: string }[];
  steps: Map<StepAddress, Step>;
  artifacts: Map<string, ArtifactDef & { pack: string }>;
  sections: Required<NonNullable<ModeData["sections"]>>;
  files: Map<string, { bytes: Uint8Array; mode: number; pack: string; harnesses: string[] | null }>;
};
/** Pure. compose calls it after disable and replace. Errors: E_MODE_REF, E_FILL_UNKNOWN, E_ARTIFACT_DANGLING, E_CLASH. */
export function compileMode(units: Unit[], packs: World["packs"], domains: DomainTable, fill: Fill): { mode: Mode; errors: RigError[] } {
  throw new Error("not implemented");
}
/** Per-harness view. `link` returns a path relative to the mode skill folder, so the output does not depend on HOME. */
export type ModeView = { harness: string; link: (ref: UnitRef) => string | null; models: string };
/** Fills {{mode:triggers|principles|playbooks|steps|artifacts|autonomy|subagents|reply|comments|models}}. An unknown name is E_TERM_UNKNOWN. */
export function modeMarkdown(mode: Mode, template: string, view: ModeView): { text: string; errors: RigError[] } {
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
| `lib/world/schemas.ts`, `lib/lock/lockfile.ts` | The closed-key `LOCK` validator lives in `lib/world/schemas.ts:239-251`. Lock schema 2 drops `pins` and adds `root`, `exclude`, `port` and `candidate`. rig.json schema 2: drop `pins`, `providers`, `default_provider`, `slots`, add `fill`. pack.json schema 2: drop `source` and `ported_from`, add `mode`, `model_surfaces` and `telemetry`. |
| `lib/mode.ts` | New. |
| `lib/stack.ts` | `discover` maps core `skills/rig-mode/` to unit type `mode` and drops the slot stubs. `compose` calls `compileMode`. |
| `lib/targets.ts` | `renderMode` runs after every other unit, so `link` reads leaf paths from the rendered entries. Delete `renderSlotStub`. Model surfaces come from pack.json. Delete `lib/targets/providers.ts`. |
| `lib/gate/registry.ts`, `lib/gate/links.ts` | Remove plugin and provider text from the `pin` and `telemetry` rows. Add the `links` check. The `telemetry` check reads `telemetry` from pack.json. |
| `lib/gate/pin.ts` | Every pack folder needs a lock entry. Add `E_PORT_STALE` and the exclude-prefix check. Delete the installed-plugin pin checks (`lib/gate/pin.ts:58-118`). Add `E_FOREIGN_INSTALL`: a harness plugin install of a seeded upstream blocks, not ackable, with the removal command in the message. |
| `lib/gate/budget.ts` | `hidden()` honors the sidecar method (`lib/gate/budget.ts:68`). |
| `lib/commands/pack.ts`, `lib/commands/pin.ts` | New flags, `pin check --diff`, `pin set --ported`. |
| `packs/core` | Add `skills/rig-mode/SKILL.md` and `domains.json`. Delete `principles.md`, `commands/craft.md`, `skills/rig-doc-review`, `skills/rig-second-opinion`. `frame.md` loses `{{providers}}`, `{{default_provider}}` and `{{slots}}`. |
| Provider and slot readers | `lib/world/project.ts`, `lib/world/merge.ts:43-46`, `lib/commands/doctor.ts:91-134`, `lib/commands/models.ts:29`, `lib/commands/shared.ts:36`, `lib/targets/models-render.ts:24-46`. |
| `packs/product` | `pack.json` drops `source` and `ported_from`. `skills/office-hours/references/design-doc.md:135,159-171` and `SKILL.md:115` drop the slot and provider text and the `{{rig:intake}}` term. |
| Deleted | `providers/` (`pstack.json`, `openspec.json`), `test/openspec.*`, `probes/craft-claude-project-units.ts`, the slot and provider tests, the `pm` to `craft` alias. OpenSpec returns in phase 4 as an artifact pack. |

## Rationale

### Synthesis decision

Two runners designed the first seed independently from the same grounding. They were candidate A (Opus) and candidate B (Sonnet). The cross-judge step did not run. The judge pool holds only Claude models, and the arena rule forbids a judge from the parent's family. An independent reviewer reads this design instead.

Candidate A is the base. It ports the hub once into `pack.json` and detects stale ports with one derived check. Candidate B derives the mode skill at every seed with a parser over the pinned hub and binds rig steps to numbered playbook steps.

A won on three rubric points:

- It matches C1 (port and own) without a parser that keeps rig downstream of pstack's prose format.
- It has fewer moving parts. It needs no section rules, no line-prefix skip list and no step anchors.
- One detector (`E_PORT_STALE`) covers both ports, the pstack hub and the gstack product pack.

Grafts from B:

- An exclude that matches nothing upstream is an error (`E_PATH_MISSING`), and the pin check refuses a file under a locked exclude prefix. Excluded code cannot return unnoticed.
- The mode skill template states that leaf skills call it poteto-mode.
- Codex and omp get an adapter rendered from `terms.json` (phase 4, `adapter`).
- B's history evidence sets the condition for revisiting the parser. Over 25 hub versions the 7 H2 sections never changed, while the bullet count grew from 22 to 52.

### Trade-offs accepted

- The seed loses 5 pstack skills and 1 agent, and 6 kept files degrade (A13). In exchange it needs no acks, and the links check passes once it skips non-path targets.
- `--ported` is an attestation the CLI cannot check for meaning. Pull request review checks what the port says.
- A rig-authored `pack.json` sits inside a vendored folder and stays out of the tree hash. In exchange anyone can recompute the vendored tree from upstream, and dropping a pack drops its mode data.
- The principles index loses the hub's five groups and its one name override. In exchange it has one source.
- `rig pack add` fetches one commit three times, because rig keeps no fetch cache. That is cheaper than a new kind of cache state.

### Alternatives rejected

| Alternative | Why it lost |
|---|---|
| Parse the hub at every seed (candidate B) | rig stays downstream of pstack's prose format, step bindings are ordinal, and a misparse can go silent |
| Mode data in sealed core | core would name pstack units and break with pstack disabled, and the core seal would follow a pack commit |
| Keep `poteto-mode` as a hidden unit and route to it | two modes on disk, and the 5,336-token hub stays invocable |
| `playbook` as a unit type | playbooks have no frontmatter and no placement of their own, so a unit type adds a render path for files only the mode skill reads |
| Ack the 68 gate findings | approves 121 KB of Bun code to run on a developer machine, one ack per file |
| A `rig seed` command with built-in recipes per commit | a second way to vendor, and a recipe list to keep in sync |
| Run gstack's own generator (`bun run gen:skill-docs`) | adds Bun to the toolchain, and the output still calls gstack binaries |

### Red-flag screen

- Shallow module: no. `compileMode` hides adoption, ref resolution, fill validation and the artifact graph behind one function.
- Information leakage: the lock alone holds provenance. pack.json no longer repeats it.
- Split ownership: `pin set` writes vendored bytes, the port writes `pack.json`. The files do not overlap.
- Two ways to do one task: `exclude` acts on bytes at vendor time, `disable` acts on units at compose time. They act on different objects.
- Hand-synced list: the degraded list is pinned by a test grep, and the principles index is derived.

## Uncertainties

| Uncertainty | Score | Reason | Blast radius | Falsification probe |
|---|---|---|---|---|
| `place()` puts the mode skill and the leaves where relative links resolve on every harness | 6 | Cursor reads `~/.claude/skills`, so its mode skill copy may sit elsewhere | A9 fails on Cursor | Run `rig plan` on the seed, then the links check on the Cursor read-set |
| A Claude Code agent maps Cursor names through `references/adapter.md` | 6 | Upstream relies on the same mechanism, unmeasured | Leaves spawn the wrong tool | Live L3: the bug-fix route uses `Agent`, not `Task` |
| Leaves work on Codex and omp with no adapter until phase 4 | 4 | No adapter exists for them | Leaves misfire on Codex and omp | A live Codex run of a leaf that says `AskQuestion` |
| The compiled mode skill stays under about 6,000 tokens | 6 | The hub alone is 5,336 tokens | A budget warn, paid on every invocation | Render it and count |
| The product port sources are complete | 7 | Resolver changes upstream move the generated outputs | A stale port goes unnoticed | Diff a resolver-only change upstream and check the outputs move |
| The exclude list is link-closed | 8 | The reviewer found no kept link to an excluded skill at `2776ddd` | `plan` blocks | Run the links check on the vendored tree first |
| Per-harness mode skill copies do not clash in a shared read dir | 5 | The adapter makes the Claude mode skill differ from the others, and omp and Codex share `~/.agents/skills` rules with byte dedupe | Two mode skill copies or a missing one on omp | A `mode` unit case that renders all four harnesses and runs `place()` on the result |

Overall confidence: 7 of 10. The vendoring and determinism half is 8, because it reuses code that exists and passed the prototype. The mode skill adoption half is new code.

## Appendix A. Prototype evidence

The prototype ran on 2026-11-05 against a scratch copy of this repo and a fixture HOME. Commands: `node bin/rig.ts pack add file:///home/you/os/plugins --sha <sha> --path <p>`, then `plan` and `apply`.

1. A short SHA (`2776ddd`) fails with `E_FETCH`. A full SHA works.
2. `--path pstack/skills` names the pack `skills` (`lib/lock.ts:36-38`). The design adds `--root` and `--name`.
3. `--path pstack` vendors 573 files, 6.3 MB in git (7.5 MB on disk), with license MIT and a tree hash.
4. The gate blocks 68 findings: 67 `exec` (50 in statechart, 16 in `poteto-mode/scripts`, 1 in `show-me-your-work`) and 1 `unicode` (`make-bot-ui`).
5. With the pack enabled, compose finds 58 skills and 2 agents and plans 1,166 file creates across four harnesses.
6. `disable` of the blocked units leaves all 67 `exec` blocks, because the gate scans the whole vendored tree. `apply` writes nothing.
7. `rig plan` took 0.19 s with the trunk config and 0.40 s with the vendored pstack, each the median of 5 runs.
