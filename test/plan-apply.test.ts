// CLI-level tests of rig plan, rig apply and rig apply --undo over a fixture HOME whose repo config root (RIG_ROOT)
// is a temp copy of this repo's data. Recording stubs of the harness CLIs sit first on PATH: no command spawns one.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { modelBearing } from "../lib/commands/models.ts";
import { plan } from "../lib/state.ts";
import { treeHash } from "../lib/tree.ts";
import { loadWorld } from "../lib/world.ts";
import { makeFixtureHome } from "./helpers/fixture-home.ts";
import { makeStubs } from "./helpers/stubs.ts";
import { json, stubPstack } from "./pstack.helpers.ts";
import { cleanup as rmScratch, makeRepo, MIT_TEXT, scratch } from "./lock.helpers.ts";
import { makeWorld, tmpDir } from "./state.helpers.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BIN = join(ROOT, "bin/rig.ts");
const NOW = "2026-11-05T12:00:00.000Z";
const STATE = ".local/state/rig/";
const HARNESS_CLIS = ["claude", "codex", "omp", "cursor-agent"];

/** @param {string} dir @returns {{path: string, mode: number, bytes: Buffer}[]} */
function filesUnder(dir, rel = "") {
  const out = [];
  for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...filesUnder(dir, r));
    else out.push({ path: r, mode: statSync(join(dir, r)).mode & 0o777, bytes: readFileSync(join(dir, r)) });
  }
  return out;
}

/** The repo data as fixture entries under `rig/`: models, targets, core and the stub pstack pack. `coreMode` overrides the mode of every core file. */
function repoSpec(coreMode) {
  const stub = stubPstack();
  const spec = { "rig/rig.json": json(stub.rig), ...stub.spec };
  for (const dir of ["models", "targets", "packs/core"]) {
    for (const f of filesUnder(join(ROOT, dir))) {
      spec[`rig/${dir}/${f.path}`] = { content: f.bytes, mode: dir === "packs/core" && coreMode ? coreMode : f.mode };
    }
  }
  return spec;
}

/**
 * A fixture HOME with a repo root at ~/rig and a core seal over the copied core.
 * @param {{home?: Record<string, any>, coreMode?: number, lock?: string}} [opts]  lock: rig.lock.json text to copy as is
 */
function setup({ home = {}, coreMode, lock } = {}) {
  const fx = makeFixtureHome({ ...repoSpec(coreMode), ...home });
  const root = fx.path("rig");
  const text = lock ?? `${JSON.stringify({ schema: 2, core: { tree: treeHash(filesUnder(join(root, "packs/core")), { core: true }), candidate: null }, packs: stubPstack().lock }, null, 2)}\n`;
  writeFileSync(join(root, "rig.lock.json"), text);
  const stubs = makeStubs([...HARNESS_CLIS, "git"]);
  const env = { HOME: fx.home, RIG_ROOT: root, RIG_NOW: NOW, ...stubs.env };
  /** @param {string[]} args @param {Record<string, string>} [extra] */
  const rig = (args, extra = {}) => {
    const r = spawnSync(process.execPath, [BIN, ...args], { env: { ...env, ...extra }, cwd: fx.home, encoding: "utf8", input: "" });
    return { code: r.status, signal: r.signal, stdout: r.stdout, stderr: r.stderr, all: r.stdout + r.stderr };
  };
  const cleanup = () => {
    fx.cleanup();
    stubs.cleanup();
  };
  const harnessCalls = () => stubs.log().filter((c) => HARNESS_CLIS.includes(c.name));
  return { fx, root, rig, stubs, harnessCalls, cleanup };
}

