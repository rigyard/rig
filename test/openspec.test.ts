// The OpenSpec provider path: telemetry (S4.6) through rig plan and rig doctor, the project declaration through
// rig doctor --project (S4.9), and the /craft routing line per harness.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { gate } from "../lib/gate.ts";
import { render } from "../lib/targets.ts";
import { compose } from "../lib/stack.ts";
import { loadWorld } from "../lib/world.ts";
import { doctorTopic, editProvider, initTree, setup } from "./openspec.helpers.ts";

const decoder = new TextDecoder();
const APP = "src/app";
const PLAN_TELEMETRY = /^warn telemetry openspec\/providers\/openspec\.json: openspec sends telemetry by default\. Add to your shell profile: export DO_NOT_TRACK=1$/m;
const TELEMETRY = /^warn +telemetry +openspec\/providers\/openspec\.json: openspec sends telemetry by default\. Add to your shell profile: export DO_NOT_TRACK=1$/m;

/** @param {import("node:test").TestContext} t @param {Parameters<typeof setup>[0]} [opts] */
function fixture(t, opts) {
  const s = setup(opts);
  t.after(() => s.fx.cleanup());
  return s;
}

describe("S4.6 telemetry", () => {
  test("rig plan with no opt-out set: one telemetry warning, no block, exit 0", (t) => {
    const r = fixture(t).rig(["plan"]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, PLAN_TELEMETRY);
    assert.equal(r.stdout.split("\n").filter((l) => /^\S+ telemetry /.test(l)).length, 1, "pstack has telemetry null: one finding only");
    assert.match(r.stdout, /^\d+ changes, 0 blocks$/m);
  });

  for (const [name, value] of [["DO_NOT_TRACK", "1"], ["OPENSPEC_TELEMETRY", "0"]]) {
    test(`rig plan with ${name}=${value}: no telemetry finding, no ack stanza, no block, exit 0`, (t) => {
      const r = fixture(t).rig(["plan"], { env: { [name]: value } });
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assert.doesNotMatch(r.stdout, /telemetry|ack:/);
      assert.match(r.stdout, /^\d+ changes, 0 blocks$/m);
    });
  }

  test("no opt-out set: rig doctor warns on openspec, names DO_NOT_TRACK=1, and exits 0", (t) => {
    const r = fixture(t).rig(["doctor"]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, TELEMETRY);
    assert.equal(doctorTopic(r.stdout, "telemetry").length, 1, "pstack has telemetry null: one finding only");
  });

  for (const [name, value] of [["DO_NOT_TRACK", "1"], ["OPENSPEC_TELEMETRY", "0"]]) {
    test(`${name}=${value}: no telemetry finding, exit 0`, (t) => {
      const r = fixture(t).rig(["doctor"], { env: { [name]: value } });
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assert.deepEqual(doctorTopic(r.stdout, "telemetry"), []);
    });
  }

  test("DO_NOT_TRACK=0 and OPENSPEC_TELEMETRY=1 opt out of nothing", (t) => {
    const r = fixture(t).rig(["doctor"], { env: { DO_NOT_TRACK: "0", OPENSPEC_TELEMETRY: "1" } });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, TELEMETRY);
  });

  test("on the rendered repo data the finding is a warning, so it needs no ack and blocks nothing", (t) => {
    const s = fixture(t);
    const world = loadWorld(s.env);
    const stack = compose(world);
    const findings = gate(stack, render(stack, world), world).findings;
    assert.deepEqual(findings.filter((f) => f.check === "telemetry").map((f) => [f.pack, f.severity]), [["openspec", "warn"]]);
    assert.deepEqual(findings.filter((f) => f.severity === "block"), []);
  });
});

