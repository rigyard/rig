// lib/lock.ts: the lock per config root, vendoring, pin check and pin set. The only module that spawns git.
// Everything fetched is read from git's object store as bytes. Nothing from a fetched tree is run.
import { basename, join, posix } from "node:path";
import { writeConfig as fsWriteConfig } from "./fs.ts";
import { treeHash } from "./tree.ts";
import { LockError } from "./lock/errors.ts";
import { readBlobs, withClone } from "./lock/git.ts";
import { fact } from "./lock/facts.ts";
import { readTreeFromDisk } from "./lock/disk.ts";
import { readLock, encodeLock, LOCK_FILE } from "./lock/lockfile.ts";
import { NO_LICENSE, isLicenseFile, licenseFromPackageJson, licenseFromText } from "./lock/license.ts";


const ROOTS = ["repo", "overlay"];
const PACK_NAME = /^[a-z0-9][a-z0-9._-]*$/i;
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

function packNameFor(repo, paths) {
  const name = paths[0] === "." ? basename(repo.replace(/\/+$/, "")).replace(/\.git$/, "") : basename(paths[0]);
  if (!PACK_NAME.test(name) || name === "core") throw new LockError("E_USAGE", `cannot derive a pack name from ${paths[0]}: got ${JSON.stringify(name)}`);
  return name;
}

