import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git, gitEnv } from "../lib/lock/git.ts";
import { cleanup, makeRepo, scratch } from "./lock.helpers.ts";

const PAIRS: string[][] = [["maintenance.auto", "false"], ["gc.auto", "0"]];

function configPairs(env: Record<string, string | undefined>) {
  const n = Number(env.GIT_CONFIG_COUNT);
  return Array.from({ length: n }, (_, i) => [env[`GIT_CONFIG_KEY_${i}`], env[`GIT_CONFIG_VALUE_${i}`]]);
}

test("gitEnv carries maintenance.auto=false and gc.auto=0", () => {
  assert.deepEqual(configPairs(gitEnv({ PATH: "/usr/bin" })), PAIRS);
});

test("gitEnv ignores GIT_CONFIG_* from the caller, as it ignores every GIT_* variable", () => {
  const env = gitEnv({ PATH: "/usr/bin", GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.fsmonitor", GIT_CONFIG_VALUE_0: "touch /tmp/x", GIT_DIR: "/elsewhere" });
  assert.deepEqual(configPairs(env), PAIRS);
  assert.equal(env.GIT_DIR, undefined);
  assert.equal(env.GIT_CONFIG_KEY_2, undefined);
});

test("every git() spawn sees maintenance.auto=false and gc.auto=0", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rig-lock-test-"));
  try {
    await git(["init", "-q", "--template=", dir]);
    assert.equal((await git(["config", "--get", "maintenance.auto"], { cwd: dir })).toString().trim(), "false");
    assert.equal((await git(["config", "--get", "gc.auto"], { cwd: dir })).toString().trim(), "0");
  } finally {
    cleanup(dir);
  }
});

test("a fetch under gitEnv starts no git maintenance, and one without it does", () => {
  const base = scratch();
  try {
    const { url, shas } = makeRepo(base, [{ "a.txt": "a" }]);
    const fetchTrace = (env: Record<string, string | undefined>) => {
      const dst = mkdtempSync(join(base, "dst-"));
      const run = (args: string[]) => spawnSync("git", args, { cwd: dst, env: { ...env, GIT_TRACE: "1" }, encoding: "utf8" });
      assert.equal(run(["init", "-q", "--template=", dst]).status, 0);
      const r = run(["fetch", "-q", "--depth", "1", "--no-tags", "--", url, shas[0]]);
      assert.equal(r.status, 0, r.stderr);
      return r.stderr;
    };
    assert.match(fetchTrace({ ...gitEnv(), GIT_CONFIG_COUNT: "0" }), /maintenance/, "control: plain git must start maintenance, else this test pins nothing");
    assert.doesNotMatch(fetchTrace(gitEnv()), /maintenance/);
  } finally {
    rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
