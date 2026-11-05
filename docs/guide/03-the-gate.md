# Pass the gate

In this page you learn what the gate checks, read a blocked plan, and ack a finding you have reviewed. You also silence the telemetry warning and learn how the CVE check uses its offline cache. After this page, a `block` line in `rig plan` tells you what to read and what to do next.

## Know when the gate runs

`rig plan`, `rig apply` and `rig models set` run the same pipeline: compose, render, gate, diff. `rig pack add` gates the tree it fetched, and `rig pin check core` gates the core tree. No flag skips the gate. The strict argument parser exits 2 on `--force`, `--skip-gate`, `--no-gate` and every other unknown flag.

When the gate blocks, `rig apply` writes nothing to your home directory. The design record is [decision 0006](../decisions/0006-one-gate-before-apply.md).

## Read the eight checks

Each finding has a severity. A `block` stops the write. A `warn` prints and lets the write go. An `info` line only reports. The table is the registry in `lib/gate/registry.ts`, with the severities that the check code emits.

| Check | Looks at | Result | Ackable |
|---|---|---|---|
| `pin` | Lock tree versus pack files, and the core seal. | block | never |
| `exec` | Pack sources: exec bit, shebang, script extension, executable or archive magic bytes, `hooks.json`, `.mcp.json`, `package.json` scripts, symlinks. | block | yes |
| `secret` | Sources and rendered text: token patterns, private key blocks, URLs with credentials. Also `private_terms` from the overlay `rig.json` inside a repo pack. | block | yes |
| `unicode` | Sources and rendered text: zero-width, bidi and tag characters, pipe-to-shell, eval of fetched data. Injection phrases warn. | block, warn | yes |
| `license` | The `license` of every pack except core. It must be an SPDX expression of allowed licenses. | block | yes |
| `cve` | Dependency lockfiles in a pack, against the OSV cache. A high, critical or unknown severity blocks. Moderate and low warn. No cached result blocks. | block, warn | yes |
| `telemetry` | A `pack.json` with telemetry on by default and no opt-out variable set. | warn | no, set the variable |
| `budget` | Rendered bytes: a skill description over the harness cap and an instruction file over the harness limit block. Long descriptions, bodies and listings, co-load, cache-bust text and deep reference chains warn. | block, warn | no |

Each harness also gets an `info budget` line with its always-on size in characters and estimated tokens.

## Read a blocked plan

This run uses a temporary HOME. The overlay `~/.config/rig/rig.json` lists one pack, `demo`. The file `~/.config/rig/packs/demo/skills/hello/SKILL.md` has a zero-width space (U+200B) after the word "hello".

```text
$ rig plan
block unicode demo/skills/hello/SKILL.md: zero-width character U+200B x1 at line 8: Say hello<U+200B> to the user.
  ack: {"id":"158407a35ebe6adb","check":"unicode","pack":"demo","path":"skills/hello/SKILL.md","reason":"","expires":""}
info budget */harness:claude: always-on: 636 characters, 159 tokens
...
23 changes, 1 block
$ echo $?
1
$ rig apply
...
23 changes, 1 block
blocked: nothing written
```

The gate shows the hidden character as `<U+200B>`, so you can see it. The `ack:` line under a finding is the stanza you paste to accept it.

## Ack a finding you reviewed

First read the file. If the content is safe, paste the stanza into an `audit.allow.json` file. rig reads two of them and uses all entries from both: one in the checkout root and one at `~/.config/rig/audit.allow.json`. rig prints the stanza and never writes this file. You write it.

```text
{
  "schema": 1,
  "acks": [
    {"id":"158407a35ebe6adb","check":"unicode","pack":"demo","path":"skills/hello/SKILL.md","reason":"reviewed: stray character from a paste, fix upstream","expires":"2027-01-31"}
  ]
}
```

Fill in `reason` and `expires`. The printed stanza leaves both empty, so a stanza you paste without changes fails:

```text
$ rig plan
rig plan: E_SCHEMA ~/.config/rig/audit.allow.json: acks[0].reason: must not be empty
$ echo $?
2
```

With both fields filled, the finding prints `(acked)` and no longer blocks:

```text
$ rig plan
...
block unicode demo/skills/hello/SKILL.md: zero-width character U+200B x1 at line 8: Say hello<U+200B> to the user. (acked)
...
23 changes, 0 blocks
```

An ack holds through the end of its `expires` date in UTC. After that date, rig ignores it, and the finding blocks again. The `id` is a hash over the check, pack, path and evidence bytes. If the upstream file changes the offending line, the finding gets a new id and blocks again. The schema is in [section 2.9 of the architecture](../design/rig-architecture.md#29-auditallowjson).

`pin` and `budget` are never ackable. An ack for them stops the run:

```text
$ rig plan
rig plan: E_SCHEMA audit.allow.json acks[0]: check pin cannot be acked
```

To clear a `pin` block, fix the lock. To clear a `budget` block, shorten the text.

## Turn off the telemetry warning

A pack can declare in its `pack.json` that its tool sends telemetry by default, with the variables that turn it off. `rig plan` then warns on every run until one of those variables is set. The fix is an environment variable, not an ack. When the pack lists `DO_NOT_TRACK=1`, add this line to your shell profile:

```text
export DO_NOT_TRACK=1
```

The value must be exactly `1`. `DO_NOT_TRACK=0` does not count. Any other variable that the pack lists works too. With the variable set, the `warn telemetry` line goes away. The design record is [decision 0022](../decisions/0022-generic-telemetry-check.md).

## Know what the text checks skip

`secret` and `unicode` skip binary files. A file is binary when it starts with JPEG, PNG, GIF, PDF or ZIP magic bytes. A NUL byte in the first 8 KiB also makes it binary. In the demo pack above, a PNG with the same zero-width bytes adds no finding.

Two exceptions keep this safe. A file with a text extension, such as `.md`, `.json` or `.sh`, gets scanned even when its first bytes look like an image. The harness loads those files as text. And `exec` reads every file, so it still flags executable magic bytes in a binary file.

## Understand the OSV cache

The `cve` check never uses the network. It reads `cache/osv/<ecosystem>.json` under the state root, `~/.local/state/rig/`. Only `rig pack add` refreshes that cache. `rig plan` and `rig apply` stay offline.

The cache key is the sha256 of the lockfile bytes. A pack whose lockfile has no cached result blocks. This happens with a hand-written pack, or after the lockfile changes:

```text
block cve demo/package-lock.json: no cached OSV result: cache/osv/npm.json is absent. Run rig pack add to refresh it (no cached result blocks for now; block versus warn is an open question (design doc, section 10))
  ack: {"id":"ba0e026234f6a329","check":"cve","pack":"demo","path":"package-lock.json","reason":"","expires":""}
```

rig can query OSV only for `package-lock.json` today. Other lockfiles, such as `yarn.lock`, get an info line during the refresh and keep blocking until a parser exists. Whether a missing result should block or warn is an [open question](../assumptions-and-open-questions.md#open-questions-for-the-user).

Next: [Add packs and seal core](./04-packs-and-pins.md).
