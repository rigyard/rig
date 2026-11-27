// Fixtures for the scope tests: a fixture HOME whose repo root (~/rig) is a temp copy of this repo's data plus one
// repo pack `notes`, and a runner for bin/rig.ts with HOME set to it.

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
export const STATE = ".local/state/rig/";
export const MARKET = ".local/share/rig/marketplace";
export const APP = "src/app";
export const canon = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;

export const NOTES_SKILL = "---\nname: notes\ndescription: Take meeting notes.\n---\nWrite the notes.\n";
export const TIDY_CMD = "---\ndescription: Tidy the notes.\n---\nTidy them.\n";
export const STYLE_RULE = "Use short lines.\n";

export function filesUnder(dir: string, rel = ""): {path: string, mode: number, bytes: Buffer}[] {
  const out: {path: string, mode: number, bytes: Buffer}[] = [];
  for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...filesUnder(dir, r));
    else out.push({ path: r, mode: statSync(join(dir, r)).mode & 0o777, bytes: readFileSync(join(dir, r)) });
  }
  return out;
}

const notesFiles = (skill: string, tidy: string) => ({ "skills/notes/SKILL.md": skill, "commands/tidy.md": tidy, "rules/style.md": STYLE_RULE });

export type Entry = {scope?: string, projects?: string[], harnesses?: string[]};

/**
 * A fixture HOME with a sealed repo root at ~/rig and one repo pack `notes` (skill notes, command tidy, rule style)
 * whose pack.json lists `scopes`. `entry` is its rig.json entry. ~/src/app is a project dir with one file.
 * The result also carries `env`, for a harness run beside rig.
 */
export function setup({ entry = {}, scopes = ["machine-hidden", "project", "hybrid"], rig: rigCfg = {}, home = {}, skill = NOTES_SKILL, tidy = TIDY_CMD }: {entry?: Entry, scopes?: string[], rig?: Record<string, unknown>, home?: Record<string, string>, skill?: string, tidy?: string} = {}) {
  const cfg = JSON.parse(readFileSync(join(ROOT, "rig.json"), "utf8"));
  const final = { ...cfg, fill: {}, disable: [], ...rigCfg, packs: { notes: entry } };
  const spec: Record<string, string | {content: Uint8Array, mode: number}> = { "rig/rig.json": canon(final) };
  for (const dir of ["models", "targets", "packs/core"]) {
    for (const f of filesUnder(join(ROOT, dir))) spec[`rig/${dir}/${f.path}`] = { content: f.bytes, mode: f.mode };
  }
  spec["rig/packs/notes/pack.json"] = canon({ schema: 2, name: "notes", scopes, license: "MIT" });
  for (const [path, text] of Object.entries(notesFiles(skill, tidy))) spec[`rig/packs/notes/${path}`] = text;
  spec[`${APP}/README.md`] = "# app\n";
  const fx = makeFixtureHome({ ...spec, ...home });
  const root = fx.path("rig");
  const lock = { schema: 2, core: { tree: treeHash(filesUnder(join(root, "packs/core")), { core: true }), candidate: null }, packs: { notes: authoredEntry("notes", notesFiles(skill, tidy)) } };
  writeFileSync(join(root, "rig.lock.json"), canon(lock));
  const env = { PATH: process.env.PATH, HOME: fx.home, RIG_ROOT: root, RIG_NOW: NOW };
  const rig = (args: string[]) => {
    const r = spawnSync(process.execPath, [BIN, ...args], { env, cwd: fx.home, encoding: "utf8", input: "" });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr, all: r.stdout + r.stderr };
  };
  const projectTree = () => treeHash(filesUnder(fx.path(APP)), { core: true });
  return { fx, root, env, rig, projectTree };
}
