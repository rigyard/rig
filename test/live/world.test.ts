// Live seed cases for world (#13): loadWorld and compose against harness-written files. Opt-in: RIG_LIVE=1.
// loadWorld and compose are called directly: the CLI is not wired yet.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe } from "node:test";
import { compose } from "../../lib/stack.ts";
import { liveTest, runHarness } from "../helpers/live.ts";
import { ompEnv, realBin, runSeed, scratchRepo, sentinel } from "../helpers/mirror.ts";
import { fixture, pack } from "../world.helpers.ts";

const sha = (p) => (existsSync(p) ? createHash("sha256").update(readFileSync(p)).digest("hex") : null);
const command = (tok) => `---\ndescription: rig seed command\n---\nReply with the word ${tok} and nothing else.\n`;

/** A world fixture and a scratch repo, both removed after the test. */
function seed(t, spec) {
  const fx = fixture(spec);
  const repo = scratchRepo();
  t.after(() => (fx.cleanup(), repo.cleanup()));
  return { fx, dir: repo.dir };
}

describe("world", () => {
  liveTest("compose replace reaches claude", async (t) => {
    const replaced = sentinel();
    const replacing = sentinel();
    const { fx, dir } = seed(t, {
      overlay: {
        "rig.json": { schema: 2, packs: { own: {}, fix: {} } },
        ...pack("own", { "commands/rigseed.md": command(replaced) }),
        ...pack("fix", { "commands/rigseed.md": command(replacing) }, { units: { rigseed: { replaces: "own/rigseed" } } }),
      },
    });
    const stack = compose(fx.load());
    assert.deepEqual(stack.errors, []);
    // Each composed pack command goes into the mirror as its source file, unchanged. render arrives in #14.
    const units = stack.units.filter((u) => u.type === "command" && !u.id.startsWith("core/"));
    assert.deepEqual(units.map((u) => u.id), ["fix/rigseed"]);
    mkdirSync(join(dir, ".claude/commands"), { recursive: true });
    for (const u of units) for (const [file, f] of u.files) writeFileSync(join(dir, ".claude/commands", file), f.bytes);

    const r = await runSeed("claude", "/rigseed", { dir });
    assert.ok(r.reply?.includes(replacing), `exit ${r.code}: no sentinel of the replacing unit`);
    assert.equal(r.reply.includes(replaced), false);
  });

  liveTest("world reads an omp-written config", async (t) => {
    const { fx } = seed(t);
    const agentDir = fx.path(".omp/agent");
    mkdirSync(agentDir, { recursive: true });
    const w = await runHarness({ bin: realBin("omp"), args: ["config", "set", "symbolPreset", "ascii"], cwd: fx.home, env: ompEnv(fx.home, agentDir), timeoutMs: 60_000 });
    assert.equal(w.code, 0, w.stderr);
    const cfg = join(agentDir, "config.yml");
    assert.match(readFileSync(cfg, "utf8"), /^symbolPreset: ascii$/m);
    const before = [sha(cfg), sha(`${cfg}.lock`)];

    // This pins that loadWorld reads a HOME that omp wrote without a schema error and without touching it.
    const world = fx.load();
    assert.equal(world.targets.get("omp")?.name, "omp");
    assert.deepEqual([sha(cfg), sha(`${cfg}.lock`)], before);
  });
});
