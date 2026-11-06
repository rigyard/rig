import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { assertOutsideHomeDotDirs, makeFixtureHome } from "./helpers/fixture-home.ts";
import { changedPaths, guardRealConfig, liveTest, ompModelArgs, REAL_CONFIG_PATHS, realConfigHashes, realHome, runHarness } from "./helpers/live.ts";
import { assertOutsideRealHome, harnessArgv, mirrorProject, realBin, replyOf, scratchRepo, sentinel } from "./helpers/mirror.ts";
import { makeStubs } from "./helpers/stubs.ts";

const sha = (s) => createHash("sha256").update(s).digest("hex");

describe("fixture-home", () => {
  test("builds files, modes and symlinks, and snapshots files only", (t) => {
    const fx = makeFixtureHome({
      ".claude/skills/a/SKILL.md": "# a\n",
      ".agents/skills/b/run.sh": { content: "#!/bin/sh\n", mode: 0o755 },
      ".cursor/skills/a": { symlink: "../../.claude/skills/a" },
    });
    t.after(fx.cleanup);

    assert.equal(fx.read(".claude/skills/a/SKILL.md"), "# a\n");
    assert.equal(readlinkSync(fx.path(".cursor/skills/a")), "../../.claude/skills/a");
    assert.deepEqual(
      fx.snapshot(),
      new Map([
        [".agents/skills/b/run.sh", { sha256: sha("#!/bin/sh\n"), mode: 0o755 }],
        [".claude/skills/a/SKILL.md", { sha256: sha("# a\n"), mode: 0o644 }],
      ]),
    );
  });

  test("a snapshot changes when a byte or a mode changes", (t) => {
    const fx = makeFixtureHome({ "f.txt": "x" });
    t.after(fx.cleanup);
    const before = fx.snapshot();
    writeFileSync(fx.path("f.txt"), "y");
    assert.notDeepEqual(fx.snapshot(), before);
    writeFileSync(fx.path("f.txt"), "x");
    assert.deepEqual(fx.snapshot(), before);
    chmodSync(fx.path("f.txt"), 0o600);
    assert.notDeepEqual(fx.snapshot(), before);
  });

  test("rejects a path that escapes home", (t) => {
    const fx = makeFixtureHome();
    t.after(fx.cleanup);
    assert.throws(() => fx.path("../outside"), /escapes home/);
    assert.throws(() => fx.path("/etc/passwd"), /home-relative/);
    assert.throws(() => makeFixtureHome({ "../x": "y" }), /escapes home/);
  });

  test("refuses the real home and its dot-dirs", () => {
    const home = "/home/u";
    assert.throws(() => assertOutsideHomeDotDirs("/home/u", home), /real home/);
    assert.throws(() => assertOutsideHomeDotDirs("/home/u/.claude/tmp", home), /dot-dir/);
    assert.throws(() => assertOutsideHomeDotDirs("/home/u/.cache", home), /dot-dir/);
    assert.doesNotThrow(() => assertOutsideHomeDotDirs("/home/u/work/tmp", home));
    assert.doesNotThrow(() => assertOutsideHomeDotDirs("/tmp/rig-fixture-1", home));
    assert.doesNotThrow(() => assertOutsideHomeDotDirs("/home/user2/.claude", home));
  });

  test("cleanup removes the tree", () => {
    const fx = makeFixtureHome({ a: "b" });
    fx.cleanup();
    assert.equal(existsSync(fx.home), false);
  });
});

