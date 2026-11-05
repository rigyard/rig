// rig.lock.json of one config root: read, canonical encode, update.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LockError } from "./errors.ts";
import { SCHEMA_1_MESSAGE } from "../world.ts";

export const LOCK_FILE = "rig.lock.json";

/** No core seal yet: core is null until the first `rig pin check core`, and core.tree null until `rig pin set core`. */
export const emptyLock = () => ({ schema: 2, core: null, packs: {} });

/** Read the lock of a config root; a missing file is an empty lock. The file must round-trip in canonical form. */
export function readLock(rootDir) {
  let text;
  try {
    text = readFileSync(join(rootDir, LOCK_FILE), "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return emptyLock();
    throw e;
  }
  let v;
  try {
    v = JSON.parse(text);
  } catch {
    throw new LockError("E_SCHEMA", `${LOCK_FILE} is not valid JSON`, LOCK_FILE);
  }
  if (JSON.stringify(v, null, 2) + "\n" !== text) {
    throw new LockError("E_JSON_ROUNDTRIP", `${LOCK_FILE} does not round-trip in canonical form; fix the formatting by hand`, LOCK_FILE);
  }
  if (v?.schema !== 2) throw new LockError("E_SCHEMA", v?.schema === 1 ? SCHEMA_1_MESSAGE : `${LOCK_FILE} must carry schema 2`, LOCK_FILE);
  return { schema: 2, core: v.core ?? null, packs: v.packs ?? {} };
}

const sorted = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));

/** Canonical bytes: fixed top-level order, pack names sorted. */
export function encodeLock(lock): Uint8Array {
  const v = { schema: 2, core: lock.core, packs: sorted(lock.packs) };
  return Buffer.from(JSON.stringify(v, null, 2) + "\n", "utf8");
}
