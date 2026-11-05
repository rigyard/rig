// lib/lock.ts: the lock per config root, vendoring, pin check and pin set of core. The only module that spawns git.
// Everything fetched is read from git's object store as bytes. Nothing from a fetched tree is run.
import { basename, join, posix } from "node:path";
import { writeConfig as fsWriteConfig } from "./fs.ts";
import { treeHash } from "./tree.ts";
import { LockError } from "./lock/errors.ts";
import { readBlobs, withClone } from "./lock/git.ts";
import type { TreeEntry } from "./lock/git.ts";
import { readTreeFromDisk } from "./lock/disk.ts";
import { readLock, encodeLock, LOCK_FILE } from "./lock/lockfile.ts";
import { ID } from "./world.ts";
import { NO_LICENSE, isLicenseFile, licenseFromPackageJson, licenseFromText } from "./lock/license.ts";


const ROOTS = ["repo", "overlay"];
const canonicalJson = (v) => Buffer.from(JSON.stringify(v, null, 2) + "\n", "utf8");

function rootDir(world, root) {
  const dir = world.roots?.[root];
  if (!dir) throw new LockError("E_USAGE", `no ${root} config root is available`);
  return dir;
}

function writerOf(world) {
  return world.writeConfig ?? fsWriteConfig;
}

function normalizePath(p) {
  if (typeof p !== "string" || p === "" || p.includes("\0")) throw new LockError("E_USAGE", `bad path: ${JSON.stringify(p)}`);
  const n = posix.normalize(p).replace(/\/+$/, "");
  if (n === "" || n === ".") return ".";
  if (n.startsWith("/") || n === ".." || n.startsWith("../")) throw new LockError("E_USAGE", `path must stay inside the repo: ${p}`);
  return n;
}

function packNameFor(repo: string, root: string, name: string | undefined): string {
  const n = name ?? (root === "." ? basename(repo.replace(/\/+$/, "")).replace(/\.git$/, "") : basename(root));
  if (!ID.test(n) || n === "core") {
    throw new LockError("E_USAGE", `bad pack name ${JSON.stringify(n)}: use lowercase letters and digits, joined by single hyphens, and not core; pass --name`);
  }
  return n;
}

const under = (path: string, prefix: string) => prefix === "." || path === prefix || path.startsWith(prefix + "/");

function select(entries: TreeEntry[], root: string, paths: string[], exclude: string[]): {picked: Map<string, TreeEntry>, excludedBytes: number} {
  const picked = new Map<string, TreeEntry>();
  for (const p of paths) {
    let hits = 0;
    for (const e of entries) {
      if (root !== "." && !e.path.startsWith(root + "/")) continue;
      const rel = root === "." ? e.path : e.path.slice(root.length + 1);
      if (!under(rel, p)) continue;
      picked.set(rel, e);
      hits++;
    }
    if (hits === 0) throw new LockError("E_PATH_MISSING", `path ${p} is not under ${root} in the repo at this commit`, p);
  }
  const rels = [...picked.keys()];
  for (const x of exclude) {
    if (!rels.some((rel) => under(rel, x))) throw new LockError("E_PATH_MISSING", `exclude ${x} matches no vendored path at this commit`, x);
  }
  let excludedBytes = 0;
  for (const rel of rels) {
    if (!exclude.some((x) => under(rel, x))) continue;
    excludedBytes += picked.get(rel)!.size;
    picked.delete(rel);
  }
  if (picked.size === 0) throw new LockError("E_USAGE", "the excludes leave no file to vendor", paths.join(", "));
  return { picked, excludedBytes };
}

/** Read the picked blobs. Git records only 644 and 755, so the mode is deterministic across machines. */
async function collect(dir, picked) {
  const dests = [...picked.keys()];
  for (const d of dests) {
    const e = picked.get(d);
    if (e.mode === "120000") throw new LockError("E_LOCK_SYMLINK", `symlink in the vendored tree: ${e.path}`, e.path);
    if (e.type !== "blob") throw new LockError("E_LOCK_SUBMODULE", `submodule in the vendored tree: ${e.path}`, e.path);
  }
  const blobs = await readBlobs(dir, dests.map((d) => picked.get(d).oid));
  return dests.map((d, i) => ({ path: d, mode: picked.get(d).mode === "100755" ? 0o755 : 0o644, bytes: blobs[i] }));
}

