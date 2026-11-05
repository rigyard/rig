// The frame, /craft and the slot stubs, rendered from the repo's own data: provider records, target records, slot
// fillers and the lock fill the core template variables.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { render } from "../lib/targets.ts";
import { compose } from "../lib/stack.ts";
import { gate } from "../lib/gate.ts";
import { loadWorld } from "../lib/world.ts";
import { makeFixtureHome } from "./helpers/fixture-home.ts";
import { ROOT, fixture } from "./world.helpers.ts";
import { HARNESSES, unit, world as renderWorld } from "./render.helpers.ts";

const decoder = new TextDecoder();
const text = (e) => decoder.decode(e.bytes);
const MDC_HEAD = "---\nalwaysApply: true\n---\n";
const FRAME_PATHS = { claude: "~/.claude/rules/rig-frame.md", codex: "~/.codex/AGENTS.md", omp: "~/.omp/agent/AGENTS.md", cursor: "~/.cursor/rules/rig-frame.mdc" };
const CRAFT_PATHS = {
  claude: "~/.claude/commands/craft.md",
  codex: "~/.codex/prompts/craft.md",
  omp: "~/.omp/agent/commands/craft.md",
  cursor: "~/.cursor/plugins/local/rig/skills/craft/SKILL.md",
};
/** The frame variables whose lines differ per harness. Every other line is byte-identical across harnesses. */
const PER_HARNESS = ["providers", "slots", "models"];
const LOCKED_PATH = "~/.claude/plugins/cache/cursor-plugins/pstack/0.15.36/skills/poteto-mode/SKILL.md";

/** The real target records, which declare the frame and /craft paths (the world fixtures do not). */
const realTargets = () => Object.fromEntries(HARNESSES.map((h) => [`targets/${h}.json`, readFileSync(join(ROOT, `targets/${h}.json`), "utf8")]));

const lockWith = (pins) => ({ schema: 1, core: null, packs: {}, pins });
const PSTACK_PIN = {
  pstack: { plugin: "pstack@cursor-plugins", current: { version: "0.15.36", sha: "0123456789abcdef", tree: "sha256:00" }, candidate: null },
};

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
  for (const h of HARNESSES) {
    assert.ok(at.has(FRAME_PATHS[h]), FRAME_PATHS[h]);
    assert.ok(at.has(CRAFT_PATHS[h]), CRAFT_PATHS[h]);
  }
  for (const [p, e] of at) assert.ok(!text(e).includes("{{"), `${p} holds a literal {{`);
});

test("frame blocks are the template byte for byte, except the declared per-harness lines", () => {
  const { at } = renderRepo();
  const template = readFileSync(join(ROOT, "packs/core/frame.md"), "utf8");
  const used = [...template.matchAll(/\{\{([a-z_]+)\}\}/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(used)].sort(), ["default_provider", ...PER_HARNESS].sort());
  // Shared variables take one value on every harness; per-harness variables are the only free regions.
  const pattern = template
    .split("\n")
    .map((line) => {
      if (/^\{\{(providers|slots)\}\}$/.test(line)) return "((?:- [^\\n]*)(?:\\n- [^\\n]*)*)";
      return escape(line).replaceAll(escape("{{default_provider}}"), "pstack").replace(escape("{{models}}"), "([^\\n]+)");
    })
    .join("\n");
  const re = new RegExp(`^${pattern}$`);
  const captures = {};
  for (const h of HARNESSES) {
    const m = re.exec(frameBody(at, h));
    assert.ok(m, `the ${h} frame differs from the template outside the per-harness lines`);
    captures[h] = m.slice(1);
  }
  // models: one distinct line per harness. providers: Claude lists both, omp none.
  assert.equal(new Set(HARNESSES.map((h) => captures[h][2])).size, 4);
  assert.notEqual(captures.claude[0], captures.omp[0]);
});

