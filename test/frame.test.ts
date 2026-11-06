// The frame, rendered from the repo's own data: the target records fill the core template variables.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "../lib/targets.ts";
import { compose } from "../lib/stack.ts";
import { gate } from "../lib/gate.ts";
import { loadWorld } from "../lib/world.ts";
import { makeFixtureHome } from "./helpers/fixture-home.ts";
import { configCopy } from "./helpers/seed.ts";
import { ROOT, fixture } from "./world.helpers.ts";
import { HARNESSES, records, unit, world as renderWorld } from "./render.helpers.ts";

const decoder = new TextDecoder();
const text = (e) => decoder.decode(e.bytes);
const MDC_HEAD = "---\nalwaysApply: true\n---\n";
const FRAME_PATHS = { claude: "~/.claude/rules/rig-frame.md", codex: "~/.codex/AGENTS.md", omp: "~/.omp/agent/AGENTS.md", cursor: "~/.cursor/rules/rig-frame.mdc" };
/** The frame variables whose lines differ per harness. Every other line is byte-identical across harnesses. */
const PER_HARNESS = ["craft", "models", "triggers"];
const CRAFT: Record<string, string> = { claude: "/craft", codex: "$craft", cursor: "/craft", omp: "/skill:craft" };

/** The real target records, which declare the frame paths (the world fixtures do not). */
const realTargets = () => Object.fromEntries(HARNESSES.map((h) => [`targets/${h}.json`, readFileSync(join(ROOT, `targets/${h}.json`), "utf8")]));

/** The four hub triggers that the default rig.json fill restates with no domain, as hub text and unit. */
const FRAME_TRIGGERS = [
  ["Any prose surface, your reply to the user included", "pstack/unslop"],
  ["Docs, RFCs, readmes, PR descriptions, or commit messages", "pstack/technical-writing"],
  ["Before commit", "cursor-team-kit/deslop"],
  ["Before review", "pstack/no-comments"],
];
const TRIGGER_LINE = /^(.+): read (\S+) and apply it\.$/;
/** The read dir that holds the seeded trigger units per harness, as docs/harnesses.md states. */
const TRIGGER_DIR: Record<string, string> = { claude: "~/.claude/skills", codex: "~/.agents/skills", omp: "~/.agents/skills", cursor: "~/.agents/skills" };

/**
 * Render the repo's own data. Returns rendered entries keyed by "~/..." path, plus stack, desired and world.
 * `rig` replaces top-level keys of a copy of rig.json first.
 */
