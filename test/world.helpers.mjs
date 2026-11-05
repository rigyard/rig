// Fixture config roots for world and stack tests. The repo root is a copy of this repo's own data (rig.json,
// packs/core and the packs rig.json lists, providers, models, targets); tests add or replace files on top.
// Layout inside the fixture HOME: `rig/` is the repo root (RIG_ROOT), `.config/rig/` is the overlay.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { makeFixtureHome } from "./helpers/fixture-home.mjs";
import { loadWorld } from "../lib/world.mjs";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const NOW = "2026-11-05T12:00:00.000Z";

function files(base, dir) {
  const out = {};
  const walk = (abs) => {
    for (const name of readdirSync(abs).sort()) {
      const a = join(abs, name);
      if (statSync(a).isDirectory()) walk(a);
      else out[relative(base, a)] = readFileSync(a, "utf8");
    }
  };
  walk(join(base, dir));
  return out;
}

/** The repo's own config data, as {relative path: text}: core, every pack rig.json lists, and the real target records. */
export function repoBase() {
  const rig = readFileSync(join(ROOT, "rig.json"), "utf8");
  return {
    "rig.json": rig,
    ...files(ROOT, "packs/core"),
    ...Object.assign({}, ...Object.keys(JSON.parse(rig).packs).map((name) => files(ROOT, `packs/${name}`))),
    ...files(ROOT, "providers"),
    ...files(ROOT, "models"),
    ...files(ROOT, "targets"),
  };
}

/** A parsed copy of one base JSON file, for a test to change. @param {string} rel */
export const baseJson = (rel) => JSON.parse(repoBase()[rel]);

const text = (v) => (typeof v === "string" ? v : `${JSON.stringify(v, null, 2)}\n`);

/**
 * Build a fixture HOME with a repo root and an optional overlay root.
 * @param {{repo?: Record<string, unknown>, overlay?: Record<string, unknown> | null, home?: Record<string, string>,
 *          env?: Record<string, string>}} [spec]  values: a string, a JSON value, or null to drop a base file
 * @returns {{env: NodeJS.ProcessEnv, home: string, path: (rel: string) => string, load: () => import("../lib/world.mjs").World, cleanup: () => void}}
 */
export function fixture({ repo = {}, overlay = null, home = {}, env = {} } = {}) {
  const spec = {};
  for (const [k, v] of Object.entries({ ...repoBase(), ...repo })) if (v !== null) spec[`rig/${k}`] = text(v);
  if (overlay) for (const [k, v] of Object.entries(overlay)) if (v !== null) spec[`.config/rig/${k}`] = text(v);
  Object.assign(spec, home);
  const fx = makeFixtureHome(spec);
  const e = { HOME: fx.home, RIG_ROOT: fx.path("rig"), RIG_NOW: NOW, ...env };
  return { env: e, home: fx.home, path: fx.path, load: () => loadWorld(e), cleanup: fx.cleanup };
}

/** rig.json of the repo with changes merged on top. @param {object} changes */
export const rigJson = (changes = {}) => ({ ...baseJson("rig.json"), ...changes });

/** Files of one pack. @param {string} name @param {Record<string, string>} unitFiles @param {object} [manifest] */
export function pack(name, unitFiles, manifest = {}) {
  const out = { [`packs/${name}/pack.json`]: { schema: 1, name, license: "MIT", ...manifest } };
  for (const [k, v] of Object.entries(unitFiles)) out[`packs/${name}/${k}`] = v;
  return out;
}

export const skill = (name) => ({ [`skills/${name}/SKILL.md`]: `---\nname: ${name}\ndescription: Fixture skill ${name}.\n---\nBody.\n` });

/** Run fn with a fixture; always clean up. */
export function withFixture(spec, fn) {
  const fx = fixture(spec);
  try {
    return fn(fx);
  } finally {
    fx.cleanup();
  }
}
