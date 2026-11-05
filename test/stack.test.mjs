import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { compose } from "../lib/stack.mjs";
import { pack, rigJson, skill, withFixture } from "./world.helpers.mjs";

const stackOf = (spec) => withFixture(spec, (fx) => compose(fx.load()));
const codes = (s) => s.errors.map((e) => e.code);
const ids = (s) => s.units.map((u) => u.id);
const unit = (s, id) => s.units.find((u) => u.id === id);
const command = (name) => ({ [`commands/${name}.md`]: `---\ndescription: Fixture command ${name}.\n---\nDo ${name}.\n` });
const withPacks = (packs, files) => ({ repo: { "rig.json": rigJson({ packs }), ...files } });

describe("core seal", () => {
  test("core is always in the stack, with no packs listed", () => {
    const s = stackOf(withPacks({}, {}));
    assert.deepEqual(ids(s), ["core/rig-frame", "core/rig-doc-review", "core/rig-second-opinion", "core/craft", "core/pm"]);
    assert.deepEqual(s.errors, []);
    assert.deepEqual(unit(s, "core/rig-frame").type, "frame");
    assert.deepEqual([...unit(s, "core/rig-frame").files.keys()], ["frame.md", "principles.md"]);
    assert.deepEqual(unit(s, "core/rig-doc-review").type, "slot-stub");
    assert.deepEqual(unit(s, "core/craft").harnesses, ["claude", "codex", "omp", "cursor"]);
  });
  test("each alias renders as a core command from the alias template", () => {
    const s = stackOf({});
    const pm = unit(s, "core/pm");
    assert.equal(pm.type, "command");
    assert.match(Buffer.from(pm.files.get("pm.md").bytes).toString(), /Alias of \/\{\{target\}\}/);
    assert.ok(!ids(s).includes("core/alias"));
  });
  test("an alias that points at no command", () =>
    assert.deepEqual(codes(stackOf({ repo: { "rig.json": rigJson({ aliases: { pm: "nothing" } }) } })), ["E_UNKNOWN_UNIT"]));
  test("compose is pure: the same world gives an equal stack", () =>
    withFixture(withPacks({ own: {} }, pack("own", skill("explain"))), (fx) => {
      const w = fx.load();
      assert.deepEqual(compose(w), compose(w));
    }));
});

describe("packs, units and scope", () => {
  test("units come from the layout; no scope entry means machine-hidden", () => {
    const s = stackOf(withPacks({ own: {} }, pack("own", { ...skill("explain"), ...command("tidy"), "agents/helper.md": "x\n", "rules/style.md": "x\n", "scripts/notes.txt": "x\n" })));
    const own = s.units.filter((u) => u.id.startsWith("own/"));
    assert.deepEqual(own.map((u) => [u.id, u.type]), [["own/explain", "skill"], ["own/tidy", "command"], ["own/helper", "agent"], ["own/style", "rule"]]);
    for (const u of own) assert.deepEqual([u.scope, u.projects], ["machine-hidden", []]);
    assert.deepEqual([...unit(s, "own/explain").files.keys()], ["SKILL.md"]);
  });
  test("project and hybrid scopes carry their projects", () => {
    const s = stackOf(withPacks({ kit: { scope: "hybrid", projects: ["~/src/app"] } }, pack("kit", skill("review"), { scopes: ["machine-hidden", "hybrid"] })));
    assert.deepEqual([unit(s, "kit/review").scope, unit(s, "kit/review").projects], ["hybrid", ["~/src/app"]]);
  });
  test("harnesses narrow by rig.json pack entry and by pack.json unit entry", () => {
    const s = stackOf(withPacks({ kit: { harnesses: ["claude", "cursor", "omp"], channel: { claude: "plugin" } } },
      pack("kit", { ...skill("review"), ...skill("lint") }, { units: { review: { harnesses: ["cursor", "claude"] } } })));
    assert.deepEqual(unit(s, "kit/review").harnesses, ["claude", "cursor"]);
    assert.deepEqual(unit(s, "kit/lint").harnesses, ["claude", "omp", "cursor"]);
    assert.deepEqual(unit(s, "kit/lint").channel, { claude: "plugin" });
  });
  test("pack.json names a unit the pack does not contain", () =>
    assert.deepEqual(codes(stackOf(withPacks({ kit: {} }, pack("kit", skill("review"), { units: { ghost: { harnesses: ["claude"] } } })))), ["E_UNKNOWN_UNIT"]));
});

