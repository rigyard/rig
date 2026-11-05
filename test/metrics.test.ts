import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stats as statsWith, recordSession as recordWith } from "../lib/metrics.ts";
import { assertSafeSpec } from "../lib/metrics/project.ts";
import { CANARY, NOW, allText, captureStdout, ioFor, makeSandbox, storeLines, storePath } from "./metrics.helpers.ts";

// Every call injects the temp-dir writer for its sandbox: lib/fs.ts is a stub until feat/state lands.
const stats = (world, opts) => statsWith(world, opts, ioFor(world));
const recordSession = (world, input) => recordWith(world, input, ioFor(world));

const WIDE = { since: "36500d", now: NOW };
const sandbox = (harnesses, run) => {
  const sb = makeSandbox(harnesses);
  try {
    return run(sb);
  } finally {
    sb.cleanup();
  }
};
const claudeLine = (sb) => storeLines(sb).find((l) => l.harness === "claude");
const hookPayload = (sb, id = "sess-0001") =>
  new TextEncoder().encode(JSON.stringify({ session_id: id, transcript_path: join(sb.home, ".claude/projects/-placeholder-proj", `${id}.jsonl`) }));

test("claude: one message id over three lines counts once, last line wins; subagent files count once", () => {
  sandbox(["claude"], (sb) => {
    stats(sb.world, WIDE);
    const line = claudeLine(sb);
    assert.deepEqual(line.models["model-alpha"], { input: 108, output: 44, cache_read: 1011, cache_write: 50, requests: 3 });
    assert.deepEqual(line.models["model-beta"], { input: 20, output: 5, cache_read: 400, requests: 1 });
    assert.deepEqual(Object.keys(line.models).sort(), ["model-alpha", "model-beta"], "the synthetic message adds no model");
  });
});

test("claude: an advisor iteration is a separate bucket, never added to top-level usage", () => {
  sandbox(["claude"], (sb) => {
    stats(sb.world, WIDE);
    const line = claudeLine(sb);
    assert.deepEqual(line.side_usage, { "model-adv": { input: 300, output: 70, cache_read: 200, requests: 1 } });
    assert.equal(line.models["model-alpha"].output, 44);
  });
});

test("claude: tools, skills, agents, compactions, hook bytes, cost and dates", () => {
  sandbox(["claude"], (sb) => {
    stats(sb.world, WIDE);
    const line = claudeLine(sb);
    assert.deepEqual(line.tools, { Agent: [2, 0], Bash: [1, 0], Read: [1, 1], Skill: [1, 0] });
    assert.deepEqual(line.skills, { explain: 1 }, "attributionSkill is not a skill load");
    assert.deepEqual(line.agents, { reviewer: { dispatches: 2, effort: { "n/a": 1, high: 1 } } });
    assert.equal(line.compactions, 1);
    assert.deepEqual(line.hook_bytes, { SessionStart: Buffer.byteLength(CANARY) }, "byte length of stdout, counted once per uuid");
    assert.equal(line.cost_usd, 3.41);
    assert.equal(line.start, "2026-11-04T18:02:11Z");
    assert.equal(line.end, "2026-11-04T18:40:57Z");
    assert.match(line.project, /^sha256:[0-9a-f]{16}$/);
    assert.equal(line.source, "stats");
    assert.equal(line.reader, "claude-jsonl@1");
  });
});

test("a missing usage field reports n/a, not 0", () => {
  sandbox(["claude"], (sb) => {
    const { text } = stats(sb.world, WIDE);
    const beta = text.split("\n").find((l) => l.includes("model-beta"));
    assert.match(beta, /cache_write n\/a/);
    assert.match(beta, /cache_hit n\/a/);
    assert.equal("cache_write" in claudeLine(sb).models["model-beta"], false);
  });
});

test("a transcript with no usage at all reports n/a for tokens and cost", () => {
  sandbox(["claude"], (sb) => {
    const dir = join(sb.home, ".claude/projects/-placeholder-proj");
    rmSync(join(dir, "sess-0001.jsonl"));
    rmSync(join(dir, "sess-0001"), { recursive: true });
    writeFileSync(join(dir, "sess-bare.jsonl"), JSON.stringify({ type: "user", timestamp: "2026-11-04T18:00:00Z", message: { role: "user", content: CANARY } }) + "\n");
    const { text } = stats(sb.world, WIDE);
    const line = storeLines(sb)[0];
    assert.deepEqual(line.models, {});
    assert.equal(line.cost_usd, null);
    assert.match(text, /models\n {4}n\/a/);
    assert.match(text, /cost: n\/a/);
  });
});

