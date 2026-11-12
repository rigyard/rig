# Sign-off (not a locked file)

Timestamp (UTC): 2026-11-11T20:04:37Z (file mtime at creation). The first runs.log line is 2026-11-11T20:04:47Z, so this file precedes the first trial by 10 s. Correction: the first draft of this line said 20:05:00Z, an estimate typed by hand that was wrong; the mtime is the record.

Signed off by the orchestrator, to whom the user delegated the decision, and relayed to the executing agent in its task brief:

- Placebo candidate A is approved: "When writing replies and summaries for the user: ..." (sha256 of file text with trailing newline 3985bd27...6517 per prereg.md).
- The three new fixtures d3 (d3dc4ce), ab (ab8d5ec) and st (069847a) and their prompts are approved as written in prereg.md.
- prereg.md sha256 at sign-off: 34ed857e70547782eab8c78397b5f8702bde6361186ef10a78ef26e7b9074210.
- shasum -a 256 -c gen/SHA256SUMS: 1228 files, all OK, at 2026-11-11T20:04Z.

Execution constraints from the user, recorded as deviations from run-plan.md (they do not change the design):

- Claude concurrency at most 2 (plan says 3). Reason: other Claude experiments run tonight.
- On a rate-limit or usage-limit error, wait 10 minutes, then resume under the prereg missing-trial rule. Each limit hit is recorded.
