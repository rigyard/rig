// Opt-in tests against real harness CLIs. They cost tokens and need logins, so they run only with RIG_LIVE=1.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { scrubEnv } from "./mirror.ts";

export const LIVE_SKIP_REASON = "live harness test: set RIG_LIVE=1 to run (costs tokens, needs logins)";

/**
 * Real user-level harness config that no live test may change, relative to the real home.
 * The first three are files the boot recipe names. It also names installed_plugins.json, which is not listed here: Claude
 * rewrites it on its own, so guardRealConfig records its hash as a diagnostic and never fails on it.
 * A directory is hashed as a whole tree, minus HARNESS_OWNED.
 */
export const REAL_CONFIG_PATHS = [
  ".claude/settings.json",
  ".codex/config.toml",
  ".omp/agent/config.yml",
  ".claude/CLAUDE.md",
  ".claude/commands",
  ".claude/skills",
  ".claude/rules",
  ".claude/agents",
  ".codex/AGENTS.md",
  ".codex/pstack-models.md",
  ".codex/skills",
  ".codex/prompts",
  ".codex/agents",
  ".cursor/rules",
  ".cursor/agents",
  ".cursor/skills",
  ".cursor/commands",
  ".cursor/plugins/local",
  ".omp/agent/AGENTS.md",
  ".omp/agent/pstack-models.md",
  ".omp/agent/commands",
  ".omp/agent/skills",
  ".agents/skills",
  ".agents/commands",
  ".gemini/settings.json",
  ".gemini/antigravity-cli/settings.json",
  ".gemini/config/skills.json",
  ".gemini/config/rules",
  ".gemini/config/agents",
];

const UUID = "[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}";
const ID = `${UUID}_${UUID}`;

/**
 * Paths under a hashed config path that the harness writes by itself in any session, so a live lane cannot tell them
 * from a rig write by their bytes. path matches a home-relative path with "/" separators. tree: the entry and
 * everything below it is skipped; otherwise only the entry itself is.
 * Each shape is narrow on purpose, and a rig skill named "synced" is still hashed. A rig skill is a pack's own tree, and no
 * seeded pstack or gstack tree holds a "<uuid>_<uuid>" folder or a ".bucket-" file. test/live-guard.test.ts pins that no path
 * rig could place and no seeded file (test/golden/first-seed.manifest) is owned.
 */
export const HARNESS_OWNED: readonly { path: RegExp; tree: boolean; reason: string }[] = [
  {
    path: /^\.claude\/skills\/synced$/,
    tree: false,
    reason: "The folder Claude Code creates for the skills it syncs from the user's claude.ai account; the claude binary names ~/.claude/skills/synced. Only the folder entry is skipped, so a rig skill named synced is still hashed.",
  },
  {
    path: new RegExp(`^\\.claude\\/skills\\/synced\\/\\.bucket-${ID}$`),
    tree: true,
    reason: "The claude binary defines the .bucket- prefix for the per-account marker file of the skill sync.",
  },
  {
    path: new RegExp(`^\\.claude\\/skills\\/synced\\/${ID}(?:\\/.*)?$`),
    tree: true,
    reason: "One synced account bucket (manifest.json, .last-complete-round, .staging, one folder per skill). Claude Code rewrites it during any session, with no rig command running.",
  },
];

/** @param rel home-relative path with "/" separators */
export const isHarnessOwned = (rel: string): boolean => HARNESS_OWNED.some((e) => e.path.test(rel));

/** Claude rewrites this file when it auto-updates a plugin (lastUpdated of two plugins equals the file mtime), so no lane fails on it. rig never writes under ~/.claude/plugins (targets/claude.json never_write). */
export const PLUGIN_REGISTRY = ".claude/plugins/installed_plugins.json";

/** The real home from the account database, so a test that set HOME cannot hide it. */
export const realHome = () => realpathSync(userInfo().homedir);

const sha256 = (b) => createHash("sha256").update(b).digest("hex");

/** sha256 of one path: file bytes, a symlink's target text, or every entry of a tree. Symlinks are never followed. */
function hashPath(abs: string, top: string) {
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
      const owned = HARNESS_OWNED.find((e) => e.path.test(`${top}/${r}`));
      if (owned?.tree) continue;
      const s = lstatSync(a);
      if (s.isDirectory()) {
        if (!owned) lines.push(`d ${r} ${s.mode & 0o7777}`);
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
  return Object.fromEntries(REAL_CONFIG_PATHS.map((rel) => [rel, hashPath(join(root, rel), rel)]));
}

/** @returns changed paths */
export function changedPaths(before: Record<string, string | null>, after: Record<string, string | null>): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => before[k] !== after[k]).sort();
}

/**
 * Wrap a test fn: hash the real config before and after it, and fail when any hash changed.
 * A config change wins over the fn's own failure, which becomes the cause.
 * The hash of PLUGIN_REGISTRY is recorded with t.diagnostic when it changed, and never fails the test.
 */
export function guardRealConfig(fn: (t: TestContext) => unknown, root: string = realHome()) {
  return async (t) => {
    const before = realConfigHashes(root);
    const registryBefore = hashPath(join(root, PLUGIN_REGISTRY), PLUGIN_REGISTRY);
    let failure = null;
    try {
      await fn(t);
    } catch (err) {
      failure = err;
    }
    const registryAfter = hashPath(join(root, PLUGIN_REGISTRY), PLUGIN_REGISTRY);
    if (registryBefore !== registryAfter) t.diagnostic?.(`${PLUGIN_REGISTRY} changed (Claude Code plugin auto-update, informational): ${registryBefore ?? "absent"} -> ${registryAfter ?? "absent"}`);
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
 * Without env the child gets process.env through scrubEnv, so it inherits no ORCA_* key and no key that relocates its config.
 * A passed env is used as is: harnessArgv and ompEnv scrub it already and then set HOME, CODEX_HOME or PI_CODING_AGENT_DIR on purpose.
 * On timeout the child gets SIGKILL and code is null.
 * @param {{bin: string, args?: string[], cwd?: string, env?: NodeJS.ProcessEnv, timeoutMs?: number, input?: string}} opts
 * @returns {Promise<{code: number | null, signal: string | null, stdout: string, stderr: string, json: unknown}>}
 */
export function runHarness({ bin, args = [], cwd = process.cwd(), env = scrubEnv(process.env), timeoutMs = 120_000, input }) {
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

const OMP_MODEL_SKIP_REASON = "omp live test: set RIG_LIVE_OMP_MODEL to a model omp can call, for example provider/model (without it omp falls back to a provider that can hit its daily cap)";

/**
 * The omp argv fragment that selects the model, from RIG_LIVE_OMP_MODEL (omp --model takes a fuzzy name or provider/model).
 * With the variable unset or blank, args is empty and skip holds the reason.
 */
export function ompModelArgs(env: NodeJS.ProcessEnv = process.env): { args: string[]; skip: string | null } {
  const model = env.RIG_LIVE_OMP_MODEL?.trim();
  return model ? { args: ["--model", model], skip: null } : { args: [], skip: OMP_MODEL_SKIP_REASON };
}

/** liveTest for a case that calls an omp model: with RIG_LIVE=1 and no RIG_LIVE_OMP_MODEL it is reported as skipped, with the reason. */
export function liveOmpTest(name: string, fn: (t: TestContext) => unknown) {
  const { skip } = ompModelArgs();
  if (process.env.RIG_LIVE === "1" && skip) return test(name, { skip }, () => {});
  return liveTest(name, fn);
}
