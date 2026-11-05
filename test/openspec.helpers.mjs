// Shared by the OpenSpec unit and live tests. A fixture HOME whose repo config root (RIG_ROOT, at ~/rig) is a sealed
// temp copy of this repo's data, the rig CLI with an env built from scratch, and the repo data rendered into HOME.

import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { patch, render } from "../lib/targets.mjs";
import { compose } from "../lib/stack.mjs";
import { treeHash } from "../lib/tree.mjs";
import { loadWorld } from "../lib/world.mjs";
import { makeFixtureHome } from "./helpers/fixture-home.mjs";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BIN = join(ROOT, "bin/rig.mjs");
const NOW = "2026-11-05T12:00:00.000Z";

/** The tree that `openspec init --tools claude` writes, recorded from OpenSpec 1.5.0 and re-checked by the live A8 case. */
export const INIT_CLAUDE = JSON.parse(readFileSync(join(ROOT, "test/fixtures/openspec/init-claude.json"), "utf8"));

/** @param {string} dir @returns {{path: string, mode: number, bytes: Buffer}[]} */
export function filesUnder(dir, rel = "") {
  const out = [];
  for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...filesUnder(dir, r));
    else out.push({ path: r, mode: statSync(join(dir, r)).mode & 0o777, bytes: readFileSync(join(dir, r)) });
  }
  return out;
}

/** The repo data that a config root holds, as fixture entries under `rig/`: core and every pack rig.json lists. */
function repoSpec() {
  const rig = readFileSync(join(ROOT, "rig.json"));
  const spec = { "rig/rig.json": rig };
  const packs = Object.keys(JSON.parse(rig.toString("utf8")).packs).map((name) => `packs/${name}`);
  for (const dir of ["models", "providers", "targets", "packs/core", ...packs]) {
    for (const f of filesUnder(join(ROOT, dir))) spec[`rig/${dir}/${f.path}`] = { content: f.bytes, mode: f.mode };
  }
  return spec;
}

/** Fixture entries for the OpenSpec 1.5.0 `init --tools claude` tree under prefix. Files hold a stand-in line. */
export function initTree(prefix) {
  const spec = {};
  for (const f of INIT_CLAUDE.files) spec[`${prefix}/${f}`] = `stand-in for ${f}\n`;
  for (const d of INIT_CLAUDE.dirs) spec[`${prefix}/${d}/.keep`] = "";
  return spec;
}

/**
 * A fixture HOME with a sealed repo root at ~/rig. `edit` runs on that root before the seal is written.
 * The rig env holds PATH, HOME, RIG_ROOT and RIG_NOW only, so no opt-out variable of the caller's shell leaks in.
 * @param {{home?: Record<string, any>, edit?: (root: string) => void}} [opts]
 */
export function setup({ home = {}, edit } = {}) {
  const fx = makeFixtureHome({ ...repoSpec(), ...home });
  const root = fx.path("rig");
  edit?.(root);
  const lock = { schema: 1, core: { tree: treeHash(filesUnder(join(root, "packs/core")), { core: true }), candidate: null }, packs: {}, pins: {} };
  writeFileSync(join(root, "rig.lock.json"), `${JSON.stringify(lock, null, 2)}\n`);
  const env = { PATH: process.env.PATH, HOME: fx.home, RIG_ROOT: root, RIG_NOW: NOW };
  /** @param {string[]} args @param {{env?: Record<string, string>}} [o] */
  const rig = (args, o = {}) => {
    const r = spawnSync(process.execPath, [BIN, ...args], { env: { ...env, ...o.env }, cwd: fx.home, encoding: "utf8", input: "" });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr };
  };
  /** Render the root's data and write every entry into HOME. @returns {string[]} home-relative paths written */
  const renderHome = () => {
    const world = loadWorld(env);
    const stack = compose(world);
    if (stack.errors.length) throw new Error(`compose: ${JSON.stringify(stack.errors)}`);
    const desired = render(stack, world);
    if (desired.errors.length) throw new Error(`render: ${JSON.stringify(desired.errors)}`);
    const written = [];
    for (const [abs, e] of desired.entries) {
      mkdirSync(dirname(abs), { recursive: true });
      if (e.kind === "owned" && !e.keep_header) {
        writeFileSync(abs, e.bytes);
        chmodSync(abs, e.mode);
      } else {
        // A block (the Codex and omp frame) and the other region kinds patch the current file, absent here.
        const p = patch(existsSync(abs) ? readFileSync(abs) : null, e);
        if (p.error) throw new Error(`patch ${abs}: ${p.error.code} ${p.error.message}`);
        writeFileSync(abs, p.next);
      }
      written.push(abs.slice(fx.home.length + 1));
    }
    return written.sort();
  };
  return { fx, root, env, rig, renderHome };
}

/** Rewrite one provider record under a repo root. @param {string} root @param {string} name @param {(rec: any) => any} fn */
export function editProvider(root, name, fn) {
  const file = join(root, `providers/${name}.json`);
  writeFileSync(file, `${JSON.stringify(fn(JSON.parse(readFileSync(file, "utf8"))), null, 2)}\n`);
}

/** Lines of doctor output for one topic, with the level and topic columns kept. @param {string} stdout @param {string} topic */
export const doctorTopic = (stdout, topic) => stdout.split("\n").filter((l) => new RegExp(`^\\S+ +${topic} `).test(l));
