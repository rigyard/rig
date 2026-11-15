// lib/fs.ts — contained primitives. Each export has an import allowlist (boundary test).
// The only module that imports the write functions of node:fs.
//
// writeHome, writeState, appendState and log take a context as their last argument, so no logic
// reads os.homedir():  ctx = {home, state, neverWrite?: string[], readSets?: string[], keepDirs?: string[]}
// home and state are absolute paths; neverWrite holds globs, readSets and keepDirs hold dirs (keepDirs: the dirs that
// pruning keeps with their ancestors), all "~/"-relative or absolute.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function rigError(code, message, p) {
  const e = new Error(message);
  e.code = code;
  if (p !== undefined) e.path = p;
  return e;
}

const inside = (root, p) => {
  const rel = path.relative(root, p);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};
const strictlyInside = (root, p) => p !== root && inside(root, p);
const expand = (home, p) => (p === "~" ? home : p.startsWith("~/") ? path.join(home, p.slice(2)) : p);

/** realpath of the deepest existing ancestor, plus the missing tail appended lexically. */
function realish(p) {
  let cur = p;
  const tail = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(cur), ...tail.reverse());
    } catch (e) {
      if (e.code !== "ENOENT" && e.code !== "ENOTDIR") throw e;
      const up = path.dirname(cur);
      if (up === cur) return p;
      tail.push(path.basename(cur));
      cur = up;
    }
  }
}

function globRe(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      re += ".*";
      i++;
      if (glob[i + 1] === "/") i++;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}
/** A glob without wildcards also covers everything below it. */
function globMatch(glob, p) {
  if (!/[*?]/.test(glob)) return inside(glob, p);
  return globRe(glob).test(p);
}

function realHome(ctx) {
  if (!ctx || typeof ctx.home !== "string" || !path.isAbsolute(ctx.home)) {
    throw rigError("E_CONTAINMENT", "fs context has no absolute home");
  }
  return fs.realpathSync.native(ctx.home);
}

/**
 * Throws E_CONTAINMENT when a dir of rel below its first segment is a symlink, such as ~/.claude/skills/how -> ~/mine/how.
 * rig owns no symlink, so a write through one lands in a dir that rig does not own. The first segment may be a link
 * (~/.codex -> ~/dotfiles/codex), so a dotfiles checkout of a whole harness dir still works.
 */
function linkedDir(rh: string, rel: string, p: string) {
  const parts = path.dirname(rel).split(path.sep).filter((x) => x !== "" && x !== ".");
  for (let i = 2; i <= parts.length; i++) {
    const dir = path.join(rh, ...parts.slice(0, i));
    let st;
    try {
      st = fs.lstatSync(dir);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") return;
      throw e;
    }
    if (st.isSymbolicLink()) {
      const link = `~/${parts.slice(0, i).join("/")}`;
      throw rigError("E_CONTAINMENT", `${link} is a symlink to ${fs.readlinkSync(dir)}, so ~/${rel.split(path.sep).join("/")} would land in a dir that rig does not own; rig writes nothing through a symlink, so replace the link with a real dir by hand`, p);
    }
  }
}

/**
 * Read-only containment check for a path in HOME. Throws E_CONTAINMENT.
 * Refuses: a path outside HOME, a parent chain whose realpath leaves HOME, a symlinked dir below the first segment,
 * a never_write match (lexical or real), a symlink or a non-file at the path, and a path inside the state root.
 * @param {string} p absolute or "~/"-relative @param {object} ctx
 * @returns {{abs: string, tilde: string, rel: string}}
 */
