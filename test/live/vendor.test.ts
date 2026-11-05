// Live vendor cases: the first-seed pstack pack add against GitHub at the pinned commit. Opt-in: RIG_LIVE=1.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe } from "node:test";
import { treeHash } from "../../lib/tree.ts";
import { makeFixtureHome } from "../helpers/fixture-home.ts";
import { liveTest, runHarness } from "../helpers/live.ts";
import { harnessArgv, mirrorProject, realBin, scratchRepo, sentinel } from "../helpers/mirror.ts";
import { filesUnder, json, repoJson, ROOT } from "../pstack.helpers.ts";

const BIN = join(ROOT, "bin/rig.ts");
const REPO = "https://github.com/cursor/plugins";
const SHA = "2776ddd2355d6d6c8747d3964600f28daf62f049";
const EXCLUDE = [
  "assets", "automations", "docs/guide", "README.md", "plugin.json",
  "skills/poteto-mode/SKILL.md", "skills/poteto-mode/scripts",
  "skills/statechart", "skills/create-formal-verification-skill",
  "skills/show-me-your-work/scripts", "skills/make-bot-ui",
  "skills/setup-pstack", "skills/poteto-help", "agents/poteto-agent.md",
];
const PACK_ADD = ["pack", "add", REPO, "--sha", SHA, "--root", "pstack", "--path", ".", ...EXCLUDE.flatMap((x) => ["--exclude", x])];

function setup(t: {after: (fn: () => void) => void}) {
  const spec: Record<string, Uint8Array | {content: Uint8Array, mode: number}> = { "rig/rig.json": readFileSync(join(ROOT, "rig.json")) };
  const packs = Object.keys(repoJson("rig.json").packs).map((name) => `packs/${name}`);
  for (const dir of ["models", "targets", "packs/core", ...packs]) {
    for (const f of filesUnder(join(ROOT, dir))) spec[`rig/${dir}/${f.path}`] = { content: f.bytes, mode: f.mode };
  }
  const fx = makeFixtureHome(spec);
  t.after(() => fx.cleanup());
  const root = fx.path("rig");
  const lock = { schema: 2, core: { tree: treeHash(filesUnder(join(root, "packs/core")), { core: true }), candidate: null }, packs: {} };
  writeFileSync(join(root, "rig.lock.json"), json(lock));
  const env = { PATH: process.env.PATH, HOME: fx.home, RIG_ROOT: root, RIG_NOW: "2026-11-05T12:00:00.000Z" };
  const rig = (args: string[]) => {
    const r = spawnSync(process.execPath, [BIN, ...args], { env, cwd: fx.home, encoding: "utf8", timeout: 300_000 });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr, all: r.stdout + r.stderr };
  };
  return { fx, root, rig };
}

describe("vendor", () => {
  liveTest("vendor pstack from GitHub", async (t) => {
    const { root, rig } = setup(t);
    const r = rig(PACK_ADD);
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /^vendored pstack into packs\/pstack\/ of the repo root, tree sha256:[0-9a-f]{64}$/m);
    assert.match(r.stdout, /^kept 107 files, excluded \d+ bytes$/m);
    assert.match(r.stdout, / 0 blocks$/m);
    const entry = JSON.parse(readFileSync(join(root, "rig.lock.json"), "utf8")).packs.pstack;
    assert.deepEqual({ sha: entry.sha, root: entry.root, paths: entry.paths, exclude: entry.exclude }, { sha: SHA, root: "pstack", paths: ["."], exclude: [...EXCLUDE].sort() });
  });

  liveTest("vendor twice is a no-op", async (t) => {
    const { root, rig } = setup(t);
    assert.equal(rig(PACK_ADD).code, 0);
    const lockBytes = readFileSync(join(root, "rig.lock.json"));
    const again = rig(PACK_ADD);
    assert.equal(again.code, 0, again.all);
    assert.match(again.stdout, /^pstack is already vendored at sha256:[0-9a-f]{64}$/m);
    assert.deepEqual(readFileSync(join(root, "rig.lock.json")), lockBytes);
  });

  liveTest("claude lists a vendored leaf", async (t) => {
    const { fx, root, rig } = setup(t);
    assert.equal(rig(PACK_ADD).code, 0);
    const cfg = repoJson("rig.json");
    writeFileSync(join(root, "rig.json"), json({ ...cfg, packs: { ...cfg.packs, pstack: {} } }));
    const a = rig(["apply"]);
    assert.equal(a.code, 0, a.all);
    const repo = scratchRepo();
    t.after(() => repo.cleanup());
    mirrorProject(fx.home, "claude", repo.dir);

    const token = sentinel("RIGVENDOR");
    const prompt = `Use the Skill tool to load the skill named how. If it loads, reply with ${token} and nothing else. If no skill named how exists, reply MISSING.`;
    const h = harnessArgv("claude", prompt, { dir: repo.dir, maxTurns: 3 });
    const args = h.args.map((x) => (x === "json" ? "stream-json" : x));
    args.splice(args.indexOf("--output-format"), 0, "--verbose");
    const run = runHarness as unknown as (o: typeof h & {timeoutMs: number}) => Promise<{code: number | null, stdout: string}>;
    const r = await run({ ...h, args, bin: realBin(h.bin, h.env.PATH), timeoutMs: 180_000 });
    const events = r.stdout.split("\n").flatMap((l) => {
      try {
        return [JSON.parse(l)];
      } catch {
        return [];
      }
    });
    const skillCalls = events
      .filter((e) => e.type === "assistant")
      .flatMap((e) => e.message?.content ?? [])
      .filter((c) => c.type === "tool_use" && c.name === "Skill")
      .map((c) => c.input?.skill ?? c.input?.command);
    assert.ok(skillCalls.includes("how"), `exit ${r.code}: no Skill call for how, saw ${JSON.stringify(skillCalls)}`);
    const result = events.find((e) => e.type === "result");
    assert.ok(result?.is_error === false && String(result.result).includes(token), `exit ${r.code}: no token in the reply`);
  });
});
