# Add packs and seal core

In this page you learn what a pack is and turn the shipped packs on and off. You vendor a pack from another repository at a fixed commit, and you seal core again after a change. After this page, every vendored skill on your machine traces back to a commit and a tree hash in `rig.lock.json`.

## Know what a pack is

A pack is a directory under `packs/<name>/`. rig finds its units by the directory layout:

- `skills/<name>/SKILL.md`, with the whole skill directory
- `commands/<name>.md`
- `agents/<name>.md`
- `rules/<name>.md`

An optional `pack.json` holds the license, the scopes the pack supports, and exceptions per unit. The lock, not `pack.json`, records where a vendored pack came from. A pack is data only. rig has no code plugins, and the `exec` check blocks scripts, hooks and MCP configs inside a pack. The design record is [decision 0004](../decisions/0004-packs-and-targets-as-data.md).

## Meet the shipped packs

The checkout ships two packs.

`packs/core` is always installed, and you never list it in `rig.json`. It holds the frame rule, the vocabulary in `terms.json` and the alias template. Its tree hash is sealed in `rig.lock.json` under `core.tree`. If you edit a core file, the `pin` check blocks with `core seal broken`. See [decision 0005](../decisions/0005-sealed-core.md).

`packs/product` holds the `/oh` command and the `office-hours` skill. It is a port of the gstack office-hours skill at commit `b244e6d`. `NOTICE.md` lists each derived file, and `licenses/MIT-gstack.txt` holds the MIT license text. The pack is MIT and supports the scopes `machine-hidden`, `project` and `hybrid`. The checkout enables it with `"product": {}` in `rig.json`. The pack is part of v0 by [decision 0026](../decisions/0026-product-pack-in-v0.md). Open points are in [the open questions](../assumptions-and-open-questions.md#open-questions-for-the-user).

## Turn a pack on or off

The `packs` object in `rig.json` lists the packs to install. An empty object takes the defaults. The pack targets the harnesses in `rig.json` `harnesses`, with scope `machine-hidden`.

```text
"packs": {
  "product": {}
}
```

To turn a pack off, remove its key from the checkout `rig.json`. The overlay at `~/.config/rig/rig.json` only adds keys, so it cannot remove a repo pack. It can turn off single units with `disable`. This overlay file drops `/oh` from every harness:

```text
{
  "schema": 2,
  "disable": ["product/oh"]
}
```

On a fresh temporary HOME, `rig plan` drops from 20 changes to 15: the four `/oh` command files are gone, and so is the Cursor plugin manifest, which only `/oh` needed. A core unit in `disable` is an `E_SCHEMA` error. [Scope packs to projects](./05-scope-and-projects.md) covers the `scope` and `projects` keys.

## Vendor a pack at a commit

`rig pack add` copies one folder of another repository into `packs/<name>/` at one commit:

```text
rig pack add https://github.com/acme/agent-skills --sha 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b --root skills/kit --path . --exclude docs
```

`--sha` takes the full 40-hex commit. A short SHA exits 2 with `E_USAGE` before rig fetches anything. `--root` names the upstream folder that the pack mirrors, `.` by default. `--path` and `--exclude` are relative to the root, and rig keeps the folder structure under it. Repeat `--path` and `--exclude` as often as you need. An exclude that matches no vendored path fails with `E_PATH_MISSING`. The pack name is the basename of the root, or the repository name when the root is `.`. `--name` sets another name.

rig fetches that commit into a temporary directory and reads the files from git's object store. It never checks out the tree and never runs a file from it. It writes only the files under the `--path` entries that no `--exclude` covers, then `pack.json` with the detected license, then the lock entry. Then it refreshes the OSV cache for the pack's lockfiles and gates the new pack. Add `--into overlay` to write into `~/.config/rig/` instead of the checkout. That directory must exist.

This output comes from the test "vendors through git, keeps the exec bit, prints the gate findings with ack stanzas, exit 1 on the block". The fixture pack has an executable `scripts/run.sh` and an excluded 12-byte `docs/notes.md`:

```text
vendored kit into packs/kit/ of the repo root, tree sha256:...
kept 2 files, excluded 12 bytes
block exec kit/scripts/run.sh: exec bit, shebang, script extension; mode 755, sha256 ...
  ack: {"id":"...","check":"exec","pack":"kit","path":"scripts/run.sh","reason":"","expires":""}
1 findings, 1 blocks
```

The command exits 1, and the files stay on disk so you can read them. Read `scripts/run.sh`. Then ack it as [Pass the gate](./03-the-gate.md#ack-a-finding-you-reviewed) shows, or remove the pack. `pack add` does not enable the pack. Add `"kit": {}` to `packs` in `rig.json`, then run `rig plan`.

A second `pack add` with the same repo, commit, root, paths and excludes writes nothing and fetches nothing. It prints `kit is already vendored at sha256:...`. A different commit fails with `E_PACK_EXISTS` while `packs/kit/` exists. To update, remove the directory and its lock entry, then add the pack again at the new commit.

## Read rig.lock.json

Each config root has one `rig.lock.json`. This is the checkout's file on main:

```text
{
  "schema": 2,
  "core": {
    "tree": "sha256:02e383d3d5ec0414909820e019bb1483ef91f264821ccfe81e6abb3148394bce",
    "candidate": null
  },
  "packs": {}
}
```

A pack entry records the repo, the full commit, the root, the paths, the excludes, the license, the tree hash, the port record and the candidate. `rig pack add` writes the root, the paths and the excludes normalized (`skills/kit/` is locked as `skills/kit`), with the paths and the excludes deduplicated and sorted, and no port record or candidate yet. When a file in a pack sits at or under a locked exclude, `pin` blocks with `under the locked exclude ...`. The tree hash is sha256 over the sorted lines `<path>\0<mode>\0<sha256 of bytes>`. A vendored pack leaves `pack.json` out of its hash. The core seal includes it. When the files on disk differ from the lock, `pin` blocks with `tree ... differs from locked ...`. rig has no update command and no auto-update. A new version is a new `pack add` that you run. rig writes the file in canonical JSON and refuses a hand-formatted one with `E_JSON_ROUNDTRIP`. A `rig.lock.json` with `"schema": 1` is a v0 lock. `rig plan` and the commands that read the lock refuse it with `E_SCHEMA`. The design record is [decision 0003](../decisions/0003-copies-and-lockfile.md).

If you change core on purpose, seal it again with no network. This output comes from the test "bootstrap: pin check core, then pin set core, seals an unsealed root and doctor exits 0":

```text
$ rig pin check core
recorded core candidate sha256:...; run rig pin set core
...
$ rig pin set core
promoted the core candidate to current
```

`rig pin check` and `rig pin set` take only `core` in this version. Any other name exits 2 with `E_USAGE`.

Next: [Scope packs to projects](./05-scope-and-projects.md).
