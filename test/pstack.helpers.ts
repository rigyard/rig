// Fixtures for the pstack tests: a fixture HOME whose repo root (~/rig) is a temp copy of this repo's data, with a
// sealed core and an optional pstack lock entry, and a runner for bin/rig.ts with HOME set to it.

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { treeHash } from "../lib/tree.ts";
import { makeFixtureHome } from "./helpers/fixture-home.ts";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BIN = join(ROOT, "bin/rig.ts");
const NOW = "2026-11-05T12:00:00.000Z";
export const PLUGIN = "pstack@cursor-plugins";
export const VERSION = "9.8.7";
export const SHA = "0123456789abcdef0123456789abcdef01234567";

export function filesUnder(dir: string, rel = ""): {path: string, mode: number, bytes: Buffer}[] {
  const out = [];
  for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...filesUnder(dir, r));
    else out.push({ path: r, mode: statSync(join(dir, r)).mode & 0o777, bytes: readFileSync(join(dir, r)) });
  }
  return out;
}

export const repoJson = (rel) => JSON.parse(readFileSync(join(ROOT, rel), "utf8"));
export const json = (v) => `${JSON.stringify(v, null, 2)}\n`;

/**
 * A fixture HOME with a sealed repo root at ~/rig. `pin` writes a pstack lock entry with that current version and
 * commit; null leaves the lock without one. `pins` sets rig.json pins.
 * @param {{home?: Record<string, any>, pin?: {version: string, sha: string} | null, pins?: string[]}} [opts]
 */
export function setup({ home = {}, pin = { version: VERSION, sha: SHA }, pins } = {}) {
  const spec = { "rig/rig.json": readFileSync(join(ROOT, "rig.json")) };
  const packs = Object.keys(repoJson("rig.json").packs).map((name) => `packs/${name}`);
  for (const dir of ["models", "providers", "targets", "packs/core", ...packs]) {
    for (const f of filesUnder(join(ROOT, dir))) spec[`rig/${dir}/${f.path}`] = { content: f.bytes, mode: f.mode };
  }
  const fx = makeFixtureHome({ ...spec, ...home });
  const root = fx.path("rig");
  const lock = {
    schema: 1,
    core: { tree: treeHash(filesUnder(join(root, "packs/core")), { core: true }), candidate: null },
    packs: {},
    pins: pin ? { pstack: { plugin: PLUGIN, current: { ...pin, tree: "sha256:00" }, candidate: null } } : {},
  };
  writeFileSync(join(root, "rig.lock.json"), json(lock));
  if (pins) writeFileSync(join(root, "rig.json"), json({ ...repoJson("rig.json"), pins }));
  const env = { PATH: process.env.PATH, HOME: fx.home, RIG_ROOT: root, RIG_NOW: NOW };
  /** @param {string[]} args */
  const rig = (args) => {
    const r = spawnSync(process.execPath, [BIN, ...args], { env, cwd: fx.home, encoding: "utf8" });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr };
  };
  return { fx, root, env, rig, read: (rel) => readFileSync(fx.path(rel), "utf8") };
}

