# Add packs and seal core

Turn shipped packs on and off, vendor upstream commits into `rig.lock.json`, track ported upstream sources, and reseal `packs/core/`.

## Packs are data only

A pack lives under `packs/<name>/` with units grouped by directory: `skills/<name>/SKILL.md`, `commands/<name>.md`, `agents/<name>.md`, and `rules/<name>.md`. An optional `pack.json` declares its SPDX `license`, supported `scopes`, and unit options. The `exec` gate check forbids scripts, hooks, and MCP configs inside packs ([decision 0004](../decisions/0004-packs-and-targets-as-data.md)).

## Shipped packs

`packs/core` installs unconditionally with its tree hash sealed under `core.tree` in `rig.lock.json` (`pin` blocks on unsealed edits; see [decision 0005](../decisions/0005-sealed-core.md)). The seeded checkout also ships four packs:

| Pack | Source | Contents |
|---|---|---|
| `pstack` | `pstack/` of `https://github.com/cursor/plugins` at `b7b93c3` | 53 engineering skills, plus the `/craft` hub and 22 playbooks |
| `cursor-team-kit` | `cursor-team-kit/` of `cursor/plugins` at `2776ddd` | `deslop`, `control-cli`, and `control-ui` |
| `cli-for-agent` | `cli-for-agent/` of `cursor/plugins` at `2776ddd` | `cli-for-agents` |
| `product` | Port of `gstack` `office-hours` (`b244e6d`, pinned `306ff23`) | Product discovery workflow (`office-hours` MIT) |

Disable a whole pack by removing it from `packs` in checkout `rig.json`, or suppress single units via `disable` in `~/.config/rig/rig.json` (core units cannot be disabled).

## Vendor or port at a fixed commit

`rig pack add` reads files directly from a 40-hex commit in git's object store without checking out trees or executing hooks (hosts containing `.git` fail with `E_LOCK_DOTGIT`):

```text
rig pack add https://github.com/acme/agent-skills --sha 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b --root skills/kit --path . --exclude docs
```

Use `--into overlay` to write into `~/.config/rig/packs/` instead of the checkout. Detectable licenses come from `LICENSE`/`LICENCE`/`COPYING`/`LICENSES/` files and `package.json`. If you ported a skill from upstream text (like `packs/product`), pass `--port <path>` so rig hashes upstream sources; afterward inspect and attest with:

```text
rig pin set fixture --ported
```

Unattested or changed port sources block `rig plan` with `E_PORT_STALE` (not ackable).

## Upgrade pins and reseal core

Check and promote pack commits in two explicit steps (never automatic updates):

```text
rig pin check kit --sha 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b
rig pin set kit
```

Use `--diff` with `rig pin check` to preview port diffs without recording a candidate, and `--exclude` / `--no-exclude` to update exclusions. After intentional edits to `packs/core/`, reseal offline:

```text
rig pin check core
rig pin set core
```

Every vendored pack entry in canonical `rig.lock.json` (`schema: 2`) locks repo, 40-hex commit, root, paths, excludes, SPDX license, sha256 tree hash, and optional port attestations ([decision 0003](../decisions/0003-copies-and-lockfile.md)).

Next: [Scope packs to projects](./05-scope-and-projects.md).
