# Deviations (not a locked file)

1. Concurrency 2 instead of 3 (user instruction, other Claude runs tonight).
2. First chunk ran as 3 sequential single-trial batches (the --max-secs 1 rule starts one trial per batch at conc 1 or 2), not one batch of 3.
3. signoff.md first draft carried a hand-typed timestamp 20:05:00Z that was wrong; corrected to the file mtime 20:04:37Z (first runs.log line 20:04:47Z).
4. Weekly usage limit hit at about 2026-11-11T20:41Z, after 35 good trials. The frozen classifyInfra did not catch it: the limit arrives as a synthetic assistant turn with is_error true, terminal_reason api_error, zero tokens, zero cost and the text "You've hit your weekly limit", so the runner wrote 103 trial records (pass=false) for ab-none-3 onward. Detected 2026-11-12 after the queue drained. Those 103 records, their raw/init/final/diff files and their runs.log lines were moved to results/quarantine-limit/ (original runs.log kept there as runs.log.original, key list in keys.txt). They are infra failures under the prereg missing-trial rule, not fails. runs.log therefore counts 138 real attempts, not 241; the 103 quarantined attempts made no model call.
5. The 103 retries were run in queue order, chosen before any result, after the limit reset (first retry 2026-11-12T00:03Z). No second attempt was needed.
6. Run-gen.ts was not edited. A watchdog (logs/watchdog2.sh) stopped the own driver on any raw transcript with a rejected rate_limit_event, terminal_reason api_error or zero cost. It never tripped.
7. Post-run scan of all 138 raw transcripts: every result is subtype success, terminal_reason completed, is_error false, cost above zero, no rejected rate-limit event.
