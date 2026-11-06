// Live port cases: re-pin the gstack product port, mark a pstack hub port stale, and run /rig-port in Claude Code.
// Opt-in: RIG_LIVE=1. RIG_LIVE_GSTACK and RIG_LIVE_PLUGINS override the upstream URLs, for example with file:// clones.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe } from "node:test";
import { treeHash } from "../../lib/tree.ts";
import { makeFixtureHome } from "../helpers/fixture-home.ts";
import { liveTest, runHarness } from "../helpers/live.ts";
import { harnessArgv, realBin, scratchRepo } from "../helpers/mirror.ts";
import { attestedLast, toolCalls } from "../helpers/transcript.ts";
import { cleanup, makeRepo, scratch } from "../lock.helpers.ts";
import { filesUnder, json, repoJson, ROOT } from "../pstack.helpers.ts";

const BIN = join(ROOT, "bin/rig.ts");
const GSTACK = process.env.RIG_LIVE_GSTACK || "https://github.com/garrytan/gstack";
const PLUGINS = process.env.RIG_LIVE_PLUGINS || "https://github.com/cursor/plugins";
const GS_PORTED = "b244e6d11a6466650c5147cd7dc023859968c4b5";
const GS_NEW = "b4068209809315ab1578c78e33e73512b29749ca";
const PS_OLD = "a968159326d1fc6b7d483491ec5c457986a20af2";
const PS_NEW = "2776ddd2355d6d6c8747d3964600f28daf62f049";
const HUB = "skills/poteto-mode/SKILL.md";

type Extra = Record<string, string | Uint8Array>;

/**
 * A config root with packs/core, models and targets of trunk, no fill, and only the packs in `enable` in rig.json.
 * `fromTrunk` names the enabled packs whose folder is copied from trunk. The lock holds the core seal and no pack entry:
 * a pack gets its entry from `rig pack add`, and an enabled pack without one blocks the plan (lib/gate/pin.ts:19).
 */
function configRoot(dir: string, enable: string[], extra: Extra, fromTrunk: string[] = []) {
  const cfg = repoJson("rig.json");
  for (const sub of ["models", "targets", "packs/core", ...fromTrunk.map((n) => `packs/${n}`)]) {
    for (const f of filesUnder(join(ROOT, sub))) {
      mkdirSync(join(dir, sub, f.path, ".."), { recursive: true });
      writeFileSync(join(dir, sub, f.path), f.bytes);
      chmodSync(join(dir, sub, f.path), f.mode);
    }
  }
  const files: Extra = { ...extra, "rig.json": json({ ...cfg, fill: {}, packs: Object.fromEntries(enable.map((p) => [p, {}])) }) };
  for (const [rel, bytes] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), bytes);
  }
  const core = { tree: treeHash(filesUnder(join(dir, "packs/core")), { core: true }), candidate: null };
  writeFileSync(join(dir, "rig.lock.json"), json({ schema: 2, core, packs: {} }));
}

function setup(t: {after: (fn: () => void) => void}, enable: string[] = [], extra: Extra = {}, fromTrunk: string[] = []) {
  const fx = makeFixtureHome({});
  t.after(() => fx.cleanup());
  const root = fx.path("rig");
  configRoot(root, enable, extra, fromTrunk);
  const env = { PATH: process.env.PATH, HOME: fx.home, RIG_ROOT: root, RIG_NOW: "2026-11-05T12:00:00.000Z" };
  const rig = (...args: string[]) => {
    const r = spawnSync(process.execPath, [BIN, ...args], { env, cwd: fx.home, encoding: "utf8", timeout: 300_000 });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr, all: r.stdout + r.stderr };
  };
  return { fx, root, rig };
}

const skill = (name: string, body: string) => `---\nname: ${name}\ndescription: ${name} skill.\n---\n${body}\n`;