describe("stubs", () => {
  test("a stub records argv, cwd and allowlisted env, and prints its canned output", async (t) => {
    const fx = makeFixtureHome();
    const stubs = makeStubs(["claude", "codex"], { canned: { claude: '{"result":"ok"}\n' } });
    t.after(() => (fx.cleanup(), stubs.cleanup()));

    const env = { ...stubs.env, HOME: fx.home, RIG_X: "1", SECRET_TOKEN: "do-not-log" };
    const r = await runHarness({ bin: "claude", args: ["-p", "hi", "--output-format", "json"], cwd: fx.home, env });
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(r.json, { result: "ok" });

    const c = await runHarness({ bin: "codex", args: ["exec"], cwd: fx.home, env });
    assert.equal(c.code, 0, c.stderr);
    assert.equal(c.stdout, "");

    const log = stubs.log();
    assert.equal(log.length, 2);
    assert.deepEqual(log[0], {
      name: "claude",
      argv: ["-p", "hi", "--output-format", "json"],
      cwd: fx.home,
      env: { HOME: fx.home, RIG_X: "1", RIG_STUB_LOG: stubs.logFile },
    });
    assert.equal(log[1].name, "codex");
    assert.deepEqual(log[1].argv, ["exec"]);
  });

  test("the git stub records, then passes through to the real git", async (t) => {
    const stubs = makeStubs(["git"]);
    t.after(stubs.cleanup);
    const r = await runHarness({ bin: "git", args: ["--version"], env: stubs.env });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /^git version /);
    assert.deepEqual(stubs.log().map((l) => l.argv), [["--version"]]);
  });

  test("PATH resolves stubs before anything else", () => {
    const stubs = makeStubs(["omp"]);
    try {
      assert.equal(stubs.PATH.split(":")[0], stubs.binDir);
    } finally {
      stubs.cleanup();
    }
  });

  test("rejects unknown names and canned output for an unstubbed name", () => {
    assert.throws(() => makeStubs(["curl"]), /unknown stub name/);
    assert.throws(() => makeStubs(["claude"], { canned: { codex: "x" } }), /not stubbed/);
  });
});

describe("live", () => {
  test("runHarness reports a timeout as a null code", async () => {
    const r = await runHarness({ bin: process.execPath, args: ["-e", "setTimeout(() => {}, 10000)"], timeoutMs: 100 });
    assert.equal(r.code, null);
    assert.equal(r.signal, "SIGKILL");
  });

  liveTest("liveTest skips unless RIG_LIVE=1", () => {
    assert.equal(process.env.RIG_LIVE, "1");
  });

  test("ompModelArgs gives a skip reason that names the variable when it is unset or blank, and the model in argv when it is set", () => {
    for (const env of [{}, { RIG_LIVE_OMP_MODEL: "" }, { RIG_LIVE_OMP_MODEL: "  " }]) {
      const r = ompModelArgs(env);
      assert.deepEqual(r.args, []);
      assert.match(r.skip ?? "", /RIG_LIVE_OMP_MODEL/);
    }
    assert.deepEqual(ompModelArgs({ RIG_LIVE_OMP_MODEL: " prov/m " }), { args: ["--model", "prov/m"], skip: null });
  });
});

describe("real config guard", () => {
  test("the hash list starts with the three boot-recipe files that no harness rewrites by itself", () => {
    assert.deepEqual(REAL_CONFIG_PATHS.slice(0, 3), [
      ".claude/settings.json",
      ".codex/config.toml",
      ".omp/agent/config.yml",
    ]);
    assert.ok(!REAL_CONFIG_PATHS.includes(".claude/plugins/installed_plugins.json"));
    for (const dir of [".claude/commands", ".claude/skills", ".claude/rules", ".codex/skills", ".codex/agents", ".cursor/rules", ".cursor/agents", ".omp/agent/skills", ".agents/skills"]) {
      assert.ok(REAL_CONFIG_PATHS.includes(dir), dir);
    }
  });

  test("a hash is null when absent and changes on a byte, a new file, a mode or a symlink target", (t) => {
    const fx = makeFixtureHome({ ".claude/settings.json": "{}\n", ".claude/skills/a/SKILL.md": "# a\n", ".agents/skills/b": { symlink: "../x" } });
    t.after(fx.cleanup);
    const h0 = realConfigHashes(fx.home);
    assert.deepEqual(Object.keys(h0), REAL_CONFIG_PATHS);
    assert.equal(h0[".codex/config.toml"], null);
    assert.match(h0[".claude/settings.json"], /^[0-9a-f]{64}$/);
    assert.deepEqual(changedPaths(h0, realConfigHashes(fx.home)), []);

    const steps = [
      [".claude/skills", () => writeFileSync(fx.path(".claude/skills/a/SKILL.md"), "# b\n")],
      [".claude/skills", () => writeFileSync(fx.path(".claude/skills/a/extra.md"), "x")],
      [".claude/skills", () => chmodSync(fx.path(".claude/skills/a/extra.md"), 0o600)],
      [".claude/settings.json", () => writeFileSync(fx.path(".claude/settings.json"), "{ }\n")],
      [".codex/config.toml", () => (mkdirSync(fx.path(".codex")), writeFileSync(fx.path(".codex/config.toml"), ""))],
      [".agents/skills", () => (rmSync(fx.path(".agents/skills/b")), writeFileSync(fx.path(".agents/skills/b"), "../x"))],
    ];
    let prev = h0;
    for (const [rel, change] of steps) {
      change();
      const next = realConfigHashes(fx.home);
      assert.deepEqual(changedPaths(prev, next), [rel]);
      prev = next;
    }
  });

  test("the guard fails a test that writes real config and keeps the test's own failure as the cause", async (t) => {
    const fx = makeFixtureHome({ ".omp/agent/config.yml": "a: 1\n" });
    t.after(fx.cleanup);
    await guardRealConfig(() => {}, fx.home)();
    await assert.rejects(guardRealConfig(() => {
      throw new Error("own failure");
    }, fx.home)(), /own failure/);
    await assert.rejects(guardRealConfig(() => writeFileSync(fx.path(".omp/agent/config.yml"), "a: 2\n"), fx.home)(), /config changed: \.omp\/agent\/config\.yml/);
    const err = await guardRealConfig(() => {
      mkdirSync(fx.path(".claude/commands"), { recursive: true });
      writeFileSync(fx.path(".claude/commands/x.md"), "x");
      throw new Error("own failure");
    }, fx.home)().catch((e) => e);
    assert.match(err.message, /config changed: \.claude\/commands/);
    assert.equal(err.cause.message, "own failure");
  });
});

