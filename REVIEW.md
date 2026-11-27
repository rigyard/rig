# REVIEW.md

What to check when you review a change to rig. Read [AGENTS.md](./AGENTS.md) for the repository contracts. Report each finding with `file:line`, verified at the head commit of the change.

## Block the change when

- **A write bypasses the gate or the journal.** Only `rig apply` writes into `~`, and the ten-check gate runs before every write. No flag may skip a check. Look for new flags, environment variables, or early returns that skip `lib/gate`.
- **A new write path is missing from the docs.** Every path rig writes or refuses to write is listed in [docs/harnesses.md](./docs/harnesses.md). The code and that file must agree.
- **Undo is no longer exact.** `rig apply --undo <run-id>` must restore the prior bytes. A new write kind needs a backup and a journal entry.
- **A secret or private detail enters the repository.** This includes tokens, `.env` content, personal paths, account names, private hosts, and private pack names. `evals/` is scanned for these.
- **A pin changes without its seal or lock update.** A change under `packs/core/` needs `rig pin check core` and `rig pin set core`. A change to `rig.lock.json` must come from a `rig pin` or `rig pack` command, not from a hand edit.
- **A runtime dependency appears.** `package.json` must declare none, and every devDependency must be pinned to an exact version.
- **`evals/history.jsonl` loses a line or changes an old line.** It is append-only.
- **A check becomes ackable that was not, or an ack loses its guard.** `pin` and `budget` findings can never be acked. An ack needs a `reason`, an `expires` date, and a hash of the exact bytes.

## Look closely at

- **Failure modes, not only the happy path.** Check an empty input, a missing file, a drifted managed file, a second run (idempotence), and a run that stops halfway. Ask what the user's disk looks like after each.
- **Deleted guards.** Each removed check, early return, or error code needs a reason in the PR. Error codes such as `E_OVERLAY_CONFLICT` and `E_FOREIGN_INSTALL` are part of the contract and tests pin them.
- **Overlay rules.** `~/.config/rig` may only add entries, except `metrics.session_hook`. A change that lets an overlay remove or replace a repo entry breaks the contract.
- **Harness differences.** A change for one harness must not alter the output for the other four. Check `targets/*.json` and the per-harness tests.
- **Byte budgets.** Instruction files and skill descriptions have per-harness caps. A longer text can turn `budget` into a block.
- **Vendored bytes.** Pack content from upstream stays byte-identical. Only the anchor lines that rig adds may differ.
- **Claims in prose.** For each "always", "never", or "byte-identical" in code comments or docs, find the test that pins it. If none exists, ask for a test or a weaker claim.

## Check the docs and tests

- A new or changed command, flag, or error code is in `rig --help`, [docs/reference.md](./docs/reference.md), and the matching guide page. `test/docs.test.ts` fails on a fenced `rig` line that does not match `--help` and on a broken relative link.
- A bug fix has a test that fails without the fix. The fix sits where every caller routes through, not only on the path in the report.
- `npm test` passes. For type changes, `npm run typecheck` must not exceed the count in `tsc-baseline.json`.
- Docs use US English and plain sentences, and follow the same limits as the rest of the guide.

## Do not flag

- Style choices that match the surrounding file.
- Dead code the change did not touch. Mention it once as a note.
- A missing feature that the PR does not claim to add.
