// The pstack model rules as `whole` files with keep_header, declared in a pack.json `model_surfaces`.
// Done-check of docs/plan/v0-slices.md S3.3 (the header lines).
// Each test runs bin/rig.ts on a fixture HOME whose repo root (~/rig) is a temp copy of this repo's data.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { compose } from "../lib/stack.ts";
import { patch, render } from "../lib/targets.ts";
import { loadWorld } from "../lib/world.ts";
import { json, repoJson, ROOT, setup } from "./pstack.helpers.ts";

const FIXTURES = join(ROOT, "test/fixtures/pstack");
const RULES = ".claude/rules/pstack-models.md";
const HEADER = readFileSync(join(FIXTURES, "pstack-models-header.md"), "utf8");
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

/** The Claude pstack model rules that roles.json and tiers.json describe, computed here without lib/models.ts. */
function expectedRules() {
  const { tiers } = repoJson("models/tiers.json");
  const lines = Object.entries(repoJson("models/roles.json").consumers.pstack).map(([key, form]) => {
    if (form.literal) return `# budget: ${form.literal}`;
    const elements = Array.isArray(form[0]) ? form : [form];
    return `${key}: ${elements.map(([tier, effort]) => `${tiers[tier].claude} ${effort}`).join(", ")}`;
  });
  return `${lines.join("\n")}\n`;
}

/** Changed lines between two texts of equal line count, as [before, after]. */
function changedLines(a, b) {
  const x = a.split("\n");
  const y = b.split("\n");
  assert.equal(x.length, y.length);
  return x.flatMap((l, i) => (l === y[i] ? [] : [[l, y[i]]]));
}

describe("pstack model rules, a whole file with keep_header (S3.3)", () => {
  test("on an empty HOME the Claude file is the budget line and one line per roles.json label, in order", (t) => {
    const s = setup();
    t.after(() => s.fx.cleanup());
    assert.equal(s.rig(["apply"]).code, 0);
    assert.equal(s.read(RULES), expectedRules());
  });

  test("an equal file adopts, and apply leaves its bytes", (t) => {
    const s = setup({ home: { [RULES]: expectedRules() } });
    t.after(() => s.fx.cleanup());
    const before = sha256(readFileSync(s.fx.path(RULES)));
    assert.match(s.rig(["plan"]).stdout, /^adopt +owned +claude +~\/\.claude\/rules\/pstack-models\.md +pstack\/models$/m);
    assert.equal(s.rig(["apply"]).code, 0);
    assert.equal(sha256(readFileSync(s.fx.path(RULES))), before);
    assert.match(s.rig(["plan"]).stdout, /^0 changes, 0 blocks$/m);
  });

  test("pstack's own header lines adopt; a tier change then rewrites only cell lines, and the header stays byte-exact", (t) => {
    const s = setup({ home: { [RULES]: HEADER + expectedRules() } });
    t.after(() => s.fx.cleanup());
    assert.match(s.rig(["plan"]).stdout, /^adopt +owned +claude +~\/\.claude\/rules\/pstack-models\.md/m);
    assert.equal(s.rig(["apply"]).code, 0);
    const before = s.read(RULES);
    const r = s.rig(["models", "set", "strong", "model-z", "--harness", "claude"]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const after = s.read(RULES);
    assert.ok(after.startsWith(HEADER), "the header lines are byte-exact");
    const changed = changedLines(before, after);
    assert.ok(changed.length > 0);
    for (const [was, now] of changed) assert.equal(now, was.replaceAll("opus ", "model-z "), "only cell tokens change");
  });

  test("an unmanaged file with another budget value blocks with E_ADOPT_MISMATCH and keeps its bytes", (t) => {
    const s = setup({ home: { [RULES]: HEADER + expectedRules().replace(/^# budget: .*$/m, "# budget: low (low)") } });
    t.after(() => s.fx.cleanup());
    const before = readFileSync(s.fx.path(RULES));
    const p = s.rig(["plan"]);
    assert.equal(p.code, 1, p.stdout);
    assert.match(p.stdout, /E_ADOPT_MISMATCH.*pstack-models\.md/);
    assert.equal(s.rig(["apply"]).code, 1);
    assert.deepEqual(readFileSync(s.fx.path(RULES)), before);
  });

  test("Cursor: no Cursor tier renders no .mdc and says so; Cursor tiers render dash-fused tokens with alwaysApply", (t) => {
    const s = setup();
    t.after(() => s.fx.cleanup());
    assert.match(s.rig(["plan"]).stdout, /^info absent cursor pstack\/models: tiers\.json names no cursor model, so ~\/\.cursor\/rules\/pstack-models\.mdc does not render$/m);

    const tiers = repoJson("models/tiers.json");
    for (const [name, row] of Object.entries(tiers.tiers)) row.cursor = `slug-${name}`;
    writeFileSync(join(s.root, "models/tiers.json"), json(tiers));
    const w = loadWorld(s.env);
    const desired = render(compose(w), w);
    assert.deepEqual(desired.errors, []);
    const entry = desired.entries.get(s.fx.path(".cursor/rules/pstack-models.mdc"));
    assert.equal(entry.keep_header, true);
    const body = new TextDecoder().decode(entry.bytes);
    assert.ok(body.startsWith("---\nalwaysApply: true\n---\n# budget: medium (high)\nfeature, refactoring: slug-fast-high\n"), body);
    assert.match(body, /^hardest tasks: slug-strong-high$/m, "xhigh clamps to the top of the Cursor ladder");

    // A Cursor model for some tiers only is a render error for that file, not a silent gap.
    const partial = repoJson("models/tiers.json");
    partial.tiers.strong.cursor = "slug-strong";
    writeFileSync(join(s.root, "models/tiers.json"), json(partial));
    const pw = loadWorld(s.env);
    const pd = render(compose(pw), pw);
    // The Cursor fleet agents surface of targets/cursor.json fails the same way.
    assert.deepEqual(pd.errors.map((e) => [e.code, e.path]), [["E_SCHEMA", "~/.cursor/rules/pstack-models.mdc"], ["E_SCHEMA", "~/.cursor/agents/{role}.md"]]);
    assert.equal(pd.entries.has(s.fx.path(".cursor/rules/pstack-models.mdc")), false);

    // A current file with frontmatter and no "#" line keeps its own frontmatter, once.
    const current = "---\ndescription: pstack model roles\nalwaysApply: true\n---\nfeature, refactoring: old\n";
    const next = new TextDecoder().decode(patch(new TextEncoder().encode(current), entry).next);
    assert.ok(next.startsWith("---\ndescription: pstack model roles\nalwaysApply: true\n---\n# budget: medium (high)\n"), next);
    assert.equal(next.match(/^---$/gm).length, 2);
  });
});
