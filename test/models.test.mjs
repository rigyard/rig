import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cellValues, setTier, effective } from "../lib/models.mjs";
import { patch } from "../lib/targets/patch.mjs";
import {
  SURFACES,
  baseRoles,
  baseTiers,
  bytesOf,
  cellDiff,
  cellFixtures,
  cellsEntry,
  changedLines,
  codexBlockEntry,
  digest,
  fixture,
  makeWorld,
  text,
  withCellMarkers,
} from "./models.helpers.mjs";

/** Every test that touches disk gets its own temp dir. */
function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "rig-models-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** The state a first apply leaves: fixture bytes after adopt (markers inserted where they apply). */
function adopted(world) {
  return cellFixtures(world).map(({ file, entry }) => ({ file, entry, bytes: patch(fixture(file), entry).next }));
}

const pick = (values, key, field) => values.find((v) => v.key === key && v.field === field)?.value;

// ---------------------------------------------------------------- cellValues

test("cellValues: fleet frontmatter on Claude gives model, effort and display per role; a pin renders its id", () => {
  const vals = cellValues(makeWorld(), SURFACES.claudeAgent, "claude");
  assert.equal(pick(vals, "reviewer", "model"), "bravo");
  assert.equal(pick(vals, "reviewer", "effort"), "high");
  assert.equal(pick(vals, "reviewer", "display"), "Bravo");
  assert.equal(pick(vals, "quick-worker", "model"), "pinned-model-d");
  assert.equal(pick(vals, "quick-worker", "display"), "Delta");
  assert.deepEqual(vals.find((v) => v.field === "display").displays, ["Alpha", "Bravo", "Charlie", "Delta"]);
});

test("cellValues: effort syntax is declared per surface, so an id ending in an effort word fuses without ambiguity", () => {
  const world = makeWorld();
  const omp = cellValues(world, SURFACES.omp, "omp");
  assert.equal(pick(omp, "task", "model_effort"), "prov/model-f-high:auto");
  assert.equal(pick(omp, "judge", "literal"), "other/model-j:medium");
  const cursor = cellValues(world, SURFACES.cursorAgent, "cursor");
  assert.equal(pick(cursor, "fast-worker", "model_effort"), "slug-f-high[effort=low]");
  const mdc = cellValues(world, SURFACES.pstackMdc, "cursor");
  assert.equal(pick(mdc, "feature, refactoring", "model_effort"), "slug-f-high-high");
  // A {model_effort} grammar on a separate-key harness has no fusing rule.
  assert.throws(() => cellValues(world, { ...SURFACES.omp, effort_syntax: "separate-key" }, "omp"), { code: "E_SCHEMA" });
});

test("cellValues: clamping maps a rung to the highest ladder rung at or below it", () => {
  const world = makeWorld();
  const effortOf = (surface, harness, key) => pick(cellValues(world, surface, harness), key, "effort");
  assert.equal(effortOf(SURFACES.pstackMd, "claude", "deep dives"), "max");
  assert.equal(effortOf({ ...SURFACES.pstackMd, harness: "codex" }, "codex", "deep dives"), "xhigh");
  const mdc = cellValues(world, SURFACES.pstackMdc, "cursor");
  assert.equal(pick(mdc, "deep dives", "model_effort"), "slug-r-high"); // max at the top of a 3-rung ladder
  assert.equal(pick(mdc, "hardest tasks", "model_effort"), "slug-s-high"); // xhigh too
  const roles = baseRoles();
  roles.consumers.omp.advisor = ["strong", "max"];
  assert.equal(pick(cellValues(makeWorld({ roles }), SURFACES.omp, "omp"), "advisor", "model_effort"), "prov/model-a:high");
});