/** Paths whose sha256 or mode differ between two snapshots, or that exist in only one. */
function changed(a, b) {
  const out = [];
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    if (JSON.stringify(a.get(k)) !== JSON.stringify(b.get(k))) out.push(k);
  }
  return out.sort();
}
/** A snapshot without the state root, whose journals and backups an undo keeps. */
const outsideState = (snap) => new Map([...snap].filter(([k]) => !k.startsWith(STATE)));
/** @param {string} stdout @returns {string} the run id of an applied run */
const runOf = (stdout) => {
  const m = stdout.match(/^run (\S+): \d+ ops applied$/m);
  assert.ok(m, `no run line in:\n${stdout}`);
  return m[1];
};
/** The create lines of a plan, by harness. */
const creates = (stdout) => [...stdout.matchAll(/^create +\S+ +(\S+) +(~\/\S+)/gm)].map((m) => [m[1], m[2]]);

describe("rig plan", () => {
  test("prints per-harness ops and writes nothing: no byte in HOME, the repo root or the state root, no log", (t) => {
    const s = setup();
    t.after(s.cleanup);
    const before = s.fx.snapshot();
    const r = s.rig(["plan"]);
    assert.equal(r.code, 0, r.all);
    const ops = creates(r.stdout);
    assert.deepEqual([...new Set(ops.map(([h]) => h))].sort(), ["claude", "codex", "cursor", "omp"]);
    assert.ok(ops.some(([h, p]) => h === "claude" && p === "~/.claude/rules/rig-frame.md"), r.stdout);
    assert.match(r.stdout, new RegExp(`^${ops.length} changes, 0 blocks$`, "m"));
    assert.deepEqual(changed(before, s.fx.snapshot()), []);
    assert.deepEqual(s.harnessCalls(), [], "plan spawns no harness CLI");
  });

  test("a malformed ~/.claude/plugins/installed_plugins.json leaves plan at exit 0", (t) => {
    const s = setup({ home: { ".claude/plugins/installed_plugins.json": "{not json" } });
    t.after(s.cleanup);
    const r = s.rig(["plan"]);
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /^\d+ changes, 0 blocks$/m);
  });

  test("over this repo's own data and rig.lock.json: no pin block, exit 0", (t) => {
    const fx = makeFixtureHome();
    t.after(() => fx.cleanup());
    const r = spawnSync(process.execPath, [BIN, "plan"], { env: { PATH: process.env.PATH, HOME: fx.home, RIG_ROOT: ROOT, RIG_NOW: NOW }, cwd: fx.home, encoding: "utf8" });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /^block pin /m);
    assert.deepEqual([...fx.snapshot().keys()], [], "plan wrote nothing into HOME");
  });

  test("a checkout under umask 002 (core files 0664) keeps this repo's core seal", (t) => {
    const s = setup({ coreMode: 0o664, lock: json({ ...JSON.parse(readFileSync(join(ROOT, "rig.lock.json"), "utf8")), packs: stubPstack().lock }) });
    t.after(s.cleanup);
    assert.equal(statSync(join(s.root, "packs/core/frame.md")).mode & 0o777, 0o664);
    const r = s.rig(["plan"]);
    assert.equal(r.code, 0, r.all);
    assert.doesNotMatch(r.stdout, /^block pin /m);
  });

  test("an unmanaged file at a rendered path blocks with E_ADOPT_MISMATCH and a diff; apply writes nothing", (t) => {
    const s = setup({ home: { ".claude/rules/rig-frame.md": "my own frame\n" } });
    t.after(s.cleanup);
    const before = s.fx.snapshot();
    const r = s.rig(["plan"]);
    assert.equal(r.code, 1, r.all);
    assert.match(r.stdout, /^block +owned +claude +~\/\.claude\/rules\/rig-frame\.md +E_ADOPT_MISMATCH .*\(diff below\)$/m);
    assert.match(r.stdout, /^--- ~\/\.claude\/rules\/rig-frame\.md \(current\)\n\+\+\+ ~\/\.claude\/rules\/rig-frame\.md \(desired\)\n/m);
    assert.match(r.stdout, /^-my own frame$/m);
    assert.match(r.stdout, /, 1 block$/m);
    const a = s.rig(["apply"]);
    assert.equal(a.code, 1, a.all);
    assert.match(a.stdout, /^blocked: nothing written$/m);
    assert.deepEqual(changed(before, s.fx.snapshot()), []);
  });
});

