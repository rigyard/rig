// The typecheck ratchet: more errors than the baseline fails, equal or fewer passes, a tsc that did not really check fails.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { countErrors, judge } from "../scripts/tsc-ratchet.ts";

const line = (code: string, file = "lib/a.ts") => `${file}(1,2): error ${code}: message.`;
const out = (...codes: string[]) => codes.map((c) => line(c)).join("\n");
const BASELINE = { total: 3, byCode: { TS2339: 1, TS7006: 2 } };

describe("tsc ratchet", () => {
  test("counts located errors by code", () => {
    assert.deepEqual(countErrors(`${out("TS7006", "TS2339", "TS7006")}\n  continuation line`), {
      counts: { total: 3, byCode: { TS2339: 1, TS7006: 2 } },
      unlocated: [],
    });
  });
  test("equal to the baseline passes", () => assert.equal(judge(BASELINE, out("TS7006", "TS7006", "TS2339"), 2).ok, true));
  test("below the baseline passes and prints the delta", () => {
    const v = judge(BASELINE, out("TS7006"), 2);
    assert.equal(v.ok, true);
    assert.match(v.lines.join("\n"), /1 errors, baseline 3 \(delta -2\)/);
    assert.match(v.lines.join("\n"), /TS2339: 1 -> 0 \(-1\)/);
  });
  test("zero errors and exit 0 passes", () => assert.equal(judge(BASELINE, "", 0).ok, true));
  test("above the baseline fails, even when one code went down", () => {
    const v = judge(BASELINE, out("TS7006", "TS7006", "TS7006", "TS7006"), 2);
    assert.equal(v.ok, false);
    assert.match(v.lines.join("\n"), /delta \+1/);
  });
  test("an error without a file location fails (no inputs, bad config)", () => {
    const v = judge(BASELINE, "error TS18003: No inputs were found in config file 'tsconfig.json'.", 2);
    assert.equal(v.ok, false);
    assert.match(v.lines.join("\n"), /without a file location/);
  });
  test("a nonzero exit with no error lines fails", () => assert.equal(judge(BASELINE, "something broke", 1).ok, false));
  test("exit 0 with error lines fails", () => assert.equal(judge(BASELINE, out("TS7006"), 0).ok, false));
  test("a tsc that did not exit normally fails", () => assert.equal(judge(BASELINE, "", null).ok, false));
});
