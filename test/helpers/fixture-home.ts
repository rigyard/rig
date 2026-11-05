// Fixture HOME builder. Builds a temp HOME tree from a plain object and snapshots it.

import { createHash } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { dirname, isAbsolute, join, relative, sep } from "node:path";

/** One entry of a fixture spec. A string or bytes is a file with mode 0o644. */
export type FixtureEntry = string | Uint8Array | {content: string | Uint8Array, mode?: number} | {symlink: string};

/** @param {string} rel a path.relative() result @returns {boolean} true when it points outside its base */
const isOutside = (rel) => rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);

/**
 * Throw when dir lies inside a dot-dir of the real home (for example ~/.claude), or is the real home itself.
 * Pure over its inputs: pass realpaths.
 */
export function assertOutsideHomeDotDirs(dir: string, realHome: string) {
  const rel = relative(realHome, dir);
  if (rel === "") throw new Error(`fixture-home: refusing to build in the real home ${dir}`);
  if (isOutside(rel)) return;
  if (rel.split(sep)[0].startsWith(".")) throw new Error(`fixture-home: refusing to build under a dot-dir of the real home: ${dir}`);
}

/**
 * Build a temp HOME from spec. Keys are home-relative paths; parent dirs are created.
 */
export function makeFixtureHome(spec: Record<string, FixtureEntry> = {}): {home: string, path: (rel: string) => string, read: (rel: string) => string, snapshot: () => Map<string, {sha256: string, mode: number}>, cleanup: () => void} {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "rig-fixture-")));
  try {
    // userInfo() reads the account database, so a test that already set HOME cannot hide the real home.
    assertOutsideHomeDotDirs(root, realpathSync(userInfo().homedir));
  } catch (err) {
    rmSync(root, { recursive: true, force: true });
    throw err;
  }
  const home = join(root, "home");
  mkdirSync(home);

  const path = (rel) => {
    if (isAbsolute(rel)) throw new Error(`fixture-home: path must be home-relative: ${rel}`);
    const abs = join(home, rel);
    if (isOutside(relative(home, abs))) throw new Error(`fixture-home: path escapes home: ${rel}`);
    return abs;
  };

  for (const [rel, entry] of Object.entries(spec)) {
    const abs = path(rel);
    mkdirSync(dirname(abs), { recursive: true });
    if (typeof entry === "object" && entry !== null && "symlink" in entry) {
      symlinkSync(entry.symlink, abs);
      continue;
    }
    const isPlain = typeof entry === "string" || entry instanceof Uint8Array;
    const content = isPlain ? entry : entry.content;
    const mode = isPlain ? 0o644 : (entry.mode ?? 0o644);
    writeFileSync(abs, content);
    chmodSync(abs, mode); // explicit chmod: the umask must not change the mode a snapshot sees
  }

  const read = (rel) => readFileSync(path(rel), "utf8");

  const snapshot = () => {
    /** @type {Map<string, {sha256: string, mode: number}>} */
    const out = new Map();
    const walk = (dir) => {
      for (const name of readdirSync(dir).sort()) {
        const abs = join(dir, name);
        const st = lstatSync(abs);
        if (st.isDirectory()) walk(abs);
        else if (st.isFile()) {
          const sha256 = createHash("sha256").update(readFileSync(abs)).digest("hex");
          out.set(relative(home, abs).split(sep).join("/"), { sha256, mode: st.mode & 0o7777 });
        }
      }
    };
    walk(home);
    return out;
  };

  const cleanup = () => rmSync(root, { recursive: true, force: true });

  return { home, path, read, snapshot, cleanup };
}
