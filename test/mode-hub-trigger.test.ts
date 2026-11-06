import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { compose } from "../lib/stack.ts";
import { render } from "../lib/targets.ts";
import { craftFiles, craftFixture } from "./mode.helpers.ts";

const dec = new TextDecoder();
const HUB_TRIGGER_KEY = "eng:design";
const HUB_TRIGGER_LINE = "Code crossing a function boundary → the **architect** skill.";

function engineering() {
  const fx = craftFixture();
  try {
    const world = fx.load();
    const stack = compose(world);
    const desired = render(stack, world);
    const entry = [...desired.entries].find(([abs]) => abs.endsWith("/.claude/skills/craft/references/engineering.md"));
    assert.ok(entry, "the render plans no ~/.claude/skills/craft/references/engineering.md");
    const e = entry[1];
    assert.ok("bytes" in e, "engineering.md is not a file entry");
    return { errors: [...stack.errors, ...desired.errors], text: dec.decode(e.bytes) };
  } finally {
    fx.cleanup();
  }
}

describe("live fixture for the domain file over the hub", () => {
  test("the hub trigger line of the manifest is a line of the fixture hub", () => {
    const hub = craftFiles()["skills/poteto-mode/SKILL.md"].split("\n");
    assert.ok(hub.includes(`- ${HUB_TRIGGER_LINE}`), "the fixture hub has no such line");
  });

  test("the rendered fixture engineering.md quotes the hub trigger that eng:design replaces", () => {
    const { errors, text } = engineering();
    assert.deepEqual(errors, []);
    assert.ok(text.includes(`- \`${HUB_TRIGGER_KEY}\`. Before: none. Slot: [design-probe](../../design-probe/SKILL.md). After: none.\n  Replaces the hub trigger: "${HUB_TRIGGER_LINE}"\n`), text);
  });
});