function resolveHome(p, ctx) {
  const rh = realHome(ctx);
  if (typeof p !== "string" || (!path.isAbsolute(p) && !p.startsWith("~/"))) {
    throw rigError("E_CONTAINMENT", `not an absolute or ~/ path: ${p}`, String(p));
  }
  const abs = path.resolve(expand(ctx.home, p));
  const lexHome = path.resolve(ctx.home);
  let rel;
  if (strictlyInside(lexHome, abs)) rel = path.relative(lexHome, abs);
  else if (strictlyInside(rh, abs)) rel = path.relative(rh, abs);
  else throw rigError("E_CONTAINMENT", `outside HOME: ${p}`, p);
  const lexAbs = path.join(rh, rel);
  const realParent = realish(path.dirname(lexAbs));
  if (!inside(rh, realParent)) throw rigError("E_CONTAINMENT", `a parent of ${p} resolves outside HOME`, p);
  linkedDir(rh, rel, p);
  const realAbs = path.join(realParent, path.basename(lexAbs));
  for (const g of ctx.neverWrite ?? []) {
    const ga = expand(ctx.home, g);
    const gr = path.join(rh, path.relative(lexHome, ga));
    if (globMatch(ga, abs) || globMatch(gr, lexAbs) || globMatch(gr, realAbs)) {
      throw rigError("E_CONTAINMENT", `${p} matches never_write ${g}`, p);
    }
  }
  if (ctx.state) {
    const rs = realish(ctx.state);
    if (inside(rs, realAbs) || inside(path.resolve(ctx.state), abs)) {
      throw rigError("E_CONTAINMENT", `${p} is inside the state root`, p);
    }
  }
  let st = null;
  try {
    st = fs.lstatSync(realAbs);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  if (st && !st.isFile()) throw rigError("E_CONTAINMENT", `${p} is a symlink or not a regular file`, p);
  return { abs: realAbs, tilde: `~/${rel.split(path.sep).join("/")}`, rel };
}

function fsyncDir(dir) {
  let fd;
  try {
    fd = fs.openSync(dir, "r");
    fs.fsyncSync(fd);
  } catch {
    // some platforms refuse fsync on a directory; the rename is still atomic
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/** mkdir -p. @returns the dirs whose entries change: dir, each dir that this created, and the parent of the first one */
function mkdirs(dir: string): string[] {
  const first = fs.mkdirSync(dir, { recursive: true });
  const out = [dir];
  if (first === undefined) return out;
  for (let d = dir; d !== first && path.dirname(d) !== d; ) {
    d = path.dirname(d);
    out.push(d);
  }
  out.push(path.dirname(first));
  return out;
}

/** A temp file in the dir of abs with the exact mode, fsynced when sync. @returns its path */
function writeTemp(abs: string, bytes: Uint8Array, mode: number, sync: boolean): string {
  const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.${process.pid}-${Math.random().toString(36).slice(2, 10)}.rig-tmp`);
  const fd = fs.openSync(tmp, "wx", 0o600);
  try {
    fs.writeSync(fd, bytes);
    fs.fchmodSync(fd, mode);
    if (sync) fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return tmp;
}

/**
 * temp file in the same dir, fsync, exact mode, then rename (or link when exclusive), then fsync each dir whose entries
 * changed. sync false skips both fsyncs, and the caller passes abs and dirs to fsyncAll.
 */
function atomicWrite(abs: string, bytes: Uint8Array, mode: number, exclusive: boolean, sync = true): {abs: string, dirs: string[]} {
  const dirs = mkdirs(path.dirname(abs));
  const tmp = writeTemp(abs, bytes, mode, sync);
  try {
    if (exclusive) fs.linkSync(tmp, abs);
    else fs.renameSync(tmp, abs);
  } finally {
    if (exclusive) fs.rmSync(tmp, { force: true });
  }
  if (sync) for (const d of dirs) fsyncDir(d);
  return { abs, dirs };
}

function modeOf(abs, dflt) {
  try {
    return fs.statSync(abs).mode & 0o7777;
  } catch {
    return dflt;
  }
}

/**
 * After an unlink, rmdir the dirs it left empty, from the dir of the file upwards. Best effort: the walk stops, and
 * never throws, at the first dir that cannot go (not empty, a symlink, not a dir, or any lstat or rmdir error such as
 * EACCES). It also stops at a dir that matches never_write, equals or holds a ctx.keepDirs entry (a dir that a target
 * declares), or is HOME, a child of HOME or a grandchild of HOME (by the path as given, so ~/.claude/skills survives
 * when ~/.claude is a link).
 * @returns the deepest dir that is still there: its entries changed
 */
function pruneEmptyDirs(abs: string, rel: string, ctx): string {
  const rh = realHome(ctx);
  const lexHome = path.resolve(ctx.home);
  let dir = path.dirname(abs);
  let lexRel = path.dirname(rel);
  for (let depth = lexRel.split(path.sep).length; depth > 2; depth--, dir = path.dirname(dir), lexRel = path.dirname(lexRel)) {
    const ignored = (ctx.neverWrite ?? []).some((g) => {
      const ga = expand(ctx.home, g);
      const gr = path.join(rh, path.relative(lexHome, ga));
      return globMatch(ga, path.join(lexHome, lexRel)) || globMatch(gr, path.join(rh, lexRel)) || globMatch(gr, dir);
    });
    const kept = (ctx.keepDirs ?? []).some((k) => {
      const ka = expand(ctx.home, k);
      const kr = path.join(rh, path.relative(lexHome, ka));
      return inside(path.join(lexHome, lexRel), ka) || inside(path.join(rh, lexRel), kr) || inside(dir, kr);
    });
    if (ignored || kept) break;
    try {
      if (!fs.lstatSync(dir).isDirectory()) break;
      fs.rmdirSync(dir);
    } catch {
      break;
    }
  }
  return dir;
}

/**
 * Atomic write into HOME, or a contained unlink when bytes is null. Mode kept: an omitted mode keeps the
 * current file's mode (0644 for a new file). opts.check: run the containment checks only and write nothing,
 * so plan, recovery and undo can refuse a path before the first write. opts.sync false: no fsync, and the caller
 * syncs the dir with fsyncAll. opts.prune: after the unlink, also remove the dirs it leaves empty (see pruneEmptyDirs
 * for what it keeps); the result's dir is then the deepest dir still there, and the caller syncs that one.
 * Allowed importer: lib/state.ts (and lib/state/*).
 * @param p absolute or "~/"-relative
 */
export function writeHome(p: string, bytes: Uint8Array | null, mode: number | undefined, ctx: object, opts: {check?: boolean, sync?: boolean, prune?: boolean} = {}): {abs: string, tilde: string, rel: string, dir?: string} {
  const r = resolveHome(p, ctx);
  if (opts.check) return r;
  if (bytes === null) {
    fs.rmSync(r.abs, { force: true });
    const dir = opts.prune ? pruneEmptyDirs(r.abs, r.rel, ctx) : path.dirname(r.abs);
    if (opts.sync !== false) fsyncDir(dir);
    return { ...r, dir };
  }
  atomicWrite(r.abs, bytes, mode ?? modeOf(r.abs, 0o644), false, opts.sync !== false);
  return r;
}

/** A temp file next to its HOME target: written, not yet durable, not yet in place. dirs change when it is renamed. */
type Staged = {abs: string, tilde: string, rel: string, tmp: string, dirs: string[]};

/**
 * The first half of writeHome for a batch: the containment checks, then the temp file with the exact mode. No fsync
 * and no rename: the caller makes every tmp durable with fsyncAll, renames each with installHome, then syncs the dirs.
 * Allowed importer: state.
 */
export function stageHome(p: string, bytes: Uint8Array, mode: number | undefined, ctx: object): Staged {
  const r = resolveHome(p, ctx);
  const dirs = mkdirs(path.dirname(r.abs));
  return { ...r, tmp: writeTemp(r.abs, bytes, mode ?? modeOf(r.abs, 0o644), false), dirs };
}

/** The second half: the containment checks again, then the rename of the staged temp onto its target. No fsync. */
export function installHome(s: Staged, ctx: object): void {
  const r = resolveHome(s.tilde, ctx);
  if (r.abs !== s.abs) {
    throw rigError("E_CONTAINMENT", `${s.tilde} resolves to another path than when it was staged`, s.tilde);
  }
  fs.renameSync(s.tmp, r.abs);
}

/** A dir that refuses fsync is skipped, as in fsyncDir. */
function fsyncPath(p: string, dir: boolean): void {
  if (dir) return fsyncDir(p);
  const fd = fs.openSync(p, "r");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

const BATCH = fileURLToPath(new URL("./fs/fsync-batch.ts", import.meta.url));
/** Below this many paths, fsync one by one: that costs less than the start of the batch child. */
const MIN_BATCH = 16;

type Failure = {code: string, message: string};
const OUT_OF_FDS = new Set(["EMFILE", "ENFILE"]);

/** The error per path from the batch child, or null when the child did not run to the end or ran out of fds. */
function fsyncBatch(paths: string[]): (Failure | null)[] | null {
  const r = spawnSync(process.execPath, [BATCH], {
    input: JSON.stringify({ paths }), encoding: "utf8", timeout: 60_000, killSignal: "SIGKILL",
    env: { ...process.env, UV_THREADPOOL_SIZE: "16" },
  });
  if (r.status !== 0) return null;
  let out: unknown;
  try {
    out = JSON.parse(r.stdout);
  } catch {
    return null;
  }
  if (!Array.isArray(out) || out.length !== paths.length) return null;
  return out.some((f) => OUT_OF_FDS.has(f?.code)) ? null : out;
}

/**
 * Make files and dirs durable, and block until all are. A child process fsyncs the paths concurrently: each fsync
 * waits for a disk flush, and the disk merges flushes that run at the same time. A file that fails to sync throws;
 * a dir that refuses fsync is skipped. When the child itself fails or runs out of fds, this thread syncs each path.
 * Allowed importer: state.
 */
export function fsyncAll(files: string[], dirs: string[] = []): void {
  const paths = [...files, ...dirs];
  const failures = paths.length >= MIN_BATCH ? fsyncBatch(paths) : null;
  if (!failures) {
    paths.forEach((p, i) => fsyncPath(p, i >= files.length));
    return;
  }
  const bad = failures.findIndex((f, i) => f !== null && i < files.length);
  if (bad >= 0) throw Object.assign(new Error(failures[bad]!.message), { code: failures[bad]!.code, path: paths[bad] });
}

function resolveState(rel, ctx) {
  const rh = realHome(ctx);
  if (!ctx.state || !path.isAbsolute(ctx.state)) throw rigError("E_STATE_ROOT", "fs context has no absolute state root");
  const rs = realish(ctx.state);
  if (!strictlyInside(path.resolve(ctx.home), path.resolve(ctx.state)) || !strictlyInside(rh, rs)) {
    throw rigError("E_STATE_ROOT", `the state root ${ctx.state} does not resolve inside HOME`, ctx.state);
  }
  if (typeof rel !== "string" || rel === "" || path.isAbsolute(rel) || rel.split(/[\\/]/).some((s) => s === ".." || s === "")) {
    throw rigError("E_CONTAINMENT", `bad state path: ${rel}`, String(rel));
  }
  const abs = path.join(rs, rel);
  const realParent = realish(path.dirname(abs));
  if (!inside(rs, realParent)) throw rigError("E_CONTAINMENT", `${rel} resolves outside the state root`, rel);
  const realAbs = path.join(realParent, path.basename(abs));
  for (const d of ctx.readSets ?? []) {
    const da = expand(ctx.home, d);
    if (inside(realish(da), realAbs) || inside(path.resolve(da), path.join(path.resolve(ctx.state), rel))) {
      throw rigError("E_STATE_IN_READSET", `state path ${rel} lies inside the read-set dir ${d}`, rel);
    }
  }
  let st = null;
  try {
    st = fs.lstatSync(realAbs);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  if (st && !st.isFile()) throw rigError("E_CONTAINMENT", `${rel} is a symlink or not a regular file`, rel);
  return realAbs;
}

/**
 * Atomic write under the state root, or a contained unlink when bytes is null. Refuses a path inside any read-set.
 * opts.exclusive: fail with EEXIST when the file exists (the target appears complete or not at all).
 * opts.sync false: no fsync, and the caller passes the returned abs and dirs to fsyncAll.
 * Allowed importers: state, metrics, gate.
 */
export function writeState(rel: string, bytes: Uint8Array | null, ctx: object, opts: {mode?: number, exclusive?: boolean, sync?: boolean} = {}): {abs: string, dirs: string[]} {
  const abs = resolveState(rel, ctx);
  if (bytes === null) {
    fs.rmSync(abs, { force: true });
    return { abs, dirs: [] };
  }
  return atomicWrite(abs, bytes, opts.mode ?? 0o600, Boolean(opts.exclusive), opts.sync !== false);
}

/** One O_APPEND write plus fsync under the state root. A missing final newline is added. */
export function appendState(rel, line, ctx) {
  const abs = resolveState(rel, ctx);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const text = String(line);
  const fd = fs.openSync(abs, "a", 0o600);
  try {
    fs.writeSync(fd, text.endsWith("\n") ? text : `${text}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Atomic write into a config root, or a contained unlink when bytes is null. The unlink also removes the parent
 * folders that it leaves empty, up to the root, so a file can take the place of a folder. The path must resolve
 * inside the root.
 * An omitted mode keeps the current file's mode (0644 for a new file); lock passes the git mode so a vendored 755
 * file keeps its exec bit. Allowed importers: lock, models.
 * @param root absolute
 */
export function writeConfig(root: string, rel: string, bytes: Uint8Array | null, mode?: number) {
  if (typeof root !== "string" || !path.isAbsolute(root)) throw rigError("E_CONTAINMENT", "config root is not absolute");
  if (typeof rel !== "string" || rel === "" || path.isAbsolute(rel) || rel.split(/[\\/]/).some((s) => s === ".." || s === "")) {
    throw rigError("E_CONTAINMENT", `bad config path: ${rel}`, String(rel));
  }
  const rr = fs.realpathSync.native(root);
  const abs = path.join(rr, rel);
  if (!inside(rr, realish(path.dirname(abs)))) throw rigError("E_CONTAINMENT", `${rel} resolves outside ${root}`, rel);
  let st = null;
  try {
    st = fs.lstatSync(abs);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  if (st && !st.isFile()) throw rigError("E_CONTAINMENT", `${rel} is a symlink or not a regular file`, rel);
  if (bytes === null) {
    fs.rmSync(abs, { force: true });
    let dir = path.dirname(abs);
    for (; strictlyInside(rr, dir); dir = path.dirname(dir)) {
      try {
        fs.rmdirSync(dir);
      } catch (e) {
        if (["ENOTEMPTY", "EEXIST", "ENOENT", "ENOTDIR"].includes((e as NodeJS.ErrnoException).code ?? "")) break;
        throw e;
      }
    }
    fsyncDir(dir);
    return;
  }
  atomicWrite(abs, bytes, mode ?? modeOf(abs, 0o644), false);
}

/** The one logger: one JSON line in log/rig.log. Never plan or doctor. */
export function log(event, ctx) {
  appendState("log/rig.log", JSON.stringify({ ts: new Date().toISOString(), ...event }), ctx);
}