describe("S4.9 rig doctor --project", () => {
  /** doctor --project on ~/src/app holding the OpenSpec init tree plus extra files. */
  const project = (t, files = {}, opts = {}) => {
    const s = fixture(t, { ...opts, home: { ...initTree(APP), ...Object.fromEntries(Object.entries(files).map(([k, v]) => [`${APP}/${k}`, v])), ...opts.home } });
    return { s, r: s.rig(["doctor", "--project", s.fx.path(APP)]) };
  };

  test("a rig-project: openspec line in CLAUDE.md: provider openspec, source instructions", (t) => {
    const { r } = project(t, { "CLAUDE.md": "# App\n\nrig-project: openspec\n" });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.deepEqual(doctorTopic(r.stdout, "project"), ["info  project   provider openspec source instructions (rig-project: openspec)"]);
  });

  test("the init tree and no line: default_provider pstack, source default, openspec/ as the only footprint, info", (t) => {
    const { r } = project(t, { "CLAUDE.md": "# App\n" });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.deepEqual(doctorTopic(r.stdout, "project"), ["info  project   provider pstack source default"]);
    assert.deepEqual(doctorTopic(r.stdout, "footprint"), ["info  footprint openspec: dir:openspec/ (info only: footprints never select a provider)"]);
  });

  test("the line only in the uncommitted CLAUDE.local.md: provider openspec, source local-instructions", (t) => {
    const { r } = project(t, { "CLAUDE.md": "# App\n", "CLAUDE.local.md": "rig-project: openspec\n" });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^info +project +provider openspec source local-instructions \(rig-project: openspec\)$/m);
  });

  test("an overlay projects map that disagrees: a warning naming both, exit 0, and the line still selects", (t) => {
    const overlay = { ".config/rig/rig.json": JSON.stringify({ schema: 1, projects: { [`~/${APP}`]: { provider: "pstack" } } }) };
    const { r } = project(t, { "CLAUDE.md": "rig-project: openspec\n" }, { home: overlay });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^info +project +provider openspec source instructions/m);
    assert.match(r.stdout, /^warn +project +the overlay projects map says pstack, the project declares openspec \(instructions\)$/m);
  });

  test("rig doctor --project writes nothing in HOME or in the project", (t) => {
    const s = fixture(t, { home: { ...initTree(APP), [`${APP}/CLAUDE.md`]: "rig-project: openspec\n" } });
    const before = s.fx.snapshot();
    assert.equal(s.rig(["doctor", "--project", s.fx.path(APP)]).code, 0);
    assert.deepEqual([...s.fx.snapshot()], [...before]);
  });
});

describe("/craft routes openspec per harness", () => {
  const CRAFT = {
    claude: ".claude/commands/craft.md",
    codex: ".codex/prompts/craft.md",
    omp: ".omp/agent/commands/craft.md",
    cursor: ".cursor/plugins/local/rig/skills/craft/SKILL.md",
  };
  const FRAME = { claude: ".claude/rules/rig-frame.md", codex: ".codex/AGENTS.md", omp: ".omp/agent/AGENTS.md", cursor: ".cursor/rules/rig-frame.mdc" };
  const ROUTE = {
    claude: "If it names openspec: run /opsx:propose.",
    // OpenSpec 1.5.0 `init --tools codex` writes ~/.codex/prompts/opsx-propose.md (live case: codex reads the route).
    codex: "If it names openspec: run /prompts:opsx-propose.",
    omp: "If it names openspec: openspec is not available on this harness. Say so in your first message, then follow the frame.",
    cursor: "If it names openspec: openspec is not available on this harness. Say so in your first message, then follow the frame.",
  };
  const FRAME_LINE = {
    claude: "- openspec: enter with /opsx:propose. Phases: explore, propose, apply, sync, archive. Artifacts: openspec/changes/<name>/.",
    codex: "- openspec: enter with /prompts:opsx-propose. Phases: explore, propose, apply, sync, archive. Artifacts: openspec/changes/<name>/.",
    omp: null,
    cursor: null,
  };

  /** @returns {Map<string, string>} home-relative path -> rendered text */
  const rendered = (t, opts) => {
    const s = fixture(t, opts);
    const world = loadWorld(s.env);
    const desired = render(compose(world), world);
    assert.deepEqual(desired.errors, []);
    return new Map([...desired.entries].map(([abs, e]) => [abs.slice(s.fx.home.length + 1), decoder.decode(e.bytes)]));
  };

  test("each harness's /craft holds its routing line, and the frame lists openspec only where it has an entry", (t) => {
    const at = rendered(t);
    for (const h of Object.keys(CRAFT)) {
      const craft = at.get(CRAFT[h]).split("\n");
      assert.equal(craft.filter((l) => l.startsWith("If it names openspec:")).length, 1, h);
      assert.ok(craft.includes(ROUTE[h]), `${h}: ${craft.find((l) => l.startsWith("If it names openspec:"))}`);
      const frame = at.get(FRAME[h]).split("\n").filter((l) => l.startsWith("- openspec:"));
      assert.deepEqual(frame, FRAME_LINE[h] ? [FRAME_LINE[h]] : [], h);
    }
  });

  test("the route comes from the record: another claude command moves the line in /craft and the frame", (t) => {
    const at = rendered(t, { edit: (root) => editProvider(root, "openspec", (r) => ({ ...r, entry: { ...r.entry, claude: { command: "/opsx:explore" } } })) });
    assert.ok(at.get(CRAFT.claude).split("\n").includes("If it names openspec: run /opsx:explore."));
    assert.doesNotMatch(at.get(CRAFT.claude), /opsx:propose/);
    assert.match(at.get(FRAME.claude), /^- openspec: enter with \/opsx:explore\./m);
  });
});
