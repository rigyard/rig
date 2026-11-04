// Hand-built Stack and World for render tests. compose and loadWorld live on other branches, so these builders
// produce the section 4 shapes directly. Placeholder values only.
import { readFileSync } from "node:fs";

export const HARNESSES = ["claude", "codex", "omp", "cursor"];
export const HOME = "/home/rig-fixture";

const fixture = (rel) => readFileSync(new URL(`./fixtures/render/${rel}`, import.meta.url));
const enc = new TextEncoder();

/** The real target records from targets/*.json, fresh objects on every call. */
export function records() {
  const out = new Map();
  for (const h of HARNESSES) out.set(h, JSON.parse(readFileSync(new URL(`../targets/${h}.json`, import.meta.url), "utf8")));
  return out;
}

/** Map of unit-relative path to {bytes, mode}. Values are strings or Uint8Arrays. */
export function files(obj) {
  return new Map(Object.entries(obj).map(([rel, v]) => [rel, { bytes: typeof v === "string" ? enc.encode(v) : new Uint8Array(v), mode: 0o644 }]));
}

/** One Stack unit. `files` maps unit-relative paths to bytes or text. */
export function unit({ id, type, harnesses = HARNESSES, scope = "machine-hidden", channel = {}, files: f }) {
  return { id, type, name: id.split("/")[1], scope, projects: [], harnesses, channel, files: files(f) };
}

/** A World with only the fields render reads. */
export function world({ targets = records(), terms = fixtureTerms(), aliases = { pm: "craft" }, harnesses = HARNESSES } = {}) {
  return {
    env: { home: HOME, state: `${HOME}/.local/state/rig`, data: `${HOME}/.local/share/rig`, test: true },
    config: { schema: 1, harnesses, aliases },
    targets,
    terms,
  };
}

export const fixtureTerms = () => JSON.parse(fixture("terms.json").toString("utf8")).terms;
export const frameTemplate = () => fixture("core/frame.md").toString("utf8");

/**
 * The fixture stack: one visible skill, one hidden skill, one command, one agent, one rule, the frame, /craft, and
 * the alias unit pm. The frame and alias units have the shape compose gives them: the frame carries principles.md
 * next to frame.md, and the alias is a core command holding the raw alias template.
 */
export function fixtureStack() {
  return {
    units: [
      unit({ id: "core/rig-frame", type: "frame", files: { "frame.md": fixture("core/frame.md"), "principles.md": "# Principles\n" } }),
      unit({ id: "core/craft", type: "command", files: { "craft.md": fixture("core/commands/craft.md") } }),
      unit({ id: "core/rig-doc-review", type: "skill", files: { "SKILL.md": fixture("core/skills/rig-doc-review/SKILL.md") } }),
      unit({ id: "own/explain", type: "skill", files: { "SKILL.md": fixture("own/skills/explain/SKILL.md") } }),
      unit({ id: "own/review", type: "command", files: { "review.md": fixture("own/commands/review.md") } }),
      unit({ id: "own/helper", type: "agent", files: { "helper.md": fixture("own/agents/helper.md") } }),
      unit({ id: "own/style", type: "rule", files: { "style.md": fixture("own/rules/style.md") } }),
      unit({ id: "core/pm", type: "command", files: { "pm.md": fixture("core/commands/alias.md") } }),
    ],
    slots: {},
    providers: [],
    errors: [],
  };
}

/** Home-relative "~/..." form of an absolute Desired path. */
export const rel = (abs) => (abs.startsWith(`${HOME}/`) ? `~/${abs.slice(HOME.length + 1)}` : abs);

export const text = (entry) => new TextDecoder().decode(entry.bytes);

/** Every dir and file a record declares as a write location (section 2.4). */
export function writable(rec) {
  const out = rec.reads.skills.filter((e) => e.writable).map((e) => `${e.path}/`);
  for (const u of Object.values(rec.units ?? {})) if (u?.dir) out.push(`${u.dir}/`);
  if (rec.instructions) out.push(rec.instructions.path);
  if (rec.plugin_manifest) out.push(rec.plugin_manifest.path);
  return out;
}