test("cellValues: a passthrough value passes unchanged and is never an escalation target", () => {
  const world = makeWorld();
  // "auto" stays "auto"; "max" on omp clamps to the top rung "high", never to the passthrough "auto".
  assert.equal(pick(cellValues(world, SURFACES.omp, "omp"), "task", "model_effort"), "prov/model-f-high:auto");
  const roles = baseRoles();
  roles.consumers.omp.task = ["fast", "max"];
  assert.equal(pick(cellValues(makeWorld({ roles }), SURFACES.omp, "omp"), "task", "model_effort"), "prov/model-f-high:high");
  // A ladder that lists a passthrough value is refused, so no rung walk can land on it.
  const tiers = baseTiers();
  tiers.ladders.omp = ["low", "medium", "high", "auto"];
  assert.throws(() => cellValues(makeWorld({ tiers }), SURFACES.omp, "omp"), { code: "E_SCHEMA" });
  // A passthrough value of another harness is not a passthrough here.
  const roles2 = baseRoles();
  roles2.consumers.fleet.reviewer = ["strong", "auto"];
  assert.throws(() => cellValues(makeWorld({ roles: roles2 }), SURFACES.claudeAgent, "claude"), { code: "E_SCHEMA" });
  // A per-harness override string replaces the whole cell on that harness only.
  assert.equal(pick(cellValues(world, SURFACES.pstackMdc, "cursor"), "how explorer", "literal"), "auto");
  assert.equal(pick(cellValues(world, SURFACES.pstackMd, "claude"), "how explorer", "model"), "charlie");
});

test("cellValues: a panel gives one element per tier pair", () => {
  const vals = cellValues(makeWorld(), SURFACES.pstackMd, "claude").filter((v) => v.key === "arena cross-judge pool");
  assert.deepEqual(
    vals.map((v) => [v.element, v.field, v.value]),
    [
      [0, "model", "bravo"],
      [0, "effort", "high"],
      [1, "model", "charlie"],
      [1, "effort", "low"],
    ],
  );
});

// ---------------------------------------------------------------- adopt

test("adopt: every fixture equal to the render gives equal digests and changes no cell byte", () => {
  for (const { file, entry } of cellFixtures(makeWorld())) {
    const before = fixture(file);
    const r = patch(before, entry);
    assert.deepEqual(cellDiff(r.current, entry.values), [], file);
    assert.equal(digest(r.current), digest(entry.values), file);
    if (file === "orchestration.md") {
      assert.equal(r.markers, "inserted");
      assert.equal(text(r.next), withCellMarkers(text(before)), "only two marker pairs are added");
    } else {
      assert.equal(r.markers, "n/a", file);
      assert.deepEqual(r.next, before, `${file}: 0 bytes change`);
    }
  }
});

test("adopt: one differing cell yields a per-cell diff naming the row and column", () => {
  const world = makeWorld();
  const { entry } = cellFixtures(world)[0];
  const src = text(fixture("orchestration.md")).replace("| web-researcher | medium  |", "| web-researcher | high    |");
  const r = patch(bytesOf(src), entry);
  assert.deepEqual(cellDiff(r.current, entry.values), [{ cell: [1, "web-researcher", 0, "effort"], from: "high", to: "medium" }]);
  assert.equal(entry.surfaces[1].column, "Default");
  assert.notEqual(digest(r.current), digest(entry.values));
});

test("adopt: a cell whose text does not fit the grammar is a mismatch, not a silent parse", () => {
  const world = makeWorld();
  const { entry } = cellFixtures(world)[0];
  const src = text(fixture("orchestration.md")).replace("| Alpha, high             |", "| Alpha                   |");
  const r = patch(bytesOf(src), entry);
  assert.deepEqual(cellDiff(r.current, entry.values).map((d) => d.cell[1]), ["deep-reasoner", "deep-reasoner", "deep-reasoner"]);
});

// ---------------------------------------------------------------- swap

test("swap: setTier on omp changes exactly one line of the omp config and 0 bytes elsewhere", () => {
  const world = makeWorld();
  const state = adopted(world);
  const { world: next } = setTier(world, "strong", "prov/model-z", "omp");
  for (const { file, bytes } of state) {
    const entry = cellFixtures(next).find((f) => f.file === file).entry;
    const r = patch(bytes, entry);
    if (file === "config.yml") {
      assert.deepEqual(changedLines(text(bytes), text(r.next)), [
        { n: 5, before: "  advisor: prov/model-a:medium", after: "  advisor: prov/model-z:medium" },
      ]);
    } else {
      assert.deepEqual(r.next, bytes, `${file}: 0 bytes change`);
    }
  }
});