function renderRepo(spec?: Record<string, any>, rig?: Record<string, unknown>) {
  if (!spec) {
    const fx = makeFixtureHome({});
    const root = rig ? configCopy(ROOT) : null;
    try {
      if (root) writeFileSync(join(root, "rig.json"), `${JSON.stringify({ ...JSON.parse(readFileSync(join(root, "rig.json"), "utf8")), ...rig }, null, 2)}\n`);
      return run(loadWorld({ HOME: fx.home, ...(root ? { RIG_ROOT: root } : {}) }), fx.home);
    } finally {
      fx.cleanup();
      if (root) rmSync(root, { recursive: true, force: true });
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
    .map((line) => escape(line).replaceAll(escape("{{craft}}"), "([^\\n`]+)").replace(escape("{{models}}"), "([^\\n]+)").replace(escape("{{triggers}}"), "([\\s\\S]+)"))
    .join("\n");
  const re = new RegExp(`^${pattern}$`);
  const models = {};
  for (const h of HARNESSES) {
    const m = re.exec(frameBody(at, h));
    assert.ok(m, `the ${h} frame differs from the template outside the per-harness lines`);
    const [first, second, line, third] = m.slice(1);
    models[h] = line;
    assert.deepEqual([first, second, third], Array(3).fill(CRAFT[h]), `${h} names craft in its typed form`);
    assert.match(frameBody(at, h), /Inside `[^`]+`, a domain step that says `Replaces the frame trigger:` runs in place of the trigger it quotes\./, `${h} frame lets a domain step replace a frame trigger`);
  }
  assert.equal(new Set(HARNESSES.map((h) => models[h])).size, 4, "one distinct models line per harness");
});

test("each frame holds the four hub triggers, each a path to the owned SKILL.md of its unit in the read set of the harness", () => {
  const { at } = renderRepo();
  const hub = readFileSync(join(ROOT, "packs/pstack/skills/poteto-mode/SKILL.md"), "utf8").split("\n");
  for (const [when] of FRAME_TRIGGERS) assert.ok(hub.some((l) => l.startsWith(`- ${when} → `)), `"${when}" is the text of a hub trigger`);
  for (const h of HARNESSES) {
    const reads: string[] = records().get(h).reads.skills.map((e: {path: string}) => e.path);
    assert.ok(reads.includes(TRIGGER_DIR[h]), `${h} reads ${TRIGGER_DIR[h]}`);
    const body = frameBody(at, h).split("\n");
    const lines = body.slice(body.indexOf("Triggers, in every task:") + 1).filter(Boolean);
    assert.deepEqual(lines.map((l) => TRIGGER_LINE.exec(l)?.[1]), FRAME_TRIGGERS.map(([when]) => when), h);
    lines.forEach((l, i) => {
      const [, ref] = FRAME_TRIGGERS[i];
      const path = TRIGGER_LINE.exec(l)![2];
      assert.equal(path, `${TRIGGER_DIR[h]}/${ref.split("/")[1]}/SKILL.md`, h);
      assert.equal(at.get(path)?.unit, ref, `${h}: ${path} is the rendered copy of ${ref}`);
    });
  }
});

test("the frame triggers are the same bytes from two HOMEs, and a disabled unit drops its line", () => {
  const a = renderRepo();
  const b = renderRepo();
  for (const h of HARNESSES) assert.equal(frameBody(a.at, h), frameBody(b.at, h), h);
  const off = renderRepo(undefined, { disable: ["pstack/unslop"] });
  assert.deepEqual(off.desired.errors, []);
  for (const h of HARNESSES) {
    assert.doesNotMatch(frameBody(off.at, h), /unslop/, h);
    assert.equal(frameBody(off.at, h).split("\n").filter((l) => TRIGGER_LINE.test(l)).length, 3, h);
  }
});

test("a trigger unit with no copy in the read set of a harness has no frame line there, and says why", () => {
  const frame = unit({ id: "core/rig-frame", type: "frame", files: { "frame.md": readFileSync(join(ROOT, "packs/core/frame.md"), "utf8") } });
  const leaf = unit({ id: "own/explain", type: "skill", harnesses: ["claude"], files: { "SKILL.md": "---\nname: explain\ndescription: Explain.\n---\n" } });
  const mode = { auto: new Set(), triggers: [{ when: "Before review", use: "own/explain" }] };
  const d = render({ units: [frame, leaf], errors: [], mode } as any, renderWorld() as any);
  assert.deepEqual(d.errors, []);
  const body = (h: keyof typeof FRAME_PATHS) => text([...d.entries.values()].find((e) => e.unit === "core/rig-frame" && e.path.endsWith(FRAME_PATHS[h].slice(1)))!);
  assert.match(body("claude"), /^Triggers, in every task:\nBefore review: read ~\/\.claude\/skills\/explain\/SKILL\.md and apply it\.\n$/m);
  assert.match(body("codex"), /^Triggers, in every task:\nNone\.\n$/m);
  assert.ok(d.info.includes(`absent codex own/explain: no skill dir of the harness holds it, so the frame has no line for the trigger "Before review"`), d.info.join("\n"));
});

test("a trigger unit that is not a skill has no frame line, and the info line says it is not a skill", () => {
  const frame = unit({ id: "core/rig-frame", type: "frame", files: { "frame.md": readFileSync(join(ROOT, "packs/core/frame.md"), "utf8") } });
  const helper = unit({ id: "own/helper", type: "agent", harnesses: ["claude"], files: { "helper.md": "---\nname: helper\ndescription: Help.\n---\n" } });
  const mode = { auto: new Set(), triggers: [{ when: "Before review", use: "own/helper" }] };
  const d = render({ units: [frame, helper], errors: [], mode } as any, renderWorld() as any);
  assert.deepEqual(d.errors, []);
  assert.ok(d.info.includes(`absent claude own/helper: the unit has type agent, not skill, so the frame has no line for the trigger "Before review"`), d.info.join("\n"));
  assert.ok(!d.info.some((l) => l.includes("own/helper") && l.includes("no skill dir")), d.info.join("\n"));
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
