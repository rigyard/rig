import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { codexSpawns, cursorArgsMention, cursorTaskOutcomes, cursorToolNames, parseJsonl } from "./helpers/delegation.ts";

const call = (callId: string, name = "spawn_agent") => ({ payload: { type: "function_call", name, call_id: callId } });
const output = (callId: string, out: unknown) => ({ payload: { type: "function_call_output", call_id: callId, output: out } });

describe("codexSpawns", () => {
  test("a spawn with a JSON agent result succeeded", () => {
    const r = codexSpawns([call("a"), output("a", JSON.stringify({ agent_id: "x", nickname: "n" }))]);
    assert.deepEqual(r, [{ callId: "a", ok: true }]);
  });
  test("a spawn with a task_name result succeeded", () => {
    assert.deepEqual(codexSpawns([call("a"), output("a", JSON.stringify({ task_name: "/root/t" }))]), [{ callId: "a", ok: true }]);
  });
  test("a spawn that came back as plain text failed", () => {
    assert.deepEqual(codexSpawns([call("a"), output("a", "no rollout found for thread id 123")]), [{ callId: "a", ok: false }]);
  });
  test("a spawn whose JSON result carries an error key failed", () => {
    assert.deepEqual(codexSpawns([call("a"), output("a", JSON.stringify({ error: "boom" }))]), [{ callId: "a", ok: false }]);
  });
  test("a spawn with no output failed", () => {
    assert.deepEqual(codexSpawns([call("a")]), [{ callId: "a", ok: false }]);
  });
  test("an output for another call does not count", () => {
    assert.deepEqual(codexSpawns([call("a"), output("b", JSON.stringify({ agent_id: "x" }))]), [{ callId: "a", ok: false }]);
  });
  test("no spawn_agent call gives no spawns", () => {
    assert.deepEqual(codexSpawns([call("a", "shell"), output("a", JSON.stringify({ ok: 1 }))]), []);
  });
  test("one failed and one successful call are reported apart", () => {
    const r = codexSpawns([call("a"), call("b"), output("a", "refused"), output("b", JSON.stringify({ agent_id: "x" }))]);
    assert.deepEqual(r.map((x) => x.ok), [false, true]);
  });
});

const cursor = (subtype: string, tool: string, body: object) => ({ type: "tool_call", subtype, call_id: "1", tool_call: { [tool]: body } });

describe("cursor matchers", () => {
  const started = cursor("started", "taskToolCall", { args: { prompt: "p" } });

  test("a completed Task call with a success result counts", () => {
    assert.deepEqual(cursorTaskOutcomes([started, cursor("completed", "taskToolCall", { args: {}, result: { success: {} } })]), { completed: 1, failed: 0 });
  });
  test("a Task call whose result is an error counts as failed", () => {
    assert.deepEqual(cursorTaskOutcomes([started, cursor("completed", "taskToolCall", { args: {}, result: { error: { message: "x" } } })]), { completed: 0, failed: 1 });
  });
  test("a rejected Task call counts as failed", () => {
    assert.deepEqual(cursorTaskOutcomes([started, cursor("completed", "taskToolCall", { result: { rejected: {} } })]), { completed: 0, failed: 1 });
  });
  test("a Task call with no completed event counts as neither", () => {
    assert.deepEqual(cursorTaskOutcomes([started]), { completed: 0, failed: 0 });
  });
  test("a completed Task call with no result is not a success", () => {
    assert.deepEqual(cursorTaskOutcomes([cursor("completed", "taskToolCall", {})]), { completed: 0, failed: 1 });
  });
  test("a completed call of another tool is ignored", () => {
    assert.deepEqual(cursorTaskOutcomes([cursor("completed", "readToolCall", { result: { success: {} } })]), { completed: 0, failed: 0 });
  });
  test("tool names come from started events only", () => {
    assert.deepEqual(cursorToolNames([started, cursor("completed", "taskToolCall", {}), { type: "assistant" }]), ["taskToolCall"]);
  });

  test("the hub check reads the call's args", () => {
    assert.ok(cursorArgsMention([cursor("started", "readToolCall", { args: { path: "/h/.cursor/skills/craft/hub.md" } })], "craft/hub.md"));
  });
  test("the hub check ignores the result, where the adapter text names craft/hub.md", () => {
    const e = cursor("completed", "readToolCall", { args: { path: "/h/.cursor/skills/craft/references/adapter.md" }, result: { success: { content: "read craft/hub.md first" } } });
    assert.equal(cursorArgsMention([e], "craft/hub.md"), false);
    const s = cursor("started", "readToolCall", { args: { path: "/h/.cursor/skills/craft/references/adapter.md" }, result: { success: { content: "read craft/hub.md first" } } });
    assert.equal(cursorArgsMention([s], "craft/hub.md"), false);
  });
});

test("parseJsonl skips lines that are not JSON", () => {
  assert.deepEqual(parseJsonl('{"a":1}\nnot json\n\n{"b":2}'), [{ a: 1 }, { b: 2 }]);
});