test("swap: a Claude tier change touches every cell of that tier and only those lines", () => {
  const world = makeWorld();
  const state = adopted(world);
  const { world: next } = setTier(world, "strong", "echo", "claude");
  const lines = {};
  for (const { file, bytes } of state) {
    const entry = cellFixtures(next).find((f) => f.file === file).entry;
    lines[file] = changedLines(text(bytes), text(patch(bytes, entry).next)).map((c) => c.after);
  }
  assert.deepEqual(lines["orchestration.md"], [
    "| reviewer                   | Echo, high, read-only  | independent adversarial pass over a diff       |",
    "| senior-worker              | Echo, high             | implementation that needs judgment             |",
  ]);
  assert.deepEqual(lines["claude-agents/reviewer.md"], [
    "description: (Read-only) independent adversarial reviewer (Echo). Use after an editing agent reports a change complete (see rules).",
    "model: echo",
  ]);
  assert.deepEqual(lines["pstack-models.md"], [
    "hardest tasks: echo xhigh",
    "reflect judgment, divergent, synthesizer: echo high",
    "arena runners: echo high, charlie high",
    "arena cross-judge pool: echo high, charlie low",
  ]);
  for (const f of ["claude-agents/quick-worker.md", "cursor-agents/reviewer.md", "cursor-agents/fast-worker.md", "pstack-models.mdc", "config.yml"]) {
    assert.deepEqual(lines[f], [], f);
  }
});

test("swap: every tier on every harness changes only cell lines, converges, and reverts byte-exact", () => {
  const world = makeWorld();
  const state = adopted(world);
  for (const tier of Object.keys(world.tiers.tiers)) {
    for (const harness of world.targets.keys()) {
      const { world: next } = setTier(world, tier, `swapped-${tier}`, harness);
      for (const { file, entry: oldEntry, bytes } of state) {
        const entry = cellFixtures(next).find((f) => f.file === file).entry;
        const r = patch(bytes, entry);
        const changed = changedLines(text(bytes), text(r.next));
        const tokens = new Set(entry.values.map((v) => v.value));
        for (const c of changed) {
          assert.ok([...tokens].some((t) => /swapped/i.test(t) && c.after.includes(t)), `${file}: ${c.after}`);
        }
        const again = patch(r.next, entry);
        assert.deepEqual(again.next, r.next, `${tier}/${harness} ${file}: second run changes 0 bytes`);
        assert.equal(digest(again.current), digest(entry.values));
        assert.deepEqual(patch(r.next, oldEntry).next, bytes, `${tier}/${harness} ${file}: revert is byte-exact`);
      }
    }
  }
});

test("second run: patching adopted bytes with the same render changes 0 bytes and keeps markers present", () => {
  const world = makeWorld();
  for (const { file, entry, bytes } of adopted(world)) {
    const r = patch(bytes, entry);
    assert.deepEqual(r.next, bytes, file);
    assert.equal(r.markers, file === "orchestration.md" ? "present" : "n/a", file);
  }
});

// ---------------------------------------------------------------- drift

test("drift: a YAML rewrite of other keys plus dropped comments is not drift", () => {
  const world = makeWorld();
  const { entry } = cellFixtures(world).find((f) => f.file === "config.yml");
  const original = patch(fixture("config.yml"), entry);
  const rewritten = patch(fixture("config.rewritten.yml"), entry);
  assert.equal(digest(rewritten.current), digest(original.current));
  assert.deepEqual(rewritten.next, fixture("config.rewritten.yml"), "0 changes");
});

test("drift: a hand edit of one cell is drift and names the cell", () => {
  const world = makeWorld();
  const { entry } = cellFixtures(world).find((f) => f.file === "config.yml");
  const recorded = digest(patch(fixture("config.yml"), entry).current);
  const edited = text(fixture("config.yml")).replace("advisor: prov/model-a:medium", "advisor: prov/model-a:high");
  const r = patch(bytesOf(edited), entry);
  assert.notEqual(digest(r.current), recorded);
  assert.deepEqual(cellDiff(r.current, entry.values), [
    { cell: [0, "advisor", 0, "model_effort"], from: "prov/model-a:high", to: "prov/model-a:medium" },
  ]);
});

test("drift: removed markers are inserted again on the next run", () => {
  const world = makeWorld();
  const { entry } = cellFixtures(world)[0];
  const r = patch(fixture("orchestration.md"), entry);
  assert.equal(r.markers, "inserted");
  const once = text(r.next);
  const stripped = once.split("\n").filter((l) => !l.startsWith("<!-- rig:models")).join("\n");
  assert.equal(stripped, text(fixture("orchestration.md")));
  assert.equal(text(patch(bytesOf(stripped), entry).next), once);
});

