// Opt-in tests against real harness CLIs. They cost tokens and need logins, so they run only with RIG_LIVE=1.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";

export const LIVE_SKIP_REASON = "live harness test: set RIG_LIVE=1 to run (costs tokens, needs logins)";

/**
 * Real user-level harness config that no live test may change, relative to the real home.
 * The first four are the files the boot recipe names. A directory is hashed as a whole tree.
 */
export const REAL_CONFIG_PATHS = [
  ".claude/settings.json",
  ".claude/plugins/installed_plugins.json",
  ".codex/config.toml",
  ".omp/agent/config.yml",
  ".claude/CLAUDE.md",
  ".claude/commands",
  ".claude/skills",
  ".claude/rules",
  ".claude/agents",
  ".codex/AGENTS.md",
  ".codex/skills",
  ".codex/prompts",
  ".cursor/rules",
  ".cursor/skills",
  ".cursor/commands",
  ".cursor/plugins/local",
  ".omp/agent/AGENTS.md",
  ".omp/agent/commands",
  ".omp/agent/skills",
  ".agents/skills",
  ".agents/commands",
];

/** The real home from the account database, so a test that set HOME cannot hide it. */
export const realHome = () => realpathSync(userInfo().homedir);

const sha256 = (b) => createHash("sha256").update(b).digest("hex");

/** sha256 of one path: file bytes, a symlink's target text, or every entry of a tree. Symlinks are never followed. */
function hashPath(abs) {
  let st;
  try {
    st = lstatSync(abs);
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
  if (st.isSymbolicLink()) return sha256(`link:${readlinkSync(abs)}`);
  if (st.isFile()) return sha256(readFileSync(abs));
  if (!st.isDirectory()) return sha256(`other:${st.mode}`);
  const lines = [];
  const walk = (dir, rel) => {
    for (const name of readdirSync(dir).sort()) {
      const a = join(dir, name);
      const r = rel ? `${rel}/${name}` : name;
      const s = lstatSync(a);
      if (s.isDirectory()) {
        lines.push(`d ${r} ${s.mode & 0o7777}`);
        walk(a, r);
      } else if (s.isSymbolicLink()) lines.push(`l ${r} ${readlinkSync(a)}`);
      else if (s.isFile()) lines.push(`f ${r} ${s.mode & 0o7777} ${sha256(readFileSync(a))}`);
      else lines.push(`o ${r} ${s.mode}`);
    }
  };
  walk(abs, "");
  return sha256(lines.join("\n"));
}

/**
 * sha256 of every REAL_CONFIG_PATHS entry under root; null for an absent path.
 * @param root defaults to the real home
 */
export function realConfigHashes(root: string = realHome()): Record<string, string | null> {
  return Object.fromEntries(REAL_CONFIG_PATHS.map((rel) => [rel, hashPath(join(root, rel))]));
}

/** @returns changed paths */
export function changedPaths(before: Record<string, string | null>, after: Record<string, string | null>): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => before[k] !== after[k]).sort();
}

/**
 * Wrap a test fn: hash the real config before and after it, and fail when any hash changed.
 * A config change wins over the fn's own failure, which becomes the cause.
 */
export function guardRealConfig(fn: (t: TestContext) => unknown, root: string = realHome()) {
  return async (t) => {
    const before = realConfigHashes(root);
    let failure = null;
    try {
      await fn(t);
    } catch (err) {
      failure = err;
    }
    const changed = changedPaths(before, realConfigHashes(root));
    if (changed.length) throw new Error(`live: the real harness config changed: ${changed.join(", ")}`, { cause: failure ?? undefined });
    if (failure) throw failure;
  };
}

/**
 * Register a test that runs only when RIG_LIVE=1. Otherwise it is reported as skipped, with the reason.
 * A live run fails when it changes any REAL_CONFIG_PATHS entry.
 */
export function liveTest(name: string, fn: (t: TestContext) => unknown) {
  if (process.env.RIG_LIVE === "1") return test(name, guardRealConfig(fn));
  return test(name, { skip: LIVE_SKIP_REASON }, fn);
}

/**
 * Run one CLI to completion and collect its output. json is JSON.parse(stdout), or null when stdout is not JSON.
 * On timeout the child gets SIGKILL and code is null.
 * @param {{bin: string, args?: string[], cwd?: string, env?: NodeJS.ProcessEnv, timeoutMs?: number, input?: string}} opts
 * @returns {Promise<{code: number | null, signal: string | null, stdout: string, stderr: string, json: unknown}>}
 */
export function runHarness({ bin, args = [], cwd = process.cwd(), env = process.env, timeoutMs = 120_000, input }) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (d) => (stdout += d));
    child.stderr.setEncoding("utf8").on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      let json = null;
      try {
        json = JSON.parse(stdout);
      } catch {
        // not JSON: json stays null
      }
      resolve({ code, signal, stdout, stderr, json });
    });
    child.stdin.end(input ?? "");
  });
}
