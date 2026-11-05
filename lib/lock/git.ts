// Git access for lib/lock.ts. Nothing from a fetched repo is ever checked out or run: the tree is read from the
// object store with ls-tree and cat-file, so no hook, filter, smudge or exec bit can fire.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LockError } from "./errors.ts";

const ENV = (() => {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith("GIT_")) env[k] = v;
  return {
    ...env,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_ALLOW_PROTOCOL: "file:http:https:ssh:git",
  };
})();

export function git(args: string[], opts: {cwd?: string, input?: Uint8Array} = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd: opts.cwd, env: ENV, stdio: ["pipe", "pipe", "pipe"] });
    const out = [];
    const err = [];
    child.stdout.on("data", (c) => out.push(c));
    child.stderr.on("data", (c) => err.push(c));
    child.on("error", (e) => reject(new LockError("E_GIT", `git could not start: ${e.message}`)));
    child.on("close", (code) => {
      if (code === 0) return resolve(Buffer.concat(out));
      reject(new LockError("E_GIT", `git ${args[0]} failed (${code}): ${Buffer.concat(err).toString("utf8").trim()}`));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(opts.input);
  });
}

/**
 * Fetch one commit into an empty repo at `dir`. Tries a depth-1 fetch by SHA, then falls back to fetching every
 * branch and tag. Returns the full commit id.
 * @param sha  7 to 40 hex chars
 */
export async function fetchCommit(dir: string, repo: string, sha: string) {
  if (typeof repo !== "string" || repo === "" || repo.startsWith("-") || /[\s\0]/.test(repo)) {
    throw new LockError("E_USAGE", `bad repo location: ${JSON.stringify(repo)}`);
  }
  if (typeof sha !== "string" || !/^[0-9a-f]{7,40}$/i.test(sha)) throw new LockError("E_USAGE", `bad sha: ${JSON.stringify(sha)}`);
  await git(["init", "-q", "--template=", dir]);
  let ref = "FETCH_HEAD";
  try {
    await git(["fetch", "-q", "--depth", "1", "--no-tags", "--", repo, sha], { cwd: dir });
  } catch {
    ref = sha.toLowerCase();
    try {
      await git(["fetch", "-q", "--no-tags", "--", repo, "+refs/heads/*:refs/rig/heads/*", "+refs/tags/*:refs/rig/tags/*"], { cwd: dir });
    } catch (e) {
      throw new LockError("E_FETCH", `cannot fetch ${repo} at ${sha}: ${e.message}`);
    }
  }
  let full;
  try {
    full = (await git(["rev-parse", "--verify", "-q", `${ref}^{commit}`], { cwd: dir })).toString("utf8").trim();
  } catch {
    throw new LockError("E_FETCH", `commit ${sha} not found in ${repo}`);
  }
  if (!full.startsWith(sha.toLowerCase())) throw new LockError("E_FETCH", `fetched commit ${full} does not match ${sha}`);
  return full;
}

/** Every entry of the commit's tree. */
export async function listTree(dir, commit): Promise<{mode: string, type: string, oid: string, path: string}[]> {
  const out = (await git(["ls-tree", "-r", "-z", "--full-tree", commit], { cwd: dir })).toString("utf8");
  const entries = [];
  for (const rec of out.split("\0")) {
    if (!rec) continue;
    const tab = rec.indexOf("\t");
    const [mode, type, oid] = rec.slice(0, tab).split(" ");
    entries.push({ mode, type, oid, path: rec.slice(tab + 1) });
  }
  return entries;
}

/** Blob bytes for each oid, in order. */
export async function readBlobs(dir, oids: string[]): Promise<Buffer[]> {
  if (oids.length === 0) return [];
  const raw = await git(["cat-file", "--batch"], { cwd: dir, input: Buffer.from(oids.join("\n") + "\n") });
  const blobs = [];
  let pos = 0;
  for (const oid of oids) {
    const nl = raw.indexOf(10, pos);
    const [got, type, size] = raw.subarray(pos, nl).toString("utf8").split(" ");
    if (got !== oid || type !== "blob") throw new LockError("E_GIT", `object ${oid} is not a blob`);
    const start = nl + 1;
    blobs.push(raw.subarray(start, start + Number(size)));
    pos = start + Number(size) + 1;
  }
  return blobs;
}

/**
 * Fetch `sha` of `repo` into a scratch repo, run `fn` on its tree listing, and always delete the scratch dir.
 * The scratch dir lies outside every config root.
 * @template T @param {string} repo @param {string} sha
 * @param {(c: {dir: string, commit: string, entries: Awaited<ReturnType<typeof listTree>>}) => Promise<T>} fn
 */
export async function withClone(repo, sha, fn) {
  const tmp = mkdtempSync(join(tmpdir(), "rig-lock-"));
  try {
    const commit = await fetchCommit(tmp, repo, sha);
    return await fn({ dir: tmp, commit, entries: await listTree(tmp, commit) });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
