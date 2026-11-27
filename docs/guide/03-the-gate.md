# Pass the gate

`rig plan`, `rig apply`, `rig models set`, `rig pack add`, and `rig pin check` run the offline gate before touching disk. No flag skips it; unknown flags like `--force` or `--skip-gate` exit 2 ([decision 0006](../decisions/0006-one-gate-before-apply.md)).

## The ten checks

| Check | Looks at | Severity | Ackable |
|---|---|---|---|
| `pin` | Lock hashes vs pack files, missing lock entries, `E_PORT_STALE`, core seal, and external plugin/skill copies (`E_FOREIGN_INSTALL`) | block, warn | never |
| `exec` | Executable bits, shebangs, scripts, archive/binary magic bytes, `hooks.json`, `.mcp.json`, `package.json` scripts, symlinks | block | yes |
| `secret` | Token patterns, private keys, credential URLs, and overlay `private_terms` inside repo packs | block | yes |
| `unicode` | Zero-width, bidi, and tag characters, pipe-to-shell, eval of fetched data, injection phrases | block, warn | yes |
| `links` | Relative Markdown links in rendered files targeting missing files or folders for that harness | block | yes |
| `mode` | `/craft` hub and playbooks referencing units missing from the composed stack (`E_MODE_NAME`) | block, info | yes |
| `license` | Pack SPDX expression against allowed licenses | block | yes |
| `cve` | Cached OSV advisories for lockfiles (`cache/osv/<ecosystem>.json`, refreshed only on `rig pack add`) | block, warn | yes |
| `telemetry` | Packs declaring default telemetry without required opt-out environment variables | warn | set env var |
| `budget` | Instruction file byte caps and skill description caps per harness | block, warn | no |

## Clear or ack findings

`pin` and `budget` cannot be acked: fix the lock/port or shorten the text. Silence a `telemetry` warning by exporting the named opt-out variable (`export DO_NOT_TRACK=1`).

For ackable findings (`exec`, `secret`, `unicode`, `links`, `mode`, `license`, `cve`), inspect the flagged file, then copy the printed `ack:` object into `audit.allow.json` (repo root or `~/.config/rig/audit.allow.json`) with a non-empty `reason` and UTC `expires` date (`YYYY-MM-DD`):

```json
{
  "schema": 1,
  "acks": [
    {"id":"158407a35ebe6adb","check":"unicode","pack":"demo","path":"skills/hello/SKILL.md","reason":"reviewed stray paste character","expires":"2027-01-31"}
  ]
}
```

Any change to the offending bytes invalidates the `id` hash and re-blocks the finding. Binary images (`JPEG`, `PNG`, `GIF`, `PDF`, `ZIP`, or NUL in first 8 KiB) skip `secret` and `unicode` unless they use a text extension like `.md` or `.sh`; `exec` scans every file. Missing OSV cache results for `package-lock.json` block until `rig pack add` refreshes the cache or you add an ack.

Next: [Add packs and seal core](./04-packs-and-pins.md).
