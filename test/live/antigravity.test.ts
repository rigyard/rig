// Live Antigravity lanes. The agent listing runs `agy agents` on the fixture HOME: it needs no login. The model lanes run
// agy with the real HOME (agy has no config-dir flag, and a temp HOME loses the login) in a scratch workspace that mirrors
// the fixture units into its .agents/ root, and the path guard fails a pass that comes from the real user scope.

import assert from "node:assert/strict";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe } from "node:test";
import type { TestContext } from "node:test";
import { ANTIGRAVITY, assertMention, pathGuard, readsPath, runAgy } from "../helpers/path-guard.ts";
import { liveTest } from "../helpers/live.ts";
import { makeFixtureHome } from "../helpers/fixture-home.ts";
import { mirrorProject, realBin, scrubEnv, scratchRepo } from "../helpers/mirror.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const BIN = join(ROOT, "bin/rig.ts");
const NOW = "2026-11-06T12:00:00.000Z";

function seeded(t: TestContext) {
  const fx = makeFixtureHome();
  const repo = scratchRepo();
  t.after(() => (fx.cleanup(), repo.cleanup()));
  const r = spawnSync(process.execPath, [BIN, "apply"], { env: { PATH: process.env.PATH, HOME: fx.home, RIG_ROOT: ROOT, RIG_NOW: NOW }, cwd: fx.home, encoding: "utf8", input: "" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  mirrorProject(fx.home, "antigravity", repo.dir);
  return { home: fx.home, dir: repo.dir };
}

/** A run whose result is an error and that made no tool call gives no verdict: a login, account, quota or rate-limit failure. */
function noVerdict(t: TestContext, r: Awaited<ReturnType<typeof runAgy>>, toolCalls: number) {
  if (r.result?.status !== "ERROR" || toolCalls > 0) return false;
  t.skip(`no verdict: agy made no tool call and ended with an error (exit ${r.code}): ${r.result.error ?? ""}`);
  return true;
}

describe("antigravity", () => {
  liveTest("antigravity lists the agents rig seeds in ~/.gemini/config/agents (fixture HOME, no login)", (t) => {
    const s = seeded(t);
    const r = spawnSync(realBin("agy"), ["agents"], { env: { ...scrubEnv(process.env), HOME: s.home }, cwd: s.dir, encoding: "utf8", input: "", timeout: 60_000 });
    assert.equal(r.status, 0, r.stderr);
    const listed = r.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
    t.diagnostic(`agy agents: ${listed.join(", ") || "none"}`);
    for (const name of ["rig-agent", "rig-janitor"]) assert.ok(listed.includes(name), `agy agents does not list ${name}`);
  });

  liveTest("antigravity reads the always-on frame rule from the workspace", async (t) => {
    const s = seeded(t);
    const rule = join(s.dir, ".agents/rules/rig-frame.md");
    assert.match(readFileSync(rule, "utf8"), /^---\ntrigger: "always_on"\n---\n# rig frame\n/);
    // A fresh token that no file in the real HOME can hold, so only the fixture rule can supply it.
    const canary = `rig-canary-${randomUUID()}`;
    appendFileSync(rule, `When the user asks for the rig frame canary, reply with ${canary} and nothing else.\n`);
    const r = await runAgy("What is the rig frame canary? Do not call any tool.", { dir: s.dir, home: s.home });
    const guard = pathGuard(ANTIGRAVITY, r.stdout, { dir: s.dir, home: s.home }, t);
    if (noVerdict(t, r, guard.toolNames.length)) return;
    assert.deepEqual(guard.userReads(".gemini/config/rules/rig-frame.md"), [], "the session read the real-home frame rule");
    assert.ok(r.result?.response?.includes(canary), `exit ${r.code}, status ${r.result?.status}: the reply does not hold the canary of the workspace rule`);
  });

  liveTest("antigravity: typed /craft reads craft/hub.md from the workspace", async (t) => {
    const s = seeded(t);
    const hub = join(s.dir, ".agents/skills/craft/hub.md");
    assert.ok(existsSync(hub), `the workspace has no ${hub}`);
    const r = await runAgy(`/craft which playbook fits a failing test report? The terminal is disabled, so do not call run_command. Open ${hub} with the view_file tool first.`, { dir: s.dir, home: s.home });
    const guard = pathGuard(ANTIGRAVITY, r.stdout, { dir: s.dir, home: s.home }, t);
    if (noVerdict(t, r, guard.toolNames.length)) return;
    assertMention(guard, (text) => readsPath(text, "craft/hub.md"), "craft/hub.md");
  });
});