/** Map pack-relative path -> tree entry. The contents of each named dir become the pack root; a named file keeps its basename. */
function select(entries, paths) {
  const picked = new Map();
  for (const p of paths) {
    let hits = 0;
    for (const e of entries) {
      let dest;
      if (p === ".") dest = e.path;
      else if (e.path === p) dest = posix.basename(p);
      else if (e.path.startsWith(p + "/")) dest = e.path.slice(p.length + 1);
      else continue;
      if (picked.has(dest)) throw new LockError("E_PATH_COLLISION", `two paths both provide ${dest}`, dest);
      picked.set(dest, e);
      hits++;
    }
    if (hits === 0) throw new LockError("E_PATH_MISSING", `path ${p} is not in the repo at this commit`, p);
  }
  return picked;
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

/**
 * rig pack add. Fetch the commit, copy only the named paths into `packs/<name>/` of the chosen root, write
 * `pack.json` and then the lock entry. The gate runs in the caller. A second call for the same repo, paths and
 * commit, with the pack unchanged on disk, writes nothing and fetches nothing.
 * @param world  needs `roots: {repo: string, overlay?: string}`; `writeConfig(root, rel, bytes, mode?)` optional.
 *   Vendored files carry their git mode (644 or 755); the lock file keeps its current mode (fs.writeConfig).
 */
export async function vendor(world: object, args: {repo: string, sha: string, paths: string[], into?: "repo" | "overlay"}): Promise<{pack: string, root: string, tree: string, files: {path: string, mode: number, bytes: Uint8Array}[], noop: boolean}> {
  const into = args.into ?? "repo";
  if (!ROOTS.includes(into)) throw new LockError("E_USAGE", `--into must be repo or overlay, got ${JSON.stringify(into)}`);
  if (!Array.isArray(args.paths) || args.paths.length === 0) throw new LockError("E_USAGE", "at least one --path is required");
  const paths = args.paths.map(normalizePath);
  const name = packNameFor(args.repo, paths);
  const root = rootDir(world, into);
  const packRel = `packs/${name}`;
  const packDir = join(root, packRel);
  const lock = readLock(root);
  const entry = lock.packs[name];
  const onDisk = readTreeFromDisk(packDir);
  const present = onDisk !== null && onDisk.length > 0;

  const shaOk = typeof args.sha === "string" && /^[0-9a-f]{7,40}$/i.test(args.sha);
  if (
    entry && present && shaOk && entry.repo === args.repo && sameList(entry.paths, paths) &&
    entry.sha.startsWith(args.sha.toLowerCase()) && onDisk.some((f) => f.path === "pack.json") &&
    treeHash(onDisk) === entry.tree
  ) {
    return { pack: name, root: into, tree: entry.tree, files: onDisk, noop: true };
  }
  if (present) {
    throw new LockError("E_PACK_EXISTS", `${packRel} already exists with other content; remove it and its lock entry first`, packRel);
  }

  const write = writerOf(world);
  const { files, license, commit } = await withClone(args.repo, args.sha, async ({ dir, commit, entries }) => ({
    commit,
    files: await collect(dir, select(entries, paths)),
    license: await detectLicense(dir, entries, paths),
  }));
  if (files.some((f) => f.path === "pack.json")) {
    throw new LockError("E_PACK_JSON_CONFLICT", "the vendored paths already contain a pack.json at the pack root", "pack.json");
  }
  const tree = treeHash(files);
  const manifest = {
    schema: 1, name, scopes: ["machine-hidden"], license,
    source: { repo: args.repo, sha: commit, paths }, units: {},
  };
  const manifestBytes = canonicalJson(manifest);

  for (const f of files) await write(root, `${packRel}/${f.path}`, f.bytes, f.mode);
  await write(root, `${packRel}/pack.json`, manifestBytes, 0o644);
  lock.packs[name] = { repo: args.repo, sha: commit, paths, license, tree };
  await write(root, LOCK_FILE, encodeLock(lock));
  return { pack: name, root: into, tree, files: [...files, { path: "pack.json", mode: 0o644, bytes: manifestBytes }], noop: false };
}

const lockRootOf = (world, name) => ROOTS.find((r) => world.roots?.[r] && readLock(world.roots[r]).pins[name]) ?? "repo";

function pluginOf(world, name, lock) {
  return lock.pins[name]?.plugin ?? world.providers?.get(name)?.pin?.plugin ?? null;
}

function marketplaceUrl(world, market) {
  const src = fact(world, "marketplaces")?.[market]?.source;
  if (typeof src === "string") return src;
  if (src?.url) return src.url;
  if (src?.repo) return `https://github.com/${src.repo}.git`;
  return null;
}

/** The caller's gate over the candidate files. Without one, every candidate counts as clean (module tests). */
async function gateOf(opts, files) {
  const r = opts.gate ? await opts.gate(files) : { findings: [], blocked: false };
  return { findings: r.findings ?? [], blocked: Boolean(r.blocked) };
}

/**
 * rig pin check. For a native plugin: fetch its marketplace repo at `sha`, hash the plugin's tree, record
 * `candidate` in the lock. For `core`: hash `packs/core/` on disk, no network. `opts.gate` runs over the candidate
 * files before the lock write: a blocked candidate is not recorded, so `pin set` cannot promote it.
 * @param name  a pin name or "core"
 */
export async function pinCheck(world: object, name: string, sha: string | null, opts: {gate?: (files: {path: string, mode: number, bytes: Uint8Array}[]) => {findings: object[], blocked: boolean} | Promise<{findings: object[], blocked: boolean}>} = {}): Promise<{candidate: {version?: string, sha?: string, tree: string, checked: string}, files: {path: string, mode: number, bytes: Uint8Array}[], findings: object[], blocked: boolean}> {
  const checked = (world.now ?? new Date()).toISOString().slice(0, 10);
  if (name === "core") {
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

  if (typeof sha !== "string") throw new LockError("E_USAGE", `pin check ${name} needs --sha`);
  const into = lockRootOf(world, name);
  const root = rootDir(world, into);
  const lock = readLock(root);
  const plugin = pluginOf(world, name, lock);
  if (!plugin) throw new LockError("E_PIN_UNKNOWN", `${name} has no pinned plugin in the lock or in a provider record`);
  const market = plugin.includes("@") ? plugin.slice(plugin.lastIndexOf("@") + 1) : null;
  const pluginName = plugin.includes("@") ? plugin.slice(0, plugin.lastIndexOf("@")) : plugin;
  const url = market && marketplaceUrl(world, market);
  if (!url) throw new LockError("E_PIN_MARKETPLACE", `no marketplace repo is known for ${plugin}`);

  const write = writerOf(world);
  const { files, version, commit } = await withClone(url, sha, async ({ dir, commit, entries }) => {
    const manifestEntry = entries.find((e) => e.path === ".claude-plugin/marketplace.json" && e.type === "blob");
    if (!manifestEntry) throw new LockError("E_PIN_MARKETPLACE", `${url} has no .claude-plugin/marketplace.json at ${commit}`);
    const [mBytes] = await readBlobs(dir, [manifestEntry.oid]);
    let listed;
    try {
      listed = JSON.parse(mBytes.toString("utf8"))?.plugins?.find((p) => p?.name === pluginName);
    } catch {
      throw new LockError("E_PIN_MARKETPLACE", "marketplace.json is not valid JSON");
    }
    if (!listed) throw new LockError("E_PIN_MARKETPLACE", `plugin ${pluginName} is not listed in the marketplace at ${commit}`);
    if (typeof listed.source !== "string") throw new LockError("E_PIN_MARKETPLACE", `plugin ${pluginName} has a non-path source; v0 handles only plugins inside the marketplace repo`);
    const sub = normalizePath(listed.source);
    const files = await collect(dir, select(entries, [sub]));
    let version = typeof listed.version === "string" ? listed.version : null;
    const pj = files.find((f) => f.path === ".claude-plugin/plugin.json");
    try {
      if (pj && typeof JSON.parse(pj.bytes.toString("utf8"))?.version === "string") version = JSON.parse(pj.bytes.toString("utf8")).version;
    } catch { /* an unreadable plugin.json leaves the version from the marketplace entry */ }
    return { files, version, commit };
  });

  // a plugin tree has no pack manifest, so every file counts
  const tree = treeHash(files, { core: true });
  const candidate = { version: version ?? commit.slice(0, 7), sha: commit, tree, checked };
  const gated = await gateOf(opts, files);
  if (!gated.blocked) {
    lock.pins[name] = { plugin, current: lock.pins[name]?.current ?? null, candidate };
    await write(root, LOCK_FILE, encodeLock(lock));
  }
  return { candidate, files, ...gated };
}

const refuse = (message) => ({ promoted: false, error: { code: "E_PIN_UNCHECKED", message } });

/**
 * rig pin set. Promote `candidate` to `current`. For a native plugin, refuse unless every installed record of the
 * plugin has a `gitCommitSha` equal to the candidate sha. `core` has no installed record.
 */
export function pinSet(world: object, name: string): {promoted: boolean, error?: {code: string, message: string}} {
  const write = writerOf(world);
  if (name === "core") {
    const root = rootDir(world, "repo");
    const lock = readLock(root);
    if (typeof lock.core?.candidate !== "string") return refuse("core has no candidate; run rig pin check core first");
    lock.core = { tree: lock.core.candidate, candidate: null };
    write(root, LOCK_FILE, encodeLock(lock));
    return { promoted: true };
  }
  const into = lockRootOf(world, name);
  const root = rootDir(world, into);
  const lock = readLock(root);
  const pin = lock.pins[name];
  if (!pin?.candidate) return refuse(`${name} has no candidate; run rig pin check ${name} --sha <sha> first`);
  const records = fact(world, "installed_plugins")?.plugins?.[pin.plugin];
  if (!Array.isArray(records) || records.length === 0) return refuse(`${pin.plugin} is not installed`);
  for (const r of records) {
    if (r?.gitCommitSha !== pin.candidate.sha) {
      return refuse(`installed ${pin.plugin} is at ${r?.gitCommitSha ?? "an unknown commit"}, not the checked ${pin.candidate.sha}`);
    }
  }
  const { checked: _checked, ...current } = pin.candidate;
  lock.pins[name] = { plugin: pin.plugin, current, candidate: null };
  write(root, LOCK_FILE, encodeLock(lock));
  return { promoted: true };
}

const OSV_PREFIX = "https://api.osv.dev/";

/**
 * The transport that rig pack add and rig pin check hand to refreshOsv: the only network call in rig besides git.
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
