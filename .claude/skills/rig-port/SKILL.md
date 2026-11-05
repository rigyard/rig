---
name: rig-port
description: Re-port a rig pack after an upstream port source changed. Use when rig plan shows "E_PORT_STALE <pack>", or for "/rig-port <pack>". Maintainer-only. Updates the ported data and shows the diff to the human. After the human approves, it attests the port with rig pin set <pack> --ported.
---

# Re-port a stale pack

The argument is the pack name. In this file, `<pack>` is that name.

## Rules

- Change only the ported data of the pack. Do not change vendored files. `rig pin set` writes the vendored files.
- Do not add an ack. The `E_PORT_STALE` block is not ackable.
- Do not run `rig pin set <pack> --ported` before the human approves the diff.
- Do not change `rig.lock.json` by hand. Only `rig` commands change it.

## Ported data

| Pack | Ported data |
|---|---|
| `pstack` | the `mode` block in `packs/pstack/pack.json` |
| `product` | the files under `packs/product/` |
| other packs | the files under `packs/<pack>/` that the lock entry does not vendor |

## Procedure

1. Run `rig pin check <pack> --diff`. This command uses the locked commit and writes nothing. The output shows the port paths as `port fresh` or `port stale`. It ends with the upstream diff of the port paths, from the last reviewed commit to the locked commit.
2. If the output ends with `no port change`, no upstream text changed. Go to step 7.
3. If the output contains `no reviewed commit: the whole port is unreviewed`, the port has no reviewed commit. Then the diff shows each port file in full as new text. In step 5, compare all of the ported data with that full text.
4. Read the upstream diff. Read the ported data of the pack.
5. Change the ported data so that it agrees with the new upstream text. Keep the rig changes that the old port made. Make no other change.
6. Run `rig plan`. The permitted blocks are `E_PORT_STALE <pack>` and, if `packs.<pack>.paths` is empty, `tree ... differs from locked`. If there is a different block, correct the ported data and run `rig plan` again.
7. Show the human the diff of the ported data (`git diff -- packs/<pack>`). Tell the human which upstream change caused each part of the diff. Stop and wait for the approval.
8. After the human approves, run `rig pin set <pack> --ported`.
