// Live seed cases for the kit itself: each harness sees a unit that only the fixture holds. Opt-in: RIG_LIVE=1.

import assert from "node:assert/strict";
import { describe } from "node:test";
import { makeFixtureHome } from "../helpers/fixture-home.mjs";
import { liveTest } from "../helpers/live.mjs";
import { mirrorProject, runSeed, scratchRepo, sentinel } from "../helpers/mirror.mjs";

/** A fixture HOME and a scratch repo, both removed after the test. */
function world(t, spec) {
  const fx = makeFixtureHome(spec);
  const repo = scratchRepo();
  t.after(() => (fx.cleanup(), repo.cleanup()));
  return { fx, dir: repo.dir };
}

describe("seedkit", () => {
  liveTest("claude sees a mirrored command", async (t) => {
    const tok = sentinel();
    const { fx, dir } = world(t, { ".claude/commands/rigseed-cmd.md": `---\ndescription: rig seed command\n---\nReply with the word ${tok} and nothing else.\n` });
    assert.deepEqual(mirrorProject(fx.home, "claude", dir), [".claude/commands/rigseed-cmd.md"]);
    const r = await runSeed("claude", "/rigseed-cmd", { dir });
    assert.ok(r.reply?.includes(tok), `exit ${r.code}: no sentinel in the reply`);
  });

  liveTest("omp sees a fixture agent dir", async (t) => {
    const tok = sentinel();
    const { fx, dir } = world(t, { ".omp/agent/commands/rigseed-cmd.md": `Say ${tok} and nothing else.\n` });
    const r = await runSeed("omp", "/rigseed-cmd", { dir, home: fx.home });
    assert.ok(r.reply?.includes(tok), `exit ${r.code}: no sentinel in the reply`);
  });

  liveTest("codex reads a mirrored AGENTS.md", async (t) => {
    const line = `RIGSEED-LINE: ${sentinel()}`;
    const { fx, dir } = world(t, { ".codex/AGENTS.md": `# Seed\n\n${line}\n` });
    assert.deepEqual(mirrorProject(fx.home, "codex", dir), ["AGENTS.md"]);
    const prompt = "Quote, verbatim and with nothing else, the line in your project instructions that starts with RIGSEED-LINE. Do not run commands or read files.";
    const r = await runSeed("codex", prompt, { dir });
    assert.equal(r.reply?.trim().replace(/^`+|`+$/g, ""), line, `exit ${r.code}`);
  });

  liveTest("cursor reads a mirrored project rule", async (t) => {
    const tok = sentinel();
    const { fx, dir } = world(t, { ".cursor/rules/rigseed.mdc": `---\ndescription: rig seed rule\nalwaysApply: true\n---\nThe rigseed token is ${tok}.\n` });
    assert.deepEqual(mirrorProject(fx.home, "cursor", dir), [".cursor/rules/rigseed.mdc"]);
    const r = await runSeed("cursor", "What is the rigseed token stated in your project rules? Reply with the token only. Do not read files.", { dir });
    assert.ok(r.reply?.includes(tok), `exit ${r.code}: no sentinel in the reply`);
  });
});
