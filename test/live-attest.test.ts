import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { attestedLast, toolCalls, type ToolCall } from "./helpers/transcript.ts";

const bash = (command: string): ToolCall => ({ name: "Bash", command });
const edit: ToolCall = { name: "Edit" };
const PIN = "rig pin check fixture --diff";
const ATTEST = "rig pin set fixture --ported";

describe("attestedLast", () => {
  test("good: edit, plan, attest, read-only checks", () => {
    const calls = [bash(PIN), { name: "Read" }, edit, bash("rig plan"), bash("git diff -- packs/fixture"), bash(ATTEST), bash("rig plan")];
    assert.deepEqual(attestedLast(calls), { ok: true, reason: "" });
  });

  test("attest then edit fails", () => {
    const r = attestedLast([bash(PIN), bash(ATTEST), edit, bash("rig plan")]);
    assert.equal(r.ok, false);
    assert.match(r.reason, /comes before the last edit/);
  });

  test("attest, edit pack.json through Bash, then plan fails", () => {
    const r = attestedLast([bash(PIN), bash(ATTEST), bash(`sed -i 's/a/b/' packs/fixture/pack.json`), bash("rig plan")]);
    assert.equal(r.ok, false);
    assert.match(r.reason, /comes before the last edit/);
  });

  test("attest then a rig call that is not read-only fails", () => {
    const r = attestedLast([edit, bash(ATTEST), bash("rig pin set fixture")]);
    assert.equal(r.ok, false);
    assert.match(r.reason, /not read-only/);
  });

  test("attest then plan, with no edit at all, fails", () => {
    const r = attestedLast([bash(PIN), bash(ATTEST), bash("rig plan")]);
    assert.equal(r.ok, false);
    assert.match(r.reason, /no file-edit/);
  });

  test("no attest fails", () => {
    assert.equal(attestedLast([edit, bash("rig plan")]).ok, false);
  });

  test("a Bash read of pack.json is not an edit", () => {
    assert.equal(attestedLast([edit, bash("cat packs/fixture/pack.json"), bash(ATTEST)]).ok, true);
  });
});

describe("toolCalls", () => {
  test("keeps tool names and Bash commands, drops text and non-JSON lines", () => {
    const line = (content: unknown[]) => JSON.stringify({ type: "assistant", message: { content } });
    const stream = [
      "not json",
      line([{ type: "text", text: "SECRET prose" }, { type: "tool_use", name: "Edit", input: { file_path: "/x", new_string: "SECRET" } }]),
      line([{ type: "tool_use", name: "Bash", input: { command: "rig plan" } }]),
      JSON.stringify({ type: "user", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "ignored" } }] } }),
    ].join("\n");
    assert.deepEqual(toolCalls(stream), [{ name: "Edit" }, { name: "Bash", command: "rig plan" }]);
  });
});