test("/craft on Claude reads pstack at the exact locked plugin-cache path", () => {
  const { at, desired, stack, world } = renderRepo({ repo: { "rig.lock.json": lockWith(PSTACK_PIN) } });
  assert.deepEqual(desired.errors, []);
  const craft = text(at.get(CRAFT_PATHS.claude));
  assert.ok(craft.includes(`If it names pstack: read ${LOCKED_PATH} and follow it.`), craft);
  assert.doesNotMatch(craft, /\bls\b|\bsort\b|\btail\b|rig pin check/);
  const findings = gate(stack, desired, world).findings.filter((f) => f.check === "pin" && f.pack === "pstack");
  assert.deepEqual(findings, []);
  // the overlay lock serves the same lookup when the repo lock has no entry
  const over = renderRepo({ overlay: { "rig.lock.json": lockWith(PSTACK_PIN) } });
  assert.ok(text(over.at.get(CRAFT_PATHS.claude)).includes(LOCKED_PATH));
});

test("with no locked pstack version, /craft on Claude says to run rig pin check, and the gate reports it", () => {
  const unlocked = { pstack: { ...PSTACK_PIN.pstack, current: null, candidate: { version: "0.15.37", sha: "fedcba9876543210", tree: "sha256:01", checked: "2026-11-04" } } };
  for (const spec of [undefined, { repo: { "rig.lock.json": lockWith(unlocked) } }]) {
    const { at, desired, stack, world } = renderRepo(spec);
    const craft = text(at.get(CRAFT_PATHS.claude));
    assert.match(craft, /If it names pstack: .*run "rig pin check pstack"/);
    assert.doesNotMatch(craft, /plugins\/cache|0\.15\.37/, "a candidate is not a locked version: no path is guessed");
    const findings = gate(stack, desired, world).findings.filter((f) => f.check === "pin" && f.pack === "pstack");
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, "warn");
    assert.match(findings[0].evidence, /claude.*rig pin check pstack/);
  }
});

test("a provider with a null entry on a harness is absent from that harness's frame", () => {
  const { at } = renderRepo();
  // pstack and openspec both have entry.omp null; openspec has entry.cursor null
  assert.doesNotMatch(frameBody(at, "omp"), /^- (pstack|openspec):/m);
  assert.match(frameBody(at, "omp"), /^- none: /m);
  assert.doesNotMatch(frameBody(at, "cursor"), /^- openspec:/m);
  assert.match(frameBody(at, "cursor"), /^- pstack: enter with \/craft\./m);
  assert.match(frameBody(at, "claude"), /^- pstack: /m);
  // /craft still names it, as not available there
  assert.match(text(at.get(CRAFT_PATHS.omp)), /If it names openspec: openspec is not available on this harness\./);
});

test("an overlay provider renders in the local frame and /craft; repo template text names no provider", () => {
  const record = { schema: 1, name: "acme-flow", kind: "workflow", entry: { claude: { command: "/acme:start" }, codex: null, omp: null, cursor: null }, phases: ["plan"], telemetry: null };
  const { at } = renderRepo({ overlay: { "rig.json": { schema: 1, providers: ["acme-flow"] }, "providers/acme-flow.json": record } });
  assert.match(frameBody(at, "claude"), /^- acme-flow: enter with \/acme:start\. Phases: plan\.$/m);
  assert.match(text(at.get(CRAFT_PATHS.claude)), /^If it names acme-flow: run \/acme:start\.$/m);
  assert.doesNotMatch(frameBody(at, "codex"), /acme-flow/);
  // Repo core text: no overlay name anywhere, and the frame and /craft templates name no provider at all.
  const core = join(ROOT, "packs/core");
  const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
  for (const f of walk(core)) assert.ok(!readFileSync(f, "utf8").includes("acme-flow"), relative(ROOT, f));
  for (const f of ["frame.md", "commands/craft.md"]) {
    assert.doesNotMatch(readFileSync(join(core, f), "utf8"), /pstack|openspec|acme/, f);
  }
});

