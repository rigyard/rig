// Git access for lib/lock.ts. Nothing from a fetched repo is ever checked out or run: the tree is read from the
// object store with ls-tree and cat-file, so no hook, filter, smudge or exec bit can fire.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LockError } from "./errors.ts";

// git 2.54 starts `git maintenance run --auto --detach` after every fetch. That process can still write in a
// scratch clone when withClone deletes it, so maintenance and gc are off for every call.
const CONFIG: [string, string][] = [["maintenance.auto", "false"], ["gc.auto", "0"]];

/** The environment for every git child: no GIT_* from `base`, no config files, no prompts, no auto maintenance. */
export function gitEnv(base: NodeJS.ProcessEnv = process.env): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(base)) if (!k.startsWith("GIT_")) env[k] = v;
  CONFIG.forEach(([key, value], i) => {
    env[`GIT_CONFIG_KEY_${i}`] = key;
    env[`GIT_CONFIG_VALUE_${i}`] = value;
  });
  return {
    ...env,
    GIT_CONFIG_COUNT: String(CONFIG.length),
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_ALLOW_PROTOCOL: "file:http:https:ssh:git",
  };
}

const ENV = gitEnv();

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
 * Fetch one commit into the repo at `dir`. Tries a depth-1 fetch by SHA, then falls back to fetching every
 * branch and tag. Returns the full commit id.
 */
async function fetchCommit(dir: string, repo: string, sha: string) {
  if (typeof sha !== "string" || !/^[0-9a-f]{40}$/.test(sha)) throw new LockError("E_USAGE", `bad sha: ${JSON.stringify(sha)}`);
  let ref = "FETCH_HEAD";
  try {
    await git(["fetch", "-q", "--depth", "1", "--no-tags", "--", repo, sha], { cwd: dir });
  } catch {
    ref = sha;
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
  if (full !== sha) throw new LockError("E_FETCH", `fetched commit ${full} does not match ${sha}`);
  return full;
}

/** One entry of a commit's tree. size is the blob byte count, 0 for a submodule. */
export type TreeEntry = {mode: string, type: string, oid: string, size: number, path: string};

/** Every entry of the commit's tree. */
export async function listTree(dir, commit): Promise<TreeEntry[]> {
  const out = (await git(["ls-tree", "-r", "-l", "-z", "--full-tree", commit], { cwd: dir })).toString("utf8");
  const entries = [];
  for (const rec of out.split("\0")) {
    if (!rec) continue;
    const tab = rec.indexOf("\t");
    const [mode, type, oid, size] = rec.slice(0, tab).split(/ +/);
    entries.push({ mode, type, oid, size: size === "-" ? 0 : Number(size), path: rec.slice(tab + 1) });
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
 * With `base`, that commit is fetched into the same repo too, so `fn` can diff against it. The scratch dir lies
 * outside every config root.
 */
export async function withClone<T>(repo: string, sha: string, fn: (c: {dir: string, commit: string, entries: TreeEntry[]}) => Promise<T>, base: string | null = null): Promise<T> {
  if (typeof repo !== "string" || repo === "" || repo.startsWith("-") || /[\s\0]/.test(repo)) {
    throw new LockError("E_USAGE", `bad repo location: ${JSON.stringify(repo)}`);
  }
  const tmp = mkdtempSync(join(tmpdir(), "rig-lock-"));
  try {
    await git(["init", "-q", "--template=", tmp]);
    const commit = await fetchCommit(tmp, repo, sha);
    if (base !== null && base !== commit) await fetchCommit(tmp, repo, base);
    return await fn({ dir: tmp, commit, entries: await listTree(tmp, commit) });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
