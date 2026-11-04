// Read a directory of a config root as a flat file list. Symlinks are refused, never followed.
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LockError } from "./errors.mjs";

/** @param {string} dir @returns {{path: string, mode: number, bytes: Uint8Array}[] | null}  null when `dir` is absent */
export function readTreeFromDisk(dir) {
  let st;
  try {
    st = lstatSync(dir);
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
  if (!st.isDirectory()) throw new LockError("E_PACK_EXISTS", `${dir} is not a directory`);
  const out = [];
  const walk = (abs, rel) => {
    for (const ent of readdirSync(abs).sort()) {
      const p = join(abs, ent);
      const r = rel ? `${rel}/${ent}` : ent;
      const s = lstatSync(p);
      if (s.isSymbolicLink()) throw new LockError("E_LOCK_SYMLINK", `symlink in ${r}`, r);
      if (s.isDirectory()) walk(p, r);
      else if (s.isFile()) out.push({ path: r, mode: s.mode & 0o777, bytes: readFileSync(p) });
    }
  };
  walk(dir, "");
  return out;
}
