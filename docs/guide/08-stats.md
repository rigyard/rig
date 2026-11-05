# Read your usage

In this page you read token, cost and tool metrics from the transcripts that your harnesses already write, keep a content-free record of them, and get a proposed configuration diff that you review and apply yourself. You see what your agents spend, and rig never edits your configuration on its own.

## Run a report

```text
rig stats
...
claude  [claude-jsonl@1]  1 session
  models
    model-alpha  requests 3  input 108  output 44  cache_read 1011  cache_write 50  cache_hit 86.5%
    model-beta  requests 1  input 20  output 5  cache_read 400  cache_write n/a  cache_hit n/a
  side usage (calls outside the main conversation, not in the rows above)
    model-adv  requests 1  input 300  output 70  cache_read 200  cache_write n/a  cache_hit n/a
  alias history: n/a
  cost: USD 3.41 (cost-state record in the transcript; 1 of 1 sessions have a cost)
  tools: 5 calls, error rate 20.0%
    Agent 2, Bash 1, Read 1, Skill 1
  skills: explain 1
  agents: reviewer 2 (effort high 1, n/a 1)
  compactions: 1
  hook output bytes: SessionStart 48
...
dropped keys (not in the allowlist; names only, values never read)
...
```

This output comes from a temp HOME that holds the fixture transcripts of `test/fixtures/metrics`. Your model names and numbers differ. The report opens with a header line that names the window, then has one block per harness: Claude, Codex, Cursor and omp.

rig reads each harness's transcript root from its target record, for example `~/.claude/projects` for Claude Code. It reads metadata fields only. The `dropped keys` section lists the field names that rig skipped, and it never reads their values. `rig stats` makes no network call.

## Know what each number means

- Claude Code repeats a usage record once per content block. rig counts each message id once, and the last line wins. Each subagent file counts once (test `claude: one message id over three lines counts once, last line wins; subagent files count once` in `test/metrics.test.ts`).
- Codex counts cached tokens inside `input`. So the Codex cache hit rate is `cache_read / input`, for example 900 of 1500 is 60.0%.
- Codex records no cache writes and no cost. Cursor records no tokens. The report prints `n/a` for a field that the harness does not record, never 0.
- Side usage, such as a Claude advisor call, is a separate bucket. rig never adds it to the model rows.

## Narrow the window and the harness

```text
rig stats --harness codex --since 7d
...
codex  [codex-rollout@1]  1 session
  models
    model-gamma  requests 2  input 1500  output 80  cache_read 900  cache_write n/a  cache_hit 60.0%
  alias history: n/a
  cost: n/a (the harness records no cost)
...
```

`--since` takes a number and a unit `d`, `h` or `m`. The default is `30d`. A zero or a bad value exits 2 with `rig stats: E_USAGE`. `--harness` takes a harness from `rig.json`.

## Keep a record that outlives transcripts

`rig stats` keeps one line per session per harness in `~/.local/state/rig/metrics.jsonl`. Claude Code deletes transcripts after its cleanup period, 30 days by default, and the store keeps the numbers. A second run over the same transcripts adds no line. A session that grew gets a new line, and the report reads the last one.

A store line holds counts, model names, tool names and dates. It holds no prompt text and no response text. The project directory appears as a hash, for example `"project":"sha256:7a3ede1497d578d0"`. The test `the canary has zero hits in the store and the log; dropped keys are reported by name` plants a marker in a transcript and checks that it never reaches the store or the log. Read [decision 0021](../decisions/0021-observability-and-self-feedback.md) for the design.

## Get a suggested diff

```text
rig stats --suggest
...
  skill product/office-hours: no loads on claude, omp in 2 sessions: disable
  saved to proposals/2026-11-05.patch in the state root; apply it in the repo root with git apply, commit, then run rig apply
diff --git a/rig.json b/rig.json
--- a/rig.json
+++ b/rig.json
@@ -10,7 +10,9 @@
     "product": {}
   },
   "aliases": {},
-  "disable": [],
+  "disable": [
+    "product/office-hours"
+  ],
   "metrics": {
     "session_hook": false
   }
```

`--suggest` prints the report, then a section headed `suggestions (a proposed diff; rig applies nothing)` with the proposals, then a patch. It saves the patch under `~/.local/state/rig/proposals/` and changes nothing else. You decide: run `git apply` on the patch in the repo, commit it, then run `rig apply`.

rig proposes two kinds of change. A skill that no session loaded gets a `disable` entry. A role that sessions escalated in two or more sessions gets one effort rung more in `models/roles.json`. One session is not enough. A harness that records no skill loads never proves a skill unused. A hook over its output budget is a report line, never a diff.

## Record one session by hand

```text
rig stats --record --session sess-0001
unchanged claude sess-0001
```

`--record --session <id>` records one session and prints one line: `recorded` or `unchanged`. Here the earlier `rig stats` run already held the same numbers. An unknown id exits 1 with `rig stats --record: E_SESSION_NOT_FOUND`. `--session` without `--record` exits 2.

## Turn on the Claude session hook

To record every Claude Code session when it ends, change one line in the repo's `rig.json`:

```text
"metrics": {
  "session_hook": true
}
```

```text
rig plan
...
create  json-element  claude  ~/.claude/settings.json                                         core/session-end
```

rig adds one element to `hooks.SessionEnd` in `~/.claude/settings.json` and keeps every other byte, foreign hooks included. The hook runs your `node` on the checkout's `bin/rig.ts` with `stats --record`. Set the line back to `false`, and the next apply removes only rig's element.

The repo sets `session_hook` to `false`, so an overlay `rig.json` cannot turn it on. It fails with `E_OVERLAY_CONFLICT`. Only Claude Code has a hook: the other target records set `session_end` to `null`.

The hook prints 0 bytes and exits 0 on every error, so it never fails your session. It writes one content-free line to `~/.local/state/rig/log/rig.log` instead, for example `{"ts":"2026-11-05T05:54:34Z","event":"metrics.record.error","code":"E_HOOK_PAYLOAD"}`. The tests `hook mode: bad input returns 0, prints nothing and logs one content-free error line` and `the rendered hook command prints 0 bytes, exits 0, and records the session` pin this.

Next: [Make it yours](./09-make-it-yours.md).
