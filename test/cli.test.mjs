import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { after, describe, test } from "node:test";
import { makeFixtureHome } from "./helpers/fixture-home.mjs";

const BIN = fileURLToPath(new URL("../bin/rig.mjs", import.meta.url));
const fixture = makeFixtureHome();
after(() => fixture.cleanup());

/** @param {string[]} args */
function rig(...args) {
  const env = { PATH: process.env.PATH, HOME: fixture.home };
  const r = spawnSync(process.execPath, [BIN, ...args], { env, cwd: fixture.home, encoding: "utf8" });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** The seven top-level commands. Literal on purpose: the test must not derive it from the table it checks. */
const COMMANDS = ["plan", "apply", "doctor", "stats", "models", "pack", "pin"];

/** One valid invocation per table row, the shortest that passes the parser. */
const VALID = {
  plan: ["plan"],
  apply: ["apply"],
  "apply --undo": ["apply", "--undo", "r1"],
  doctor: ["doctor"],
  "doctor --project": ["doctor", "--project", "/tmp/p"],
  stats: ["stats"],
  "stats all flags": ["stats", "--since", "7d", "--harness", "omp", "--suggest"],
  "stats --record": ["stats", "--record", "--session", "s1"],
  models: ["models"],
  "models set": ["models", "set", "strong", "m", "--harness", "omp"],
  "pack add": ["pack", "add", "file:///r", "--sha", "abc", "--path", "a", "--path", "b"],
  "pack add --into": ["pack", "add", "file:///r", "--sha", "abc", "--path", "a", "--into", "overlay"],
  "pin check": ["pin", "check", "core"],
  "pin check --sha": ["pin", "check", "x", "--sha", "abc"],
  "pin set": ["pin", "set", "x"],
};

describe("help", () => {
  for (const argv of [["--help"], ["help"]]) {
    test(`rig ${argv.join(" ")} lists exactly the 7 commands`, () => {
      const r = rig(...argv);
      assert.equal(r.code, 0, r.stderr);
      const listed = new Set([...r.stdout.matchAll(/^ {2}rig (\S+)/gm)].map((m) => m[1]));
      assert.deepEqual([...listed].sort(), [...COMMANDS].sort());
    });
  }

  for (const cmd of COMMANDS) {
    test(`rig ${cmd} --help exits 0 and shows only ${cmd}`, () => {
      const r = rig(cmd, "--help");
      assert.equal(r.code, 0, r.stderr);
      const listed = new Set([...r.stdout.matchAll(/^ {2}rig (\S+)/gm)].map((m) => m[1]));
      assert.deepEqual([...listed], [cmd]);
    });
  }

  test("rig with no command exits 2", () => {
    const r = rig();
    assert.equal(r.code, 2);
    assert.match(r.stderr, /E_USAGE/);
  });
});

describe("usage errors exit 2 with one line", () => {
  /** @param {string[]} argv */
  function usage(argv) {
    const r = rig(...argv);
    assert.equal(r.code, 2, `rig ${argv.join(" ")}: exit ${r.code}, stderr ${r.stderr}`);
    assert.match(r.stderr, /^rig: E_USAGE .+\n$/, `one E_USAGE line expected, got: ${JSON.stringify(r.stderr)}`);
    assert.equal(r.stdout, "");
  }

  test("unknown command", () => usage(["frobnicate"]));
  test("rig report is not a command (renamed to stats)", () => usage(["report"]));
  test("rig help with an unknown command", () => usage(["help", "frobnicate"]));

  for (const [label, argv] of Object.entries(VALID)) {
    test(`unknown flag on: ${label}`, () => usage([...argv, "--bogus"]));
  }

  for (const skip of ["--skip-gate", "--force", "--no-gate", "--skip", "--yes", "--unsafe"]) {
    for (const cmd of ["plan", "apply"]) {
      test(`skip-like flag ${skip} on ${cmd}`, () => usage([cmd, skip]));
    }
  }

  test("short flag", () => usage(["plan", "-f"]));
  test("models set without --harness", () => usage(["models", "set", "strong", "x"]));
  test("models set with one positional", () => usage(["models", "set", "strong", "--harness", "omp"]));
  test("models with a stray positional", () => usage(["models", "strong"]));
  test("pack without subcommand", () => usage(["pack"]));
  test("pack with an unknown subcommand", () => usage(["pack", "remove", "x"]));
  test("pack add without --sha", () => usage(["pack", "add", "file:///r", "--path", "a"]));
  test("pack add without --path", () => usage(["pack", "add", "file:///r", "--sha", "abc"]));
  test("pack add --into with a value other than overlay", () => usage(["pack", "add", "file:///r", "--sha", "abc", "--path", "a", "--into", "repo"]));
  test("pin without subcommand", () => usage(["pin"]));
  test("pin set does not take --sha", () => usage(["pin", "set", "x", "--sha", "abc"]));
  test("pin check without a name", () => usage(["pin", "check"]));
  test("missing flag value", () => usage(["apply", "--undo"]));
  test("flag value that looks like a flag", () => usage(["pack", "add", "file:///r", "--sha", "--path", "a"]));
  test("boolean flag with a value", () => usage(["stats", "--suggest=yes"]));
  test("non-repeatable flag twice", () => usage(["doctor", "--project", "a", "--project", "b"]));
  test("extra positional", () => usage(["plan", "extra"]));
});

// Every handler is wired. Their CLI tests run over a temp config root in test/cli-wiring.test.mjs and
// test/plan-apply.test.mjs: run here, against this repo's own root, models set would write its models/tiers.json.
