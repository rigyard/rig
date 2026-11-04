import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { writeHome, writeState } from "../lib/fs.mjs";
import { apply, plan, undo } from "../lib/state.mjs";
import {
  asObj, converge, ctxOf, desiredV, fakePatch, installedMismatch, journalLines, journals, makeWorld, prng,
  readInstalledFile, runChild, seedUserFiles, snapshot, STATE_REL, tmpDir,
} from "./state.helpers.mjs";

const dirs = [];
const fresh = (prefix) => {
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
const write = (home, rel, text, mode) => {
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

  test("a file changed between plan and write stops the run with E_CHANGED_UNDER", () => {
    const { home, world } = seeded(0);
    const p = plan(desiredV(home, 1), OK, world, OPTS);
    assert.equal(p.ops[1].path, "~/.claude/skills/s001/SKILL.md");
    write(home, ".claude/skills/s001/SKILL.md", "changed under\n");
    const r = apply(p, world);
    assert.equal(r.error.code, "E_CHANGED_UNDER");
    assert.equal(r.changed, 1);
    assert.equal(fs.readFileSync(path.join(home, ".claude/skills/s001/SKILL.md"), "utf8"), "changed under\n");
    assert.deepEqual(journalLines(world, r.run).at(-1), { type: "abort", seq: 2, reason: "E_CHANGED_UNDER" });
    const next = plan(desiredV(home, 1), OK, world, OPTS);
    assert.deepEqual(codes(next), [["~/.claude/skills/s001/SKILL.md", "E_DRIFT"]]);
    assert.equal(next.ops.some((o) => o.path === "~/.claude/skills/s000/SKILL.md"), false, "the done op stays recorded");
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
    assert.deepEqual(apply(stale, world), { run: null, changed: 0, replan: true });
    assert.deepEqual(snap(home), before);
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