// ---------------------------------------------------------------- locators

test("role-line: labels with commas are cut first, then values split on ', '", () => {
  const world = makeWorld();
  const { entry } = cellFixtures(world).find((f) => f.file === "pstack-models.md");
  const src = text(fixture("pstack-models.md")).replace(
    "reflect judgment, divergent, synthesizer: bravo high",
    "reflect judgment, divergent, synthesizer: charlie high",
  );
  const r = patch(bytesOf(src), entry);
  assert.deepEqual(cellDiff(r.current, entry.values), [
    { cell: [0, "reflect judgment, divergent, synthesizer", 0, "model"], from: "charlie", to: "bravo" },
  ]);
  assert.deepEqual(changedLines(src, text(r.next)), [
    { n: 9, before: "reflect judgment, divergent, synthesizer: charlie high", after: "reflect judgment, divergent, synthesizer: bravo high" },
  ]);
  // The "# budget:" header line is a cell keyed "budget"; the other "#" lines are not.
  assert.equal(pick(r.current, "budget", "literal"), "medium (high)");
});

test("role-line: a label that is a prefix of another label does not capture its line", () => {
  const roles = baseRoles();
  roles.consumers.pstack = { arena: ["fast", "high"], "arena runners": ["strong", "high"] };
  const world = makeWorld({ roles });
  const entry = cellsEntry(world, "~/p.md", [{ surface: SURFACES.pstackMd, harness: "claude" }]);
  const r = patch(bytesOf("arena runners: bravo high\narena: charlie high\n"), entry);
  assert.deepEqual(cellDiff(r.current, entry.values), []);
});

test("role-line: a panel with a different element count is one mismatch on that line", () => {
  const world = makeWorld();
  const { entry } = cellFixtures(world).find((f) => f.file === "pstack-models.md");
  const src = text(fixture("pstack-models.md")).replace("arena runners: bravo high, charlie high", "arena runners: bravo high");
  const r = patch(bytesOf(src), entry);
  assert.ok(cellDiff(r.current, entry.values).every((d) => d.cell[1] === "arena runners"));
  assert.match(text(r.next), /^arena runners: bravo high, charlie high$/m);
});

test("frontmatter: the display token is the first parenthesised known display name", () => {
  const world = makeWorld();
  const { entry } = cellFixtures(world).find((f) => f.file === "claude-agents/reviewer.md");
  const r = patch(fixture("claude-agents/reviewer.md"), entry);
  assert.equal(pick(r.current, "reviewer", "display"), "Bravo"); // not "Read-only", not "see rules"
  // The body line "You are a reviewer (Bravo)." is prose, not a cell.
  const { world: next } = setTier(world, "strong", "echo", "claude");
  const out = text(patch(fixture("claude-agents/reviewer.md"), cellFixtures(next)[1].entry).next);
  assert.match(out, /^You are a reviewer \(Bravo\)\. Keep this prose untouched\.$/m);
});

test("frontmatter: pinning an alias tier changes only the model line and the display token", () => {
  const tiers = baseTiers();
  tiers.tiers.strong.claude = { id: "pinned-model-s", display: "Echo" };
  const world = makeWorld({ tiers });
  const before = text(fixture("claude-agents/reviewer.md"));
  const { entry } = cellFixtures(world).find((f) => f.file === "claude-agents/reviewer.md");
  assert.deepEqual(changedLines(before, text(patch(bytesOf(before), entry).next)).map((c) => c.n), [3, 4]);
  assert.match(text(patch(bytesOf(before), entry).next), /^model: pinned-model-s$/m);
});

