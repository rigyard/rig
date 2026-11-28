// The guarantees of evals/fixtures/ (see evals/fixtures/README.md): the published fixtures and graders are the ones that
// produced the recorded fx3 and fx4b cells, and scripts/eval-fixture.ts prepares and grades a trial. Offline, no model.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, test } from "node:test";
import { EXPECTED_TESTS, parseTap } from "../scripts/eval-fixture.ts";
import { type Cell, parseHistory } from "../scripts/evals-history.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT = join(ROOT, "scripts", "eval-fixture.ts");
const RULE = readFileSync(join(ROOT, "evals", "fixtures", "rule.txt"), "utf8");
const FIXTURES = ["fx3", "fx4b"];
const tmp = mkdtempSync(join(tmpdir(), "eval-fixture-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

const run = (...args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
const excluded = (dir: string) => readFileSync(join(dir, ".git", "info", "exclude"), "utf8").split("\n");
let seq = 0;
const freshDir = () => join(tmp, `trial-${++seq}`);

describe("published fixtures", () => {
  for (const fx of FIXTURES) {
    test(`${fx}: fixture and grader hashes equal the recorded cells`, () => {
      const cells = parseHistory(readFileSync(join(ROOT, "evals", "history.jsonl"), "utf8"))
        .filter((l): l is Cell => l.kind === "cell" && l.fixture === fx);
      assert.ok(cells.length > 0, `no recorded cell for ${fx}`);
      const pairs = [...new Set(cells.map((c) => `${c.fixture_sha256} ${c.grader_sha256}`))];
      assert.equal(pairs.length, 1, `${fx} cells carry more than one hash pair`);
      const r = run("hash", fx);
      assert.equal(r.status, 0, r.stderr);
      const h = JSON.parse(r.stdout) as { fixture_sha256: string; grader_sha256: string };
      assert.equal(`${h.fixture_sha256} ${h.grader_sha256}`, pairs[0]);
    });
  }

  test("rule.txt is the recorded rule text", () => {
    assert.equal(createHash("sha256").update(RULE).digest("hex"), "4e8c5d3f01c69c929959d1d9e19c5e77ce0c8fac49459fa38930994f51db42ff");
    assert.equal(Buffer.byteLength(RULE), 187);
  });

  test("prompt prints one line", () => {
    for (const fx of FIXTURES) {
      const r = run("prompt", fx);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /^[^\n]+\n$/);
    }
  });
});

describe("prepare", () => {
  test("arm none writes no instruction file", () => {
    const dir = freshDir();
    const r = run("prepare", "fx3", "none", dir);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "README.md"), []);
    assert.ok(excluded(dir).includes("AGENTS.md"));
  });

  test("arm rule writes exactly rule.txt under the chosen name and excludes it from git", () => {
    for (const name of ["AGENTS.md", "CLAUDE.md", "RULES.md"]) {
      const dir = freshDir();
      const r = run("prepare", "fx4b", "rule", dir, ...(name === "AGENTS.md" ? [] : ["--instruction-file", name]));
      assert.equal(r.status, 0, r.stderr);
      assert.equal(readFileSync(join(dir, name), "utf8"), RULE);
      assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "README.md"), [name]);
      assert.ok(excluded(dir).includes(name));
      const status = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: dir, encoding: "utf8" });
      assert.equal(status.status, 0, status.stderr);
      assert.ok(!status.stdout.includes(name), `git status shows ${name}`);
    }
  });

  test("refuses a directory inside the checkout through a symlinked parent, and writes nothing", () => {
    const link = join(tmp, "link-to-evals");
    symlinkSync(join(ROOT, "evals"), link);
    const r = run("prepare", "fx3", "none", join(link, "trial-via-link"));
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /inside the rig checkout/);
    assert.ok(!existsSync(join(ROOT, "evals", "trial-via-link")));
  });

  for (const name of ["", ".git", "a/AGENTS.md", "a\\AGENTS.md", "..", "README.md", "readme.md", "package.json", "src"]) {
    test(`refuses --instruction-file ${JSON.stringify(name)} before any write`, () => {
      const dir = freshDir();
      const r = run("prepare", "fx3", "rule", dir, "--instruction-file", name);
      assert.equal(r.status, 2, r.stderr);
      assert.match(r.stderr, /instruction-file/);
      assert.ok(!existsSync(dir), `${dir} was created`);
    });
  }

  test("the none and rule work dirs differ only by the instruction file", () => {
    const snapshot = (dir: string) => {
      const files = Object.fromEntries(readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => relative(dir, join(e.parentPath, e.name)))
        .filter((f) => f.split("/")[0] !== ".git")
        .sort()
        .map((f) => [f, readFileSync(join(dir, f), "utf8")]));
      const index = spawnSync("git", ["ls-files", "-s"], { cwd: dir, encoding: "utf8" });
      assert.equal(index.status, 0, index.stderr);
      return { files, index: index.stdout, exclude: readFileSync(join(dir, ".git", "info", "exclude"), "utf8") };
    };
    for (const name of ["AGENTS.md", "CLAUDE.md"]) {
      const none = freshDir();
      const rule = freshDir();
      assert.equal(run("prepare", "fx4b", "none", none, "--instruction-file", name).status, 0);
      assert.equal(run("prepare", "fx4b", "rule", rule, "--instruction-file", name).status, 0);
      const a = snapshot(none);
      const b = snapshot(rule);
      assert.equal(a.index, b.index);
      assert.equal(a.exclude, b.exclude);
      assert.ok(a.exclude.split("\n").includes(name));
      const { [name]: ruleText, ...rest } = b.files;
      assert.equal(ruleText, RULE);
      assert.deepEqual(rest, a.files);
    }
  });

  test("refuses a non-empty directory", () => {
    const dir = freshDir();
    assert.equal(run("prepare", "fx3", "none", dir).status, 0);
    const r = run("prepare", "fx3", "rule", dir);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /not an empty directory/);
    assert.ok(!existsSync(join(dir, "AGENTS.md")));
  });
});

