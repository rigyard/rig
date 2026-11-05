// The product pack (packs/product/): a port of gstack's office-hours skill as owned data.
// The pack loads and composes on a fixture repo root, carries no gstack runtime call, and passes the gate's
// source-level checks (license, exec, secret, unicode, pin, cve, reference depth). Render and seed tests for the
// pack come later, so the rendered-bytes budget limits are checked here against the source text.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, test } from "node:test";
import { gate } from "../lib/gate.ts";
import { LIMITS } from "../lib/gate/budget.ts";
import { compose } from "../lib/stack.ts";
import { readSet, render } from "../lib/targets.ts";
import { desired } from "./gate.helpers.ts";
import { ROOT, rigJson, withFixture } from "./world.helpers.ts";

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

/** Write every owned entry of a Desired into the fixture HOME, the way apply would. */
function writeOwned(desired) {
  for (const e of desired.entries.values()) {
    if (e.kind !== "owned") continue;
    mkdirSync(dirname(e.path), { recursive: true });
    writeFileSync(e.path, e.bytes);
  }
}

/** The hide control a harness reads in one copy of a skill, as a regexp over that copy's files. */
function hideOf(record, copyDir) {
  const h = record.hide;
  if (h.method === "frontmatter-key") return [join(copyDir, "SKILL.md"), new RegExp(`^${h.key}: ${JSON.stringify(h.value)}$`, "m")];
  if (h.method === "sidecar") return [join(copyDir, h.file), new RegExp(`^  ${h.key.split(".")[1]}: ${JSON.stringify(h.value)}$`, "m")];
  return null;
}

describe("product pack", () => {
  test("listed in rig.json, it renders on every v0 harness over the repo's own data, with no E_READSET", () =>
    withFixture({}, (fx) => {
      const world = fx.load();
      assert.ok(world.packs.has("product"), "rig.json lists the product pack");
      const stack = compose(world);
      assert.deepEqual(stack.errors, []);
      const d = render(stack, world);
      assert.deepEqual(d.errors, []);
      writeOwned(d);
      // each harness lists office-hours exactly once after its own dedupe rule, and every copy it reads is hidden from it
      const set = readSet(world);
      for (const h of world.config.harnesses) {
        const seen = set.get(h).filter((s) => s.name === "office-hours");
        assert.equal(seen.length, 1, `${h} lists office-hours ${seen.length} times`);
        for (const dir of world.targets.get(h).reads.skills) {
          const copy = join(fx.home, dir.path.slice(2), "office-hours");
          if (!existsSync(copy)) continue;
          const [file, re] = hideOf(world.targets.get(h), copy);
          assert.match(readFileSync(file, "utf8"), re, `${h} reads ${dir.path}/office-hours without its hide control`);
        }
      }
    }));

  test("loads through loadWorld and composes with no errors", () =>
    withFixture(productSpec(), (fx) => {
      const world = fx.load();
      const pack = world.packs.get("product");
      assert.ok(pack, "world has the product pack");
      assert.equal(pack.manifest.license, "MIT");
      assert.equal(pack.manifest.schema, 2);
      const stack = compose(world);
      assert.deepEqual(stack.errors, []);
      const ids = stack.units.filter((u) => u.id.startsWith("product/")).map((u) => `${u.type}:${u.id}`);
      assert.deepEqual(ids, ["skill:product/office-hours", "command:product/oh"]);
    }));

  test("the gate finds nothing in the pack's sources", () =>
    withFixture(productSpec(), (fx) => {
      const world = fx.load();
      const { findings } = gate(compose(world), desired(), world);
      const own = findings.filter((f) => f.pack === "product" && f.check !== "pin");
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

  test("no pack file names a workflow provider, a step slot or a v0 core skill, and the handoff ends with the doc path", () =>
    withFixture({}, (fx) => {
      for (const f of packFiles().filter((x) => x.rel.startsWith("skills/"))) {
        assert.doesNotMatch(f.text, /provider|\bslot\b|rig-project|rig-doc-review|rig-second-opinion|\/craft|\{\{rig:intake\}\}/i, f.rel);
      }
      const handoff = readFileSync(join(SKILL, "references/design-doc.md"), "utf8");
      assert.match(handoff, /^End with the design doc path, `docs\/designs\/<slug>\.md`, with the final slug\.$/m);
      const world = fx.load();
      const d = render(compose(world), world);
      assert.deepEqual(d.errors, []);
      const copies = [...d.entries.values()].filter((e) => e.unit === "product/office-hours" && e.path.endsWith("/references/design-doc.md"));
      assert.equal(copies.length, 2);
      for (const copy of copies) assert.doesNotMatch(new TextDecoder().decode(copy.bytes), /\{\{/, copy.path);
    }));

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