/** Closest package.json or LICENSE file, starting in the named path and walking up to the repo root. */
async function detectLicense(dir, entries, paths) {
  const ids = new Set();
  for (const p of paths) {
    let d = p === "." ? "" : entries.some((e) => e.path === p) ? posix.dirname(p).replace(/^\.$/, "") : p;
    let found = null;
    for (;;) {
      const here = entries.filter((e) => (posix.dirname(e.path) === "." ? "" : posix.dirname(e.path)) === d && e.type === "blob");
      const pkg = here.find((e) => posix.basename(e.path) === "package.json");
      const lic = here.filter((e) => isLicenseFile(posix.basename(e.path)));
      const cands = [...(pkg ? [pkg] : []), ...lic];
      const blobs = await readBlobs(dir, cands.map((e) => e.oid));
      found = cands
        .map((e, i) => (e === pkg ? licenseFromPackageJson(blobs[i].toString("utf8")) : licenseFromText(blobs[i].toString("utf8"))))
        .find(Boolean) ?? null;
      if (found || d === "") break;
      d = posix.dirname(d).replace(/^\.$/, "");
    }
    if (!found) return NO_LICENSE;
    ids.add(found);
  }
  return [...ids].sort().join(" AND ");
}

const sameList = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);

const repoPath = (upstream: string, p: string) => (upstream === "." ? p : p === "." ? upstream : `${upstream}/${p}`);

/**
 * rig pack add. Fetch the commit, copy the named paths under `root`, minus the excludes, into `packs/<name>/` of the
 * chosen config root, write `pack.json` and then the lock entry. Excluded files are never written. The gate runs in the
 * caller. A second call with the same arguments, with the pack unchanged on disk, writes nothing and fetches nothing.
 * @param world  needs `roots: {repo: string, overlay?: string}`; `writeConfig(root, rel, bytes, mode?)` optional.
 *   Vendored files carry their git mode (644 or 755); the lock file keeps its current mode (fs.writeConfig).
 * @param args  `root` (default ".") is the upstream folder the pack mirrors; `paths` and `exclude` are relative to it.
 * @returns kept counts the vendored files without pack.json.
 */
export async function vendor(world: object, args: {repo: string, sha: string, root?: string, paths: string[], exclude?: string[], name?: string, into?: "repo" | "overlay"}): Promise<{pack: string, root: string, tree: string, files: {path: string, mode: number, bytes: Uint8Array}[], kept: number} & ({noop: true, excludedBytes: null} | {noop: false, excludedBytes: number})> {
  if (typeof args.sha !== "string" || !/^[0-9a-f]{40}$/i.test(args.sha)) {
    throw new LockError("E_USAGE", `--sha must be the full 40-hex commit, got ${JSON.stringify(args.sha)}`);
  }
  const sha = args.sha.toLowerCase();
  const into = args.into ?? "repo";
  if (!ROOTS.includes(into)) throw new LockError("E_USAGE", `--into must be repo or overlay, got ${JSON.stringify(into)}`);
  if (!Array.isArray(args.paths) || args.paths.length === 0) throw new LockError("E_USAGE", "at least one --path is required");
  const upstream = normalizePath(args.root ?? ".");
  const paths = [...new Set(args.paths.map(normalizePath))].sort();
  const exclude = [...new Set((args.exclude ?? []).map(normalizePath))].sort();
  if (exclude.includes(".")) throw new LockError("E_USAGE", "--exclude . would exclude every path");
  const name = packNameFor(args.repo, upstream, args.name);
  const root = rootDir(world, into);
  const packRel = `packs/${name}`;
  const packDir = join(root, packRel);
  const lock = readLock(root);
  const entry = lock.packs[name];
  const onDisk = readTreeFromDisk(packDir);
  const present = onDisk !== null && onDisk.length > 0;

  if (
    entry && present && entry.repo === args.repo && entry.sha === sha && entry.root === upstream &&
    sameList(entry.paths, paths) && sameList(entry.exclude, exclude) &&
    onDisk.some((f) => f.path === "pack.json") && treeHash(onDisk) === entry.tree
  ) {
    return { pack: name, root: into, tree: entry.tree, files: onDisk, kept: onDisk.length - 1, excludedBytes: null, noop: true };
  }
  if (present) {
    throw new LockError("E_PACK_EXISTS", `${packRel} already exists with other content; remove it and its lock entry first`, packRel);
  }

  const write = writerOf(world);
  const { files, license, commit, excludedBytes } = await withClone(args.repo, sha, async ({ dir, commit, entries }) => {
    const { picked, excludedBytes } = select(entries, upstream, paths, exclude);
    return {
      commit,
      excludedBytes,
      files: await collect(dir, picked),
      license: await detectLicense(dir, entries, paths.map((p) => repoPath(upstream, p))),
    };
  });
  if (files.some((f) => f.path === "pack.json")) {
    throw new LockError("E_PACK_JSON_CONFLICT", "the vendored paths already contain a pack.json at the pack root", "pack.json");
  }
  const tree = treeHash(files);
  const manifest = { schema: 2, name, scopes: ["machine-hidden"], license, units: {} };
  const manifestBytes = canonicalJson(manifest);

  for (const f of files) await write(root, `${packRel}/${f.path}`, f.bytes, f.mode);
  await write(root, `${packRel}/pack.json`, manifestBytes, 0o644);
  lock.packs[name] = { repo: args.repo, sha: commit, root: upstream, paths, exclude, license, tree, port: null, candidate: null };
  await write(root, LOCK_FILE, encodeLock(lock));
  const all = [...files, { path: "pack.json", mode: 0o644, bytes: manifestBytes }];
  return { pack: name, root: into, tree, files: all, kept: files.length, excludedBytes, noop: false };
}

