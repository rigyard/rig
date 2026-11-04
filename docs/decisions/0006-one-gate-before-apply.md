# 0006. One gate before every write, with no skip flag

- Status: Proposed
- Date: 2026-11-04

## Context

The user requires guardrails that find flaws, CVEs and hostile content before seeding. A gate that runs after the harness installs a plugin is too late, because hooks run first.

## Decision

- `rig audit` runs the gate alone. `plan` and `apply` call the same gate. `apply` writes only from the audited stack and re-hashes it before each write.
- No skip flag exists. Mechanism: the strict argument parser exits 2 on an unknown flag.
- An ack is an entry in `audit.allow.json` with a reason and an expiry. Its id hashes check, pack, path and evidence, so a changed file blocks again. The CLI prints the stanza and never writes it. The `pin` check cannot be acked.
- Native plugins: `rig pin check <name> --sha S` clones at S into a temporary directory and runs the gate. `rig pin set` refuses a SHA that `pin check` did not record. `doctor` flags marketplaces with auto-update on that serve a pinned plugin.

## Consequences

- Upstream script changes cause ack churn.
- A pack with a dependency manifest blocks on its first offline apply until a CVE result exists.
- rig cannot stop a harness from updating a plugin. `doctor` detects the mismatch afterwards.
