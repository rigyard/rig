// The frame, rendered from the repo's own data: the target records fill the core template variables.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "../lib/targets.ts";
import { compose } from "../lib/stack.ts";
import { gate } from "../lib/gate.ts";
import { loadWorld } from "../lib/world.ts";
import { makeFixtureHome } from "./helpers/fixture-home.ts";
import { ROOT, fixture } from "./world.helpers.ts";
import { HARNESSES, records, unit, world as renderWorld } from "./render.helpers.ts";

const decoder = new TextDecoder();
const text = (e) => decoder.decode(e.bytes);
const MDC_HEAD = "---\nalwaysApply: true\n---\n";
const FRAME_PATHS = { claude: "~/.claude/rules/rig-frame.md", codex: "~/.codex/AGENTS.md", omp: "~/.omp/agent/AGENTS.md", cursor: "~/.cursor/rules/rig-frame.mdc" };
/** The frame variables whose lines differ per harness. Every other line is byte-identical across harnesses. */
const PER_HARNESS = ["craft", "models"];
const CRAFT: Record<string, string> = { claude: "/craft", codex: "$craft", cursor: "/craft", omp: "/craft" };

/** The real target records, which declare the frame paths (the world fixtures do not). */
const realTargets = () => Object.fromEntries(HARNESSES.map((h) => [`targets/${h}.json`, readFileSync(join(ROOT, `targets/${h}.json`), "utf8")]));

/** Render the repo's own data. Returns rendered entries keyed by "~/..." path, plus stack, desired and world. */
function renderRepo(spec) {
  if (!spec) {
    const fx = makeFixtureHome({});
    try {
      return run(loadWorld({ HOME: fx.home }), fx.home);
    } finally {
      fx.cleanup();
    }
  }
  const fx = fixture({ ...spec, repo: { ...realTargets(), ...(spec.repo ?? {}) } });
  try {
    return run(fx.load(), fx.home);
  } finally {
    fx.cleanup();
  }
}

function run(w, home) {
  const stack = compose(w);
  assert.deepEqual(stack.errors, []);
  const desired = render(stack, w);
  const at = new Map([...desired.entries].map(([abs, e]) => [`~/${abs.slice(home.length + 1)}`, e]));
  return { at, stack, desired, world: w };
}

const frameBody = (at, h) => {
  const t = text(at.get(FRAME_PATHS[h]));
  return h === "cursor" ? t.slice(MDC_HEAD.length) : t;
};

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("the repo's own data renders on all four harnesses with no error, no {{ left in any file, and no gate block", () => {
  const { at, desired, stack, world } = renderRepo();
  assert.deepEqual(desired.errors, []);
  // the core seal in rig.lock.json matches packs/core, and no check blocks the rendered text
  assert.deepEqual(gate(stack, desired, world).findings.filter((f) => f.severity === "block"), []);
  for (const h of HARNESSES) assert.ok(at.has(FRAME_PATHS[h]), FRAME_PATHS[h]);
  for (const [p, e] of at) assert.ok(!text(e).includes("{{"), `${p} holds a literal {{`);
});

test("frame blocks are the template byte for byte, except the declared per-harness lines", () => {
  const { at } = renderRepo();
  const template = readFileSync(join(ROOT, "packs/core/frame.md"), "utf8");
  const used = [...template.matchAll(/\{\{([a-z_]+)\}\}/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(used)].sort(), PER_HARNESS);
  const pattern = template
    .split("\n")
    .map((line) => escape(line).replaceAll(escape("{{craft}}"), "([^\\n`]+)").replace(escape("{{models}}"), "([^\\n]+)"))
    .join("\n");
  const re = new RegExp(`^${pattern}$`);
  const models = {};
  for (const h of HARNESSES) {
    const m = re.exec(frameBody(at, h));
    assert.ok(m, `the ${h} frame differs from the template outside the per-harness lines`);
    const [first, second, line] = m.slice(1);
    models[h] = line;
    assert.deepEqual([first, second], [CRAFT[h], CRAFT[h]], `${h} names craft in its typed form`);
  }
  assert.equal(new Set(HARNESSES.map((h) => models[h])).size, 4, "one distinct models line per harness");
});

test("no harness's frame names a provider or a slot", () => {
  const { at } = renderRepo();
  for (const h of HARNESSES) assert.doesNotMatch(frameBody(at, h), /provider|slot/i, h);
});

test("an unknown {{name}} in a core template is E_TERM_UNKNOWN and renders nothing for that unit", () => {
  const bad = unit({ id: "core/brief", type: "command", harnesses: ["claude"], files: { "brief.md": "Run {{nope}}.\n" } });
  const d = render({ units: [bad], errors: [] }, renderWorld({ aliases: {} }));
  assert.equal(d.entries.size, 0);
  assert.equal(d.errors[0].code, "E_TERM_UNKNOWN");
  assert.match(d.errors[0].message, /core\/brief.*\{\{nope\}\}/);
  const wrong = unit({ id: "core/brief", type: "command", harnesses: ["claude"], files: { "brief.md": "{{models}}\n" } });
  assert.equal(render({ units: [wrong], errors: [] }, renderWorld({ aliases: {} })).errors[0].code, "E_TERM_UNKNOWN");
});

test("a target record with no skill_prefix renders no frame for that harness and says why", () => {
  const targets = records();
  delete targets.get("omp").skill_prefix;
  const frame = unit({ id: "core/rig-frame", type: "frame", files: { "frame.md": readFileSync(join(ROOT, "packs/core/frame.md"), "utf8") } });
  const d = render({ units: [frame], errors: [] } as any, renderWorld({ targets }) as any);
  assert.deepEqual(d.errors.map((e) => [e.code, e.harness]), [["E_INTERNAL", "omp"]]);
  assert.match(d.errors[0].message, /targets\/omp\.json declares no skill_prefix/);
  assert.deepEqual([...d.entries.values()].map((e) => e.unit), ["core/rig-frame", "core/rig-frame", "core/rig-frame"]);
});

test("render twice is byte-identical", () => {
  const fx = fixture({ repo: realTargets() });
  try {
    const w = fx.load();
    const stack = compose(w);
    const flat = (d) => [...d.entries].map(([p, e]) => [p, e.kind, text(e)]);
    assert.deepEqual(flat(render(stack, w)), flat(render(stack, w)));
  } finally {
    fx.cleanup();
  }
});