function coreOnly(verb, name) {
  if (name !== "core") throw new LockError("E_USAGE", `rig pin ${verb} works on core only in this version, not on ${name}`);
}

/** The caller's gate over the candidate files. Without one, every candidate counts as clean (module tests). */
async function gateOf(opts, files) {
  const r = opts.gate ? await opts.gate(files) : { findings: [], blocked: false };
  return { findings: r.findings ?? [], blocked: Boolean(r.blocked) };
}

/**
 * rig pin check core: hash `packs/core/` on disk, no network, and record the candidate seal. `opts.gate` runs over
 * the candidate files before the lock write: a blocked candidate is not recorded, so `pin set` cannot promote it.
 */
export async function pinCheck(world: object, name: string, sha: string | null, opts: {gate?: (files: {path: string, mode: number, bytes: Uint8Array}[]) => {findings: object[], blocked: boolean} | Promise<{findings: object[], blocked: boolean}>} = {}): Promise<{candidate: {tree: string, checked: string}, files: {path: string, mode: number, bytes: Uint8Array}[], findings: object[], blocked: boolean}> {
  coreOnly("check", name);
  const checked = (world.now ?? new Date()).toISOString().slice(0, 10);
  const root = rootDir(world, "repo");
  const files = readTreeFromDisk(join(root, "packs", "core"));
  if (!files) throw new LockError("E_USAGE", "packs/core is absent");
  const tree = treeHash(files, { core: true });
  const gated = await gateOf(opts, files);
  if (!gated.blocked) {
    const lock = readLock(root);
    lock.core = { tree: lock.core?.tree ?? null, candidate: tree };
    await writerOf(world)(root, LOCK_FILE, encodeLock(lock));
  }
  return { candidate: { tree, checked }, files, ...gated };
}

const refuse = (message) => ({ promoted: false, error: { code: "E_PIN_UNCHECKED", message } });

/**
 * rig pin set core. Promote the candidate seal to `core.tree`.
 */
export function pinSet(world: object, name: string): {promoted: boolean, error?: {code: string, message: string}} {
  coreOnly("set", name);
  const root = rootDir(world, "repo");
  const lock = readLock(root);
  if (typeof lock.core?.candidate !== "string") return refuse("core has no candidate; run rig pin check core first");
  lock.core = { tree: lock.core.candidate, candidate: null };
  writerOf(world)(root, LOCK_FILE, encodeLock(lock));
  return { promoted: true };
}

const OSV_PREFIX = "https://api.osv.dev/";

/**
 * The transport that rig pack add hands to refreshOsv: the only network call in rig besides git.
 * A body means POST of JSON, none means GET. Refuses any URL outside api.osv.dev, answers the text, throws on a
 * non-2xx status, a network error or a 30-second timeout.
 */
export async function osvFetch(url: string, body?: string): Promise<string> {
  if (!url.startsWith(OSV_PREFIX)) throw new LockError("E_USAGE", `not an OSV URL: ${url}`, url);
  const res = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.text();
}