test("codex: cache hit is cached / input, cache write and cost are n/a", () => {
  sandbox(["codex"], (sb) => {
    const { text } = stats(sb.world, WIDE);
    const [line] = storeLines(sb);
    assert.deepEqual(line.models["model-gamma"], { input: 1500, output: 80, cache_read: 900, requests: 2 });
    assert.equal(line.cost_usd, null);
    assert.deepEqual(line.tools, { apply_patch: [1, null], shell: [1, null] });
    assert.equal(line.compactions, 1);
    assert.match(line.project, /^sha256:/);
    assert.equal(line.session_id, "cdx-0001");
    const row = text.split("\n").find((l) => l.includes("model-gamma"));
    assert.match(row, /cache_hit 60\.0%/, "900 / 1500, not 900 / (1500 + 900)");
    assert.match(row, /cache_write n\/a/);
    assert.match(text, /cost: n\/a \(the harness records no cost\)/);
    assert.match(text, /error rate n\/a/);
  });
});

test("omp: recorded cost passes through, side calls are their own bucket", () => {
  sandbox(["omp"], (sb) => {
    const { text } = stats(sb.world, WIDE);
    const [line] = storeLines(sb);
    assert.equal(line.cost_usd, 0.37);
    assert.deepEqual(line.models["model-delta"], { input: 150, output: 30, cache_read: 300, cache_write: 10, requests: 2 });
    assert.deepEqual(line.side_usage, { "model-eps": { input: 30, output: 5, requests: 1 } });
    assert.deepEqual(line.tools, { bash: [1, 1], read: [1, 0] });
    assert.deepEqual(line.skills, { explain: 1 });
    assert.equal(line.compactions, 1);
    assert.match(text, /cost: USD 0\.37 \(recorded by the harness per call/);
    assert.match(text.split("\n").find((l) => l.includes("model-delta")), /cache_hit 65\.2%/);
  });
});

test("cursor: invocation counts, model mix and tool calls only; other files are never read", () => {
  sandbox(["cursor"], (sb) => {
    mkdirSync(join(sb.home, ".cursor/chats/x"), { recursive: true });
    writeFileSync(join(sb.home, ".cursor/chats/x/store.db"), CANARY);
    writeFileSync(join(sb.home, ".cursor/chats/x/chat.jsonl"), JSON.stringify({ role: "assistant", model: "model-chats", content: CANARY }) + "\n");
    stats(sb.world, WIDE);
    const lines = storeLines(sb);
    assert.equal(lines.length, 1, "only projects/*/agent-transcripts/*.jsonl is a session");
    assert.deepEqual(lines[0].models, { "model-zeta": { requests: 2 } });
    assert.deepEqual(lines[0].tools, { ReadFile: [1, null], Shell: [2, null] });
    assert.equal(lines[0].cost_usd, null);
    assert.equal(lines[0].compactions, null);
  });
});

test("cursor: a session in its own directory counts once, with its subagent files", () => {
  sandbox(["cursor"], (sb) => {
    const dir = join(sb.home, ".cursor/projects/placeholder-proj/agent-transcripts/cur-0002");
    const turn = (model, tool) => JSON.stringify({ role: "assistant", model, message: { content: [{ type: "text", text: CANARY }, { type: "tool_use", name: tool, input: { command: CANARY } }] } }) + "\n";
    mkdirSync(join(dir, "subagents"), { recursive: true });
    writeFileSync(join(dir, "cur-0002.jsonl"), turn("model-eta", "Shell"));
    writeFileSync(join(dir, "subagents", "sub-0001.jsonl"), turn("model-eta", "Grep") + turn("model-theta", "Grep"));
    writeFileSync(join(dir, "other.jsonl"), turn("model-other", "Shell"));
    stats(sb.world, WIDE);
    const line = storeLines(sb).find((l) => l.session_id === "cur-0002");
    assert.ok(line, "the nested session is found");
    assert.equal(storeLines(sb).length, 2, "the flat session and the nested one; no other file is a session");
    assert.deepEqual(line.models, { "model-eta": { requests: 2 }, "model-theta": { requests: 1 } });
    assert.deepEqual(line.tools, { Grep: [2, null], Shell: [1, null] });
    assert.equal(allText(sb.state).includes(CANARY), false);
  });
});

test("the canary has zero hits in the store and the log; dropped keys are reported by name", () => {
  sandbox(["claude", "codex", "omp", "cursor"], (sb) => {
    const claudeFile = join(sb.home, ".claude/projects/-placeholder-proj/sess-0001.jsonl");
    appendFileSync(claudeFile, JSON.stringify({ type: "assistant", uuid: "a9", timestamp: "2026-11-04T18:41:00Z", wireToolInputs: CANARY, message: { id: "msg-9", model: CANARY, usage: { input_tokens: 1 } } }) + "\n");
    const { text } = stats(sb.world, WIDE);
    assert.equal(allText(sb.state).includes(CANARY), false);
    assert.equal(allText(sb.state).includes("zq7x"), false);
    assert.equal(text.includes("zq7x"), false, "the report holds no content either");
    assert.ok(storeLines(sb).length >= 4);
    assert.match(text, /dropped keys/);
    for (const name of ["last-prompt.lastPrompt", "queue-operation.content", "ai-title.aiTitle", "assistant.wireToolInputs", "attachment.attachment.hookInfos"]) {
      assert.ok(text.includes(name), `dropped key ${name} is named`);
    }
    assert.equal(claudeLine(sb).models._unknown.requests, 1, "a model value that is prose fails the shape check");
  });
});

test("a second stats run over the same transcripts leaves one line per session", () => {
  sandbox(["claude", "codex", "omp", "cursor"], (sb) => {
    const first = stats(sb.world, WIDE).text;
    const bytes = readFileSync(storePath(sb), "utf8");
    const second = stats(sb.world, WIDE).text;
    assert.equal(readFileSync(storePath(sb), "utf8"), bytes);
    assert.equal(storeLines(sb).length, 4);
    assert.equal(second, first);
  });
});

test("a session that grew gets a new line and the report reads the last one", () => {
  sandbox(["claude"], (sb) => {
    stats(sb.world, WIDE);
    const file = join(sb.home, ".claude/projects/-placeholder-proj/sess-0001.jsonl");
    appendFileSync(file, JSON.stringify({ type: "assistant", uuid: "a7", timestamp: "2026-11-04T19:00:00Z", message: { id: "msg-7", model: "model-beta", usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }) + "\n");
    const { text } = stats(sb.world, WIDE);
    assert.equal(storeLines(sb).length, 2);
    assert.equal(storeLines(sb)[1].models["model-beta"].requests, 2);
    assert.match(text, /1 session\b/);
    assert.match(text.split("\n").find((l) => l.includes("model-beta")), /requests 2/);
  });
});

test("the store survives deletion of the transcript", () => {
  sandbox(["claude", "omp"], (sb) => {
    const before = stats(sb.world, WIDE).text;
    const bytes = readFileSync(storePath(sb), "utf8");
    rmSync(join(sb.home, ".claude"), { recursive: true });
    rmSync(join(sb.home, ".omp"), { recursive: true });
    const after = stats(sb.world, WIDE).text;
    const withoutDropped = (t) => t.split("\ndropped keys")[0];
    assert.equal(readFileSync(storePath(sb), "utf8"), bytes);
    assert.equal(withoutDropped(after), withoutDropped(before.trimEnd() + "\n"));
    assert.match(after, /model-alpha/);
  });
});

test("the window and the harness filter select sessions", () => {
  sandbox(["claude", "omp"], (sb) => {
    assert.match(stats(sb.world, { since: "7d", now: NOW }).text, /claude {2}\[/);
    const none = stats(sb.world, { since: "1h", now: NOW });
    assert.match(none.text, /no sessions in the window/);
    const onlyOmp = stats(sb.world, { ...WIDE, harness: "omp" }).text;
    assert.match(onlyOmp, /omp {2}\[/);
    assert.equal(onlyOmp.includes("claude  ["), false);
    assert.throws(() => stats(sb.world, { since: "soon" }), { code: "E_USAGE" });
    assert.throws(() => stats(sb.world, { since: "0d" }), { code: "E_USAGE" });
  });
});

test("every store line stays under 4 KiB; the smallest entries fold into _other", () => {
  sandbox(["claude"], (sb) => {
    const file = join(sb.home, ".claude/projects/-placeholder-proj/sess-0001.jsonl");
    const blocks = Array.from({ length: 400 }, (_, i) => ({ type: "tool_use", id: `big-${i}`, name: `Tool_${String(i).padStart(3, "0")}`, input: {} }));
    appendFileSync(file, JSON.stringify({ type: "assistant", uuid: "a8", timestamp: "2026-11-04T18:41:00Z", message: { id: "msg-8", model: "model-beta", content: blocks, usage: { input_tokens: 1 } } }) + "\n");
    stats(sb.world, WIDE);
    const raw = readFileSync(storePath(sb), "utf8").trimEnd();
    assert.ok(Buffer.byteLength(raw) + 1 < 4096);
    const line = JSON.parse(raw);
    assert.ok("_other" in line.tools);
    const calls = Object.values(line.tools).reduce((n, [c]) => n + c, 0);
    assert.equal(calls, 5 + 400, "folding keeps the call total");
  });
});

test("an allowlist that names a prompt-like key is refused", () => {
  assert.throws(() => assertSafeSpec({ message: { usage: true }, lastPrompt: true }), /lastPrompt/);
  assert.throws(() => assertSafeSpec({ attachment: { hookInfos: { command: true } } }), /hookInfos/);
  assert.throws(() => assertSafeSpec({ content: true }), /content/);
  assert.doesNotThrow(() => assertSafeSpec({ message: { content: { type: true } } }));
});

test("stats --suggest with nothing to propose prints the report and saves no patch", () => {
  sandbox(["claude"], (sb) => {
    const r = stats(sb.world, { ...WIDE, suggest: true });
    assert.equal(r.patch, null);
    assert.match(r.text, /^claude {2}\[claude-jsonl@1\]/m);
    assert.match(r.text, /^suggestions \(a proposed diff; rig applies nothing\)\n {2}none\n$/m);
    assert.equal(existsSync(join(sb.state, "proposals")), false);
  });
});

test("hook mode: a valid payload records one line, twice leaves one, prints nothing", () => {
  sandbox(["claude"], (sb) => {
    const { result, out } = captureStdout(() => [recordSession(sb.world, { stdin: hookPayload(sb) }), recordSession(sb.world, { stdin: hookPayload(sb) })]);
    assert.deepEqual(result, [0, 0]);
    assert.equal(out, "");
    const lines = storeLines(sb);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].source, "record");
    assert.equal(lines[0].models["model-alpha"].requests, 3);
    const { text } = stats(sb.world, WIDE);
    assert.match(text, /1 session\b/);
    assert.equal(storeLines(sb).length, 1, "stats finds the same fact the hook wrote");
  });
});

test("hook mode: bad input returns 0, prints nothing and logs one content-free error line", () => {
  sandbox(["claude"], (sb) => {
    const outside = join(sb.base, "outside.jsonl");
    writeFileSync(outside, JSON.stringify({ type: "user", message: { content: CANARY } }) + "\n");
    const bad = [
      new TextEncoder().encode(`not json ${CANARY}`),
      new TextEncoder().encode(JSON.stringify({ session_id: "outside", transcript_path: outside })),
      new TextEncoder().encode(JSON.stringify({ session_id: "other-id", transcript_path: hookPayloadPath(sb) })),
      new TextEncoder().encode("{}"),
    ];
    const { result, out } = captureStdout(() => bad.map((stdin) => recordSession(sb.world, { stdin })));
    assert.deepEqual(result, [0, 0, 0, 0]);
    assert.equal(out, "");
    assert.equal(storeLines(sb).length, 0);
    const log = readFileSync(join(sb.state, "log/rig.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(log.map((l) => l.code), ["E_HOOK_PAYLOAD", "E_TRANSCRIPT_PATH", "E_SESSION_MISMATCH", "E_HOOK_PAYLOAD"]);
    assert.equal(allText(sb.state).includes("zq7x"), false);
    assert.equal(recordSession(null, { stdin: new Uint8Array() }), 0);
  });
});

function hookPayloadPath(sb) {
  return join(sb.home, ".claude/projects/-placeholder-proj/sess-0001.jsonl");
}

test("hook mode: an unwritable state root still returns 0 and prints nothing", { skip: process.getuid?.() === 0 }, () => {
  sandbox(["claude"], (sb) => {
    mkdirSync(sb.state, { recursive: true });
    chmodSync(sb.state, 0o500);
    try {
      const { result, out } = captureStdout(() => recordSession(sb.world, { stdin: hookPayload(sb) }));
      assert.equal(result, 0);
      assert.equal(out, "");
    } finally {
      chmodSync(sb.state, 0o700);
    }
  });
});

test("by hand: --session records one named session, prints one line, exit 1 on an unknown id", () => {
  sandbox(["claude", "codex"], (sb) => {
    const first = captureStdout(() => recordSession(sb.world, { session: "cdx-0001" }));
    assert.equal(first.result, 0);
    assert.equal(first.out, "recorded codex cdx-0001\n");
    const again = captureStdout(() => recordSession(sb.world, { session: "cdx-0001" }));
    assert.equal(again.out, "unchanged codex cdx-0001\n");
    assert.equal(storeLines(sb).length, 1);

    const original = process.stderr.write;
    let err = "";
    process.stderr.write = (chunk) => ((err += String(chunk)), true);
    try {
      assert.equal(recordSession(sb.world, { session: "missing-id" }), 1);
    } finally {
      process.stderr.write = original;
    }
    assert.match(err, /E_SESSION_NOT_FOUND/);
    assert.equal(storeLines(sb).length, 1);
  });
});