describe("the four customization operations", () => {
  test("disable a default unit", () => {
    const s = stackOf({ repo: { "rig.json": rigJson({ packs: { own: {} }, disable: ["own/explain"] }), ...pack("own", { ...skill("explain"), ...skill("plan") }) } });
    assert.ok(!ids(s).includes("own/explain"));
    assert.ok(ids(s).includes("own/plan"));
    assert.deepEqual(s.errors, []);
  });
  test("disable a unit that does not exist", () =>
    assert.deepEqual(codes(stackOf({ repo: { "rig.json": rigJson({ disable: ["own/explain"] }) } })), ["E_UNKNOWN_UNIT"]));
  test("fill a slot from the overlay", () => {
    const filler = { schema: 1, name: "omp-cli", kind: "headless", family: "multi", argv: ["omp", "-p", "{prompt}"], model_harness: "omp", forbid_same_family: false, telemetry: null };
    const s = stackOf({ overlay: { "rig.json": { schema: 1, providers: ["omp-cli"], slots: { "second-opinion": { provider: "omp-cli", harnesses: ["claude", "cursor"] } } }, "providers/omp-cli.json": filler } });
    assert.equal(s.slots["second-opinion"].name, "omp-cli");
    assert.equal(s.slots["doc-review"], null);
    assert.deepEqual(unit(s, "core/rig-second-opinion").harnesses, ["claude", "cursor"]);
    assert.deepEqual(s.providers.map((p) => p.name), ["pstack", "openspec", "omp-cli"]);
  });
  test("add a pack", () => assert.ok(ids(stackOf(withPacks({ kit: {} }, pack("kit", skill("review"))))).includes("kit/review")));
  test("replace a non-sealed unit: no clash, and the replaced unit leaves the stack", () => {
    const s = stackOf(withPacks({ own: {}, kit: {} }, { ...pack("own", skill("explain")), ...pack("kit", skill("explain"), { units: { explain: { replaces: "own/explain" } } }) }));
    assert.deepEqual(s.errors, []);
    assert.ok(ids(s).includes("kit/explain") && !ids(s).includes("own/explain"));
  });
  test("replace a unit that does not exist", () =>
    assert.deepEqual(codes(stackOf(withPacks({ kit: {} }, pack("kit", skill("explain"), { units: { explain: { replaces: "own/explain" } } })))), ["E_UNKNOWN_UNIT"]));
});

describe("clash rules", () => {
  test("two packs install one name and neither declares replaces: E_CLASH", () => {
    const s = stackOf(withPacks({ own: {}, kit: {} }, { ...pack("own", skill("explain")), ...pack("kit", skill("explain")) }));
    assert.deepEqual(codes(s), ["E_CLASH"]);
    assert.match(s.errors[0].message, /kit\/explain and own\/explain/);
  });
  test("a replaces that targets another unit does not excuse a name clash", () => {
    const s = stackOf(withPacks({ own: {}, kit: {} }, {
      ...pack("own", { ...skill("explain"), ...skill("old") }),
      ...pack("kit", skill("explain"), { units: { explain: { replaces: "own/old" } } }),
    }));
    assert.deepEqual(codes(s), ["E_CLASH"]);
  });
  test("two units that replace one target: E_CLASH", () => {
    const s = stackOf(withPacks({ own: {}, a: {}, b: {} }, {
      ...pack("own", skill("explain")),
      ...pack("a", skill("explain"), { units: { explain: { replaces: "own/explain" } } }),
      ...pack("b", skill("explain2"), { units: { explain2: { replaces: "own/explain" } } }),
    }));
    assert.deepEqual(codes(s), ["E_CLASH"]);
  });
  test("a skill and a command share one name space", () =>
    assert.deepEqual(codes(stackOf(withPacks({ own: {}, kit: {} }, { ...pack("own", skill("tidy")), ...pack("kit", command("tidy")) }))), ["E_CLASH"]));
  test("an agent and a skill with one name do not clash", () =>
    assert.deepEqual(codes(stackOf(withPacks({ own: {} }, pack("own", { ...skill("review"), "agents/review.md": "x\n" })))), []));
  test("a pack unit with a core name: E_CORE_SHADOW", () => {
    for (const files of [skill("rig-doc-review"), command("craft"), command("pm")]) {
      const s = stackOf(withPacks({ own: {} }, pack("own", files)));
      assert.deepEqual(codes(s), ["E_CORE_SHADOW"], JSON.stringify(Object.keys(files)));
    }
  });
  test("an overlay pack unit with a core name: E_CORE_SHADOW", () => {
    const s = stackOf({ overlay: { "rig.json": { schema: 1, packs: { mine: {} } }, ...pack("mine", skill("rig-second-opinion")) } });
    assert.deepEqual(codes(s), ["E_CORE_SHADOW"]);
  });
  test("an alias with the name of a core command: E_CLASH", () =>
    assert.deepEqual(codes(stackOf({ repo: { "rig.json": rigJson({ aliases: { craft: "craft" } }) } })).sort(), ["E_CLASH", "E_UNKNOWN_UNIT"]));
});

describe("second-opinion family rule", () => {
  const codexCli = { schema: 1, name: "codex-cli", kind: "headless", family: "openai", argv: ["codex", "exec", "{prompt}"], model_harness: "codex", forbid_same_family: true, telemetry: null };
  const spec = (harnesses) => ({ overlay: { "rig.json": { schema: 1, providers: ["codex-cli"], slots: { "second-opinion": { provider: "codex-cli", ...(harnesses ? { harnesses } : {}) } } }, "providers/codex-cli.json": codexCli } });
  test("a filler that forbids its own family, on its own harness: E_SAME_FAMILY", () => {
    const s = stackOf(spec(null));
    assert.deepEqual(codes(s), ["E_SAME_FAMILY"]);
    assert.equal(s.errors[0].harness, "codex");
  });
  test("leaving its own harness out passes", () => assert.deepEqual(codes(stackOf(spec(["claude", "omp", "cursor"]))), []));
});
