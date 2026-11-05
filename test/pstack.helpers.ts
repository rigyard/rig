// Fixtures for the pstack model rules tests: a fixture HOME whose repo root (~/rig) is a temp copy of this repo's
// data plus a `pstack` pack that declares the pstack model rules in pack.json `model_surfaces`, with a sealed core,
// and a runner for bin/rig.ts with HOME set to it.

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { treeHash } from "../lib/tree.ts";
import { makeFixtureHome } from "./helpers/fixture-home.ts";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BIN = join(ROOT, "bin/rig.ts");
const NOW = "2026-11-05T12:00:00.000Z";

export const PSTACK_PACK = {
  schema: 2,
  name: "pstack",
  license: "MIT",
  model_surfaces: [
    { path: "~/.claude/rules/pstack-models.md", harness: "claude", consumer: "pstack", kind: "whole", keep_header: true, grammar: "{model} {effort}" },
    { path: "~/.cursor/rules/pstack-models.mdc", harness: "cursor", consumer: "pstack", kind: "whole", keep_header: true, grammar: "{model_effort}", effort_syntax: "dash-fused" },
  ],
};

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
 * A fixture HOME with a sealed repo root at ~/rig whose rig.json lists the fixture pstack pack.
 * @param {{home?: Record<string, any>}} [opts]
 */
export function setup({ home = {} } = {}) {
  const cfg = repoJson("rig.json");
  const spec = { "rig/rig.json": json({ ...cfg, packs: { ...cfg.packs, pstack: {} } }), "rig/packs/pstack/pack.json": json(PSTACK_PACK) };
  const packs = Object.keys(cfg.packs).map((name) => `packs/${name}`);
  for (const dir of ["models", "targets", "packs/core", ...packs]) {
    for (const f of filesUnder(join(ROOT, dir))) spec[`rig/${dir}/${f.path}`] = { content: f.bytes, mode: f.mode };
  }
  const fx = makeFixtureHome({ ...spec, ...home });
  const root = fx.path("rig");
  const lock = { schema: 2, core: { tree: treeHash(filesUnder(join(root, "packs/core")), { core: true }), candidate: null }, packs: {} };
  writeFileSync(join(root, "rig.lock.json"), json(lock));
  const env = { PATH: process.env.PATH, HOME: fx.home, RIG_ROOT: root, RIG_NOW: NOW };
  /** @param {string[]} args */
  const rig = (args) => {
    const r = spawnSync(process.execPath, [BIN, ...args], { env, cwd: fx.home, encoding: "utf8" });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr };
  };
  return { fx, root, env, rig, read: (rel) => readFileSync(fx.path(rel), "utf8") };
}

