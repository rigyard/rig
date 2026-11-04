import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, readlinkSync, writeFileSync } from "node:fs";
import { describe, test } from "node:test";
import { assertOutsideHomeDotDirs, makeFixtureHome } from "./helpers/fixture-home.mjs";
import { liveTest, runHarness } from "./helpers/live.mjs";
import { makeStubs } from "./helpers/stubs.mjs";

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
});