test("frontmatter: a new pinned id keeps its display; a renamed pin display is not derivable and throws", () => {
  const before = text(fixture("claude-agents/quick-worker.md"));
  const world = makeWorld();
  const { world: next } = setTier(world, "cheap", "pinned-model-e", "claude");
  const { entry } = cellFixtures(next).find((f) => f.file === "claude-agents/quick-worker.md");
  assert.deepEqual(changedLines(before, text(patch(bytesOf(before), entry).next)), [
    { n: 4, before: "model: pinned-model-d", after: "model: pinned-model-e" },
  ]);
  // Display tokens inside a quoted value are found too; a pin display rename leaves no known old token.
  const tiers = baseTiers();
  tiers.tiers.cheap.claude = { id: "pinned-model-d", display: "Echo" };
  const renamed = cellFixtures(makeWorld({ tiers })).find((f) => f.file === "claude-agents/quick-worker.md").entry;
  assert.throws(() => patch(bytesOf(before), renamed), { code: "E_LOCATOR", key: "description" });
});

test("locator: a header that matches twice, an absent row and an absent YAML key throw E_LOCATOR", () => {
  const world = makeWorld();
  const { entry } = cellFixtures(world)[0];
  const src = text(fixture("orchestration.md"));
  const roster = src.slice(src.indexOf("| Role                       |"), src.indexOf("\n\n## Effort"));
  assert.throws(() => patch(bytesOf(src + "\n" + roster + "\n"), entry), { code: "E_LOCATOR" });
  assert.throws(() => patch(bytesOf(src.replace(/^\| quick-worker {3}\|.*\n/m, "")), entry), { code: "E_LOCATOR" });
  const omp = cellFixtures(world).find((f) => f.file === "config.yml").entry;
  assert.throws(() => patch(bytesOf(text(fixture("config.yml")).replace("  plan: prov/model-r:high\n", "")), omp), { code: "E_LOCATOR" });
  assert.throws(() => patch(bytesOf("modelRoles: {task: a}\n"), omp), { code: "E_LOCATOR" });
  const dupKey = text(fixture("config.yml")).replace("  plan: prov/model-r:high\n", "  plan: prov/model-r:high\n  plan: prov/model-r:high\n");
  assert.throws(() => patch(bytesOf(dupKey), omp), { code: "E_LOCATOR" });
  const pstack = cellFixtures(world).find((f) => f.file === "pstack-models.md").entry;
  assert.throws(() => patch(bytesOf(text(fixture("pstack-models.md")) + "bug-fix: charlie high\n"), pstack), { code: "E_LOCATOR" });
  const agent = cellFixtures(world).find((f) => f.file === "claude-agents/reviewer.md").entry;
  assert.throws(() => patch(bytesOf(text(fixture("claude-agents/reviewer.md")).replace("effort: high\n", "effort: high\neffort: low\n")), agent), {
    code: "E_LOCATOR",
  });
});

test("locator: keys under a sibling top-level map are not cells", () => {
  const world = makeWorld();
  const { entry } = cellFixtures(world).find((f) => f.file === "config.yml");
  const r = patch(fixture("config.yml"), entry);
  assert.equal(pick(r.current, "task", "model_effort"), "prov/model-f-high:auto"); // not queue.task: 5
  assert.equal(pick(r.current, "default", "model_effort"), "prov/model-c:medium"); // not queue.default
});

test("input: CRLF line endings and invalid UTF-8 fail loudly", () => {
  const world = makeWorld();
  const { entry } = cellFixtures(world).find((f) => f.file === "config.yml");
  const crlf = text(fixture("config.yml")).replaceAll("\n", "\r\n");
  assert.throws(() => patch(bytesOf(crlf), entry), { code: "E_LOCATOR", message: /CRLF/ });
  assert.throws(() => patch(new Uint8Array([0x6d, 0xff, 0x0a]), entry), { code: "E_LOCATOR", message: /UTF-8/ });
});

// ---------------------------------------------------------------- block and owned

test("block: the Codex [agents] table is appended between markers, then converges", () => {
  const world = makeWorld();
  const entry = codexBlockEntry(world);
  const before = text(fixture("config.toml"));
  const r = patch(fixture("config.toml"), entry);
  assert.equal(r.markers, "inserted");
  assert.equal(r.current, null);
  assert.equal(
    text(r.next),
    before +
      "\n# rig:models:start\n[agents]\ndefault_subagent_model = \"codex-model-s\"\ndefault_subagent_reasoning_effort = \"medium\"\n# rig:models:end\n",
  );
  const again = patch(r.next, entry);
  assert.equal(again.markers, "present");
  assert.deepEqual(again.next, r.next);
  assert.deepEqual(again.current, entry.bytes);
  const { world: next } = setTier(world, "strong", "codex-model-z", "codex");
  const swapped = changedLines(text(r.next), text(patch(r.next, codexBlockEntry(next)).next));
  assert.deepEqual(swapped.map((c) => c.after), ['default_subagent_model = "codex-model-z"']);
});

