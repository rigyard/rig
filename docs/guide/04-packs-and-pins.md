# Add packs and pin plugins

In this page you learn what a pack is and turn the shipped packs on and off. You vendor a pack from another repository at a fixed commit, and you lock a native plugin such as pstack. After this page, every skill on your machine traces back to a commit and a tree hash in `rig.lock.json`.

## Know what a pack is

A pack is a directory under `packs/<name>/`. rig finds its units by the directory layout:

- `skills/<name>/SKILL.md`, with the whole skill directory
- `commands/<name>.md`
- `agents/<name>.md`
- `rules/<name>.md`

An optional `pack.json` holds the license, the scopes the pack supports, where it came from, and exceptions per unit. A pack is data only. rig has no code plugins, and the `exec` check blocks scripts, hooks and MCP configs inside a pack. The design record is [decision 0004](../decisions/0004-packs-and-targets-as-data.md).

## Meet the shipped packs

The checkout ships two packs.

`packs/core` is always installed, and you never list it in `rig.json`. It holds the frame rule, the principles index, the vocabulary in `terms.json`, the `/craft` command, the alias template and two slot stubs. Its tree hash is sealed in `rig.lock.json` under `core.tree`. If you edit a core file, the `pin` check blocks with `core seal broken`. See [decision 0005](../decisions/0005-sealed-core.md).

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
  "schema": 1,
  "disable": ["product/oh"]
}
```

On a fresh temporary HOME, `rig plan` drops from 33 changes to 29: the four `/oh` command files are gone. A core unit in `disable` is an `E_SCHEMA` error. [Scope packs to projects](./05-scope-and-projects.md) covers the `scope` and `projects` keys.

## Vendor a pack at a commit

`rig pack add` copies part of another repository into `packs/<name>/` at one commit:

```text
rig pack add https://github.com/acme/agent-skills --sha 1a2b3c4 --path skills/kit
```

rig fetches that commit into a temporary directory and reads the files from git's object store. It never checks out the tree and never runs a file from it. It copies only the `--path` entries, writes `pack.json` with the detected license, and writes the lock entry. Then it refreshes the OSV cache for the pack's lockfiles and gates the new pack. Add `--into overlay` to write into `~/.config/rig/` instead of the checkout. That directory must exist.

This output comes from the test "vendors through git, keeps the exec bit, prints the gate findings with ack stanzas, exit 1 on the block". The fixture pack has an executable `scripts/run.sh`:

```text
vendored kit into packs/kit/ of the repo root, tree sha256:...
block exec kit/scripts/run.sh: exec bit, shebang, script extension; mode 755, sha256 ...
  ack: {"id":"...","check":"exec","pack":"kit","path":"scripts/run.sh","reason":"","expires":""}
1 findings, 1 blocks
```

The command exits 1, and the files stay on disk so you can read them. Read `scripts/run.sh`. Then ack it as [Pass the gate](./03-the-gate.md#ack-a-finding-you-reviewed) shows, or remove the pack. `pack add` does not enable the pack. Add `"kit": {}` to `packs` in `rig.json`, then run `rig plan`.

A second `pack add` with the same repo, paths and commit writes nothing and fetches nothing. A different commit fails with `E_PACK_EXISTS` while `packs/kit/` exists. To update, remove the directory and its lock entry, then add the pack again at the new commit.

## Read rig.lock.json

Each config root has one `rig.lock.json`. This is the checkout's file on main:

```text
{
  "schema": 1,
  "core": {
    "tree": "sha256:34ce10a4c2250abfcb12ca4f4ff4df239ba54357bb69bc97215b978d30490dac",
    "candidate": null
  },
  "packs": {},
  "pins": {}
}
```

A pack entry records the repo, the full commit, the paths, the license and the tree hash. The tree hash is sha256 over the sorted lines `<path>\0<mode>\0<sha256 of bytes>`. A vendored pack leaves `pack.json` out of its hash. The core seal includes it. When the files on disk differ from the lock, `pin` blocks with `tree ... differs from locked ...`. rig has no update command and no auto-update. A new version is a new `pack add` that you run. rig writes the file in canonical JSON and refuses a hand-formatted one with `E_JSON_ROUNDTRIP`. The design record is [decision 0003](../decisions/0003-copies-and-lockfile.md).

If you change core on purpose, seal it again with no network. This output comes from the test "bootstrap: pin check core, then pin set core, seals an unsealed root and doctor exits 0":

```text
$ rig pin check core
recorded core candidate sha256:...; run rig pin set core
...
$ rig pin set core
promoted the core candidate to current
```

## Pin a native plugin

pstack installs through Claude Code's own plugin system. rig does not copy it. rig gates it and locks the commit you approved, in two steps.

`rig pin check pstack --sha <commit>` reads the plugin name from `providers/pstack.json` and the marketplace repo from `~/.claude/plugins/known_marketplaces.json`. It fetches that commit, hashes the plugin tree, refreshes the OSV cache and gates the tree. A clean tree becomes the `candidate` in the lock. A blocked tree leaves the lock unchanged. This output comes from the test "pin check prints the candidate version, commit and tree; pin set promotes it when the installed commit is equal":

```text
$ rig pin check pstack --sha 0123456789abcdef0123456789abcdef01234567
recorded pstack candidate 9.8.7 (0123456789abcdef0123456789abcdef01234567) sha256:...; run rig pin set pstack
...
```

Next, install that commit in Claude Code. Then run `rig pin set pstack`. It promotes the candidate to `current` only when every installed record of the plugin has the same commit. These two failures ran on a temporary HOME:

```text
$ rig pin check pstack
rig pin: E_USAGE rig pin check pstack needs --sha
$ rig pin set pstack
rig pin set: E_PIN_UNCHECKED pstack has no candidate; run rig pin check pstack --sha <sha> first
```

After `pin set`, add `"pstack"` to `pins` in `rig.json`. Then every plan compares the installed commit with the lock and blocks when they differ. A name in `pins` with no `current` version blocks too, so add it after `pin set`, not before. The `pin` check also warns when the marketplace has auto-update on. rig cannot stop Claude Code from updating a plugin. It detects the change on the next `rig plan` or `rig doctor`.

## Know the pstack pin status on main

The checkout has no pstack pin yet: `pins` is empty in both `rig.json` and `rig.lock.json`. Whether to ship a locked pin is an [open decision](../assumptions-and-open-questions.md). Until you lock one, `rig doctor` warns on every run:

```text
warn  pin       pstack/rig.lock.json: /craft on claude reads pstack from the plugin cache, and pstack has no locked version: run rig pin check pstack
```

`/craft` on Claude Code reads pstack from a plugin cache path that contains the locked version. With no locked version, `/craft` tells you to run `rig pin check pstack`.

Next: [Scope packs to projects](./05-scope-and-projects.md).
