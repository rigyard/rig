// Every model id that tiers.json names for Codex, Cursor and omp is in the snapshot of that harness's model list, and
// every harness gets a pstack role table that holds only ids from the snapshot. This test checks the committed snapshot
// test/fixtures/harness-models/listed.json. It does not call the harness CLIs. `node scripts/refresh-harness-models.ts`
// captures the three lists again into the snapshot, so a harness release that drops an id fails here after the refresh.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { repoJson, ROOT, setup } from "./pstack.helpers.ts";

const LISTED = JSON.parse(readFileSync(join(ROOT, "test/fixtures/harness-models/listed.json"), "utf8"));
const TABLES = { codex: ".codex/pstack-models.md", cursor: ".cursor/rules/pstack-models.mdc", omp: ".omp/agent/pstack-models.md" };

/** The role -> value tokens of a rendered table, without the frontmatter and the budget line. */
function roleTokens(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const line of text.split("\n")) {
    const m = line.match(/^([^#:\-][^:]*): (.+)$/);
    if (m && m[1] !== "alwaysApply") out.set(m[1], m[2].split(", "));
  }
  return out;
}

describe("harness model ids", () => {
  test("every tier id of Codex, Cursor and omp is listed by that harness, with every rung of its ladder", () => {
    const { tiers, ladders } = repoJson("models/tiers.json");
    for (const [tier, row] of Object.entries(tiers) as [string, Record<string, string>][]) {
      for (const h of ["codex", "cursor", "omp"]) {
        assert.equal(typeof row[h], "string", `tier ${tier} names a ${h} model`);
        if (h === "cursor") {
          for (const rung of ladders.cursor) assert.ok(LISTED.cursor.ids.includes(`${row.cursor}-${rung}`), `cursor ${row.cursor}-${rung} is listed`);
        } else {
          assert.ok(LISTED[h].ids.includes(row[h]), `${h} ${row[h]} is listed`);
          for (const rung of ladders[h]) assert.ok(LISTED[h].efforts.includes(rung), `${h} effort ${rung} is listed`);
        }
      }
    }
  });

  test("a fresh HOME holds a pstack role table per harness, each role line holds listed ids and efforts only", (t) => {
    const s = setup();
    t.after(() => s.fx.cleanup());
    const a = s.rig(["apply"]);
    assert.equal(a.code, 0, a.stdout + a.stderr);
    const labels = Object.keys(repoJson("models/roles.json").consumers.pstack).filter((k) => k !== "budget");
    for (const [h, rel] of Object.entries(TABLES)) {
      const text = s.read(rel);
      assert.match(text, /^# budget: medium \(high\)$/m, `${h} table has the budget line`);
      const roles = roleTokens(text);
      assert.deepEqual([...roles.keys()], labels, `${h} table has one line per pstack role`);
      for (const [role, tokens] of roles) {
        for (const token of tokens) {
          if (h === "cursor") assert.ok(LISTED.cursor.ids.includes(token), `${role}: cursor ${token} is listed`);
          else if (h === "omp") {
            const [model, effort] = token.split(":");
            assert.ok(LISTED.omp.ids.includes(model), `${role}: omp ${model} is listed`);
            assert.ok(LISTED.omp.efforts.includes(effort), `${role}: omp effort ${effort} is listed`);
          } else {
            const [model, effort] = token.split(" ");
            assert.ok(LISTED.codex.ids.includes(model), `${role}: codex ${model} is listed`);
            assert.ok(LISTED.codex.efforts.includes(effort), `${role}: codex effort ${effort} is listed`);
          }
        }
      }
    }
  });

  test("an omp HOME with no config.yml skips the modelRoles surface instead of blocking the apply", (t) => {
    const s = setup();
    t.after(() => s.fx.cleanup());
    const p = s.rig(["plan"]);
    assert.equal(p.code, 0, p.stdout + p.stderr);
    assert.doesNotMatch(p.stdout, /config\.yml/);
    assert.match(p.stdout, /^create +owned +omp +~\/\.omp\/agent\/pstack-models\.md +pstack\/models$/m);
  });

  test("an omp config.yml with no modelRoles map is skipped, not blocked", (t) => {
    const s = setup({ home: { ".omp/agent/config.yml": "symbolPreset: ascii\n" } });
    t.after(() => s.fx.cleanup());
    const p = s.rig(["plan"]);
    assert.equal(p.code, 0, p.stdout + p.stderr);
    assert.doesNotMatch(p.stdout, /config\.yml/);
    assert.equal(s.rig(["apply"]).code, 0);
    assert.equal(s.read(".omp/agent/config.yml"), "symbolPreset: ascii\n");
  });

  for (const [name, config] of [
    ["a flow-style modelRoles map", "modelRoles: {task: a, plan: b}\n"],
    ["a quoted modelRoles key", 'symbolPreset: ascii\n"modelRoles":\n  task: a\n'],
    ["a single-quoted modelRoles key", "'modelRoles':\n  task: a\n"],
    ["a modelRoles block map that appears twice", "modelRoles:\n  task: a\nmodelRoles:\n  plan: b\n"],
  ]) {
    test(`an omp config.yml with ${name} blocks with E_LOCATOR and names the file`, (t) => {
      const s = setup({ home: { ".omp/agent/config.yml": config } });
      t.after(() => s.fx.cleanup());
      const p = s.rig(["plan"]);
      assert.match(p.stdout, /^block +cells +omp +~\/\.omp\/agent\/config\.yml /m, p.stdout);
      assert.match(p.stdout, /E_LOCATOR/);
      assert.match(p.stdout, / 1 block\b/);
      assert.equal(s.read(".omp/agent/config.yml"), config);
    });
  }

  test("the Codex and omp tables pin the anchors: the operator defaults for the top tiers, the clamp at each ladder", (t) => {
    const s = setup();
    t.after(() => s.fx.cleanup());
    assert.equal(s.rig(["apply"]).code, 0);
    const codex = roleTokens(s.read(TABLES.codex));
    assert.deepEqual(codex.get("judgment and prose"), ["gpt-6.1-sol high"]);
    assert.deepEqual(codex.get("hardest tasks"), ["gpt-6.1-sol high"], "the shipped table names no xhigh");
    assert.deepEqual(codex.get("swarm workers"), ["gpt-6.1-terra high"]);
    const omp = roleTokens(s.read(TABLES.omp));
    assert.deepEqual(omp.get("hardest tasks"), ["google-antigravity/claude-opus-5-5:high"]);
    assert.deepEqual(omp.get("swarm workers"), ["google-antigravity/gemini-3.8-flash:high"]);
  });

  test("rig models set renders into the new tables and a second apply changes nothing", (t) => {
    const s = setup();
    t.after(() => s.fx.cleanup());
    assert.equal(s.rig(["apply"]).code, 0);
    const r = s.rig(["models", "set", "strong", "gpt-6-astra", "--harness", "codex"]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.deepEqual(roleTokens(s.read(TABLES.codex)).get("judgment and prose"), ["gpt-6-astra high"]);
    assert.equal(repoJson("models/tiers.json").tiers.strong.codex, "gpt-6.1-sol", "the repo copy is untouched, the fixture copy changed");
    assert.match(s.rig(["plan"]).stdout, /^0 changes, 0 blocks$/m);
  });
});
