// The fixture craft pack (test/fixtures/craft-pack/) inside a fixture HOME: a repo root with the pack enabled, a
// fill that sets eng:design to fixture/design-probe, and a lock with the core seal and a vendored entry for the pack.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { treeHash } from "../lib/tree.ts";
import { fixture, repoBase, rigJson } from "./world.helpers.ts";

export const CRAFT_PACK = fileURLToPath(new URL("./fixtures/craft-pack/", import.meta.url));
export const PACK = "fixture";

/** Pack-relative path to text, for every file of the fixture craft pack. */
export function craftFiles(): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (abs: string) => {
    for (const name of readdirSync(abs).sort()) {
      const a = join(abs, name);
      if (statSync(a).isDirectory()) walk(a);
      else out[relative(CRAFT_PACK, a)] = readFileSync(a, "utf8");
    }
  };
  walk(CRAFT_PACK);
  return out;
}

export const craftManifest = () => JSON.parse(craftFiles()["pack.json"]);

const enc = new TextEncoder();
const hashOf = (files: Record<string, string>) => treeHash(Object.entries(files).map(([path, t]) => ({ path, mode: 0o644, bytes: enc.encode(t) })));

/** rig.lock.json with the core seal of the copied core and a vendored entry for each pack in `packs`. */
export function lockFor(packs: Record<string, Record<string, string>>) {
  const base = repoBase();
  const core = Object.entries(base).filter(([k]) => k.startsWith("packs/core/")).map(([k, v]) => [k.slice("packs/core/".length), String(v)]);
  const entries = Object.fromEntries(Object.entries(packs).map(([name, files]) => [name, {
    repo: `https://example.invalid/${name}.git`, sha: "0".repeat(40), root: ".", paths: ["LICENSE", "skills"], exclude: [],
    license: "MIT", tree: hashOf(files), port: null, candidate: null,
  }]));
  return { schema: 2, core: { tree: treeHash(core.map(([path, t]) => ({ path, mode: 0o644, bytes: enc.encode(t) })), { core: true }), candidate: null }, packs: entries };
}

/**
 * A fixture HOME whose repo root enables the fixture craft pack.
 * @param o.files  pack-relative overrides of the fixture pack; null drops a file
 * @param o.manifest  replaces pack.json
 * @param o.rig  top-level rig.json keys that replace the fixture keys, so a `fill` here drops the eng:design fill
 * @param o.repo  repo-root files added last
 * @param o.vendored  false: no lock entry, as for an authored pack
 * @param o.overlay  files of the overlay root ~/.config/rig
 */
export function craftFixture(o: {files?: Record<string, string | null>, manifest?: object, rig?: object, vendored?: boolean, repo?: Record<string, unknown>, overlay?: Record<string, unknown>} = {}) {
  const files: Record<string, string> = { ...craftFiles(), ...(o.manifest ? { "pack.json": `${JSON.stringify(o.manifest, null, 2)}\n` } : {}) };
  for (const [k, v] of Object.entries(o.files ?? {})) {
    if (v === null) delete files[k];
    else files[k] = v;
  }
  const rig = rigJson({ packs: { product: {}, [PACK]: {} }, fill: { "eng:design": `${PACK}/design-probe` }, ...(o.rig ?? {}) });
  const repo: Record<string, unknown> = { "rig.json": rig, "rig.lock.json": lockFor(o.vendored === false ? {} : { [PACK]: files }) };
  for (const [k, v] of Object.entries(files)) repo[`packs/${PACK}/${k}`] = v;
  const spec: any = { repo: { ...repo, ...(o.repo ?? {}) }, overlay: o.overlay ?? null };
  return fixture(spec);
}