test("the OpenSpec line on Claude names /opsx:propose, in the frame and in /craft", () => {
  const { at } = renderRepo();
  assert.match(frameBody(at, "claude"), /^- openspec: enter with \/opsx:propose\. Phases: explore, propose, apply, sync, archive\. Artifacts: openspec\/changes\/<name>\/\.$/m);
  assert.match(text(at.get(CRAFT_PATHS.claude)), /^If it names openspec: run \/opsx:propose\.$/m);
});

test("slot stubs render with an empty filler, and the frame names each stub with its filler", () => {
  const { at } = renderRepo();
  const stub = (name) => [...at].filter(([p]) => p.endsWith(`/${name}/SKILL.md`)).map(([, e]) => text(e));
  const doc = stub("rig-doc-review");
  const second = stub("rig-second-opinion");
  assert.ok(doc.length >= 1 && second.length >= 1);
  for (const t of doc) assert.match(t, /^Slot empty: ask the user to review <path>\.$/m);
  for (const t of second) assert.match(t, /^Slot empty: say that no second opinion is configured\.$/m);
  for (const h of HARNESSES) {
    assert.match(frameBody(at, h), /^- rig-doc-review \(filler: empty\): Review a markdown document/m);
    assert.match(frameBody(at, h), /^- rig-second-opinion \(filler: empty\): /m);
  }
});

test("a headless filler renders its argv with the tier model into the stub body", () => {
  const codexCli = { schema: 1, name: "codex-cli", kind: "headless", family: "openai", argv: ["codex", "exec", "--model", "{model}", "{prompt}"], model_harness: "codex", forbid_same_family: true, telemetry: null };
  const base = renderWorld({ aliases: {} });
  const w = { ...base, config: { ...base.config, slots: { "second-opinion": { provider: "codex-cli", tier: "strong" } } }, tiers: { tiers: { strong: { codex: "fixture-model" } } } };
  const stub = unit({ id: "core/rig-second-opinion", type: "slot-stub", harnesses: ["claude"], files: { "SKILL.md": "---\nname: rig-second-opinion\n---\n{{slot_body}}\n" } });
  const d = render({ units: [stub], slots: { "second-opinion": codexCli }, providers: [] }, w);
  assert.deepEqual(d.errors, []);
  const body = [...d.entries.values()].map(text).find((t) => t.includes("rig-second-opinion"));
  assert.match(body, /^Provider: codex-cli\. Run `codex exec --model fixture-model "<prompt>"`/m);
  // no tier, no model: an error, not a guess
  const noTier = { ...w, config: { ...w.config, slots: { "second-opinion": { provider: "codex-cli" } } } };
  assert.equal(render({ units: [stub], slots: { "second-opinion": codexCli }, providers: [] }, noTier).errors[0].code, "E_INTERNAL");
});

test("an unknown {{name}} in a core template is E_TERM_UNKNOWN and renders nothing for that unit", () => {
  const bad = unit({ id: "core/craft", type: "command", harnesses: ["claude"], files: { "craft.md": "Run {{nope}}.\n" } });
  const d = render({ units: [bad], slots: {}, providers: [] }, renderWorld({ aliases: {} }));
  assert.equal(d.entries.size, 0);
  assert.equal(d.errors[0].code, "E_TERM_UNKNOWN");
  assert.match(d.errors[0].message, /core\/craft.*\{\{nope\}\}/);
  // a frame variable is not a /craft variable
  const wrong = unit({ id: "core/craft", type: "command", harnesses: ["claude"], files: { "craft.md": "{{models}}\n" } });
  assert.equal(render({ units: [wrong], slots: {}, providers: [] }, renderWorld({ aliases: {} })).errors[0].code, "E_TERM_UNKNOWN");
});

test("render twice is byte-identical", () => {
  const spec = { repo: { "rig.lock.json": lockWith(PSTACK_PIN) } };
  const fx = fixture({ ...spec, repo: { ...realTargets(), ...spec.repo } });
  try {
    const w = fx.load();
    const stack = compose(w);
    const flat = (d) => [...d.entries].map(([p, e]) => [p, e.kind, text(e)]);
    assert.deepEqual(flat(render(stack, w)), flat(render(stack, w)));
  } finally {
    fx.cleanup();
  }
});
