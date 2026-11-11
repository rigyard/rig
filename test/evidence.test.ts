// The evidence ledger (docs/design/rig-v1-concept.md, "L0. Ledger"): evidence.json beside rig.json, checked by rig doctor.
// The check takes a config root and the refs that the listed packs contain. It has no other input, so no state root.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { ledgerLines } from "../lib/evidence.ts";

const LISTED = ["pstack/how", "pstack/architect", "own/tidy", "own/notes"];
const dir = mkdtempSync(join(tmpdir(), "rig-evidence-"));
after(() => rmSync(dir, { recursive: true, force: true }));

function ledger(text: string | object | null) {
  const root = mkdtempSync(join(dir, "root-"));
  if (text !== null) writeFileSync(join(root, "evidence.json"), typeof text === "string" ? text : JSON.stringify(text));
  return ledgerLines(root, LISTED);
}

const row = (status: string, extra = {}) => ({ status, source: "evals/run-1.md", ...extra });
const doc = (units: object) => ({ schema: 1, units });
const ALL_UNTESTED = "untested 4, helps 0, no-effect 0, hurts 0, safety 0 (no evidence.json)";

describe("evidence ledger", () => {
  test("a valid ledger: one info line with the count per status, and a unit with no row counts as untested", () => {
    const lines = ledger(doc({
      "pstack/how": row("helps", { models: ["model-a"], date: "2026-11-10" }),
      "pstack/architect": { status: "safety", source: "https://example.test/why" },
      "own/tidy": row("no-effect"),
    }));
    assert.deepEqual(lines, [{ level: "info", topic: "evidence", text: "untested 1, helps 1, no-effect 1, hurts 0, safety 1 (evidence.json)" }]);
  });

  test("a row with status untested needs no source and counts as untested", () => {
    const lines = ledger(doc({ "pstack/how": { status: "untested" } }));
    assert.deepEqual(lines, [{ level: "info", topic: "evidence", text: "untested 4, helps 0, no-effect 0, hurts 0, safety 0 (evidence.json)" }]);
  });

  test("no evidence.json: every unit is untested, and it is no error", () => {
    assert.deepEqual(ledger(null), [{ level: "info", topic: "evidence", text: ALL_UNTESTED }]);
  });

  test("an empty evidence.json, zero bytes or blank: every unit is untested, and it is no error", () => {
    for (const text of ["", " \n\t\n"]) {
      assert.deepEqual(ledger(text), [{ level: "info", topic: "evidence", text: "untested 4, helps 0, no-effect 0, hurts 0, safety 0 (evidence.json, empty)" }], JSON.stringify(text));
    }
  });

  test("a ledger with no rows counts every unit as untested", () => {
    assert.deepEqual(ledger(doc({})), [{ level: "info", topic: "evidence", text: "untested 4, helps 0, no-effect 0, hurts 0, safety 0 (evidence.json)" }]);
  });

  test("a ref that no listed pack contains: E_UNKNOWN_UNIT naming the ref, and the counts still print", () => {
    const lines = ledger(doc({ "pstack/gone": row("hurts"), "pstack/how": row("helps") }));
    assert.equal(lines.length, 2);
    assert.equal(lines[0].level, "error");
    assert.equal(lines[0].topic, "evidence");
    assert.match(lines[0].text, /^E_UNKNOWN_UNIT evidence\.json: .*pstack\/gone/);
    assert.deepEqual(lines[1], { level: "info", topic: "evidence", text: "untested 3, helps 1, no-effect 0, hurts 0, safety 0 (evidence.json)" });
  });

  test("every unknown ref gets its own error line", () => {
    const lines = ledger(doc({ "a/one": row("helps"), "b/two": row("helps") }));
    assert.deepEqual(lines.filter((l) => l.level === "error").map((l) => /a\/one|b\/two/.exec(l.text)?.[0]), ["a/one", "b/two"]);
  });

  test("an unknown status: E_SCHEMA naming the ref and the key", () => {
    const lines = ledger(doc({ "pstack/how": row("great") }));
    assert.equal(lines.length, 1);
    assert.equal(lines[0].level, "error");
    assert.match(lines[0].text, /^E_SCHEMA evidence\.json: units\["pstack\/how"\]\.status: expected one of untested, helps, no-effect, hurts, safety, got "great"$/);
  });

  test("a status other than untested with no source: E_SCHEMA naming the ref, for each such status", () => {
    for (const status of ["helps", "no-effect", "hurts", "safety"]) {
      const lines = ledger(doc({ "pstack/how": { status } }));
      assert.equal(lines.length, 1, status);
      assert.match(lines[0].text, /^E_SCHEMA evidence\.json: units\["pstack\/how"\]\.source: required when status is not untested$/, status);
    }
  });

  test("an extra field in a row is rejected, so the spec is closed", () => {
    const lines = ledger(doc({ "pstack/how": row("helps", { note: "x" }) }));
    assert.match(lines[0].text, /^E_SCHEMA evidence\.json: units\["pstack\/how"\]\.note: unknown key$/);
  });

  test("an extra key at the root is rejected", () => {
    const lines = ledger({ schema: 1, units: {}, acks: [] });
    assert.match(lines[0].text, /^E_SCHEMA evidence\.json: acks: unknown key$/);
  });

  test("a missing schema key, a wrong schema number and a plain map root are E_SCHEMA", () => {
    for (const text of [{ units: {} }, { schema: 2, units: {} }, { "pstack/how": row("helps") }]) {
      const lines = ledger(text);
      assert.equal(lines.length, 1, JSON.stringify(text));
      assert.match(lines[0].text, /^E_SCHEMA evidence\.json: /, JSON.stringify(text));
    }
  });

  test("a bad date, a bad models list and a core ref are E_SCHEMA naming the key", () => {
    const cases: [object, RegExp][] = [
      [{ "pstack/how": row("helps", { date: "2026-13-45" }) }, /units\["pstack\/how"\]\.date: not a date/],
      [{ "pstack/how": row("helps", { date: "yesterday" }) }, /units\["pstack\/how"\]\.date: /],
      [{ "pstack/how": row("helps", { models: "model-a" }) }, /units\["pstack\/how"\]\.models: expected an array/],
      [{ "core/craft": row("safety") }, /units\["core\/craft"\]: core units are sealed/],
      [{ how: row("helps") }, /units\.how: /],
    ];
    for (const [units, want] of cases) {
      const lines = ledger(doc(units));
      assert.equal(lines.length, 1, JSON.stringify(units));
      assert.match(lines[0].text, want);
    }
  });

  test("text that is not JSON is E_SCHEMA", () => {
    assert.match(ledger("{nope")[0].text, /^E_SCHEMA evidence\.json: not valid JSON/);
  });
});
