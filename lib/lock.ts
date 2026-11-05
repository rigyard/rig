// lib/lock.ts: the lock per config root, vendoring, port records, pin check and pin set. The only module that spawns git.
// Everything fetched is read from git's object store as bytes. Nothing from a fetched tree is run.
import { basename, join, posix } from "node:path";
import { writeConfig as fsWriteConfig } from "./fs.ts";
import { treeHash } from "./tree.ts";
import { LockError } from "./lock/errors.ts";
import { git, readBlobs, withClone } from "./lock/git.ts";
import type { TreeEntry } from "./lock/git.ts";
import { readTreeFromDisk } from "./lock/disk.ts";
import { readLock, encodeLock, LOCK_FILE } from "./lock/lockfile.ts";
import { ID } from "./world.ts";
import { NO_LICENSE, isLicenseFile, joinLicenses, licenseFromPackageJson, licenseFromText } from "./lock/license.ts";


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

function normalizePath(p: string) {
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
const relOf = (path: string, root: string) => (root === "." ? path : path.startsWith(root + "/") ? path.slice(root.length + 1) : null);

function select(entries: TreeEntry[], root: string, paths: string[], exclude: string[]): {picked: Map<string, TreeEntry>, excludedBytes: number} {
  const picked = new Map<string, TreeEntry>();
  for (const p of paths) {
    let hits = 0;
    for (const e of entries) {
      const rel = relOf(e.path, root);
      if (rel === null || !under(rel, p)) continue;
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

async function detectLicense(dir: string, entries: TreeEntry[], paths: string[], vendored: string[]): Promise<string> {
  const dirOf = (p: string) => (posix.dirname(p) === "." ? "" : posix.dirname(p));
  const isPackageJson = (e: TreeEntry) => posix.basename(e.path) === "package.json";
  const idsOf = async (cands: TreeEntry[]) => {
    const blobs = await readBlobs(dir, cands.map((e) => e.oid));
    return cands.map((e, i) => (isPackageJson(e) ? licenseFromPackageJson : licenseFromText)(blobs[i].toString("utf8")));
  };
  const ids = new Set<string>();
  for (const p of paths) {
    let d = p === "." ? "" : entries.some((e) => e.path === p) ? dirOf(p) : p;
    let found: string | null = null;
    for (;;) {
      const here = entries.flatMap((e) => {
        const rel = d === "" ? e.path : e.path.startsWith(`${d}/`) ? e.path.slice(d.length + 1) : null;
        return e.type === "blob" && rel !== null ? [{ e, rel }] : [];
      });
      const pkg = here.find((h) => h.rel === "package.json")?.e;
      const lic = here.filter((h) => (!h.rel.includes("/") || h.rel.toUpperCase().startsWith("LICENSES/")) && isLicenseFile(h.rel)).map((h) => h.e);
      const cands = [...(pkg ? [pkg] : []), ...lic];
      const got = await idsOf(cands);
      if (got.some((id, i) => id === null && cands[i] !== pkg)) return NO_LICENSE;
      found = got.find(Boolean) ?? null;
      if (found || d === "") break;
      d = posix.dirname(d).replace(/^\.$/, "");
    }
    if (!found) return NO_LICENSE;
    ids.add(found);
  }
  const vendoredSet = new Set(vendored);
  const nested = entries.filter((e) => e.type === "blob" && vendoredSet.has(e.path) && (isPackageJson(e) || isLicenseFile(e.path)));
  const nestedIds = await idsOf(nested);
  for (const [i, id] of nestedIds.entries()) {
    if (id !== null) ids.add(id);
    else if (!isPackageJson(nested[i])) return NO_LICENSE;
  }
  return joinLicenses([...ids]);
}

const sameList = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);

const repoPath = (upstream: string, p: string) => (upstream === "." ? p : p === "." ? upstream : `${upstream}/${p}`);

const normList = (xs: string[]) => [...new Set(xs.map(normalizePath))].sort();

function excludeList(xs: string[]) {
  const exclude = normList(xs);
  if (exclude.includes(".")) throw new LockError("E_USAGE", "--exclude . would exclude every path");
  const notice = exclude.find((x) => isLicenseFile(x) || posix.basename(x).toUpperCase() === "LICENSES");
  if (notice !== undefined) throw new LockError("E_USAGE", `--exclude ${notice} names a license file; exclude the folder of the code it covers instead`, notice);
  return exclude;
}

function fullSha(sha: unknown): string {
  if (typeof sha !== "string" || !/^[0-9a-f]{40}$/i.test(sha)) {
    throw new LockError("E_USAGE", `--sha must be the full 40-hex commit, got ${JSON.stringify(sha)}`);
  }
  return sha.toLowerCase();
}

type File = {path: string, mode: number, bytes: Uint8Array};
type LockWorld = {roots?: {repo?: string, overlay?: string}, now?: Date, writeConfig?: (root: string, rel: string, bytes: Uint8Array | null, mode?: number) => unknown};
type PortLock = {paths: string[], tree: string, reviewed_sha: string | null, reviewed_tree: string | null};
export type PortStatus = "none" | "fresh" | "stale";

async function vendoredFiles(dir: string, entries: TreeEntry[], root: string, paths: string[], exclude: string[]) {
  const { picked, excludedBytes } = select(entries, root, paths, exclude);
  const files: File[] = await collect(dir, picked);
  if (files.some((f) => f.path === "pack.json")) {
    throw new LockError("E_PACK_JSON_CONFLICT", "the vendored paths already contain a pack.json at the pack root", "pack.json");
  }
  return { files, excludedBytes };
}

/**
 * The upstream entries under the port paths, ignoring excludes, and one signature per port path: its files with
 * mode and blob id. A port path with no file at this commit has the empty signature.
 */
function portPick(entries: TreeEntry[], root: string, paths: string[]) {
  const picked = new Map<string, TreeEntry>();
  const sig = new Map<string, string>();
  for (const p of paths) {
    const lines = [];
    for (const e of entries) {
      const rel = relOf(e.path, root);
      if (rel === null || !under(rel, p)) continue;
      picked.set(rel, e);
      lines.push(`${rel}\0${e.mode}\0${e.oid}`);
    }
    sig.set(p, lines.join("\n"));
  }
  return { picked, sig };
}

const portStatus = (port: PortLock | null): PortStatus => (port === null ? "none" : port.tree === port.reviewed_tree ? "fresh" : "stale");

function packDirOf(root: string, name: string) {
  const files = readTreeFromDisk(join(root, "packs", name));
  if (!files) throw new LockError("E_USAGE", `packs/${name} is absent`, `packs/${name}`);
  return files;
}

function locate(world: LockWorld, name: string) {
  for (const root of ROOTS) {
    const dir = world.roots?.[root as "repo" | "overlay"];
    if (!dir) continue;
    const lock = readLock(dir);
    const entry = lock.packs[name];
    if (entry) return { root, dir, lock, entry };
  }
  throw new LockError("E_USAGE", `${name} has no lock entry; rig pack add writes it`);
}

/**
 * rig pack add. Fetch the commit, copy the named paths under `root`, minus the excludes, into `packs/<name>/` of the
 * chosen config root, write `pack.json` and then the lock entry. Excluded files are never written. The gate runs in the
 * caller. A second call with the same arguments, with the pack unchanged on disk, writes nothing and fetches nothing.
 * `port` records upstream port sources, hashed at `sha` with no exclude applied, and writes them as not reviewed.
 * With `port` and no `paths` (adopt form), the authored folder `packs/<name>/` must exist with its pack.json: rig
 * vendors nothing, hashes the folder, and writes only the lock entry.
 * @param world  needs `roots: {repo: string, overlay?: string}`; `writeConfig(root, rel, bytes, mode?)` optional.
 *   Vendored files carry their git mode (644 or 755); the lock file keeps its current mode (fs.writeConfig).
 * @param args  `root` (default ".") is the upstream folder the pack mirrors; `paths`, `exclude` and `port` are relative to it.
 * @returns kept counts the pack's files without pack.json.
 */
export async function vendor(world: object, args: {repo: string, sha: string, root?: string, paths?: string[], exclude?: string[], port?: string[], name?: string, into?: "repo" | "overlay"}): Promise<{pack: string, root: string, tree: string, files: File[], kept: number, adopted: boolean, port: PortLock | null} & ({noop: true, excludedBytes: null} | {noop: false, excludedBytes: number})> {
  const sha = fullSha(args.sha);
  const into = args.into ?? "repo";
  if (!ROOTS.includes(into)) throw new LockError("E_USAGE", `--into must be repo or overlay, got ${JSON.stringify(into)}`);
  const paths = normList(args.paths ?? []);
  const port = normList(args.port ?? []);
  if (paths.length === 0 && port.length === 0) throw new LockError("E_USAGE", "at least one --path or --port is required");
  const adopted = paths.length === 0;
  const upstream = normalizePath(args.root ?? ".");
  const exclude = excludeList(args.exclude ?? []);
  if (adopted && exclude.length > 0) throw new LockError("E_USAGE", "--exclude needs --path: an adopted pack vendors nothing");
  const name = packNameFor(args.repo, upstream, args.name);
  const root = rootDir(world, into);
  const packRel = `packs/${name}`;
  const lock = readLock(root);
  const entry = lock.packs[name];
  const onDisk = readTreeFromDisk(join(root, packRel));
  const present = onDisk !== null && onDisk.length > 0;

  if (
    entry && present && entry.repo === args.repo && entry.sha === sha && entry.root === upstream &&
    sameList(entry.paths, paths) && sameList(entry.exclude, exclude) && sameList(entry.port?.paths ?? [], port) &&
    onDisk.some((f) => f.path === "pack.json") && treeHash(onDisk) === entry.tree
  ) {
    return { pack: name, root: into, tree: entry.tree, files: onDisk, kept: onDisk.length - 1, adopted, port: entry.port, excludedBytes: null, noop: true };
  }
  let authored: File[] = [];
  if (adopted) {
    if (!onDisk?.some((f) => f.path === "pack.json")) {
      throw new LockError("E_USAGE", `${packRel}/pack.json is absent; --port without --path adopts an authored pack folder`, packRel);
    }
    authored = onDisk;
  }
  if (adopted ? entry !== undefined : present) {
    throw new LockError("E_PACK_EXISTS", `${packRel} already exists with other content; remove it and its lock entry first`, packRel);
  }

  const write = writerOf(world);
  const got = await withClone(args.repo, sha, async ({ dir, commit, entries }) => {
    const v = adopted ? { files: [], excludedBytes: 0 } : await vendoredFiles(dir, entries, upstream, paths, exclude);
    let portTree = null;
    if (port.length > 0) {
      const { picked, sig } = portPick(entries, upstream, port);
      const missing = port.find((p) => sig.get(p) === "");
      if (missing !== undefined) throw new LockError("E_PATH_MISSING", `port path ${missing} is not under ${upstream} in the repo at this commit`, missing);
      portTree = treeHash(await collect(dir, picked));
    }
    const licensed = adopted ? port : paths;
    const vendored = (adopted ? [...portPick(entries, upstream, port).picked.keys()] : v.files.map((f) => f.path)).map((p) => repoPath(upstream, p));
    return { ...v, commit, portTree, license: await detectLicense(dir, entries, licensed.map((p) => repoPath(upstream, p)), vendored) };
  });
  const portLock = got.portTree === null ? null : { paths: port, tree: got.portTree, reviewed_sha: null, reviewed_tree: null };
  const record = (tree: string) => ({ repo: args.repo, sha: got.commit, root: upstream, paths, exclude, license: got.license, tree, port: portLock, candidate: null });

  if (adopted) {
    const tree = treeHash(authored);
    lock.packs[name] = record(tree);
    await write(root, LOCK_FILE, encodeLock(lock));
    return { pack: name, root: into, tree, files: authored, kept: authored.length - 1, adopted, port: portLock, excludedBytes: 0, noop: false };
  }
  const tree = treeHash(got.files);
  const manifest = { schema: 2, name, scopes: ["machine-hidden"], license: got.license, units: {} };
  const manifestBytes = canonicalJson(manifest);
  for (const f of got.files) await write(root, `${packRel}/${f.path}`, f.bytes, f.mode);
  await write(root, `${packRel}/pack.json`, manifestBytes, 0o644);
  lock.packs[name] = record(tree);
  await write(root, LOCK_FILE, encodeLock(lock));
  const all = [...got.files, { path: "pack.json", mode: 0o644, bytes: manifestBytes }];
  return { pack: name, root: into, tree, files: all, kept: got.files.length, adopted, port: portLock, excludedBytes: got.excludedBytes, noop: false };
}

/** The caller's gate over the candidate files, with the config root and the pack.json that pin set keeps. */
type Gate = (files: File[], pack: {root: string, manifest: object | null}) => {findings: object[], blocked: boolean} | Promise<{findings: object[], blocked: boolean}>;

/** Without a gate, every candidate counts as clean (module tests). */
async function gateOf(opts, files, pack = { root: "repo", manifest: null }) {
  const r = opts.gate ? await opts.gate(files, pack) : { findings: [], blocked: false };
  return { findings: r.findings ?? [], blocked: Boolean(r.blocked) };
}

function changedCount(before: File[], after: File[]) {
  const old = new Map(before.filter((f) => f.path !== "pack.json").map((f) => [f.path, f]));
  let n = 0;
  for (const f of after) {
    const o = old.get(f.path);
    old.delete(f.path);
    if (!o || Boolean(o.mode & 0o111) !== Boolean(f.mode & 0o111) || !Buffer.from(o.bytes).equals(Buffer.from(f.bytes))) n++;
  }
  return n + old.size;
}

async function portDiff(dir: string, from: string | null, to: string, root: string, paths: string[]) {
  const base = from ?? (await git(["mktree"], { cwd: dir, input: Buffer.alloc(0) })).toString("utf8").trim();
  const args = ["diff", "--no-color", "--no-ext-diff", "--no-textconv", "--no-renames", ...(root === "." ? [] : [`--relative=${root}`]), base, to, "--", ...paths.map((p) => repoPath(root, p))];
  return (await git(args, { cwd: dir })).toString("utf8");
}

/**
 * rig pin check core: hash `packs/core/` on disk, no network, and record the candidate seal. `opts.gate` runs over
 * the candidate files before the lock write: a blocked candidate is not recorded, so `pin set` cannot promote it.
 */
async function coreCheck(world: LockWorld, opts: {gate?: Gate}) {
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
  return { candidate: { sha: null, exclude: null, tree, port_tree: null, checked }, files, changed: null, port: null, diff: null, recorded: !gated.blocked, ...gated };
}

/**
 * rig pin check <pack> [--sha] [--diff] [--exclude | --no-exclude]. Fetch `sha` (default: the locked one), select the
 * locked paths with the locked excludes, or with `opts.exclude` in their place (`[]` for none), detect the license
 * and gate that candidate, which records the detected license. A license that differs from the locked one replaces the pack.json license in the gate.
 * For an adopted pack the candidate is the folder on disk and its license stays. The port is stale when its tree at
 * `sha` differs from `reviewed_tree`, and always before the first attest. Writes only `candidate` of the pack's lock
 * entry, with its exclude list, and only when the gate passes. `opts.diff` only prints: it adds a unified diff of the
 * port paths from `reviewed_sha` to `sha` (from the empty tree before the first attest), fetches `reviewed_sha` for
 * it, and writes nothing. For core: no network, no flags.
 */
export async function pinCheck(world: object, name: string, sha: string | null, opts: {gate?: Gate, diff?: boolean, exclude?: string[]} = {}): Promise<{candidate: {sha: string | null, exclude: string[] | null, tree: string, port_tree: string | null, license?: string, checked: string}, files: File[], changed: number | null, port: {paths: string[], stale: boolean, reviewed_sha: string | null} | null, diff: string | null, recorded: boolean, findings: object[], blocked: boolean}> {
  if (name === "core") {
    const flag = sha !== null ? "--sha" : opts.diff ? "--diff" : opts.exclude ? (opts.exclude.length > 0 ? "--exclude" : "--no-exclude") : null;
    if (flag) throw new LockError("E_USAGE", `rig pin check core does not take ${flag}`);
    return coreCheck(world, opts);
  }
  const { root: rootName, dir: root, lock, entry } = locate(world, name);
  const target = fullSha(sha ?? entry.sha);
  const adopted = entry.paths.length === 0;
  if (adopted && opts.exclude) throw new LockError("E_USAGE", `${name} vendors no path, so --exclude does not apply`);
  if (opts.diff && !entry.port) throw new LockError("E_USAGE", `${name} has no port record, so --diff has nothing to show`);
  const exclude = opts.exclude ? excludeList(opts.exclude) : entry.exclude;
  const disk = packDirOf(root, name);
  const port: PortLock | null = entry.port;
  const base = opts.diff && port ? port.reviewed_sha : null;

  const got = await withClone(entry.repo, target, async ({ dir, commit, entries }) => {
    const files = adopted ? disk.filter((f) => f.path !== "pack.json") : (await vendoredFiles(dir, entries, entry.root, entry.paths, exclude)).files;
    const license = adopted ? entry.license : await detectLicense(dir, entries, entry.paths.map((p: string) => repoPath(entry.root, p)), files.map((f) => repoPath(entry.root, f.path)));
    if (!port) return { commit, files, license, portTree: null, diff: null };
    const portTree = treeHash(await collect(dir, portPick(entries, entry.root, port.paths).picked));
    const diff = opts.diff ? await portDiff(dir, base, commit, entry.root, port.paths) : null;
    return { commit, files, license, portTree, diff };
  }, base);

  const checked = (world.now ?? new Date()).toISOString().slice(0, 10);
  const candidate = { sha: got.commit, exclude, tree: treeHash(got.files), port_tree: got.portTree, license: got.license, checked };
  const manifestFile = disk.find((f) => f.path === "pack.json");
  const manifest = manifestFile ? JSON.parse(Buffer.from(manifestFile.bytes).toString("utf8")) : null;
  const gated = await gateOf(opts, got.files, { root: rootName, manifest: manifest && got.license !== entry.license ? { ...manifest, license: got.license } : manifest });
  const recorded = !gated.blocked && !opts.diff;
  if (recorded) {
    lock.packs[name] = { ...entry, candidate };
    await writerOf(world)(root, LOCK_FILE, encodeLock(lock));
  }
  const status = port && { paths: port.paths, stale: port.reviewed_tree === null || got.portTree !== port.reviewed_tree, reviewed_sha: port.reviewed_sha };
  return { candidate, files: got.files, changed: changedCount(disk, got.files), port: status, diff: got.diff, recorded, ...gated };
}

const refuse = (message) => ({ promoted: false, error: { code: "E_PIN_UNCHECKED", message } });

function coreSet(world: LockWorld) {
  const root = rootDir(world, "repo");
  const lock = readLock(root);
  if (typeof lock.core?.candidate !== "string") return refuse("core has no candidate; run rig pin check core first");
  lock.core = { tree: lock.core.candidate, candidate: null };
  writerOf(world)(root, LOCK_FILE, encodeLock(lock));
  return { promoted: true };
}

/**
 * rig pin set <pack> [--ported]. Without --ported: re-fetch candidate.sha, select with candidate.exclude, refuse
 * unless the tree and the detected license equal candidate.tree and candidate.license, delete the files that are not in the candidate, write the new ones, write the
 * new license into pack.json when it differs from the locked one, then move sha, tree, license, exclude and port.tree
 * in the lock. A raw fs error becomes E_PIN_WRITE. The lock is written last, so a failed run leaves the candidate for
 * a retry. An adopted pack has no vendored files, so it moves sha and port.tree with no fetch. With --ported:
 * reviewed_sha and reviewed_tree take sha and port.tree, and an adopted pack's tree takes the hash of its folder. No
 * fetch; a second call writes nothing.
 * core: promote the candidate seal to `core.tree`.
 */
export async function pinSet(world: object, name: string, opts: {ported?: boolean} = {}): Promise<{promoted: boolean, attested?: boolean, sha?: string, port?: PortStatus, error?: {code: string, message: string}}> {
  if (name === "core") {
    if (opts.ported) throw new LockError("E_USAGE", "rig pin set core does not take --ported");
    return coreSet(world);
  }
  const { dir: root, lock, entry } = locate(world, name);
  const adopted = entry.paths.length === 0;
  const write = writerOf(world);

  if (opts.ported) {
    if (!entry.port) throw new LockError("E_USAGE", `${name} has no port record; rig pack add --port writes one`);
    const tree = adopted ? treeHash(packDirOf(root, name)) : entry.tree;
    const next = { ...entry, tree, port: { ...entry.port, reviewed_sha: entry.sha, reviewed_tree: entry.port.tree } };
    const attested = JSON.stringify(next) !== JSON.stringify(entry);
    if (attested) {
      lock.packs[name] = next;
      await write(root, LOCK_FILE, encodeLock(lock));
    }
    return { promoted: false, attested, sha: entry.sha, port: "fresh" };
  }

  const c = entry.candidate;
  if (!c) return refuse(`${name} has no candidate; run rig pin check ${name} --sha <sha> first`);
  let { tree, license } = entry;
  if (!adopted) {
    const got = await withClone(entry.repo, c.sha, async ({ dir, entries }) => {
      const { files } = await vendoredFiles(dir, entries, entry.root, entry.paths, c.exclude);
      return { files, license: await detectLicense(dir, entries, entry.paths.map((p: string) => repoPath(entry.root, p)), files.map((f) => repoPath(entry.root, f.path))) };
    });
    tree = treeHash(got.files);
    if (tree !== c.tree) {
      return refuse(`the files of ${name} at ${c.sha} with the candidate excludes hash to ${tree}, not to the candidate ${c.tree}; run rig pin check ${name} again`);
    }
    if (got.license !== c.license) {
      return refuse(`the license of ${name} at ${c.sha} with the candidate excludes is ${got.license}, not the checked ${c.license ?? "none"}; run rig pin check ${name} again`);
    }
    license = got.license;
    const keep = new Set(got.files.map((f) => f.path));
    const disk = packDirOf(root, name);
    try {
      for (const f of disk) {
        if (f.path !== "pack.json" && !keep.has(f.path)) await write(root, `packs/${name}/${f.path}`, null);
      }
      for (const f of got.files) await write(root, `packs/${name}/${f.path}`, f.bytes, f.mode);
      const manifestFile = disk.find((f) => f.path === "pack.json");
      if (manifestFile && license !== entry.license) {
        const manifest = JSON.parse(Buffer.from(manifestFile.bytes).toString("utf8"));
        await write(root, `packs/${name}/pack.json`, canonicalJson({ ...manifest, license }), 0o644);
      }
    } catch (e) {
      const err = e as Error & {code?: unknown};
      if (typeof err.code === "string" && err.code.startsWith("E_")) throw e;
      throw new LockError("E_PIN_WRITE", `cannot write packs/${name}: ${err.message}; the lock is unchanged, so fix the cause and run rig pin set ${name} again`, `packs/${name}`);
    }
  }
  const port = entry.port && { ...entry.port, tree: c.port_tree };
  lock.packs[name] = { ...entry, sha: c.sha, exclude: c.exclude, license, tree, port, candidate: null };
  await write(root, LOCK_FILE, encodeLock(lock));
  return { promoted: true, sha: c.sha, port: portStatus(port) };
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