describe("port", () => {
  liveTest("gstack office-hours re-pins without a port", async (t) => {
    const { rig } = setup(t, ["product"], {}, ["product"]);
    const add = rig("pack", "add", GSTACK, "--sha", GS_PORTED, "--name", "product", "--port", "office-hours/SKILL.md", "--port", "office-hours/sections", "--port", "LICENSE");
    assert.equal(add.code, 0, add.all);
    assert.match(add.stdout, /^adopted product in packs\/product\/ /m);
    assert.equal(rig("pin", "set", "product", "--ported").code, 0);
    const check = rig("pin", "check", "product", "--sha", GS_NEW);
    assert.equal(check.code, 0, check.all);
    assert.deepEqual(check.stdout.match(/^port \w+: .*$/gm), ["port fresh: LICENSE, office-hours/SKILL.md, office-hours/sections"]);
    const set = rig("pin", "set", "product");
    assert.equal(set.stdout, `promoted the product candidate to current at ${GS_NEW}\n`);
    const plan = rig("plan");
    assert.equal(plan.code, 0, plan.all);
    assert.match(plan.stdout, / 0 blocks$/m);
  });

  liveTest("pstack hub change marks the port stale", async (t) => {
    const extra = {
      "packs/pstack/pack.json": json({ schema: 2, name: "pstack", scopes: ["machine-hidden"], license: "MIT", units: {} }),
      "packs/pstack/skills/scratch/SKILL.md": skill("scratch", "A scratch port of the pstack hub."),
    };
    const { rig } = setup(t, ["pstack"], extra);
    const add = rig("pack", "add", PLUGINS, "--sha", PS_OLD, "--root", "pstack", "--name", "pstack", "--port", HUB);
    assert.equal(add.code, 0, add.all);
    assert.equal(rig("pin", "set", "pstack", "--ported").code, 0);
    const check = rig("pin", "check", "pstack", "--sha", PS_NEW);
    assert.equal(check.code, 0, check.all);
    assert.match(check.stdout, new RegExp(`^port stale: ${HUB}$`, "m"));
    assert.equal(rig("pin", "set", "pstack").code, 0);
    const review = rig("pin", "check", "pstack", "--diff");
    assert.equal(review.code, 0, review.all);
    assert.match(review.stdout, new RegExp(`^--- a/${HUB}\\n\\+\\+\\+ b/${HUB}$`, "m"), "diff paths are relative to the root");
    const plan = rig("plan");
    assert.equal(plan.code, 1, plan.all);
    assert.match(plan.stdout, /^block pin pstack\/\.: E_PORT_STALE pstack: /m);
    assert.match(plan.stdout, / 1 block$/m, "the stale port is the only block");
  });

  liveTest("claude runs rig-port on a stale fixture", async (t) => {
    const base = scratch();
    t.after(() => cleanup(base));
    const upstream = makeRepo(base, [
      { LICENSE: readFileSync(join(ROOT, "packs/product/licenses/MIT-gstack.txt"), "utf8"), "hub/SKILL.md": skill("hub", "Route the work.") },
      { "hub/SKILL.md": skill("hub", "Route the work, then verify it with a test.") },
    ]);
    const repo = scratchRepo();
    t.after(() => repo.cleanup());
    const fx = makeFixtureHome({});
    t.after(() => fx.cleanup());
    configRoot(repo.dir, ["fixture"], {
      ".claude/skills/rig-port/SKILL.md": readFileSync(join(ROOT, ".claude/skills/rig-port/SKILL.md")),
      "packs/fixture/pack.json": json({ schema: 2, name: "fixture", scopes: ["machine-hidden"], license: "MIT", units: {}, mode: { sections: { route: { domain: "engineering", text: "Route the work." } } } }),
      "packs/fixture/skills/fixture/SKILL.md": skill("fixture", "Read the route in pack.json."),
    });
    const binDir = join(base, "bin");
    mkdirSync(binDir);
    writeFileSync(join(binDir, "rig"), `#!/bin/sh\nHOME=${JSON.stringify(fx.home)} RIG_ROOT=${JSON.stringify(repo.dir)} RIG_NOW=2026-11-05T12:00:00.000Z exec ${JSON.stringify(process.execPath)} ${JSON.stringify(BIN)} "$@"\n`);
    chmodSync(join(binDir, "rig"), 0o755);
    const PATH = `${binDir}:${process.env.PATH}`;
    const rig = (...args: string[]) => spawnSync("rig", args, { env: { ...process.env, PATH }, cwd: repo.dir, encoding: "utf8" });
    const ok = (r: ReturnType<typeof rig>) => assert.equal(r.status, 0, r.stdout + r.stderr);
    ok(rig("pack", "add", upstream.url, "--sha", upstream.shas[0], "--name", "fixture", "--port", "hub/SKILL.md"));
    ok(rig("pin", "set", "fixture", "--ported"));
    ok(rig("pin", "check", "fixture", "--sha", upstream.shas[1]));
    ok(rig("pin", "set", "fixture"));
    assert.match(rig("plan").stdout, /E_PORT_STALE fixture/);
    const gitEnv = {
      ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    };
    const git = (...args: string[]) => spawnSync("git", args, { cwd: repo.dir, env: gitEnv, encoding: "utf8" }).stdout;
    git("add", "-A");
    git("commit", "-q", "-m", "stale fixture");

    const h = harnessArgv("claude", "/rig-port fixture. I approve the re-port diff in advance, so finish the procedure.", { dir: repo.dir, maxTurns: 30, env: { ...process.env, PATH } });
    const args = h.args.map((x) => (x === "json" ? "stream-json" : x));
    args.splice(args.indexOf("--output-format"), 0, "--verbose", "--allowedTools", "Read Edit Bash(rig:*) Bash(git diff:*)");
    const run = runHarness as unknown as (o: typeof h & {timeoutMs: number}) => Promise<{code: number | null, stdout: string}>;
    const r = await run({ ...h, args, bin: realBin(h.bin, h.env.PATH), timeoutMs: 600_000 });
    const calls = toolCalls(r.stdout);
    const verdict = attestedLast(calls);
    assert.ok(verdict.ok, `exit ${r.code}: ${verdict.reason} in ${JSON.stringify(calls.map((c) => c.command ?? c.name))}`);
    const plan = rig("plan");
    assert.equal(plan.status, 0, plan.stdout);
    assert.match(plan.stdout, / 0 blocks$/m);
    assert.deepEqual(git("diff", "--name-only").trim().split("\n").sort(), ["packs/fixture/pack.json", "rig.lock.json"]);
  });
});
