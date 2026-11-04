// The provider declaration of one project (doc section 11, decision 0008 as updated by section 14 row 11).
// Only a `rig-project: <provider>` line selects. The overlay `projects` map is a check. Footprints are info:
// this file computes them after the provider is fixed, and no footprint value reaches the selection.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { expandHome } from "./read.mjs";

/** Instruction files in read order. The first one with a declaration line wins. */
const INSTRUCTION_FILES = [
  ["CLAUDE.local.md", "local-instructions"],
  ["CLAUDE.md", "instructions"],
  ["AGENTS.md", "instructions"],
  [".claude/rules/rig-project.md", "instructions"],
];

const LINE = /^[ \t]*rig-project:[ \t]*([a-z0-9]+(?:-[a-z0-9]+)*)[ \t]*$/m;

const readText = (abs) => {
  try {
    return readFileSync(abs, "utf8");
  } catch {
    return null;
  }
};

const readJson = (abs) => {
  const t = readText(abs);
  if (t === null) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
};

/** @param {string} dir absolute project dir @returns {[string, "instructions"|"local-instructions"][]} */
function instructionFiles(dir) {
  const files = INSTRUCTION_FILES.map(([rel, source]) => [join(dir, rel), source]);
  const rules = join(dir, ".cursor/rules");
  if (existsSync(rules)) {
    for (const name of readdirSync(rules).sort()) if (name.endsWith(".mdc")) files.push([join(rules, name), "instructions"]);
  }
  return files;
}

/** @param {string} p @param {string} home */
const normalize = (p, home) => resolve(expandHome(p, home)).replace(/\/+$/, "");

/**
 * @param {import("../world.mjs").World} world @param {string} dir
 * @returns {{provider: string, source: "instructions"|"local-instructions"|"default", line: string | null,
 *            overlay: string | null, agrees: boolean, footprints: string[],
 *            packs: {name: string, enabled: boolean, source: "local"|"project"|"user"|null}[]}}
 */
export function projectDeclaration(world, dir) {
  const home = world.env.home;
  const abs = normalize(dir, home);

  let provider = world.config.default_provider;
  /** @type {"instructions"|"local-instructions"|"default"} */
  let source = "default";
  let line = null;
  for (const [file, src] of instructionFiles(abs)) {
    const m = readText(file)?.match(LINE);
    if (!m) continue;
    provider = m[1];
    source = src;
    line = m[0].trim();
    break;
  }

  let overlay = null;
  for (const [key, entry] of Object.entries(world.config.projects ?? {})) {
    if (normalize(key, home) === abs) overlay = entry.provider;
  }
  const agrees = overlay === null || overlay === provider;

  const settings = {
    local: readJson(join(abs, ".claude/settings.local.json"))?.enabledPlugins,
    project: readJson(join(abs, ".claude/settings.json"))?.enabledPlugins,
    user: readJson(join(home, ".claude/settings.json"))?.enabledPlugins,
  };

  const footprints = [];
  for (const p of world.providers.values()) {
    for (const spec of Object.values(p.footprint ?? {})) {
      if (spec.startsWith("dir:")) {
        const d = join(abs, spec.slice(4));
        if (existsSync(d) && statSync(d).isDirectory()) footprints.push(`${p.name}: ${spec}`);
      } else if (spec.startsWith("enabledPlugins:")) {
        const id = spec.slice("enabledPlugins:".length);
        if (settings.local?.[id] === true || settings.project?.[id] === true) footprints.push(`${p.name}: ${spec}`);
      }
    }
  }

  // Scope packs declared for this directory, and whether Claude Code enables their rig-local plugin here.
  // Precedence: local beats project beats user, key by key; the first source that mentions the id decides.
  const marketplace = world.targets.get("claude")?.channels?.plugin?.marketplace ?? null;
  const packs = [];
  for (const [name, entry] of Object.entries(world.config.packs)) {
    if (entry.scope !== "project" && entry.scope !== "hybrid") continue;
    if (!(entry.projects ?? []).some((p) => normalize(p, home) === abs)) continue;
    let enabled = false;
    let from = null;
    if (marketplace) {
      const pid = `${name}@${marketplace}`;
      for (const s of /** @type {const} */ (["local", "project", "user"])) {
        if (settings[s] && pid in settings[s]) {
          enabled = settings[s][pid] === true;
          from = s;
          break;
        }
      }
    }
    packs.push({ name, enabled, source: from });
  }

  return { provider, source, line, overlay, agrees, footprints, packs };
}
