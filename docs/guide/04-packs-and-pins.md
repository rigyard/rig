# Add packs and seal core

In this page you learn what a pack is and turn the shipped packs on and off. You vendor a pack from another repository at a fixed commit, move it to a new commit, record the upstream sources of a port, and seal core again after a change. After this page, every vendored skill on your machine traces back to a commit and a tree hash in `rig.lock.json`.

## Know what a pack is

A pack is a directory under `packs/<name>/`. rig finds its units by the directory layout:

- `skills/<name>/SKILL.md`, with the whole skill directory
- `commands/<name>.md`
- `agents/<name>.md`
- `rules/<name>.md`

An optional `pack.json` holds the license, the scopes the pack supports, and exceptions per unit. The lock, not `pack.json`, records where a vendored pack came from. A pack is data only. rig has no code plugins, and the `exec` check blocks scripts, hooks and MCP configs inside a pack. The design record is [decision 0004](../decisions/0004-packs-and-targets-as-data.md).

## Meet the shipped packs

The checkout ships five packs. Four of them make up the seeded default.

`packs/core` is always installed, and you never list it in `rig.json`. It holds the frame rule, the vocabulary in `terms.json`, the alias template, the domain table, the shell of the `craft` mode skill, the `engineering-research` skill and the agents `rig-agent` and `rig-janitor`. Its tree hash is sealed in `rig.lock.json` under `core.tree`. If you edit a core file, the `pin` check blocks with `core seal broken`. See [decision 0005](../decisions/0005-sealed-core.md).

| Pack | Source | What it holds |
|---|---|---|
| `pstack` | `pstack/` of `https://github.com/cursor/plugins` at `b7b93c3`, minus 12 excludes | 53 skills, the agents `poteto-agent` and `comment-sicko`, which `rig.json` disables in favor of the core `rig-agent` and `rig-janitor`, and the hub and 22 playbooks that install as `craft/hub.md` and `craft/playbooks/` |
| `cursor-team-kit` | `cursor-team-kit/` of the same repo at `2776ddd` | the skills `deslop`, `control-cli` and `control-ui` |
| `cli-for-agent` | `cli-for-agent/` of the same repo at `2776ddd` | the skill `cli-for-agents` |
| `product` | a port of gstack `office-hours` at `b244e6d`, pinned at `306ff23` | the `office-hours` skill |

rig vendored the first three with `rig pack add`. Their bytes are upstream bytes, and `rig.lock.json` records the repo, the commit, the root, the paths and the excludes. Each pack folder also holds a `pack.json` that rig wrote and that the lock tree leaves out. `packs/pstack/pack.json` holds the pstack model surfaces and the mode data that [Run multi-step work with /craft](./06-craft.md) describes. `pstack` excludes the folders that hold scripts or that no harness loads. It also excludes `setup-pstack`, because rig writes the model rule itself, and `poteto-help`, whose links point at a skill dir that no harness gets.

