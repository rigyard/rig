// The read side of world: JSON files, pack trees, home paths. Nothing here writes.

import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync } from "node:fs";
import { isAbsolute, join, posix } from "node:path";
import { RigError } from "./errors.ts";
import { check } from "./schema.ts";

/**
 * Read and check one JSON config file.
 * @param file  the name errors show @returns canonical value, or undefined when optional and absent
 */
export function readConfig(abs: string, file: string, spec: object, o: {optional?: boolean} = {}): any {
  if (!existsSync(abs)) {
    if (o.optional) return undefined;
    throw new RigError("E_SCHEMA", "file is missing", { file });
  }
  let text;
  try {
    text = readFileSync(abs, "utf8");
  } catch (err) {
    throw new RigError("E_SCHEMA", `not valid JSON: ${err.message}`, { file });
  }
  return parseConfig(text, file, spec);
}

/** Parse and check the text of one JSON config file. */
export function parseConfig(text: string, file: string, spec: object): any {
  let value;
  try {
    value = JSON.parse(text);
  } catch (err) {
    throw new RigError("E_SCHEMA", `not valid JSON: ${err.message}`, { file });
  }
  return check(spec, value, file);
}

/**
 * Every file under dir, keyed by its relative POSIX path, sorted. A symlink is recorded, not followed:
 * its bytes are the link text and its mode keeps the S_IFLNK bits, so the gate sees it.
 */
export function readTree(dir: string): Map<string, {bytes: Uint8Array, mode: number}> {
  const out = new Map();
  const walk = (abs, rel) => {
    for (const name of readdirSync(abs).sort()) {
      const a = join(abs, name);
      const r = rel ? `${rel}/${name}` : name;
      const st = lstatSync(a);
      if (st.isSymbolicLink()) out.set(r, { bytes: Buffer.from(readlinkSync(a), "utf8"), mode: st.mode });
      else if (st.isDirectory()) walk(a, r);
      else if (st.isFile()) out.set(r, { bytes: readFileSync(a), mode: st.mode });
    }
  };
  walk(dir, "");
  return out;
}

/** `~/x` -> `<home>/x`. Other paths pass through. @param {string} p @param {string} home */
export const expandHome = (p, home) => (p === "~" ? home : p.startsWith("~/") ? join(home, p.slice(2)) : p);

/**
 * Every dir a target record declares: its root, unit dirs, read-set dirs and the dir of each file path it names.
 * Pruning an emptied dir never removes one of these, nor an ancestor of one. Only "~/" and absolute paths count.
 */
export function declaredDirs(t): string[] {
  const dirs = [
    t.root,
    t.transcripts?.root,
    ...(t.reads?.skills ?? []).map((s) => s?.path),
    ...Object.values(t.units ?? {}).map((u: any) => u?.dir),
  ];
  const files = [
    t.instructions?.path,
    t.plugin_manifest?.path,
    t.skill_registry?.path,
    ...(t.model_surfaces ?? []).map((s) => s?.path),
    ...Object.values(t.hooks ?? {}).map((h: any) => h?.file),
  ];
  const all = [...dirs, ...files.map((f) => (typeof f === "string" ? posix.dirname(f) : undefined))];
  return [...new Set(all.filter((d): d is string => typeof d === "string" && (d.startsWith("~/") || isAbsolute(d))))];
}

/** `<home>/x` -> `~/x`, so keys never carry the user name. @param {string} abs @param {string} home */
export const homeRelative = (abs, home) => (abs === home ? "~" : abs.startsWith(`${home}/`) ? `~/${abs.slice(home.length + 1)}` : abs);

export function readBytes(abs: string): Uint8Array | null {
  try {
    return lstatSync(abs).isFile() ? readFileSync(abs) : null;
  } catch {
    return null;
  }
}
