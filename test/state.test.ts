import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import cp, { spawn, spawnSync } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fsyncAll, writeHome, writeState } from "../lib/fs.ts";
import { apply, plan, undo } from "../lib/state.ts";
import { fsCtx } from "../lib/state/observe.ts";
import {
  asObj, converge, ctxOf, desiredV, fakePatch, installedMismatch, intentStates, journalLines, journals, litter, makeWorld, prng,
  readInstalledFile, runChild, runOf, seedUserFiles, snapshot, STATE_REL, tmpDir,
} from "./state.helpers.ts";

const dirs = [];
const fresh = (prefix?: string) => {
  const d = tmpDir(prefix);
  dirs.push(d);
  return d;
};
after(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

const OK = { findings: [], blocked: false };
const OPTS = { patch: fakePatch };
const snap = (home) => asObj(snapshot(home));
const codes = (p) => p.ops.filter((o) => o.op === "block").map((o) => [o.path, o.error.code]);
const write = (home: string, rel: string, text: string, mode?: number) => {
  fs.mkdirSync(path.dirname(path.join(home, rel)), { recursive: true });
  fs.writeFileSync(path.join(home, rel), text, mode === undefined ? undefined : { mode });
};

/** A HOME with user files, converged on v0 ... upTo. */
function seeded(upTo = 0, shape = {}) {
  const home = fresh();
  seedUserFiles(home);
  const world = makeWorld(home);
  for (let v = 0; v <= upTo; v++) {
    const r = converge(desiredV(home, v, shape), world).result;
    assert.equal(r.error, undefined);
  }
  return { home, world };
}
function clone(src) {
  const home = fresh();
  fs.cpSync(src, home, { recursive: true });
  return { home, world: makeWorld(home) };
}
const COUNT_FSYNC = fileURLToPath(new URL("./fixtures/state/count-fsync.ts", import.meta.url));
const FS_TS = fileURLToPath(new URL("../lib/fs.ts", import.meta.url));
const textFiles = (dir: string, n: number) => Array.from({ length: n }, (_, i) => {
  const f = path.join(dir, `f${i}`);
  fs.writeFileSync(f, "x");
  return f;
});
function fsyncsIn(fn: () => void): number {
  const { fsyncSync } = fs;
  let n = 0;
  fs.fsyncSync = (fd) => (n++, fsyncSync(fd));
  try {
    fn();
  } finally {
    fs.fsyncSync = fsyncSync;
  }
  return n;
}
const spawnChild = cp.spawnSync;
type SpawnSync = (cmd: string, args: string[], opts: {input: string}) => {status: number | null, stdout: string};
/** Run fn with child_process.spawnSync replaced, also in the named imports of lib/fs.ts. */
function withSpawnSync<T>(fake: SpawnSync, fn: () => T): T {
  const { spawnSync: real } = cp;
  Object.assign(cp, { spawnSync: fake });
  syncBuiltinESMExports();
  try {
    return fn();
  } finally {
    Object.assign(cp, { spawnSync: real });
    syncBuiltinESMExports();
  }
}
function withEnv<T>(vars: Record<string, string>, fn: () => T): T {
  const old = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(old)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}
const countFsyncs = (file: string) => ({
  NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${pathToFileURL(COUNT_FSYNC).href}`.trim(), FSYNC_COUNT_FILE: file,
});

function allClosed(world) {
  return journals(world).every((n) => ["commit", "abort", "recovered"].includes(journalLines(world, n.slice(0, -6)).at(-1).type));
}
function assertConverged(home, world, v, ref, shape = {}) {
  assert.deepEqual(snap(home), ref, "HOME equals the desired end state");
  assert.equal(installedMismatch(world, desiredV(home, v, shape)), null);
  const again = plan(desiredV(home, v, shape), OK, world, OPTS);
  assert.equal(again.ops.length, 0, "a further plan has 0 ops");
  assert.ok(allClosed(world), "every journal is closed");
}

describe("fs containment", () => {
  test("writeHome is atomic, keeps the mode, and leaves no temp file", () => {
    const home = fresh();
    const ctx = ctxOf(makeWorld(home));
    writeHome("~/a/b/secret.env", Buffer.from("one\n"), 0o600, ctx);
    writeHome(path.join(home, "a/b/secret.env"), Buffer.from("two\n"), undefined, ctx);
    const p = path.join(home, "a/b/secret.env");
    assert.equal(fs.readFileSync(p, "utf8"), "two\n");
    assert.equal(fs.statSync(p).mode & 0o7777, 0o600);
    assert.deepEqual(fs.readdirSync(path.dirname(p)), ["secret.env"]);
  });

  test("fsyncAll throws for a file it cannot sync and skips such a dir, in a batch and one by one", () => {
    const home = fresh();
    const files = textFiles(home, 20);
    const missing = path.join(home, "missing");
    assert.doesNotThrow(() => fsyncAll(files, [home, missing]));
    assert.throws(() => fsyncAll([...files, missing]), { code: "ENOENT", path: missing });
    assert.doesNotThrow(() => fsyncAll(files.slice(0, 2), [missing]));
    assert.throws(() => fsyncAll([missing]), { code: "ENOENT", path: missing });
    const messageOf = (f: () => void) => {
      try {
        f();
      } catch (e) {
        return (e as Error).message;
      }
      return null;
    };
    assert.equal(messageOf(() => fsyncAll([...files, missing])), messageOf(() => fsyncAll([missing])), "the batch names the failed call as the serial path does");
  });

  test("fsyncAll syncs a batch in one child process, and a short list in this process", () => {
    const home = fresh();
    const files = textFiles(home, 20);
    const counts = path.join(fresh(), "fsyncs");
    withEnv(countFsyncs(counts), () => {
      assert.equal(fsyncsIn(() => fsyncAll(files, [home])), 0, "this process makes no fsync for a batch");
      assert.equal(fs.readFileSync(counts, "utf8"), "21\n", "one child makes one fsync per path");
      assert.equal(fsyncsIn(() => fsyncAll(files.slice(0, 2), [home])), 3, "a short list syncs in this process");
      assert.equal(fs.readFileSync(counts, "utf8"), "21\n", "a short list starts no child");
    });
  });

  test("fsyncAll syncs every path in this process when the batch child fails or runs out of file descriptors", () => {
    const home = fresh();
    const files = textFiles(home, 20);
    const child = (code: string, hit: (i: number, n: number) => boolean): SpawnSync => (_cmd, _args, opts) => {
      const paths: string[] = JSON.parse(opts.input).paths;
      const out = paths.map((p, i) => (hit(i, paths.length) ? { code, message: `${code}: too many open files, open '${p}'` } : null));
      return { status: 0, stdout: JSON.stringify(out) };
    };
    const emfile = child("EMFILE", (i) => i >= 8);
    const enfileOnDir = child("ENFILE", (i, n) => i === n - 1);
    assert.equal(withSpawnSync(emfile, () => fsyncsIn(() => fsyncAll(files, [home]))), 21, "EMFILE on files");
    assert.equal(withSpawnSync(enfileOnDir, () => fsyncsIn(() => fsyncAll(files, [home]))), 21, "ENFILE on a dir");
    const dead: SpawnSync = () => ({ status: null, stdout: "" });
    assert.equal(withSpawnSync(dead, () => fsyncsIn(() => fsyncAll(files, [home]))), 21, "a child killed by its timeout");
  });

  test("fsyncAll falls back to one fsync per path in this process when the batch child's reply is garbled", () => {
    const home = fresh();
    const files = textFiles(home, 20);
    const n = files.length + 1;
    const replies: Record<string, string> = {
      "bad JSON": "{not json",
      "empty stdout": "",
      "not a list": '{"0":null}',
      "a list that is too short": JSON.stringify(Array(n - 1).fill(null)),
      "a list that is too long": JSON.stringify(Array(n + 1).fill(null)),
      "an empty list": "[]",
    };
    for (const [name, stdout] of Object.entries(replies)) {
      let calls = 0;
      const garbled: SpawnSync = () => (calls++, { status: 0, stdout });
      assert.equal(withSpawnSync(garbled, () => fsyncsIn(() => fsyncAll(files, [home]))), n, `${name}: each path is synced once in this process`);
      assert.equal(calls, 1, `${name}: the child ran once and was not retried`);
    }
  });

  test("under ulimit -n 64, the batch child syncs 200 paths and this process syncs none", () => {
    const dir = fresh();
    textFiles(dir, 200);
    const counts = path.join(fresh(), "fsyncs");
    const script = `import fs from "node:fs";
      const { fsyncAll } = await import(${JSON.stringify(pathToFileURL(FS_TS).href)});
      fsyncAll(fs.readdirSync(process.env.DIR).map((f) => process.env.DIR + "/" + f));`;
    const r = spawnSync("bash", ["-c", 'ulimit -n 64 && exec "$0" "$@"', process.execPath, "--input-type=module", "-e", script], {
      env: { PATH: process.env.PATH, DIR: dir, ...countFsyncs(counts) }, encoding: "utf8",
    });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.readFileSync(counts, "utf8"), "200\n0\n", "the child exits first with 200 fsyncs, then this process with 0");
  });

  test("a symlinked parent that leaves HOME is refused; one inside HOME is allowed", () => {
    const home = fresh();
    const outside = fresh("rig-outside-");
    fs.symlinkSync(outside, path.join(home, ".claude"));
    const world = makeWorld(home);
    assert.throws(() => writeHome("~/.claude/skills/x/SKILL.md", Buffer.from("x"), 0o644, ctxOf(world)), { code: "E_CONTAINMENT" });
    const p = plan(desiredV(home, 0), OK, world, OPTS);
    assert.ok(p.blocked);
    assert.ok(codes(p).some(([q, c]) => q.startsWith("~/.claude/") && c === "E_CONTAINMENT"));
    assert.deepEqual(apply(p, world), { run: null, changed: 0 });
    assert.deepEqual(fs.readdirSync(outside), []);

    const home2 = fresh();
    fs.mkdirSync(path.join(home2, "dotfiles/codex"), { recursive: true });
    fs.symlinkSync(path.join(home2, "dotfiles/codex"), path.join(home2, ".codex"));
    writeHome("~/.codex/AGENTS.md", Buffer.from("ok\n"), 0o644, ctxOf(makeWorld(home2)));
    assert.equal(fs.readFileSync(path.join(home2, "dotfiles/codex/AGENTS.md"), "utf8"), "ok\n");
  });

  test("a symlinked skill dir below a harness dir blocks the plan, and apply writes nothing through it", () => {
    const home = fresh("rig-link-");
    write(home, "mine/how/SKILL.md", "my own how\n", undefined);
    fs.mkdirSync(path.join(home, ".claude/skills"), { recursive: true });
    fs.symlinkSync(path.join(home, "mine/how"), path.join(home, ".claude/skills/how"));
    const world = makeWorld(home);
    const p0 = path.join(home, ".claude/skills/how/SKILL.md");
    const desired = { entries: new Map([[p0, { kind: "owned", path: p0, bytes: Buffer.from("rig how\n"), mode: 0o644, unit: "pstack/how" }]]) };
    const before = snap(home);
    const p = plan(desired, OK, world, OPTS);
    assert.deepEqual(codes(p), [["~/.claude/skills/how/SKILL.md", "E_CONTAINMENT"]]);
    assert.match(p.ops[0]?.error?.message ?? "", /^~\/\.claude\/skills\/how is a symlink to .*mine\/how, so ~\/\.claude\/skills\/how\/SKILL\.md would land in a dir that rig does not own; /);
    assert.deepEqual(apply(p as never, world), { run: null, changed: 0 });
    assert.throws(() => writeHome("~/.claude/skills/how/SKILL.md", Buffer.from("x"), 0o644, ctxOf(world)), { code: "E_CONTAINMENT" });
    assert.deepEqual(snap(home), before);
    assert.equal(fs.readFileSync(path.join(home, "mine/how/SKILL.md"), "utf8"), "my own how\n");
  });

  test("a symlink at the target path is refused", () => {
    const { home, world } = seeded(0);
    fs.rmSync(path.join(home, ".claude/agents/reviewer.md"));
    fs.symlinkSync(path.join(home, "notes.txt"), path.join(home, ".claude/agents/reviewer.md"));
    assert.throws(() => writeHome("~/.claude/agents/reviewer.md", Buffer.from("x"), 0o644, ctxOf(world)), { code: "E_CONTAINMENT" });
    const p = plan(desiredV(home, 0), OK, world, OPTS);
    assert.deepEqual(codes(p), [["~/.claude/agents/reviewer.md", "E_CONTAINMENT"]]);
    assert.equal(fs.readFileSync(path.join(home, "notes.txt"), "utf8"), "not rig\n");
  });

  test("a write under a never_write glob is refused, also through a symlinked alias", () => {
    const home = fresh();
    const world = makeWorld(home);
    const ctx = ctxOf(world);
    assert.throws(() => writeHome("~/.cursor/skills-cursor/x/SKILL.md", Buffer.from("x"), 0o644, ctx), { code: "E_CONTAINMENT" });
    fs.mkdirSync(path.join(home, ".cursor/skills-cursor"), { recursive: true });
    fs.symlinkSync(path.join(home, ".cursor/skills-cursor"), path.join(home, "alias"));
    assert.throws(() => writeHome("~/alias/x.md", Buffer.from("x"), 0o644, ctx), { code: "E_CONTAINMENT" });
    const p0 = path.join(home, ".cursor/skills-cursor/y/SKILL.md");
    const desired = { entries: new Map([[p0, { kind: "owned", path: p0, bytes: Buffer.from("y"), mode: 0o644, unit: "u/y" }]]) };
    const p = plan(desired, OK, world, OPTS);
    assert.deepEqual(codes(p), [["~/.cursor/skills-cursor/y/SKILL.md", "E_CONTAINMENT"]]);
    assert.deepEqual(fs.readdirSync(path.join(home, ".cursor/skills-cursor")), []);
  });

  test("pruning after an unlink stops at a dir that matches never_write, and a plain unlink prunes nothing", () => {
    const home = fresh();
    const ctx = { ...ctxOf(makeWorld(home)), neverWrite: ["~/.claude/skills/*"] };
    write(home, ".claude/skills/x/a/b.md", "b\n");
    writeHome("~/.claude/skills/x/a/b.md", null, undefined, ctx);
    assert.deepEqual(fs.readdirSync(path.join(home, ".claude/skills/x/a")), []);
    write(home, ".claude/skills/x/a/b.md", "b\n");
    const r = writeHome("~/.claude/skills/x/a/b.md", null, undefined, ctx, { prune: true });
    assert.equal(fs.existsSync(path.join(home, ".claude/skills/x/a")), false);
    assert.equal(fs.existsSync(path.join(home, ".claude/skills/x")), true);
    assert.equal(r.dir, path.join(home, ".claude/skills/x"));
  });

  describe("pruning keeps the dirs that a target declares, and their ancestors", () => {
    const REPO = fileURLToPath(new URL("..", import.meta.url));
    const realCtx = (home: string, ...names: string[]) => {
      const targets = new Map(names.map((n) => [n, JSON.parse(fs.readFileSync(path.join(REPO, `targets/${n}.json`), "utf8"))]));
      return fsCtx({ ...makeWorld(home), targets });
    };
    const there = (home: string, rel: string) => fs.existsSync(path.join(home, rel));

    test("a harness skills dir at depth 3 survives the removal of its last file (omp)", () => {
      const home = fresh();
      write(home, ".omp/agent/skills/x/SKILL.md", "x\n");
      writeHome("~/.omp/agent/skills/x/SKILL.md", null, undefined, realCtx(home, "omp"), { prune: true });
      assert.equal(there(home, ".omp/agent/skills/x"), false);
      assert.deepEqual(fs.readdirSync(path.join(home, ".omp/agent/skills")), []);
    });

    test("without keepDirs the same removal takes that dir", () => {
      const home = fresh();
      write(home, ".omp/agent/skills/x/SKILL.md", "x\n");
      const { keepDirs, ...bare } = realCtx(home, "omp");
      writeHome("~/.omp/agent/skills/x/SKILL.md", null, undefined, bare, { prune: true });
      assert.equal(there(home, ".omp/agent/skills"), false);
    });

    test("an ancestor of a declared dir survives (cursor local plugin dir)", () => {
      const home = fresh();
      write(home, ".cursor/plugins/local/rig/other/a.md", "a\n");
      const r = writeHome("~/.cursor/plugins/local/rig/other/a.md", null, undefined, realCtx(home, "cursor"), { prune: true });
      assert.equal(there(home, ".cursor/plugins/local/rig/other"), false);
      assert.deepEqual(fs.readdirSync(path.join(home, ".cursor/plugins/local/rig")), []);
      assert.equal(r.dir, path.join(home, ".cursor/plugins/local/rig"));
    });

    test("the last file under the cursor rig plugin keeps ~/.cursor/plugins/local and ~/.cursor/plugins", () => {
      const home = fresh();
      write(home, ".cursor/plugins/local/rig/skills/x/SKILL.md", "x\n");
      writeHome("~/.cursor/plugins/local/rig/skills/x/SKILL.md", null, undefined, realCtx(home, "cursor"), { prune: true });
      assert.equal(there(home, ".cursor/plugins/local/rig/skills/x"), false);
      assert.equal(there(home, ".cursor/plugins/local/rig/skills"), true);
      assert.equal(there(home, ".cursor/plugins/local"), true);
    });

    test("the antigravity agents and rules dirs at depth 3 survive", () => {
      const home = fresh();
      for (const d of ["agents", "rules"]) {
        write(home, `.gemini/config/${d}/x/a.md`, "a\n");
        writeHome(`~/.gemini/config/${d}/x/a.md`, null, undefined, realCtx(home, "antigravity"), { prune: true });
        assert.equal(there(home, `.gemini/config/${d}`), true, d);
      }
    });

    test("a HOME that is a symlink compares the same way: the declared dir survives", () => {
      const real = fresh();
      const home = path.join(fresh(), "link");
      fs.symlinkSync(real, home);
      write(real, ".omp/agent/skills/x/SKILL.md", "x\n");
      writeHome("~/.omp/agent/skills/x/SKILL.md", null, undefined, realCtx(home, "omp"), { prune: true });
      assert.equal(there(real, ".omp/agent/skills/x"), false);
      assert.equal(there(real, ".omp/agent/skills"), true);
    });
  });

  test("the state root must resolve inside HOME (E_STATE_ROOT)", () => {
    const home = fresh();
    const outside = fresh("rig-outside-");
    const bytes = Buffer.from("{}");
    assert.throws(() => writeState("installed.json", bytes, { home, state: path.join(outside, "rig") }), { code: "E_STATE_ROOT" });
    fs.mkdirSync(path.join(home, ".local"));
    fs.symlinkSync(outside, path.join(home, ".local/state"));
    assert.throws(() => writeState("installed.json", bytes, { home, state: path.join(home, ".local/state/rig") }), { code: "E_STATE_ROOT" });
    assert.deepEqual(fs.readdirSync(outside), []);
    const world = makeWorld(home, { env: { home, state: path.join(home, ".local/state/rig"), data: "", test: true } });
    assert.throws(() => apply({ ops: [], blocked: false, interrupted: [] }, world), { code: "E_STATE_ROOT" });
    assert.deepEqual(fs.readdirSync(outside), []);
  });

  test("a backup or state path inside a read-set dir is refused", () => {
    const home = fresh();
    const ctx = { home, state: path.join(home, ".claude/skills/rig-state"), readSets: ["~/.claude/skills"] };
    assert.throws(() => writeState("backups/r/x.md", Buffer.from("x"), ctx), { code: "E_STATE_IN_READSET" });
    assert.equal(fs.existsSync(path.join(home, ".claude")), false);
  });
});

describe("plan and apply", () => {
  test("plan is read-only: no state root, no file written", () => {
    const home = fresh();
    seedUserFiles(home);
    const before = snap(home);
    const p = plan(desiredV(home, 0), OK, makeWorld(home), OPTS);
    assert.equal(p.blocked, false);
    assert.ok(p.ops.length > 0);
    assert.deepEqual(snap(home), before);
    assert.equal(fs.existsSync(path.join(home, STATE_REL)), false);
  });

  test("a second apply reports 0 ops and writes no journal", () => {
    const { home, world } = seeded(0);
    const n = journals(world).length;
    const { plan: p, result } = converge(desiredV(home, 0), world);
    assert.equal(p.ops.length, 0);
    assert.deepEqual(result, { run: null, changed: 0 });
    assert.equal(journals(world).length, n);
    assert.equal(installedMismatch(world, desiredV(home, 0)), null);
  });

  test("installed.json is canonical JSON with sorted entries", () => {
    const { world } = seeded(0);
    const text = fs.readFileSync(path.join(world.env.state, "installed.json"), "utf8");
    const v = JSON.parse(text);
    assert.equal(text, `${JSON.stringify(v, null, 2)}\n`);
    assert.deepEqual(Object.keys(v.entries), Object.keys(v.entries).sort());
    assert.equal(v.entries["~/.config/tool/token.env"].mode, 0o600);
  });

  test("a foreign edit to a managed file blocks with E_DRIFT and nothing is written", () => {
    const { home, world } = seeded(0);
    write(home, ".claude/skills/s000/SKILL.md", "FOREIGN EDIT\n");
    const before = snap(home);
    const n = journals(world).length;
    const p = plan(desiredV(home, 1), OK, world, OPTS);
    assert.ok(p.blocked);
    assert.deepEqual(codes(p), [["~/.claude/skills/s000/SKILL.md", "E_DRIFT"]]);
    assert.match(p.ops.find((o) => o.op === "block").diff, /^-FOREIGN EDIT$/m);
    assert.deepEqual(apply(p, world), { run: null, changed: 0 });
    assert.deepEqual(snap(home), before);
    assert.equal(journals(world).length, n);
  });

  describe("repair", () => {
    const REPAIR = { ...OPTS, repair: true };
    const SKILL = ".claude/skills/s000/SKILL.md";

    test("an edited owned file plans as an update with a diff and the old bytes in the backup; undo restores the edit", () => {
      const { home, world } = seeded(0);
      write(home, SKILL, "FOREIGN EDIT\n", 0o600);
      fs.chmodSync(path.join(home, SKILL), 0o600);
      const d = desiredV(home, 0);
      assert.deepEqual(codes(plan(d, OK, world, OPTS)), [[`~/${SKILL}`, "E_DRIFT"]]);
      const p = plan(d, OK, world, REPAIR);
      assert.equal(p.blocked, false);
      assert.deepEqual(p.ops.map((o) => [o.op, o.path, o.repair]), [["update", `~/${SKILL}`, true]]);
      assert.match(p.ops[0].diff, /^-FOREIGN EDIT$/m);
      assert.equal(p.ops[0].after_mode, 0o644);
      const r = apply(p, world);
      assert.equal(r.error, undefined);
      assert.deepEqual(fs.readFileSync(path.join(home, SKILL)), d.entries.get(path.join(home, SKILL)).bytes);
      assert.equal(fs.statSync(path.join(home, SKILL)).mode & 0o777, 0o644);
      assert.deepEqual(plan(d, OK, world, OPTS).ops, []);
      assert.equal(undo(runOf(r), world).conflicts.length, 0);
      assert.equal(fs.readFileSync(path.join(home, SKILL), "utf8"), "FOREIGN EDIT\n");
      assert.equal(fs.statSync(path.join(home, SKILL)).mode & 0o777, 0o600);
    });

    test("a removed owned file plans as a create; undo removes it again", () => {
      const { home, world } = seeded(0);
      fs.rmSync(path.join(home, SKILL));
      const d = desiredV(home, 0);
      assert.deepEqual(codes(plan(d, OK, world, OPTS)), [[`~/${SKILL}`, "E_DRIFT"]]);
      const p = plan(d, OK, world, REPAIR);
      assert.deepEqual(p.ops.map((o) => [o.op, o.path, o.repair]), [["create", `~/${SKILL}`, true]]);
      const r = apply(p, world);
      assert.equal(r.error, undefined);
      assert.deepEqual(plan(d, OK, world, OPTS).ops, []);
      assert.equal(undo(runOf(r), world).conflicts.length, 0);
      assert.equal(fs.existsSync(path.join(home, SKILL)), false);
    });

    test("a drifted block region is rewritten and the text around the markers stays", () => {
      const { home, world } = seeded(0);
      const rel = ".codex/config.toml";
      const text = fs.readFileSync(path.join(home, rel), "utf8");
      write(home, rel, `${text.replace('model = "m0"', 'model = "mine"')}tail\n`);
      const d = desiredV(home, 0);
      assert.deepEqual(codes(plan(d, OK, world, OPTS)), [[`~/${rel}`, "E_DRIFT"]]);
      const p = plan(d, OK, world, REPAIR);
      assert.deepEqual(p.ops.map((o) => [o.op, o.path, o.repair]), [["update", `~/${rel}`, true]]);
      assert.equal(apply(p, world).error, undefined);
      assert.equal(fs.readFileSync(path.join(home, rel), "utf8"), `${text}tail\n`);
      assert.deepEqual(plan(d, OK, world, OPTS).ops, []);
    });

    test("an unmanaged file at a desired path keeps E_ADOPT_MISMATCH and a removal-time edit keeps E_DRIFT", () => {
      const home = fresh();
      const world = makeWorld(home);
      write(home, ".claude/agents/reviewer.md", "hand written\n");
      const p = plan(desiredV(home, 0), OK, world, REPAIR);
      assert.deepEqual(codes(p), [["~/.claude/agents/reviewer.md", "E_ADOPT_MISMATCH"]]);
      assert.deepEqual(apply(p, world), { run: null, changed: 0 });
      assert.equal(fs.readFileSync(path.join(home, ".claude/agents/reviewer.md"), "utf8"), "hand written\n");

      const s = seeded(0);
      write(s.home, ".claude/skills/s005/SKILL.md", "FOREIGN EDIT\n");
      assert.deepEqual(codes(plan(desiredV(s.home, 1), OK, s.world, REPAIR)), [["~/.claude/skills/s005/SKILL.md", "E_DRIFT"]]);
    });

    test("a drifted cells entry gets only its own cell back and keeps the other lines", () => {
      const home = fresh();
      const world = makeWorld(home);
      const file = path.join(home, ".config/tool/agent.env");
      const cell = (value: string) => ({ surface: "env", key: "model", element: "", field: "", value });
      const patchCells = (bytes: Uint8Array | null, entry: {values: {value: string}[]}) => {
        const lines = (bytes ? Buffer.from(bytes).toString("utf8") : "").split("\n").filter(Boolean);
        const at = lines.findIndex((l) => l.startsWith("model="));
        const current = at < 0 ? null : [cell(lines[at].slice(6))];
        const want = `model=${entry.values[0].value}`;
        if (at < 0) lines.push(want);
        else lines[at] = want;
        return { current, next: Buffer.from(`${lines.join("\n")}\n`), markers: "n/a" };
      };
      const desired = { entries: new Map([[file, { kind: "cells", path: file, values: [cell("m1")], surfaces: [], unit: "models/tool" }]]), errors: [], info: [] };
      write(home, ".config/tool/agent.env", "mine=1\nmodel=m1\n");
      assert.equal(apply(plan(desired, OK, world, { patch: patchCells }), world).error, undefined);
      write(home, ".config/tool/agent.env", "mine=2\nmodel=hand\n");
      assert.deepEqual(codes(plan(desired, OK, world, { patch: patchCells })), [["~/.config/tool/agent.env", "E_DRIFT"]]);
      const p = plan(desired, OK, world, { patch: patchCells, repair: true });
      assert.deepEqual(p.ops.map((o) => [o.op, o.repair]), [["patch-cells", true]]);
      assert.match(p.ops[0].diff, /"hand" -> "m1"/);
      assert.equal(apply(p, world).error, undefined);
      assert.equal(fs.readFileSync(file, "utf8"), "mine=2\nmodel=m1\n");
      assert.deepEqual(plan(desired, OK, world, { patch: patchCells }).ops, []);
    });

    test("an entry recorded with another kind than desired keeps E_DRIFT", () => {
      const { home, world } = seeded(0);
      const d = desiredV(home, 0);
      const cfg = path.join(home, ".codex/config.toml");
      d.entries.set(cfg, { kind: "owned", path: cfg, bytes: Buffer.from("x\n"), mode: 0o644, unit: "models/codex" });
      assert.deepEqual(codes(plan(d, OK, world, REPAIR)), [["~/.codex/config.toml", "E_DRIFT"]]);
    });

    test("without drift the repair plan equals the plain plan", () => {
      const { home, world } = seeded(0);
      assert.deepEqual(plan(desiredV(home, 1), OK, world, REPAIR).ops, plan(desiredV(home, 1), OK, world, OPTS).ops);
    });
  });

  test("an unmanaged file at a desired path blocks with E_ADOPT_MISMATCH; equal bytes adopt", () => {
    const home = fresh();
    const world = makeWorld(home);
    write(home, ".claude/agents/reviewer.md", "hand written\n");
    const d = desiredV(home, 0);
    const p = plan(d, OK, world, OPTS);
    assert.deepEqual(codes(p), [["~/.claude/agents/reviewer.md", "E_ADOPT_MISMATCH"]]);
    assert.match(p.ops.find((o) => o.op === "block").diff, /^-hand written$/m);

    const want = d.entries.get(path.join(home, ".claude/agents/reviewer.md")).bytes;
    write(home, ".claude/agents/reviewer.md", want);
    const p2 = plan(d, OK, world, OPTS);
    assert.equal(p2.ops.find((o) => o.path === "~/.claude/agents/reviewer.md").op, "adopt");
    assert.equal(converge(d, world).result.error, undefined);
    assert.equal(installedMismatch(world, d), null);
  });

  test("remove never deletes: the old bytes move into the run's backups", () => {
    const { home, world } = seeded(0);
    const rel = ".claude/skills/s005/SKILL.md";
    const old = fs.readFileSync(path.join(home, rel));
    const { result } = converge(desiredV(home, 1), world);
    assert.equal(fs.existsSync(path.join(home, rel)), false);
    assert.deepEqual(fs.readFileSync(path.join(world.env.state, "backups", result.run, rel)), old);
    const intent = journalLines(world, result.run).find((l) => l.path === `~/${rel}`);
    assert.equal(intent.op, "remove-to-backup");
    assert.equal(intent.after_sha, null);
  });

  describe("a removal leaves no empty dir behind", () => {
    const leaf = ".claude/skills/x/references/sources/a.md";
    const withFiles = (d, home: string, files: Record<string, string>) => {
      for (const [rel, text] of Object.entries(files)) {
        const p = path.join(home, rel);
        d.entries.set(p, { kind: "owned", path: p, bytes: Buffer.from(text), mode: 0o644, unit: "pack/extra" });
      }
      return d;
    };
    const isDir = (home: string, rel: string) => fs.existsSync(path.join(home, rel)) && fs.lstatSync(path.join(home, rel)).isDirectory();

    test("the last file of a dir takes the empty dirs above it, up to a grandchild of HOME", () => {
      const home = fresh();
      const world = makeWorld(home);
      converge(withFiles(desiredV(home, 0), home, { [leaf]: "a\n" }), world);
      assert.equal(converge(desiredV(home, 0), world).result.error, undefined);
      for (const rel of [".claude/skills/x/references/sources", ".claude/skills/x/references", ".claude/skills/x"]) {
        assert.equal(fs.existsSync(path.join(home, rel)), false, rel);
      }
      assert.equal(isDir(home, ".claude/skills"), true);
      assert.equal(isDir(home, ".claude"), true);
    });

    test("a dir below depth 3 goes and a grandchild of HOME stays, empty", () => {
      const { home, world } = seeded(1);
      assert.equal(isDir(home, ".new/deep/dir"), true);
      assert.equal(converge(desiredV(home, 2), world).result.error, undefined);
      assert.equal(fs.existsSync(path.join(home, ".new/deep/dir")), false);
      assert.equal(isDir(home, ".new/deep"), true);
      assert.deepEqual(fs.readdirSync(path.join(home, ".new/deep")), []);
      assert.equal(isDir(home, ".new"), true);
    });

    test("a dir that still holds a user file stays, and its empty child goes", () => {
      const home = fresh();
      const world = makeWorld(home);
      converge(withFiles(desiredV(home, 0), home, { [leaf]: "a\n" }), world);
      write(home, ".claude/skills/x/references/note.txt", "mine\n");
      assert.equal(converge(desiredV(home, 0), world).result.error, undefined);
      assert.equal(fs.existsSync(path.join(home, ".claude/skills/x/references/sources")), false);
      assert.equal(fs.readFileSync(path.join(home, ".claude/skills/x/references/note.txt"), "utf8"), "mine\n");
    });

    test("a symlink left in the dir keeps it, and its target is not followed", () => {
      const home = fresh();
      const world = makeWorld(home);
      converge(withFiles(desiredV(home, 0), home, { [leaf]: "a\n" }), world);
      write(home, "elsewhere/keep.txt", "kept\n");
      fs.symlinkSync(path.join(home, "elsewhere"), path.join(home, ".claude/skills/x/references/link"));
      assert.equal(converge(desiredV(home, 0), world).result.error, undefined);
      assert.equal(fs.existsSync(path.join(home, ".claude/skills/x/references/sources")), false);
      assert.equal(fs.lstatSync(path.join(home, ".claude/skills/x/references/link")).isSymbolicLink(), true);
      assert.equal(fs.readFileSync(path.join(home, "elsewhere/keep.txt"), "utf8"), "kept\n");
    });

    test("a harness dir that is a symlink survives, and the empty dirs below it go", () => {
      const home = fresh();
      fs.mkdirSync(path.join(home, "dotfiles/claude"), { recursive: true });
      fs.symlinkSync(path.join(home, "dotfiles/claude"), path.join(home, ".claude"));
      const world = makeWorld(home);
      converge(withFiles(desiredV(home, 0), home, { [leaf]: "a\n" }), world);
      assert.equal(converge(desiredV(home, 0), world).result.error, undefined);
      assert.equal(fs.lstatSync(path.join(home, ".claude")).isSymbolicLink(), true);
      assert.equal(isDir(home, "dotfiles/claude/skills"), true);
      assert.equal(fs.existsSync(path.join(home, "dotfiles/claude/skills/x")), false);
    });

    test("an rmdir that the OS refuses stops the prune, and the run still commits", { skip: process.getuid?.() === 0 }, () => {
      const home = fresh();
      const world = makeWorld(home);
      converge(withFiles(desiredV(home, 0), home, { [leaf]: "a\n" }), world);
      const locked = path.join(home, ".claude/skills/x");
      fs.chmodSync(locked, 0o555);
      try {
        const { result } = converge(desiredV(home, 0), world);
        assert.equal(result.error, undefined);
        assert.equal(fs.existsSync(path.join(home, leaf)), false);
        assert.equal(isDir(home, ".claude/skills/x/references"), true);
        assert.equal(fs.existsSync(path.join(home, ".claude/skills/x/references/sources")), false);
        assert.ok(journalLines(world, result.run).some((l) => l.type === "commit"));
      } finally {
        fs.chmodSync(locked, 0o755);
      }
    });

    test("undo of the removal restores the file byte-exact with its dirs", () => {
      const home = fresh();
      const world = makeWorld(home);
      converge(withFiles(desiredV(home, 0), home, { [leaf]: "a\n" }), world);
      const before = snap(home);
      const run = converge(desiredV(home, 0), world).result.run;
      assert.equal(fs.existsSync(path.join(home, ".claude/skills/x")), false);
      const u = undo(run, world);
      assert.deepEqual(u.conflicts, []);
      assert.deepEqual(snap(home), before);
      assert.equal(fs.readFileSync(path.join(home, leaf), "utf8"), "a\n");
    });

    test("undo of a create takes the dirs that the create made", () => {
      const home = fresh();
      const world = makeWorld(home);
      converge(desiredV(home, 0), world);
      const run = converge(withFiles(desiredV(home, 0), home, { [leaf]: "a\n" }), world).result.run;
      assert.equal(isDir(home, ".claude/skills/x/references/sources"), true);
      assert.deepEqual(undo(run, world).conflicts, []);
      assert.equal(fs.existsSync(path.join(home, ".claude/skills/x")), false);
      assert.equal(isDir(home, ".claude/skills"), true);
    });
  });

  test("a file changed between plan and write stops the run with E_CHANGED_UNDER", () => {
    const { home, world } = seeded(0);
    const p = plan(desiredV(home, 1), OK, world, OPTS);
    assert.equal(p.ops[1].path, "~/.claude/skills/s001/SKILL.md");
    write(home, ".claude/skills/s001/SKILL.md", "changed under\n");
    const r = apply(p, world);
    assert.equal(r.error.code, "E_CHANGED_UNDER");
    assert.equal(r.changed, 1);
    assert.equal(fs.readFileSync(path.join(home, ".claude/skills/s001/SKILL.md"), "utf8"), "changed under\n");
    assert.deepEqual(journalLines(world, r.run).at(-1), { type: "abort", seq: 2, reason: "E_CHANGED_UNDER", done: [1] });
    const next = plan(desiredV(home, 1), OK, world, OPTS);
    assert.deepEqual(codes(next), [["~/.claude/skills/s001/SKILL.md", "E_DRIFT"]]);
    assert.equal(next.ops.some((o) => o.path === "~/.claude/skills/s000/SKILL.md"), false, "the done op stays recorded");
  });

  test("a file changed during the rename batch stops the run; no temp file of a later op stays behind", () => {
    const { home, world } = seeded(0);
    const p = plan(desiredV(home, 1), OK, world, OPTS);
    const first = path.join(home, ".claude/skills/s000/SKILL.md");
    const rename = fs.renameSync;
    fs.renameSync = (from, to) => {
      rename(from, to);
      if (to === first) write(home, ".claude/skills/s001/SKILL.md", "changed under\n");
    };
    let r;
    try {
      r = apply(p, world);
    } finally {
      fs.renameSync = rename;
    }
    assert.equal(r.error.code, "E_CHANGED_UNDER");
    assert.equal(r.changed, 1);
    assert.deepEqual(litter(home), []);
    assert.deepEqual(journalLines(world, r.run).at(-1), { type: "abort", seq: 2, reason: "E_CHANGED_UNDER", done: [1] });
    assert.equal(fs.readFileSync(path.join(home, ".claude/skills/s001/SKILL.md"), "utf8"), "changed under\n");
    assert.deepEqual(codes(plan(desiredV(home, 1), OK, world, OPTS)), [["~/.claude/skills/s001/SKILL.md", "E_DRIFT"]]);
  });

  test("backups, temp files and the journal are durable before HOME changes; changed dirs before installed.json", () => {
    const { home, world } = seeded(0);
    const p = plan(desiredV(home, 1), OK, world, OPTS);
    const state = world.env.state;
    const log: {call: "fsync" | "rename" | "unlink", path: string, to?: string}[] = [];
    const fdPath = new Map<number, string>();
    const batch: SpawnSync = (cmd, args, opts) => {
      const r = spawnChild(cmd, args, opts as cp.SpawnSyncOptionsWithStringEncoding);
      const paths: string[] = JSON.parse(opts.input).paths;
      if (r.status === 0) for (const [i, f] of JSON.parse(r.stdout).entries()) if (f === null) log.push({ call: "fsync", path: paths[i] });
      return r;
    };
    const { openSync, fsyncSync, renameSync, rmSync } = fs;
    Object.assign(fs, {
      openSync: (...a: Parameters<typeof openSync>) => {
        const fd = openSync(...a);
        fdPath.set(fd, String(a[0]));
        return fd;
      },
      fsyncSync: (fd: number) => (log.push({ call: "fsync", path: fdPath.get(fd) ?? "?" }), fsyncSync(fd)),
      renameSync: (from: string, to: string) => (log.push({ call: "rename", path: from, to }), renameSync(from, to)),
      rmSync: (f: string, o: object) => (log.push({ call: "unlink", path: f }), rmSync(f, o)),
    });
    let r;
    try {
      r = withSpawnSync(batch, () => apply(p, world));
    } finally {
      Object.assign(fs, { openSync, fsyncSync, renameSync, rmSync });
    }
    assert.equal(r.error, undefined);
    const inState = (f: string) => f.startsWith(`${state}/`);
    const at = (pred: (e: (typeof log)[number]) => boolean, from = 0) => log.findIndex((e, i) => i >= from && pred(e));
    const syncedBefore = (f: string, end: number) => {
      const i = at((e) => e.call === "fsync" && e.path === f);
      return i >= 0 && i < end;
    };
    const homeWrites = log.flatMap((e, i): {i: number, tmp: string | null, target: string}[] => {
      if (e.call === "rename" && !inState(e.to!)) return [{ i, tmp: e.path, target: e.to! }];
      if (e.call === "unlink" && !inState(e.path) && !e.path.endsWith(".rig-tmp")) return [{ i, tmp: null, target: e.path }];
      return [];
    });
    assert.equal(homeWrites.length, p.ops.length, "every op of the plan changes HOME once");
    const first = homeWrites[0].i;
    const last = homeWrites.at(-1)!.i;
    for (const { tmp } of homeWrites) if (tmp) assert.ok(syncedBefore(tmp, first), `${tmp} is durable before the first rename`);
    const backups = log.filter((e) => e.call === "rename" && e.to!.startsWith(path.join(state, "backups")));
    assert.ok(backups.length > 0);
    for (const b of backups) assert.ok(syncedBefore(b.to!, first), `${b.to} is durable before the first rename`);
    assert.ok(syncedBefore(path.join(state, "journal"), first), "the journal is durable before the first rename");
    const installed = at((e) => e.call === "rename" && e.to === path.join(state, "installed.json"), last);
    assert.ok(installed > last);
    const surviving = (f: string) => {
      let d = path.dirname(f);
      while (!fs.existsSync(d)) d = path.dirname(d);
      return d;
    };
    for (const d of new Set(homeWrites.map((w) => surviving(w.target)))) {
      const synced = at((e) => e.call === "fsync" && e.path === d, last);
      assert.ok(synced > last && synced < installed, `${d} is durable after the last rename, before installed.json`);
    }
  });

  test("apply under ulimit -n 64 with more files to sync than the limit converges", async () => {
    const home = fresh();
    seedUserFiles(home);
    const world = makeWorld(home);
    const shape = { n: 120 };
    const c = await runChild(home, 0, { ...shape, fdLimit: 64 });
    assert.equal(c.code, 0, c.stderr);
    assert.equal(installedMismatch(world, desiredV(home, 0, shape)), null);
    assert.equal(plan(desiredV(home, 0, shape), OK, world, OPTS).ops.length, 0);
  });

  test("a second concurrent apply is refused; a stale lock is replaced", async () => {
    const { home, world } = seeded(0);
    const holder = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    try {
      writeState("apply.lock", Buffer.from(JSON.stringify({ pid: holder.pid, run: "other" })), ctxOf(world));
      const before = snap(home);
      const n = journals(world).length;
      const r = converge(desiredV(home, 1), world).result;
      assert.equal(r.error.code, "E_LOCKED");
      assert.deepEqual(snap(home), before);
      assert.equal(journals(world).length, n);
    } finally {
      holder.kill("SIGKILL");
      await new Promise((res) => (holder.exitCode !== null || holder.signalCode ? res() : holder.on("exit", res)));
    }
    const r = converge(desiredV(home, 1), world).result;
    assert.equal(r.error, undefined);
    assert.equal(fs.existsSync(path.join(world.env.state, "apply.lock")), false);
  });

  test("temp litter is swept on start, other files stay", () => {
    const { home, world } = seeded(0);
    write(home, ".claude/skills/s000/.SKILL.md.123-abc.rig-tmp", "litter");
    write(home, ".claude/skills/s000/notes.md", "keep\n");
    write(home, `${STATE_REL}/.installed.json.1-x.rig-tmp`, "litter");
    write(home, `${STATE_REL}/journal/.j.1-y.rig-tmp`, "litter");
    converge(desiredV(home, 0), world);
    assert.deepEqual(fs.readdirSync(path.join(home, ".claude/skills/s000")).sort(), ["SKILL.md", "notes.md"]);
    assert.equal(fs.readdirSync(world.env.state).some((n) => n.endsWith(".rig-tmp")), false);
    assert.equal(fs.readdirSync(path.join(world.env.state, "journal")).some((n) => n.endsWith(".rig-tmp")), false);
  });
});

describe("crash and recovery", () => {
  const base = seeded(0);
  const ref1 = clone(base.home);
  converge(desiredV(ref1.home, 1), ref1.world);
  const REF1 = snap(ref1.home);
  converge(desiredV(ref1.home, 2), ref1.world);
  const REF2 = snap(ref1.home);
  const N = plan(desiredV(base.home, 1), OK, base.world, OPTS).ops.length;

  test("the clone of a seeded HOME is byte- and mode-identical", () => {
    assert.deepEqual(snap(clone(base.home).home), snap(base.home));
    assert.equal(N, 9);
  });

  for (const target of [1, 2]) {
    test(`abort after op k for every k converges on the next apply (then desired v${target})`, async () => {
      for (let k = 0; k <= N; k++) {
        const { home, world } = clone(base.home);
        const c = await runChild(home, 1, { env: { RIG_TEST: "1", RIG_TEST_ABORT_AFTER: String(k) } });
        assert.equal(c.signal, "SIGKILL", `k=${k} ${c.stderr}`);
        assert.equal(allClosed(world), false, `k=${k} leaves an open journal`);
        const { result } = converge(desiredV(home, target), world);
        assert.equal(result.error, undefined, `k=${k}`);
        assertConverged(home, world, target, target === 1 ? REF1 : REF2);
      }
    });
  }

  const SEED = snap(base.home);
  const staged = (states: {state: string, op: string}[]) => states.filter((s) => s.state === "before" && s.op !== "remove-to-backup").length;
  const boundaries = [
    { at: "journal", done: 0, litter: () => 0, what: "after the journal holds every intent, before the temp files" },
    { at: "staged", done: 0, litter: staged, what: "after the temp files are written, before the batched fsync" },
    { at: "0", done: 0, litter: staged, what: "after the batched fsync, before the first rename" },
    { at: "4", done: 4, litter: staged, what: "mid-rename batch, after 4 of 9 renames" },
    { at: "9", done: 9, litter: () => 0, what: "after the last rename, before the dir fsync" },
    { at: "installed", done: 9, litter: () => 0, what: "after installed.json, before the commit line" },
  ];
  for (const b of boundaries) {
    test(`a kill ${b.what} leaves each intent at its before or after bytes; the next apply converges`, async () => {
      const { home, world } = clone(base.home);
      const c = await runChild(home, 1, { env: { RIG_TEST: "1", RIG_TEST_ABORT_AFTER: b.at } });
      assert.equal(c.signal, "SIGKILL", c.stderr);
      const [name] = journals(world).filter((n) => !journals(base.world).includes(n));
      const run = name.slice(0, -6);
      assert.equal(journalLines(world, run).at(-1).type, "intent", "the journal is open");
      const states = intentStates(world, run);
      assert.equal(states.length, N, "every intent is journaled before the first rename");
      assert.deepEqual(states.map((s) => s.state), [...Array(b.done).fill("after"), ...Array(N - b.done).fill("before")], "renames land in plan order");
      assert.equal(litter(home).length, b.litter(states), "one temp file per staged op that is not yet renamed");
      if (b.at === "journal") assert.deepEqual(snap(home), SEED, "HOME is untouched");
      if (b.at === "installed") assert.equal(installedMismatch(world, desiredV(home, 1)), null, "installed.json holds the new entries");
      const p = plan(desiredV(home, 1), OK, world, OPTS);
      assert.deepEqual(p.interrupted, [run]);
      assert.equal(p.blocked, false, "recovery explains every path");
      assert.equal(p.ops.length, N - b.done);
      assert.equal(converge(desiredV(home, 1), world).result.error, undefined);
      assertConverged(home, world, 1, REF1);
    });
  }

  test("undo of a run killed mid-rename restores the done ops and skips the intents that never reached disk", async () => {
    const { home, world } = clone(base.home);
    const c = await runChild(home, 1, { env: { RIG_TEST: "1", RIG_TEST_ABORT_AFTER: "4" } });
    assert.equal(c.signal, "SIGKILL", c.stderr);
    const run = journals(world).filter((n) => !journals(base.world).includes(n))[0].slice(0, -6);
    const u = undo(run, world);
    assert.deepEqual(u.conflicts, []);
    assert.equal(u.restored, 4);
    assert.deepEqual(snap(home), SEED);
    assert.equal(converge(desiredV(home, 1), world).result.error, undefined);
    assertConverged(home, world, 1, REF1);
  });

  const newRun = (world: {env: {state: string}}) => journals(world).filter((n) => !journals(base.world).includes(n))[0].slice(0, -6);
  const ref1WithSeedAt = (intents: {path: string}[]) => {
    const out = { ...REF1 };
    for (const { path: p } of intents) {
      const rel = p.slice(2);
      if (rel in SEED) out[rel] = SEED[rel];
      else delete out[rel];
    }
    return out;
  };
  for (const k of [0, 4]) {
    test(`undo of a run killed after ${k} renames restores those ${k} ops only, after a later run did the rest`, async () => {
      const { home, world } = clone(base.home);
      const c = await runChild(home, 1, { env: { RIG_TEST: "1", RIG_TEST_ABORT_AFTER: String(k) } });
      assert.equal(c.signal, "SIGKILL", c.stderr);
      const run = newRun(world);
      const intents = journalLines(world, run).filter((l) => l.type === "intent");
      assert.equal(converge(desiredV(home, 1), world).result.error, undefined);
      assert.deepEqual(snap(home), REF1);
      const u = undo(run, world);
      assert.deepEqual(u.conflicts, []);
      assert.equal(u.restored, k);
      assert.deepEqual(snap(home), ref1WithSeedAt(intents.slice(0, k)), "the later run's work stays");
    });
  }

  test("undo of a run stopped by E_CHANGED_UNDER restores its done op only, after a later run did the rest", () => {
    const { home, world } = clone(base.home);
    const first = path.join(home, ".claude/skills/s000/SKILL.md");
    const second = path.join(home, ".claude/skills/s001/SKILL.md");
    const secondBytes = fs.readFileSync(second);
    const rename = fs.renameSync;
    fs.renameSync = (from, to) => {
      rename(from, to);
      if (to === first) fs.writeFileSync(second, "changed under\n");
    };
    let r;
    try {
      r = apply(plan(desiredV(home, 1), OK, world, OPTS), world);
    } finally {
      fs.renameSync = rename;
    }
    assert.equal(r.error.code, "E_CHANGED_UNDER");
    assert.equal(r.changed, 1);
    fs.writeFileSync(second, secondBytes);
    assert.equal(converge(desiredV(home, 1), world).result.error, undefined);
    assert.deepEqual(snap(home), REF1);
    const u = undo(r.run, world);
    assert.deepEqual(u.conflicts, []);
    assert.equal(u.restored, 1);
    assert.deepEqual(snap(home), ref1WithSeedAt(journalLines(world, r.run).filter((l) => l.type === "intent").slice(0, 1)));
  });

  test("undo of a journal closed by an older rig, without the done seqs, restores the intents at their after bytes", async () => {
    const { home, world } = clone(base.home);
    const c = await runChild(home, 1, { env: { RIG_TEST: "1", RIG_TEST_ABORT_AFTER: "4" } });
    assert.equal(c.signal, "SIGKILL", c.stderr);
    const run = newRun(world);
    assert.deepEqual(apply({ ops: [], blocked: false, interrupted: [run] }, world), { run: null, changed: 0 });
    const file = path.join(world.env.state, "journal", `${run}.jsonl`);
    const lines = journalLines(world, run);
    const { done, ...legacy } = lines.at(-1);
    assert.equal(legacy.type, "recovered");
    const close = (last: object) => fs.writeFileSync(file, [...lines.slice(0, -1), last].map((l) => `${JSON.stringify(l)}\n`).join(""));
    close({ ...legacy, done: ["1"] });
    assert.deepEqual(undo(run, world).conflicts.map((x) => x.code), ["E_UNDO_CONFLICT"], "a done field that is not a list of seqs is corrupt");
    close(legacy);
    const u = undo(run, world);
    assert.deepEqual(u.conflicts, []);
    assert.equal(u.restored, 4);
    assert.deepEqual(snap(home), SEED);
  });

  test("RIG_TEST_ABORT_AFTER is ignored without RIG_TEST=1", async () => {
    const { home, world } = clone(base.home);
    const c = await runChild(home, 1, { env: { RIG_TEST_ABORT_AFTER: "0" } });
    assert.equal(c.code, 0, c.stderr);
    assertConverged(home, world, 1, REF1);
  });

  test("a stale plan after a crash is refused with replan, nothing written to HOME", async () => {
    const { home, world } = clone(base.home);
    const stale = plan(desiredV(home, 1), OK, world, OPTS);
    await runChild(home, 1, { env: { RIG_TEST: "1", RIG_TEST_ABORT_AFTER: "3" } });
    const before = snap(home);
    assert.notDeepEqual(litter(home), []);
    for (const rel of litter(home)) delete before[rel];
    assert.deepEqual(apply(stale, world), { run: null, changed: 0, replan: true });
    assert.deepEqual(snap(home), before, "only the temp files of the killed run are gone");
    assert.equal(converge(desiredV(home, 1), world).result.error, undefined);
    assertConverged(home, world, 1, REF1);
  });

  test("an open journal with only a run line, or without its commit line, is closed with recovered", () => {
    const { home, world } = clone(base.home);
    const r = converge(desiredV(home, 1), world).result;
    const file = path.join(world.env.state, "journal", `${r.run}.jsonl`);
    const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
    fs.writeFileSync(file, `${lines.slice(0, -1).join("\n")}\n`);
    const empty = "20261104T000000.000Z-90";
    fs.writeFileSync(path.join(world.env.state, "journal", `${empty}.jsonl`), `${JSON.stringify({ type: "run", run: empty, cmd: "apply", rig: "0.1.0" })}\n{"type":"inte`);
    const installed = readInstalledFile(world);
    const p = plan(desiredV(home, 1), OK, world, OPTS);
    assert.deepEqual(p.interrupted, [r.run, empty]);
    assert.equal(p.ops.length, 0);
    const res = apply(p, world);
    assert.deepEqual(res, { run: null, changed: 0 });
    assert.equal(journalLines(world, r.run).at(-1).type, "recovered");
    const emptyLines = fs.readFileSync(path.join(world.env.state, "journal", `${empty}.jsonl`), "utf8").split("\n").filter(Boolean);
    assert.equal(JSON.parse(emptyLines.at(-1)).type, "recovered");
    assert.match(JSON.parse(emptyLines.at(-1)).by, /^\d{8}T\d{6}\.\d{3}Z-\d+$/);
    assert.deepEqual(readInstalledFile(world), installed);
    assertConverged(home, world, 1, REF1);
  });

  test("a journal path that escapes HOME is refused by recovery and undo; nothing is written", () => {
    const { home, world } = clone(base.home);
    const outside = fresh("rig-outside-");
    fs.symlinkSync(outside, path.join(home, "link"));
    const sha = `sha256:${"0".repeat(64)}`;
    const intent = (p) => JSON.stringify({ type: "intent", seq: 1, path: p, op: "create", kind: "owned", before_sha: null, before_mode: null,
      after_sha: sha, after_mode: 420, backup: null, entry_before: null, entry_after: null });
    const run = "20261104T000000.000Z-91";
    const file = path.join(world.env.state, "journal", `${run}.jsonl`);
    fs.writeFileSync(file, `${JSON.stringify({ type: "run", run, cmd: "apply", rig: "0.1.0" })}\n${intent("~/../escape.md")}\n${intent("~/link/x.md")}\n`);
    const before = snap(home);
    const p = plan(desiredV(home, 1), OK, world, OPTS);
    assert.ok(p.blocked);
    assert.deepEqual(p.ops.filter((o) => o.op === "block").map((o) => o.error.code), ["E_CONTAINMENT", "E_CONTAINMENT"]);
    const r = apply(p, world);
    assert.equal(r.error.code, "E_RECOVERY_CONFLICT");
    assert.match(r.error.message, /escape\.md[\s\S]*link\/x\.md/);
    fs.appendFileSync(file, `${JSON.stringify({ type: "commit", run, ops: 2 })}\n`);
    const u = undo(run, world);
    assert.equal(u.run, null);
    assert.deepEqual(u.conflicts.map((c) => [c.path, c.code]), [["~/link/x.md", "E_CONTAINMENT"], ["~/../escape.md", "E_CONTAINMENT"]]);
    assert.deepEqual(snap(home), before);
    assert.deepEqual(fs.readdirSync(outside), []);
    assert.equal(fs.existsSync(path.join(path.dirname(home), "escape.md")), false);
  });

  test("SIGKILL of a child apply at 20 random points converges", { timeout: 180_000 }, async (t) => {
    const shape = { n: 30, bulk: true };
    const seed = seeded(0, shape);
    const ref = clone(seed.home);
    converge(desiredV(ref.home, 1, shape), ref.world);
    const REF = snap(ref.home);
    const SEED = snap(seed.home);
    const full = await runChild(clone(seed.home).home, 1, shape);
    assert.equal(full.code, 0, full.stderr);
    const rnd = prng(20261105);
    const landed = { pre: 0, mid: 0, post: 0 };
    for (let i = 0; i < 20; i++) {
      const { home, world } = clone(seed.home);
      const delay = Math.round(full.ms * (0.3 + rnd() * 0.75));
      const c = await runChild(home, 1, { ...shape, killAfterMs: delay });
      const s = snap(home);
      const where = JSON.stringify(s) === JSON.stringify(SEED) ? "pre" : JSON.stringify(s) === JSON.stringify(REF) ? "post" : "mid";
      landed[where]++;
      const { result } = converge(desiredV(home, 1, shape), world);
      assert.equal(result.error, undefined, `kill ${i} at ${delay}ms (${c.signal ?? c.code})`);
      assertConverged(home, world, 1, REF, shape);
    }
    t.diagnostic(`full run ${Math.round(full.ms)}ms; kills landed pre/mid/post = ${landed.pre}/${landed.mid}/${landed.post}`);
  });
});