describe("grade", () => {
  for (const fx of FIXTURES) {
    test(`${fx}: an untouched fixture fails with every grader test parsed and no grader left behind`, () => {
      const dir = freshDir();
      assert.equal(run("prepare", fx, "none", dir).status, 0);
      const r = run("grade", fx, dir);
      assert.equal(r.status, 1, r.stderr);
      const g = JSON.parse(r.stdout) as { pass: boolean; tests: { name: string; pass: boolean }[]; failed: string[] };
      assert.equal(g.pass, false);
      assert.equal(g.tests.length, EXPECTED_TESTS[fx]);
      assert.ok(g.failed.length > 0);
      if (fx === "fx4b") assert.deepEqual(g.tests.map((t) => t.pass), [false, false, false, true]);
      assert.ok(!existsSync(join(dir, "grader.check.ts")));
    });
  }

  test("pass needs exactly the expected number of tests, all ok", () => {
    const tap = (...lines: string[]) => ["TAP version 13", ...lines, `1..${lines.length}`].join("\n");
    const ok = ["ok 1 - a", "ok 2 - b", "ok 3 - c", "ok 4 - d"];
    assert.equal(parseTap(tap(...ok), 4).pass, true);
    assert.deepEqual(parseTap(tap(...ok.slice(0, 3)), 4), { pass: false, tests: ok.slice(0, 3).map((l) => ({ name: l.slice(7), pass: true })), failed: [] });
    assert.deepEqual(parseTap(tap("ok 1 - a", "not ok 2 - b", "ok 3 - c", "ok 4 - d"), 4).failed, ["b"]);
    assert.equal(parseTap(tap(...ok, "ok 5 - e"), 4).pass, false);
    assert.equal(parseTap(tap("# Subtest: a", "    ok 1 - inner", ...ok), 4).tests.length, 4);
    assert.equal(parseTap("", 4).pass, false);
  });

  test("the expected test count of each fixture is 4", () => {
    assert.deepEqual(EXPECTED_TESTS, { fx3: 4, fx4b: 4 });
  });
});

describe("usage errors exit 2", () => {
  const cases: [string, string[], RegExp][] = [
    ["unknown fixture", ["hash", "fx9"], /unknown fixture fx9/],
    ["unknown command", ["run", "fx3"], /unknown command run/],
    ["bad arm", ["prepare", "fx3", "placebo", join(tmp, "bad-arm")], /unknown arm placebo/],
    ["missing directory", ["grade", "fx3", join(tmp, "missing")], /is not a directory/],
        ["directory inside the checkout", ["prepare", "fx3", "none", join(ROOT, "evals", "trial")], /inside the rig checkout/],
  ];
  for (const [name, args, message] of cases) {
    test(name, () => {
      const r = run(...args);
      assert.equal(r.status, 2, r.stderr);
      assert.match(r.stderr, message);
    });
  }
});