describe("mirror", () => {
  const units = {
    ".claude/commands/c.md": "c\n",
    ".claude/skills/s/SKILL.md": "s\n",
    ".claude/rules/r.md": "r\n",
    ".claude/settings.json": "{}\n",
    ".claude/agents/a.md": "a\n",
    ".codex/AGENTS.md": "agents\n",
    ".codex/skills/cs/SKILL.md": "cs\n",
    ".agents/skills/as/SKILL.md": "as\n",
    ".cursor/rules/x.mdc": "x\n",
    ".cursor/hooks.json": "{}\n",
    ".omp/agent/commands/o.md": "o\n",
  };

  test("copies only the units of the named harness", (t) => {
    const fx = makeFixtureHome(units);
    const repos = ["claude", "codex", "cursor"].map(() => scratchRepo());
    t.after(() => (fx.cleanup(), repos.forEach((r) => r.cleanup())));
    const [c, x, u] = repos.map((r) => r.dir);

    assert.deepEqual(mirrorProject(fx.home, "claude", c), [".claude/agents/a.md", ".claude/commands/c.md", ".claude/rules/r.md", ".claude/skills/s/SKILL.md"]);
    assert.deepEqual(mirrorProject(fx.home, "codex", x), [".agents/skills/as/SKILL.md", ".agents/skills/cs/SKILL.md", "AGENTS.md"]);
    assert.deepEqual(mirrorProject(fx.home, "cursor", u), [".cursor/rules/x.mdc"]);

    assert.equal(readFileSync(join(c, ".claude/commands/c.md"), "utf8"), "c\n");
    assert.equal(readFileSync(join(c, ".claude/agents/a.md"), "utf8"), "a\n");
    assert.equal(readFileSync(join(c, ".claude/rules/r.md"), "utf8"), "r\n");
    assert.equal(readFileSync(join(x, "AGENTS.md"), "utf8"), "agents\n");
    for (const absent of [".claude/settings.json", "AGENTS.md", ".agents", ".cursor"]) assert.equal(existsSync(join(c, absent)), false, absent);
    for (const absent of [".claude", ".cursor", ".codex"]) assert.equal(existsSync(join(x, absent)), false, absent);
    for (const absent of [".claude", "AGENTS.md", ".cursor/hooks.json"]) assert.equal(existsSync(join(u, absent)), false, absent);
    assert.throws(() => mirrorProject(fx.home, "omp", c), /no project mirror for omp/);

    mkdirSync(fx.path(".agents/skills/cs"));
    writeFileSync(fx.path(".agents/skills/cs/SKILL.md"), "clash\n");
    assert.throws(() => mirrorProject(fx.home, "codex", x), /two sources write \.agents\/skills\/cs\/SKILL\.md/);
  });

  test("a second mirror shows only what HOME holds now and keeps other project files", (t) => {
    const fx = makeFixtureHome(units);
    const repo = scratchRepo();
    t.after(() => (fx.cleanup(), repo.cleanup()));
    mirrorProject(fx.home, "claude", repo.dir);
    writeFileSync(join(repo.dir, ".claude/settings.local.json"), "{}\n");
    rmSync(fx.path(".claude/commands/c.md"));
    assert.deepEqual(mirrorProject(fx.home, "claude", repo.dir), [".claude/agents/a.md", ".claude/rules/r.md", ".claude/skills/s/SKILL.md"]);
    assert.equal(existsSync(join(repo.dir, ".claude/commands/c.md")), false);
    assert.equal(existsSync(join(repo.dir, ".claude/settings.local.json")), true);
  });

  test("refuses a source or destination inside the real home before any write", (t) => {
    const fake = makeFixtureHome({ "work/.keep": "" });
    const fx = makeFixtureHome(units);
    const repo = scratchRepo();
    t.after(() => (fake.cleanup(), fx.cleanup(), repo.cleanup()));
    const opts = { realHome: fake.home };
    assert.throws(() => mirrorProject(fx.home, "claude", fake.path(".claude/proj"), opts), /dot-dir/);
    assert.throws(() => mirrorProject(fx.home, "claude", fake.path("work"), opts), /inside the real home/);
    assert.throws(() => mirrorProject(fx.home, "claude", fake.home, opts), /real home/);
    assert.throws(() => mirrorProject(fake.home, "claude", repo.dir, opts), /real home/);
    assert.deepEqual([...fake.snapshot().keys()], ["work/.keep"]);
    assert.equal(existsSync(join(repo.dir, ".claude")), false);

    assert.throws(() => assertOutsideRealHome(join(realHome(), ".claude", "rig-seed-never-made")), /dot-dir/);
    assert.throws(() => assertOutsideRealHome(join(realHome(), "rig-seed-never-made", "x")), /inside the real home/);
    assert.throws(() => assertOutsideRealHome("relative/path"), /absolute/);
  });

  test("refuses a project dir whose unit path is a symlink out of the project", (t) => {
    const outside = makeFixtureHome({ "commands/keep.md": "keep\n" });
    const fx = makeFixtureHome(units);
    const repo = scratchRepo();
    t.after(() => (outside.cleanup(), fx.cleanup(), repo.cleanup()));
    symlinkSync(outside.home, join(repo.dir, ".claude"));
    assert.throws(() => mirrorProject(fx.home, "claude", repo.dir), /resolves outside the project/);
    assert.deepEqual([...outside.snapshot().keys()], ["commands/keep.md"]);
  });

  test("scratchRepo makes a git repo outside the real home", (t) => {
    const repo = scratchRepo();
    t.after(repo.cleanup);
    assert.equal(existsSync(join(repo.dir, ".git")), true);
    assert.doesNotThrow(() => assertOutsideRealHome(repo.dir));
    repo.cleanup();
    assert.equal(existsSync(repo.dir), false);
  });

  test("harnessArgv builds the headless argv of each harness", (t) => {
    const fx = makeFixtureHome();
    t.after(fx.cleanup);
    const env = { PATH: "/bin", HOME: "/real", CLAUDE_CONFIG_DIR: "/x", CLAUDE_CODE_PLUGIN_DIRS: "/p", OMP_PROFILE: "p", CODEX_HOME: "/c", RIG_LIVE_OMP_MODEL: "prov/m" };
    const dir = "/tmp/rig-seed-x";

    const c = harnessArgv("claude", "/rigseed", { dir, env, maxTurns: 2 });
    assert.deepEqual([c.bin, c.args, c.cwd, c.input], ["claude", ["--setting-sources", "project,local", "-p", "--max-turns", "2", "--output-format", "json", "/rigseed"], dir, ""]);
    assert.deepEqual(c.env, { PATH: "/bin", HOME: "/real", RIG_LIVE_OMP_MODEL: "prov/m" });

    const o = harnessArgv("omp", "hi", { dir, env, home: fx.home });
    assert.deepEqual([o.bin, o.args], ["omp", ["--model", "prov/m", "-p", "--mode", "json", "--no-session", "hi"]]);
    assert.equal(o.env.HOME, fx.home);
    assert.equal(o.env.PI_CODING_AGENT_DIR, join(fx.home, ".omp", "agent"));
    assert.equal("OMP_PROFILE" in o.env, false);
    assert.equal(o.input, "");
    assert.deepEqual(harnessArgv("omp", "hi", { dir, env: { PATH: "/bin" }, home: fx.home }).args, ["-p", "--mode", "json", "--no-session", "hi"]);
    assert.deepEqual(harnessArgv("omp", "hi", { dir, env, home: fx.home, model: "other/m" }).args.slice(0, 2), ["--model", "other/m"]);
    assert.throws(() => harnessArgv("omp", "hi", { dir, env }), /fixture home/);
    assert.throws(() => harnessArgv("omp", "hi", { dir, env, home: realHome() }), /real home/);

    const x = harnessArgv("codex", "q", { dir, env });
    t.after(() => {
      x.cleanup();
      assert.equal(existsSync(x.env.HOME!), false, "cleanup removes the codex temp HOME");
    });
    assert.deepEqual([x.bin, x.args], ["codex", ["exec", "-s", "read-only", "--ephemeral", "--ignore-user-config", "--json", "-C", dir, "q"]]);
    assert.equal(x.env.CODEX_HOME, join(realHome(), ".codex"));
    assert.notEqual(x.env.HOME, "/real");
    assert.deepEqual(readdirSync(x.env.HOME!), []);

    const u = harnessArgv("cursor", "q", { dir, env, pluginDir: "/tmp/p" });
    assert.deepEqual([u.bin, u.args], ["cursor-agent", ["-p", "--mode", "ask", "--trust", "--workspace", dir, "--output-format", "json", "--plugin-dir", "/tmp/p", "q"]]);
    assert.throws(() => harnessArgv("vim", "q", { dir, env }), /unknown harness/);
  });

  test("realBin refuses a recording stub, so a live case cannot pass without the real CLI", (t) => {
    const stubs = makeStubs(["claude"]);
    t.after(stubs.cleanup);
    assert.throws(() => realBin("claude", stubs.PATH), /test stub/);
    assert.throws(() => realBin("rig-no-such-cli", stubs.PATH), /not on PATH/);
    assert.equal(realBin("node", stubs.PATH).length > 0, true);
  });

  test("replyOf reads only the final reply, never an echoed prompt", () => {
    const tok = sentinel();
    const line = (o) => JSON.stringify(o);
    const user = { type: "message_end", message: { role: "user", content: [{ type: "text", text: `Say ${tok}` }] } };
    const failed = { type: "message_end", message: { role: "assistant", content: [], stopReason: "error" } };
    const ok = { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: tok }], stopReason: "stop" } };
    assert.equal(replyOf("omp", { code: 1, stdout: [user, failed].map(line).join("\n"), json: null }), null);
    assert.equal(replyOf("omp", { code: 0, stdout: [user, failed].map(line).join("\n"), json: null }), null);
    assert.equal(replyOf("omp", { code: 0, stdout: [user, ok].map(line).join("\n"), json: null }), tok);

    assert.equal(replyOf("claude", { code: 0, stdout: "", json: { type: "result", is_error: false, result: tok } }), tok);
    assert.equal(replyOf("cursor", { code: 0, stdout: "", json: { type: "result", is_error: true, result: tok } }), null);
    assert.equal(replyOf("claude", { code: 0, stdout: "x", json: null }), null);

    const msg = { type: "item.completed", item: { type: "agent_message", text: tok } };
    assert.equal(replyOf("codex", { code: 0, stdout: line(msg), json: null }), tok);
    assert.equal(replyOf("codex", { code: 0, stdout: [msg, { type: "turn.failed" }].map(line).join("\n"), json: null }), null);
  });

  test("sentinels are random and shaped", () => {
    const a = sentinel();
    assert.match(a, /^RIGSEED-[0-9A-F]{12}$/);
    assert.notEqual(a, sentinel());
    assert.match(sentinel("X"), /^X-/);
  });
});
