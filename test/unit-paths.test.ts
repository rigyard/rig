import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertSafeSpec, project, units } from "../lib/metrics/project.ts";
import { unitRefs } from "../lib/metrics/unit-paths.ts";
import type { UnitRefs } from "../lib/metrics/unit-paths.ts";

function withHome(run: (home: string, refs: UnitRefs) => void) {
  const home = mkdtempSync(join(tmpdir(), "rig-refs-"));
  for (const dir of [".claude/skills/how", ".claude/skills/craft/playbooks", ".claude/skills/how-else", ".claude/plugins/cache/p/skills/idle"]) mkdirSync(join(home, dir), { recursive: true });
  try {
    return run(home, unitRefs([join(home, ".claude/skills")], home));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

test("a path, a ~ form, a $HOME form and a command each resolve to the installed unit dir", () => {
  withHome((home: string, refs: UnitRefs) => {
    assert.deepEqual(refs(`${home}/.claude/skills/how/SKILL.md`), ["how"]);
    assert.deepEqual(refs("cat ~/.claude/skills/how/SKILL.md"), ["how"]);
    assert.deepEqual(refs('sed -n "1,40p" $HOME/.claude/skills/how/SKILL.md'), ["how"]);
    assert.deepEqual(refs("head ${HOME}/.claude/skills/how/SKILL.md"), ["how"]);
    assert.deepEqual(refs(`cat ${home}/.claude/skills/how/SKILL.md ~/.claude/skills/craft/hub.md`), ["how", "craft"]);
  });
});

test("a command that only names the dir counts: the rule errs toward keeping a skill", () => {
  withHome((_home: string, refs: UnitRefs) => {
    assert.deepEqual(refs("ls ~/.claude/skills/how"), ["how"]);
  });
});

test("a file inside the unit dir counts for the unit, not for the file name", () => {
  withHome((home: string, refs: UnitRefs) => {
    assert.deepEqual(refs(`${home}/.claude/skills/craft/hub.md`), ["craft"]);
    assert.deepEqual(refs(`${home}/.claude/skills/craft/playbooks/feature.md`), ["craft"]);
  });
});

test("text that is not a path into an installed unit dir resolves to nothing", () => {
  withHome((home: string, refs: UnitRefs) => {
    assert.deepEqual(refs(`ls ${home}/.claude/skills/`), [], "the root itself");
    assert.deepEqual(refs(`cat ${home}/.claude/skills/ghost/SKILL.md`), [], "a name with no dir");
    assert.deepEqual(refs(`cat ${home}/.claude/skills/how-els/SKILL.md`), [], "a prefix of a dir name is not the dir");
    assert.deepEqual(refs(`cat ${home}/.claude/plugins/cache/p/skills/idle/SKILL.md`), [], "a plugin cache is not a skill root");
    assert.deepEqual(refs(`cat /srv${home}/.claude/skills/how/SKILL.md`), [], "the root must start the path");
    assert.deepEqual(refs("how/SKILL.md"), [], "a bare relative path");
  });
});

test("units() keeps names, never text, and drops a string that does not start as asked", () => {
  withHome((home: string, refs: UnitRefs) => {
    const sink = new Set<string>();
    const text = `CANARY cat ${home}/.claude/skills/how/SKILL.md`;
    assert.deepEqual(project({ command: text }, { command: units() }, sink, "t", refs), { command: ["how"] });
    assert.equal(project({ command: "CANARY" }, { command: units() }, sink, "t", refs).command, undefined);
    const tagged = units({ startsWith: "<skill>", within: /<path>[^<\n]*<\/path>/g });
    const inject = `<skill>\n<name>x</name>\n<path>${home}/.claude/skills/how/SKILL.md</path>\nsee ~/.claude/skills/craft/hub.md`;
    assert.deepEqual(project({ text: inject }, { text: tagged }, sink, "t", refs), { text: ["how"] }, "only the path line is scanned");
    assert.equal(project({ text: `cat ${home}/.claude/skills/how/SKILL.md` }, { text: tagged }, sink, "t", refs).text, undefined);
  });
});

test("a prompt-like key is allowed only when every leaf below it is units()", () => {
  assert.doesNotThrow(() => assertSafeSpec({ input: { command: units() }, payload: { arguments: units() }, message: { content: { arguments: { path: units(), command: units() } } } }));
  assert.throws(() => assertSafeSpec({ input: { command: true } }), /command/);
  assert.throws(() => assertSafeSpec({ message: { content: { arguments: { path: units(), other: true } } } }), /arguments/);
  assert.throws(() => assertSafeSpec({ message: { text: {} } }), /text/);
});
