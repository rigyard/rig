// Fixtures for the pstack model rules tests: a fixture HOME whose repo root (~/rig) is a temp copy of this repo's
// models, targets and core, with a stub pstack pack that declares the pstack model rules in pack.json
// `model_surfaces`, a sealed core, and a runner for bin/rig.ts with HOME set to it.

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { treeHash } from "../lib/tree.ts";
import { makeFixtureHome } from "./helpers/fixture-home.ts";
import { authoredEntry } from "./world.helpers.ts";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BIN = join(ROOT, "bin/rig.ts");
const NOW = "2026-11-05T12:00:00.000Z";

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

const STUB_FILES = { "skills/how/SKILL.md": "---\nname: how\ndescription: A stub skill of the pstack fixture.\n---\nStub.\n" };

/**
 * A stub of the seeded pstack pack: the repo pack.json without `mode`, so it keeps `model_surfaces`, and one skill.
 * The full seed renders only in the first-seed tests. `rig` is this repo's rig.json with pstack as the only pack.
 */
export function stubPstack(): {spec: Record<string, string>, rig: Record<string, unknown>, lock: Record<string, object>} {
  const manifest = repoJson("packs/pstack/pack.json");
  delete manifest.mode;
  const spec: Record<string, string> = { "rig/packs/pstack/pack.json": json(manifest) };
  for (const [rel, text] of Object.entries(STUB_FILES)) spec[`rig/packs/pstack/${rel}`] = text;
  return { spec, rig: { ...repoJson("rig.json"), packs: { pstack: {} }, fill: {} }, lock: { pstack: authoredEntry("pstack", STUB_FILES) } };
}

/**
 * A fixture HOME with a sealed repo root at ~/rig: this repo's models, targets and core, and the stub pstack pack.
 * @param {{home?: Record<string, any>}} [opts]
 */
export function setup({ home = {} } = {}) {
  const stub = stubPstack();
  const spec: Record<string, string | {content: Buffer, mode: number}> = { "rig/rig.json": json(stub.rig), ...stub.spec };
  for (const dir of ["models", "targets", "packs/core"]) {
    for (const f of filesUnder(join(ROOT, dir))) spec[`rig/${dir}/${f.path}`] = { content: f.bytes, mode: f.mode };
  }
  const fx = makeFixtureHome({ ...spec, ...home });
  const root = fx.path("rig");
  const lock = { schema: 2, core: { tree: treeHash(filesUnder(join(root, "packs/core")), { core: true }), candidate: null }, packs: stub.lock };
  writeFileSync(join(root, "rig.lock.json"), json(lock));
  const env = { PATH: process.env.PATH, HOME: fx.home, RIG_ROOT: root, RIG_NOW: NOW };
  /** @param {string[]} args */
  const rig = (args) => {
    const r = spawnSync(process.execPath, [BIN, ...args], { env, cwd: fx.home, encoding: "utf8" });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr };
  };
  return { fx, root, env, rig, read: (rel) => readFileSync(fx.path(rel), "utf8") };
}

