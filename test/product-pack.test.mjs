// The product pack (packs/product/): a port of gstack's office-hours skill as owned data.
// The pack loads and composes on a fixture repo root, carries no gstack runtime call, and passes the gate's
// source-level checks (license, exec, secret, unicode, pin, cve, reference depth). Render and seed tests for the
// pack come later, so the rendered-bytes budget limits are checked here against the source text.

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, test } from "node:test";
import { gate } from "../lib/gate.mjs";
import { LIMITS } from "../lib/gate/budget.mjs";
import { compose } from "../lib/stack.mjs";
import { desired } from "./gate.helpers.mjs";
import { ROOT, rigJson, withFixture } from "./world.helpers.mjs";

const PACK = join(ROOT, "packs/product");
const SKILL = join(PACK, "skills/office-hours");
const TERMS = Object.keys(JSON.parse(readFileSync(join(ROOT, "packs/core/terms.json"), "utf8")).terms);

/** Every file of the pack, as {rel, abs, text, mode}. */
function packFiles() {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const abs = join(dir, name);
      const st = statSync(abs);
      if (st.isDirectory()) walk(abs);
      else out.push({ rel: relative(PACK, abs), abs, text: readFileSync(abs, "utf8"), mode: st.mode & 0o777 });
    }
  };
  walk(PACK);
  return out;
}

/**
 * A fixture repo root: the repo's own data with rig.json listing the pack, plus the pack files with their real
 * modes. The pack goes in through `home`, which keeps {content, mode} entries as they are.
 */
function productSpec() {
  const home = {};
  for (const f of packFiles()) home[`rig/packs/product/${f.rel}`] = { content: f.text, mode: f.mode };
  return { repo: { "rig.json": rigJson({ packs: { product: {} } }) }, home };
}

describe("product pack", () => {
  test("loads through loadWorld and composes with no errors", () =>
    withFixture(productSpec(), (fx) => {
      const world = fx.load();
      const pack = world.packs.get("product");
      assert.ok(pack, "world has the product pack");
      assert.equal(pack.manifest.license, "MIT");
      assert.equal(pack.manifest.source, null);
      const stack = compose(world);
      assert.deepEqual(stack.errors, []);
      const ids = stack.units.filter((u) => u.id.startsWith("product/")).map((u) => `${u.type}:${u.id}`);
      assert.deepEqual(ids, ["skill:product/office-hours", "command:product/oh"]);
    }));

  test("the gate finds nothing in the pack's sources", () =>
    withFixture(productSpec(), (fx) => {
      const world = fx.load();
      const { findings } = gate(compose(world), desired(), world);
      const own = findings.filter((f) => f.pack === "product");
      assert.deepEqual(own, []);
    }));

  test("no file carries a gstack runtime call or a template placeholder outside the rig vocabulary", () => {
    const files = packFiles();
    assert.ok(files.length > 0);
    for (const f of files) {
      assert.doesNotMatch(f.text, /gstack-/i, `${f.rel}: gstack- binary or name`);
      assert.doesNotMatch(f.text, /\$\{?GSTACK/, `${f.rel}: $GSTACK variable`);
      assert.doesNotMatch(f.text, /\{\{SECTION/, `${f.rel}: {{SECTION placeholder`);
      assert.doesNotMatch(f.text, /\.gstack\b/, `${f.rel}: path into the gstack state root`);
      for (const m of f.text.matchAll(/\{\{([^}]*)\}\}/g)) {
        const term = m[1].match(/^rig:([a-z0-9-]+)$/)?.[1];
        assert.ok(term && TERMS.includes(term), `${f.rel}: placeholder {{${m[1]}}} is not a known {{rig:term}}`);
      }
      assert.equal(f.mode & 0o111, 0, `${f.rel}: exec bit`);
    }
  });

  test("references/product-core.md is under 80 lines", () => {
    const lines = readFileSync(join(SKILL, "references/product-core.md"), "utf8").split("\n").length;
    assert.ok(lines < 80, `${lines} lines`);
  });

  test("every references/ file that a skill file names exists, and every reference file is named", () => {
    const named = new Set();
    for (const f of packFiles().filter((x) => x.rel.startsWith("skills/office-hours/"))) {
      for (const m of f.text.matchAll(/references\/[A-Za-z0-9._-]+\.md/g)) named.add(m[0]);
    }
    assert.ok(named.has("references/product-core.md"));
    for (const ref of named) assert.ok(existsSync(join(SKILL, ref)), `${ref} is named but missing`);
    for (const name of readdirSync(join(SKILL, "references"))) {
      assert.ok(named.has(`references/${name}`), `references/${name} exists but no skill file names it`);
    }
  });

  test("the skill name equals its folder, fits the budget limits, and the /oh command runs it", () => {
    const skill = readFileSync(join(SKILL, "SKILL.md"), "utf8");
    assert.match(skill, /^---\nname: office-hours\ndescription: .+\n---\n/);
    const fm = skill.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    const description = fm[1].match(/^description: (.*)$/m)[1];
    assert.ok(description.length <= LIMITS.descriptionWarn, `description is ${description.length} characters`);
    const body = fm[2].replace(/\n$/, "");
    assert.ok(body.split("\n").length <= LIMITS.bodyLines, "skill body lines");
    assert.ok(Math.ceil(body.length / LIMITS.charsPerToken) <= LIMITS.bodyTokens, "skill body tokens");
    const oh = readFileSync(join(PACK, "commands/oh.md"), "utf8");
    assert.match(oh, /^---\ndescription: .+\n---\n/);
    assert.match(oh, /office-hours skill/);
  });

  test("the handoff resolves the provider by declaration and names an intake line for every workflow provider", () => {
    const handoff = readFileSync(join(SKILL, "references/design-doc.md"), "utf8");
    assert.match(handoff, /rig-project: <provider>/);
    const providers = readdirSync(join(ROOT, "providers"))
      .map((n) => JSON.parse(readFileSync(join(ROOT, "providers", n), "utf8")))
      .filter((p) => p.kind === "workflow");
    assert.deepEqual(providers.map((p) => p.name).sort(), ["openspec", "pstack"]);
    assert.match(handoff, /- pstack: "Next: `\/craft feature docs\/designs\/<slug>\.md`"/);
    assert.match(handoff, /- openspec: "Next: `\/opsx:new <slug>`, then `\/opsx:propose` with docs\/designs\/<slug>\.md as input"/);
    assert.doesNotMatch(handoff, /openspec\/ directory (?:means|selects)/);
  });

  test("NOTICE.md and the MIT license ship with the pack", () => {
    const notice = readFileSync(join(PACK, "NOTICE.md"), "utf8");
    assert.match(notice, /gstack/);
    assert.match(notice, /b244e6d11a6466650c5147cd7dc023859968c4b5/);
    assert.match(notice, /licenses\/MIT-gstack\.txt/);
    const license = readFileSync(join(PACK, "licenses/MIT-gstack.txt"), "utf8");
    assert.match(license, /^MIT License\n/);
    assert.match(license, /Permission is hereby granted, free of charge/);
  });
});
