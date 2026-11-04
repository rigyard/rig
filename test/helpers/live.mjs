// Opt-in tests against real harness CLIs. They cost tokens and need logins, so they run only with RIG_LIVE=1.

import { spawn } from "node:child_process";
import { test } from "node:test";

export const LIVE_SKIP_REASON = "live harness test: set RIG_LIVE=1 to run (costs tokens, needs logins)";

/**
 * Register a test that runs only when RIG_LIVE=1. Otherwise it is reported as skipped, with the reason.
 * @param {string} name @param {import("node:test").TestFn} fn
 */
export function liveTest(name, fn) {
  if (process.env.RIG_LIVE === "1") return test(name, fn);
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
