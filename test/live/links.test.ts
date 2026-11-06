// Live seed cases for the links check and the Codex sidecar hide. Opt-in: RIG_LIVE=1.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe } from "node:test";
import { treeHash } from "../../lib/tree.ts";
import { makeFixtureHome } from "../helpers/fixture-home.ts";
import { liveTest } from "../helpers/live.ts";
import { mirrorProject, runSeed, scratchRepo, sentinel } from "../helpers/mirror.ts";
import { canon, filesUnder, ROOT, setup } from "../scope.helpers.ts";

const NOW = "2026-11-05T12:00:00.000Z";
const LIST_PROMPT = "List the name of every skill available to you, one per line, and nothing else. Do not run commands or read files.";

describe("links", () => {
  liveTest("codex hides sidecar skills", async (t) => {
    const fx = makeFixtureHome({});
    const repo = scratchRepo();
    t.after(() => (fx.cleanup(), repo.cleanup()));
    const a = spawnSync(process.execPath, [join(ROOT, "bin/rig.ts"), "apply"], { env: { PATH: process.env.PATH, HOME: fx.home, RIG_NOW: NOW }, cwd: fx.home, encoding: "utf8", input: "" });
    assert.equal(a.status, 0, a.stdout + a.stderr);
    assert.match(fx.read(".agents/skills/office-hours/agents/openai.yaml"), /^ {2}allow_implicit_invocation: false$/m);
    mirrorProject(fx.home, "codex", repo.dir);
    const control = join(repo.dir, ".agents/skills/rig-links-control");
    mkdirSync(control, { recursive: true });
    writeFileSync(join(control, "SKILL.md"), "---\nname: rig-links-control\ndescription: A visible control skill for the listing case.\n---\nDo nothing.\n");
    const r = await runSeed("codex", LIST_PROMPT, { dir: repo.dir });
    assert.ok(r.reply, `exit ${r.code}: no reply`);
    assert.match(r.reply, /rig-links-control/, "a visible skill without the sidecar is listed");
    assert.doesNotMatch(r.reply, /office-hours/, "the sidecar-hidden skill is not listed");
  });

  liveTest("claude follows a seeded link", async (t) => {
    const tok = sentinel("RIGLINK");
    const skill = "---\nname: notes\ndescription: Read the notes reference.\n---\nOpen [the reference](references/ref.md) and reply with the sentinel it states, and nothing else.\n";
    const s = setup({ skill, home: { "rig/packs/notes/skills/notes/references/ref.md": `The sentinel is ${tok}.\n` } });
    const repo = scratchRepo();
    t.after(() => (s.fx.cleanup(), repo.cleanup()));
    const lockFile = join(s.root, "rig.lock.json");
    const lock = JSON.parse(readFileSync(lockFile, "utf8"));
    lock.packs.notes.tree = treeHash(filesUnder(join(s.root, "packs/notes")).filter((f) => f.path !== "pack.json"));
    writeFileSync(lockFile, canon(lock));
    const a = s.rig(["apply"]);
    assert.equal(a.code, 0, a.all);
    assert.ok(mirrorProject(s.fx.home, "claude", repo.dir).includes(".claude/skills/notes/references/ref.md"));
    const r = await runSeed("claude", "/notes", { dir: repo.dir, maxTurns: 4 });
    assert.ok(r.reply?.includes(tok), `exit ${r.code}: no sentinel in the reply`);
  });
});