`packs/product` is a port that rig adopted with `rig pack add --port`. `NOTICE.md` lists each derived file, and `licenses/MIT-gstack.txt` holds the MIT license text. The pack is MIT and supports the scopes `machine-hidden`, `project` and `hybrid`. The pack is part of v0 by [decision 0026](../decisions/0026-product-pack-in-v0.md). Open points are in [the open questions](../assumptions-and-open-questions.md#open-questions-for-the-user).

Every pack folder needs a lock entry. A pack folder with no entry blocks `rig plan` in the `pin` check. `rig pack add` writes the entry.

## Turn a pack on or off

The `packs` object in `rig.json` lists the packs to install. An empty object takes the defaults. The pack targets the harnesses in `rig.json` `harnesses`, with scope `machine-hidden`.

```text
"packs": {
  "cli-for-agent": {},
  "cursor-team-kit": {},
  "product": {},
  "pstack": {}
}
```

To turn a pack off, remove its key from the checkout `rig.json`. The overlay at `~/.config/rig/rig.json` only adds keys, so it cannot remove a repo pack. It can turn off single units with `disable`. This overlay file drops the `ketchup-video` skill from every harness:

```text
{
  "schema": 2,
  "disable": ["pstack/ketchup-video"]
}
```

On a fresh temporary HOME, `rig plan` drops from 279 changes to 276: the two copies of its `SKILL.md` and its Codex sidecar are gone. A core unit in `disable` is an `E_SCHEMA` error. [Scope packs to projects](./05-scope-and-projects.md) covers the `scope` and `projects` keys.

## Vendor a pack at a commit

`rig pack add` copies one folder of another repository into `packs/<name>/` at one commit:

```text
rig pack add https://github.com/acme/agent-skills --sha 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b --root skills/kit --path . --exclude docs
```

`--sha` takes the full 40-hex commit. A short SHA exits 2 with `E_USAGE` before rig fetches anything. `--root` names the upstream folder that the pack mirrors, `.` by default. `--path` and `--exclude` are relative to the root, and rig keeps the folder structure under it. Repeat `--path` and `--exclude` as often as you need. An exclude that matches no vendored path fails with `E_PATH_MISSING`. The pack name is the basename of the root, or the repository name when the root is `.`. `--name` sets another name.

rig fetches that commit into a temporary directory and reads the files from git's object store. It never checks out the tree and never runs a file from it. A tree with a `.git` folder or file at any depth, in any letter case, fails with `E_LOCK_DOTGIT` before rig writes anything, because git would run a hostile `.git/config` in that folder. `--exclude` drops such a path first. It writes only the files under the `--path` entries that no `--exclude` covers, then `pack.json` with the detected license, then the lock entry. rig detects the license from the closest `package.json` or license file, starting at each `--path` and walking up to the repo root. A license file is a file named `LICENSE`, `LICENCE` or `COPYING` with any suffix (`LICENSE-GPL`, `LICENSE.GPL-3.0`), or any file under a `LICENSES/` folder. A source file such as `license.js` or `License.ts` is not a license file. A license file that matches no known license makes the license unknown (`NOASSERTION`), and the gate blocks it. This holds at every level of the walk and for every license file among the vendored files, so a permissive root LICENSE never covers a license file that rig cannot read. Every vendored `package.json` with a `license` field also adds that license, and one without the field adds nothing. Licenses that rig finds in more than one place join with `AND`, and a compound one keeps its own parentheses, as in `(Apache-2.0 OR MIT) AND GPL-3.0`. An id with unbalanced parentheses makes the license unknown. To drop an unwanted license, add the folder of the code it covers to `--exclude`. `--exclude` refuses a path that names only a license file or a `LICENSES/` folder with `E_USAGE`, so a notice never leaves while its code stays. rig then refreshes the OSV cache for the pack's lockfiles and gates the new pack. Add `--into overlay` to write into `~/.config/rig/` instead of the checkout. That directory must exist.

Two license gaps remain. The text rules match on "contains", so a GPL text with an MIT paragraph appended reads as MIT. An adopted pack keeps its recorded license, and a stale port still forces a review.

This output comes from the test "vendors through git, keeps the exec bit, prints the gate findings with ack stanzas, exit 1 on the block". The fixture pack has an executable `scripts/run.sh` and an excluded 12-byte `docs/notes.md`:

```text
vendored kit into packs/kit/ of the repo root, tree sha256:...
kept 2 files, excluded 12 bytes
block exec kit/scripts/run.sh: exec bit, shebang, script extension; mode 755, sha256 ...
  ack: {"id":"...","check":"exec","pack":"kit","path":"scripts/run.sh","reason":"","expires":""}
1 findings, 1 blocks
```

The command exits 1, and the files stay on disk so you can read them. Read `scripts/run.sh`. Then ack it as [Pass the gate](./03-the-gate.md#ack-a-finding-you-reviewed) shows, or remove the pack. `pack add` does not enable the pack. Add `"kit": {}` to `packs` in `rig.json`, then run `rig plan`.

A second `pack add` with the same repo, commit, root, paths, excludes and port paths writes nothing and fetches nothing. It prints `kit is already vendored at sha256:...`. A different commit fails with `E_PACK_EXISTS` while `packs/kit/` exists. To move a pack to a new commit, use `rig pin check` and `rig pin set` ([Move a pack to a new commit](#move-a-pack-to-a-new-commit)).

## Record the sources of a port

A port is a pack that you wrote from upstream text, such as `packs/product` from the gstack office-hours skill. rig cannot check that the port still agrees with its sources, so it records them. `--port` names an upstream path, relative to the root, that the pack was ported from. Repeat it for each source. rig hashes the port paths at the commit, with no exclude applied, so a port path can also be an exclude.

Without `--path`, `pack add` adopts a pack folder that you wrote. The folder `packs/<name>/` must exist with its `pack.json`. rig vendors nothing and writes only the lock entry, with the tree hash of the folder:

```text
rig pack add https://github.com/acme/agent-skills --sha 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b --name fixture --port hub/SKILL.md
```

This output comes from the test "rig: a pin move with unchanged port sources stays green with no attest":

```text
adopted fixture in packs/fixture/ of the repo root, tree sha256:...
kept 1 files
port not reviewed: hub/SKILL.md; rig plan blocks until rig pin set fixture --ported
```

A new port record is not reviewed. `rig plan` blocks with `E_PORT_STALE fixture` until you read the port and attest it:

```text
rig pin set fixture --ported
```

`--ported` copies the locked commit and the port tree into `reviewed_sha` and `reviewed_tree`. For an adopted pack it also records the tree hash of the folder. It uses no network. A second `--ported` with nothing to change writes nothing and prints `the fixture port is already attested at ...`.

## Move a pack to a new commit

`rig pin check <pack> --sha <sha>` fetches the commit, selects the locked paths minus the locked excludes, gates that candidate, and records it in the lock entry as `candidate`. The candidate keeps its exclude list. A blocked candidate is not recorded. Without `--sha`, it checks the locked commit again. For the port paths, it prints one line: `port fresh` when their tree hash at the new commit equals `reviewed_tree`, else `port stale`. The port is stale before the first `--ported`. `pin check` of a vendored pack also detects the license at the new commit, by the same rules as `pack add`. When the license differs from the locked one, the gate checks the new license, so a disallowed license blocks the candidate. The candidate records the detected license. `rig pin set <pack>` then fetches the candidate commit again and detects the license again. It refuses with `E_PIN_UNCHECKED` when that license differs from the one in the candidate, or when the candidate has none, so run `pin check` again. Otherwise it deletes the files that upstream removed, writes the new files, keeps `pack.json`, and moves the lock entry. When the license changed, `pin set` writes it into `pack.json` and changes no other key. A write that fails exits 1 with `E_PIN_WRITE`. The lock and its candidate stay as they were, so run `pin set` again after you fix the cause. An adopted pack has no vendored files, so `pin set` moves only the commit and the port tree.

This output comes from the same test, after `pin set fixture --ported`. No port source changed, so `pin set` alone gives a green plan:

```text
$ rig pin check fixture --sha <new sha>
recorded fixture candidate sha256:... at ...; run rig pin set fixture
0 files changed
port fresh: hub/SKILL.md
$ rig pin set fixture
promoted the fixture candidate to current at ...
```

When a port source changed, the plan blocks after `pin set`. This output comes from the test "rig: a changed port source blocks rig plan with E_PORT_STALE until pin set --ported, which is not ackable, idempotent and offline":

```text
$ rig pin set fixture
promoted the fixture candidate to current at ...
port stale: run /rig-port fixture, then rig pin set fixture --ported
$ rig plan
block pin fixture/.: E_PORT_STALE fixture: port sources sha256:... are not reviewed (reviewed sha256:...); re-port, then rig pin set fixture --ported
```

`E_PORT_STALE` is a `pin` block, so you cannot ack it. Update the port to agree with the new upstream text, then run `rig pin set fixture --ported`. In this repository, the maintainer skill `/rig-port <pack>` in `.claude/skills/rig-port/` does the update in Claude Code and asks you to approve the diff first.

`--diff` adds a unified diff of the port paths, from the last reviewed commit to the checked commit. Without `--sha`, that is the locked commit. The paths in it are relative to the root. With `--diff`, `pin check` only prints and records no candidate. With no port change, it prints `no port change`. Before the first `--ported`, no reviewed commit exists. Then it prints `no reviewed commit: the whole port is unreviewed; the diff shows each port file in full`, and the diff shows each port file as new:

```text
rig pin check fixture --diff
```

`--exclude` on `pin check` replaces the exclude list for the candidate, and `--no-exclude` makes the list empty. Use them when a new upstream folder makes the candidate gate block, or when an excluded path is gone upstream and gives `E_PATH_MISSING`. `pin check` records the list in the candidate, and `pin set` applies it. `pin set` refuses with `E_PIN_UNCHECKED` when the files with the candidate list do not hash to the candidate tree, for example after a hand edit of the lock:

```text
rig pin check kit --sha 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b --exclude docs --exclude scripts
rig pin set kit
```

`pin set` with no candidate exits 1 with `E_PIN_UNCHECKED`. A pack with no lock entry exits 2 with `E_USAGE`.

## Read rig.lock.json

Each config root has one `rig.lock.json`. A root with no vendored pack has this shape:

```text
{
  "schema": 2,
  "core": {
    "tree": "sha256:...",
    "candidate": null
  },
  "packs": {}
}
```

A pack entry records the repo, the full commit, the root, the paths, the excludes, the license, the tree hash, the port record and the candidate. `rig pack add` writes the root, the paths, the excludes and the port paths normalized (`skills/kit/` is locked as `skills/kit`), deduplicated and sorted. An adopted pack has no paths and no excludes. The port record holds the port paths, their tree hash at the locked commit, and `reviewed_sha` and `reviewed_tree`, which stay null until `rig pin set <pack> --ported`. A pack added with no `--port` has `port: null`. The candidate is null until `rig pin check`. It holds the commit, the exclude list, the tree hash, the port tree hash, the detected license and the check date. When a file in a pack sits at or under a locked exclude, `pin` blocks with `under the locked exclude ...`. The tree hash is sha256 over the sorted lines `<path>\0<mode>\0<sha256 of bytes>`. A vendored pack leaves `pack.json` out of its hash. The core seal includes it. When the files on disk differ from the lock, `pin` blocks with `tree ... differs from locked ...`. When the port tree differs from `reviewed_tree`, or `reviewed_tree` is null, `pin` blocks with `E_PORT_STALE <pack>`. rig has no auto-update. A new version is a `pin check` and a `pin set` that you run. rig writes the file in canonical JSON and refuses a hand-formatted one with `E_JSON_ROUNDTRIP`. A `rig.lock.json` with `"schema": 1` is a v0 lock. `rig plan` and the commands that read the lock refuse it with `E_SCHEMA`. The design record is [decision 0003](../decisions/0003-copies-and-lockfile.md).

If you change core on purpose, seal it again with no network. This output comes from the test "bootstrap: pin check core, then pin set core, seals an unsealed root and doctor exits 0":

```text
$ rig pin check core
recorded core candidate sha256:...; run rig pin set core
...
$ rig pin set core
promoted the core candidate to current
```

`rig pin check core` reads the disk only and takes no `--sha`, `--diff`, `--exclude` or `--no-exclude`. `rig pin set core` takes no `--ported`. Each of those flags exits 2 with `E_USAGE`.

Next: [Scope packs to projects](./05-scope-and-projects.md).
