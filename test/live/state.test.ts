// Live seed cases for state (#12): apply, undo and crash recovery, each confirmed by a real harness. Opt-in: RIG_LIVE=1.
// apply and undo are called directly: the CLI is not wired yet.

import assert from "node:assert/strict";
import { join } from "node:path";
import { describe } from "node:test";
import { undo } from "../../lib/state.ts";
import { makeFixtureHome } from "../helpers/fixture-home.ts";
import { liveTest, runHarness } from "../helpers/live.ts";
import { mirrorProject, runSeed, scratchRepo, sentinel } from "../helpers/mirror.ts";
import { converge, journalLines, journals, makeWorld, snapshot } from "../state.helpers.ts";

const STATE_HELPERS = new URL("../state.helpers.ts", import.meta.url).href;

/** A fixture HOME, its state world and a scratch repo, all removed after the test. */
function seed(t) {
  const fx = makeFixtureHome();
  const repo = scratchRepo();
  t.after(() => (fx.cleanup(), repo.cleanup()));
  return { home: fx.home, world: makeWorld(fx.home), dir: repo.dir };
}

/** A hand-built Desired of owned files. @param {string} home @param {Record<string, string>} files home-relative path -> text */
function desired(home, files) {
  const entries = new Map();
  for (const [rel, text] of Object.entries(files)) {
    const p = join(home, rel);
    entries.set(p, { kind: "owned", path: p, bytes: Buffer.from(text), mode: 0o644, unit: "seed/rigseed" });
  }
  return { entries, errors: [], info: [] };
}

const command = (tok) => `---\ndescription: rig seed command\n---\nReply with the word ${tok} and nothing else.\n`;

describe("state", () => {
  liveTest("state seeds a command that claude runs", async (t) => {
    const { home, world, dir } = seed(t);
    const tok = sentinel();
    const { result } = converge(desired(home, { ".claude/commands/rigseed.md": command(tok) }), world);
    assert.equal(result.error, undefined);
    assert.equal(result.changed, 1);
    assert.deepEqual(mirrorProject(home, "claude", dir), [".claude/commands/rigseed.md"]);
    const r = await runSeed("claude", "/rigseed", { dir });
    assert.ok(r.reply?.includes(tok), `exit ${r.code}: no sentinel in the reply`);
  });

  liveTest("undo removes what claude saw", async (t) => {
    const { home, world, dir } = seed(t);
    const tok = sentinel();
    const before = snapshot(home);
    const { result } = converge(desired(home, { ".claude/commands/rigseed.md": command(tok) }), world);
    assert.equal(result.error, undefined);
    mirrorProject(home, "claude", dir);
    const first = await runSeed("claude", "/rigseed", { dir });
    assert.ok(first.reply?.includes(tok), `exit ${first.code}: no sentinel in the first reply`);

    const u = undo(result.run, world);
    assert.deepEqual(u.conflicts, []);
    assert.equal(u.restored, 1);
    assert.deepEqual(mirrorProject(home, "claude", dir), []);
    const second = await runSeed("claude", "/rigseed", { dir });
    assert.notEqual(second.reply, null, `exit ${second.code}: the second run gave no reply`);
    assert.equal(second.reply.includes(tok), false);
    assert.deepEqual(snapshot(home), before);
  });

  liveTest("crash, recover, omp sees one copy", async (t) => {
    const { home, world, dir } = seed(t);
    const name = `rigseed-${sentinel("x").slice(2).toLowerCase()}`;
    const files = {
      [`.omp/agent/skills/${name}/SKILL.md`]: `---\nname: ${name}\ndescription: rig seed skill\n---\nA rig seed skill.\n`,
      [`.omp/agent/skills/${name}/notes.md`]: "Seed notes.\n",
      ".omp/agent/commands/rigseed-note.md": "Say seed and nothing else.\n",
    };
    const want = desired(home, files);

    // The child applies the same Desired and SIGKILLs itself after one mutation.
    const wire = JSON.stringify([...want.entries.values()].map((e) => ({ ...e, bytes: e.bytes.toString("base64") })));
    const child = [
      `import { converge, makeWorld } from ${JSON.stringify(STATE_HELPERS)};`,
      "const list = JSON.parse(process.env.RIG_SEED_DESIRED);",
      'const entries = new Map(list.map((e) => [e.path, { ...e, bytes: Buffer.from(e.bytes, "base64") }]));',
      "converge({ entries, errors: [], info: [] }, makeWorld(process.env.FIXTURE_HOME));",
    ].join("\n");
    const c = await runHarness({
      bin: process.execPath,
      args: ["--input-type=module", "-e", child],
      env: { PATH: process.env.PATH, RIG_TEST: "1", RIG_TEST_ABORT_AFTER: "1", FIXTURE_HOME: home, RIG_SEED_DESIRED: wire },
      timeoutMs: 30_000,
    });
    assert.equal(c.signal, "SIGKILL", c.stderr);
    const crashed = journals(world).map((f) => f.replace(/\.jsonl$/, ""));
    assert.equal(crashed.length, 1);
    assert.notEqual(journalLines(world, crashed[0]).at(-1).type, "commit");

    const { result } = converge(want, world);
    assert.equal(result.error, undefined);
    assert.equal(journalLines(world, crashed[0]).at(-1).type, "recovered");
    assert.equal(journalLines(world, result.run).at(-1).type, "commit");

    const r = await runSeed("omp", "List the names of all your available skills whose name starts with rigseed, one per line, nothing else. Do not use tools.", { dir, home });
    assert.notEqual(r.reply, null, `exit ${r.code}: no reply`);
    assert.equal(r.reply.split(name).length - 1, 1, "omp names the seed skill exactly once");
  });
});