describe("undo", () => {
  test("undo restores byte-exact: a removed file, a 0600 file and a user file from before the first run", () => {
    const home = fresh();
    seedUserFiles(home);
    const world = makeWorld(home);
    const S0 = snap(home);
    const run1 = converge(desiredV(home, 0), world).result.run;
    const S1 = snap(home);
    const I1 = readInstalledFile(world);
    assert.equal(S1[".config/tool/token.env"].split(":")[1], "600");
    assert.notEqual(S1[".codex/config.toml"], S0[".codex/config.toml"], "run 1 patched the user's config");
    const run2 = converge(desiredV(home, 1), world).result.run;
    assert.equal(fs.existsSync(path.join(home, ".claude/skills/s005/SKILL.md")), false);

    const u2 = undo(run2, world);
    assert.deepEqual(u2.conflicts, []);
    assert.equal(u2.restored, 9);
    assert.deepEqual(snap(home), S1);
    assert.deepEqual(readInstalledFile(world), I1);
    assert.equal(journalLines(world, u2.run)[0].cmd, "undo");
    assert.equal(journalLines(world, u2.run).at(-1).type, "commit");

    const u1 = undo(run1, world);
    assert.deepEqual(u1.conflicts, []);
    assert.deepEqual(snap(home), S0);
    assert.deepEqual(readInstalledFile(world), { schema: 1, entries: {} });
    assert.equal(plan(desiredV(home, 0), OK, world, OPTS).ops.length, 10, "after a full undo the plan starts over");
  });

  test("undo with conflicting paths writes nothing and lists every path", () => {
    const { home, world } = seeded(1);
    const run2 = journals(world).at(-1).slice(0, -6);
    write(home, ".claude/skills/s000/SKILL.md", "user edit\n");
    write(home, ".claude/skills/s005/SKILL.md", "recreated by the user\n");
    const before = snap(home);
    const n = journals(world).length;
    const u = undo(run2, world);
    assert.equal(u.run, null);
    assert.equal(u.restored, 0);
    assert.deepEqual(u.conflicts.map((c) => c.code), ["E_UNDO_CONFLICT", "E_UNDO_CONFLICT"]);
    assert.deepEqual(u.conflicts.map((c) => c.path).sort(), ["~/.claude/skills/s000/SKILL.md", "~/.claude/skills/s005/SKILL.md"]);
    assert.deepEqual(snap(home), before);
    assert.equal(journals(world).length, n);
  });

  test("undo of an unknown run id reports a conflict and writes nothing", () => {
    const { home, world } = seeded(0);
    const before = snap(home);
    assert.equal(undo("20990101T000000.000Z-7", world).conflicts[0].code, "E_UNDO_CONFLICT");
    assert.equal(undo("../../etc", world).conflicts[0].code, "E_UNDO_CONFLICT");
    assert.deepEqual(snap(home), before);
  });
});