test("block: an [agents] table outside the markers blocks with E_LOCATOR", () => {
  const entry = codexBlockEntry(makeWorld());
  const src = text(fixture("config.toml")) + "\n[agents]\nmax_threads = 4\n";
  assert.throws(() => patch(bytesOf(src), entry), { code: "E_LOCATOR" });
  const sub = text(fixture("config.toml")) + "\n[agents.reviewer]\nmodel = \"x\"\n";
  assert.equal(patch(bytesOf(sub), entry).markers, "inserted");
});

test("owned with keep_header: the current header stays byte-exact except the budget value", () => {
  const before = text(fixture("pstack-models.mdc"));
  const render = "# budget: low (medium)\nfeature, refactoring: slug-f-high-high\n";
  const entry = { kind: "owned", path: SURFACES.pstackMdc.path, bytes: bytesOf(render), mode: 0o644, unit: "pstack/models", keep_header: true };
  const out = text(patch(bytesOf(before), entry).next);
  const head = before.split("\n").slice(0, 7);
  head[6] = "# budget: low (medium)";
  assert.equal(out, head.join("\n") + "\nfeature, refactoring: slug-f-high-high\n");
  assert.deepEqual(patch(null, entry).next, entry.bytes);
});

// ---------------------------------------------------------------- setTier and effective

test("setTier: returns canonical tiers.json bytes with one value changed and stable key order", (t) => {
  const world = makeWorld();
  const dir = tempDir(t);
  const file = join(dir, "tiers.json");
  writeFileSync(file, JSON.stringify(world.tiers, null, 2) + "\n");
  const { bytes, world: next } = setTier(world, "fast", "prov/model-y", "omp");
  const before = readFileSync(file, "utf8");
  const changed = changedLines(before, text(bytes));
  assert.deepEqual(changed.map((c) => c.after.trim()), ['"omp": "prov/model-y",']);
  assert.equal(text(bytes), JSON.stringify(JSON.parse(text(bytes)), null, 2) + "\n");
  assert.equal(next.tiers.tiers.fast.omp, "prov/model-y");
  assert.equal(world.tiers.tiers.fast.omp, "prov/model-f-high", "the input world is unchanged");
  assert.ok(Object.isFrozen(next) && Object.isFrozen(next.tiers.tiers.fast));
  // A pinned value stays pinned.
  const pinned = setTier(world, "cheap", "pinned-model-e", "claude").world.tiers.tiers.cheap.claude;
  assert.deepEqual(pinned, { id: "pinned-model-e", display: "Delta" });
});

test("setTier: an unknown harness or tier throws and returns nothing", () => {
  const world = makeWorld();
  assert.throws(() => setTier(world, "strong", "prov/model-z", "nope"), { code: "E_USAGE", message: /harness nope/ });
  assert.throws(() => setTier(world, "huge", "prov/model-z", "omp"), { code: "E_USAGE", message: /tier huge/ });
  assert.throws(() => setTier(world, "strong", "two words", "omp"), { code: "E_USAGE" });
});

test("effective: each value names its source: tiers.json, a pinned id, or an env override", () => {
  const world = makeWorld({ vars: { ANTHROPIC_DEFAULT_BRAVO_MODEL: "remapped-model-b" } });
  const rows = effective(world);
  const row = (h, tier) => rows.find((r) => r.harness === h && r.tier === tier);
  assert.equal(rows.length, 16);
  assert.deepEqual(row("claude", "reason"), { harness: "claude", tier: "reason", model: "alpha", source: "tiers.json" });
  assert.deepEqual(row("claude", "strong"), {
    harness: "claude",
    tier: "strong",
    model: "remapped-model-b",
    source: "env override",
    env: "ANTHROPIC_DEFAULT_BRAVO_MODEL",
  });
  assert.deepEqual(row("claude", "cheap"), { harness: "claude", tier: "cheap", model: "pinned-model-d", source: "pinned id" });
  assert.deepEqual(row("omp", "strong"), { harness: "omp", tier: "strong", model: "prov/model-a", source: "tiers.json" });
});
