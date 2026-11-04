// The read side of world: JSON files, pack trees, home paths. Nothing here writes.

import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import { RigError } from "./errors.mjs";
import { check } from "./schema.mjs";

/**
 * Read and check one JSON config file.
 * @param {string} abs @param {string} file  the name errors show @param {object} spec @param {{optional?: boolean}} [o]
 * @returns {any} canonical value, or undefined when optional and absent
 */
export function readConfig(abs, file, spec, o = {}) {
  if (!existsSync(abs)) {
    if (o.optional) return undefined;
    throw new RigError("E_SCHEMA", "file is missing", { file });
  }
  let value;
  try {
    value = JSON.parse(readFileSync(abs, "utf8"));
  } catch (err) {
    throw new RigError("E_SCHEMA", `not valid JSON: ${err.message}`, { file });
  }
  return check(spec, value, file);
}

/**
 * Every file under dir, keyed by its relative POSIX path, sorted. A symlink is recorded, not followed:
 * its bytes are the link text and its mode keeps the S_IFLNK bits, so the gate sees it.
 * @param {string} dir @returns {Map<string, {bytes: Uint8Array, mode: number}>}
 */
export function readTree(dir) {
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

/** `<home>/x` -> `~/x`, so keys never carry the user name. @param {string} abs @param {string} home */
export const homeRelative = (abs, home) => (abs === home ? "~" : abs.startsWith(`${home}/`) ? `~/${abs.slice(home.length + 1)}` : abs);

/** @param {string} abs @returns {Uint8Array | null} */
export function readBytes(abs) {
  try {
    return lstatSync(abs).isFile() ? readFileSync(abs) : null;
  } catch {
    return null;
  }
}