describe("rig apply", () => {
  test("a render error (an unknown term in the core frame) blocks: plan exits 1, apply writes nothing", (t) => {
    const frame = readFileSync(join(ROOT, "packs/core/frame.md"), "utf8");
    const s = setup({ home: { "rig/packs/core/frame.md": `${frame}{{rig:no-such-term}}\n` } });
    t.after(s.cleanup);
    const before = s.fx.snapshot();
    const p = s.rig(["plan"]);
    assert.equal(p.code, 1, p.all);
    assert.match(p.stdout, /^block E_TERM_UNKNOWN /m);
    assert.doesNotMatch(p.stdout, /^block pin /m, "the copied core is sealed");
    const a = s.rig(["apply"]);
    assert.equal(a.code, 1, a.all);
    assert.match(a.stdout, /^blocked: nothing written$/m);
    assert.deepEqual(changed(before, s.fx.snapshot()), []);
  });

  test("writes the plan through the journal; a second apply reports 0 changes and writes nothing", (t) => {
    const s = setup();
    t.after(s.cleanup);
    const planned = creates(s.rig(["plan"]).stdout);
    const r = s.rig(["apply"]);
    assert.equal(r.code, 0, r.all);
    const run = runOf(r.stdout);
    assert.match(r.stdout, new RegExp(`^run ${run}: ${planned.length} ops applied$`, "m"));
    for (const [, p] of planned) assert.ok(statSync(s.fx.path(p.slice(2))).isFile(), p);
    const installed = JSON.parse(s.fx.read(`${STATE}installed.json`));
    assert.deepEqual(Object.keys(installed.entries).sort(), planned.map(([, p]) => p).sort());
    assert.match(s.fx.read(`${STATE}journal/${run}.jsonl`), /"type":"commit"/);
    assert.match(s.fx.read(`${STATE}log/rig.log`), new RegExp(`"event":"apply","run":"${run}"`));

    const before = s.fx.snapshot();
    const again = s.rig(["apply"]);
    assert.equal(again.code, 0, again.all);
    assert.match(again.stdout, /^0 changes, 0 blocks$/m);
    assert.doesNotMatch(again.stdout, /^run /m);
    assert.deepEqual(changed(before, s.fx.snapshot()), []);
    assert.deepEqual(s.harnessCalls(), [], "apply spawns no harness CLI");
  });

  test("a hand edit of an applied file: plan exits 1 with E_DRIFT naming it, doctor names it as an error", (t) => {
    const s = setup();
    t.after(s.cleanup);
    assert.equal(s.rig(["apply"]).code, 0);
    writeFileSync(s.fx.path(".claude/rules/rig-frame.md"), "edited by hand\n");
    const p = s.rig(["plan"]);
    assert.equal(p.code, 1, p.all);
    assert.match(p.stdout, /^block +owned +claude +~\/\.claude\/rules\/rig-frame\.md +E_DRIFT /m);
    const before = s.fx.snapshot();
    const d = s.rig(["doctor"]);
    assert.equal(d.code, 1, d.all);
    assert.match(d.stdout, /^error +drift +~\/\.claude\/rules\/rig-frame\.md: E_DRIFT /m);
    assert.deepEqual(changed(before, s.fx.snapshot()), [], "doctor writes nothing");
    const a = s.rig(["apply"]);
    assert.equal(a.code, 1, a.all);
    assert.equal(s.fx.read(".claude/rules/rig-frame.md"), "edited by hand\n", "apply never overwrites drift");
  });

  test("a gate block (a pack script with a shebang) makes apply exit 1 and write nothing", (t) => {
    const s = setup();
    const base = scratch();
    t.after(() => {
      s.cleanup();
      rmScratch(base);
    });
    const repo = makeRepo(base, [{
      LICENSE: MIT_TEXT,
      "skills/kit/SKILL.md": "---\nname: kit\ndescription: Kit.\n---\nUse the kit.\n",
      "skills/kit/scripts/run.sh": { content: "#!/bin/sh\necho kit\n", mode: 0o755 },
    }]);
    assert.equal(s.rig(["pack", "add", repo.url, "--sha", repo.shas[0], "--root", "skills/kit", "--path", "."]).code, 1, "pack add reports the block");
    const cfg = JSON.parse(readFileSync(join(s.root, "rig.json"), "utf8"));
    writeFileSync(join(s.root, "rig.json"), `${JSON.stringify({ ...cfg, packs: { kit: {} } }, null, 2)}\n`);
    const before = s.fx.snapshot();
    const r = s.rig(["apply"]);
    assert.equal(r.code, 1, r.all);
    assert.match(r.stdout, /^block exec kit\/scripts\/run\.sh: /m);
    assert.match(r.stdout, /^ {2}ack: \{"id":"[0-9a-f]{16}","check":"exec"/m);
    assert.match(r.stdout, /^blocked: nothing written$/m);
    assert.deepEqual(changed(before, s.fx.snapshot()), []);
  });

  for (const which of ["first", "last"]) {
    test(`fault injection: a kill after the ${which} write converges on the next apply`, (t) => {
      const s = setup();
      const clean = setup();
      t.after(() => {
        s.cleanup();
        clean.cleanup();
      });
      const n = creates(s.rig(["plan"]).stdout).length;
      const k = which === "first" ? 1 : n;
      const killed = s.rig(["apply"], { RIG_TEST: "1", RIG_TEST_ABORT_AFTER: String(k) });
      assert.equal(killed.signal, "SIGKILL", killed.all);
      const p = s.rig(["plan"]);
      assert.match(p.stdout, /^info run \S+ was interrupted; rig apply recovers it first$/m);
      assert.match(p.stdout, new RegExp(`^${n - k} changes, 0 blocks$`, "m"));
      const next = s.rig(["apply"]);
      assert.equal(next.code, 0, next.all);
      const last = s.rig(["apply"]);
      assert.equal(last.code, 0, last.all);
      assert.match(last.stdout, /^0 changes, 0 blocks$/m);
      assert.equal(clean.rig(["apply"]).code, 0);
      const home = (fx) => new Map([...outsideState(fx.snapshot())].filter(([k2]) => !k2.startsWith("rig/")));
      assert.deepEqual(changed(home(s.fx), home(clean.fx)), [], "the same files as a run that was never killed");
    });
  }
});

describe("rig apply --undo", () => {
  test("restores the HOME snapshot byte-exact and touches no path outside the run", (t) => {
    const s = setup({ home: { "notes/keep.txt": "not rig's\n" } });
    t.after(s.cleanup);
    const before = outsideState(s.fx.snapshot());
    const run = runOf(s.rig(["apply"]).stdout);
    const u = s.rig(["apply", "--undo", run]);
    assert.equal(u.code, 0, u.all);
    assert.match(u.stdout, new RegExp(`^undid run ${run} as run \\S+: \\d+ ops restored$`, "m"));
    assert.deepEqual(changed(before, outsideState(s.fx.snapshot())), []);
    assert.deepEqual(JSON.parse(s.fx.read(`${STATE}installed.json`)).entries, {});
    const p = s.rig(["plan"]);
    assert.equal(p.code, 0, p.all);
  });

  test("a conflict lists every conflicting path and restores nothing", (t) => {
    const s = setup();
    t.after(s.cleanup);
    const run = runOf(s.rig(["apply"]).stdout);
    writeFileSync(s.fx.path(".claude/rules/rig-frame.md"), "edit one\n");
    writeFileSync(s.fx.path(".omp/agent/AGENTS.md"), "edit two\n");
    const before = s.fx.snapshot();
    const u = s.rig(["apply", "--undo", run]);
    assert.equal(u.code, 1, u.all);
    assert.match(u.stdout, /^conflict E_UNDO_CONFLICT ~\/\.claude\/rules\/rig-frame\.md: /m);
    assert.match(u.stdout, /^conflict E_UNDO_CONFLICT ~\/\.omp\/agent\/AGENTS\.md: /m);
    assert.match(u.stdout, /^2 conflicts: nothing restored$/m);
    assert.deepEqual(changed(before, s.fx.snapshot()), []);
  });

  test("an unknown run id exits 1 and writes nothing", (t) => {
    const s = setup();
    t.after(s.cleanup);
    const before = s.fx.snapshot();
    const u = s.rig(["apply", "--undo", "20260101T000000.000Z-1"]);
    assert.equal(u.code, 1, u.all);
    assert.match(u.stdout, /E_UNDO_CONFLICT .*no journal for run/);
    assert.deepEqual(changed(before, s.fx.snapshot()), []);
  });
});

describe("rig models set through the apply pipeline", () => {
  test("after an apply, changes only tiers.json and model cells: no other HOME file", (t) => {
    const s = setup();
    t.after(s.cleanup);
    assert.equal(s.rig(["apply"]).code, 0);
    const before = outsideState(s.fx.snapshot());
    const r = s.rig(["models", "set", "strong", "model-placeholder", "--harness", "claude"]);
    assert.equal(r.code, 0, r.all);
    const diff = changed(before, outsideState(s.fx.snapshot()));
    const world = loadWorld({ HOME: s.fx.home, RIG_ROOT: s.root, RIG_NOW: NOW });
    const isModel = modelBearing(world);
    assert.deepEqual(diff.filter((p) => p !== "rig/models/tiers.json" && !isModel({ path: s.fx.path(p) })), []);
    assert.ok(diff.includes("rig/models/tiers.json"));
  });

  test("the model-bearing filter matches declared model surfaces only", (t) => {
    const s = setup();
    t.after(s.cleanup);
    const world = loadWorld({ HOME: s.fx.home, RIG_ROOT: s.root, RIG_NOW: NOW });
    const isModel = modelBearing(world);
    assert.equal(isModel({ path: s.fx.path(".claude/agents/reviewer.md") }), true);
    assert.equal(isModel({ path: s.fx.path(".claude/rules/rig-frame.md") }), false);
    assert.equal(isModel({ path: s.fx.path(".claude/agents/reviewer.md.bak") }), false);
  });
});

describe("state.plan modes", () => {
  test("a desired mode with stat file type bits (0o100644) plans as 0644 and adopts an equal 0644 file", (t) => {
    const home = tmpDir();
    t.after(() => rmScratch(home));
    const world = makeWorld(home);
    const entry = (rel) => ({ kind: "owned", path: join(home, rel), bytes: Buffer.from("x\n"), mode: 0o100644, unit: "core/u" });
    writeFileSync(join(home, "same.md"), "x\n", { mode: 0o644 });
    const desired = { entries: new Map([["a", entry("new.md")], ["b", entry("same.md")]]) };
    const p = plan(desired, { findings: [], blocked: false }, world);
    assert.deepEqual(p.ops.map((o) => [o.op, o.path, o.after_mode]), [["create", "~/new.md", 0o644], ["adopt", "~/same.md", 0o644]]);
    assert.equal(p.blocked, false);
  });
});

describe("treeHash modes", () => {
  const f = (mode) => [{ path: "a.md", mode, bytes: Buffer.from("x\n") }];
  test("0664 hashes like 0644, 0755 differs, 0775 hashes like 0755", () => {
    assert.equal(treeHash(f(0o664)), treeHash(f(0o644)));
    assert.equal(treeHash(f(0o100664)), treeHash(f(0o644)));
    assert.notEqual(treeHash(f(0o755)), treeHash(f(0o644)));
    assert.equal(treeHash(f(0o775)), treeHash(f(0o755)));
  });
});
