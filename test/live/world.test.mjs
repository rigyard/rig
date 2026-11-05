// Live seed cases for world (#13): loadWorld and compose against harness-written files. Opt-in: RIG_LIVE=1.
// loadWorld and compose are called directly: the CLI is not wired yet.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe } from "node:test";
import { compose } from "../../lib/stack.mjs";
import { liveTest, realHome, runHarness } from "../helpers/live.mjs";
import { harnessArgv, ompEnv, realBin, runSeed, scratchRepo, sentinel } from "../helpers/mirror.mjs";
import { baseJson, fixture, pack } from "../world.helpers.mjs";

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
        "rig.json": { schema: 1, packs: { own: {}, fix: {} } },
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

    // The omp target on trunk declares no facts files, and loadWorld parses facts as JSON, so config.yml is no
    // facts file. This pins that loadWorld reads a HOME that omp wrote without a schema error and without touching it.
    const world = fx.load();
    assert.equal(world.targets.get("omp")?.name, "omp");
    assert.deepEqual([sha(cfg), sha(`${cfg}.lock`)], before);
  });

  liveTest("world reads claude plugin facts", async (t) => {
    const real = join(realHome(), ".claude/plugins/installed_plugins.json");
    if (!existsSync(real)) return t.skip("no installed_plugins.json in the real home");
    const bytes = readFileSync(real);
    const rel = "~/.claude/plugins/installed_plugins.json";
    const claude = { ...baseJson("targets/claude.json"), facts: { installed_plugins: rel } };
    const { fx, dir } = seed(t, { repo: { "targets/claude.json": claude }, home: { ".claude/plugins/installed_plugins.json": bytes } });

    const facts = fx.load().facts.get(rel);
    assert.deepEqual(facts, JSON.parse(bytes.toString("utf8")));

    const { env } = harnessArgv("claude", "", { dir });
    const l = await runHarness({ bin: realBin("claude", env.PATH), args: ["plugin", "list", "--json"], cwd: dir, env, timeoutMs: 60_000 });
    assert.equal(l.code, 0, "claude plugin list failed");
    assert.ok(Array.isArray(l.json), "claude plugin list --json is not an array");

    // The listing carries no commit, so the installed version and install path stand in for it.
    const key = (id, e) => JSON.stringify([id, e.scope, e.version, e.installPath]);
    const listed = new Set(l.json.map((e) => key(e.id, e)));
    const ids = Object.keys(facts.plugins);
    assert.ok(ids.length > 0, "the facts list no plugin");
    const missing = ids.filter((id) => facts.plugins[id].some((e) => !listed.has(key(id, e))));
    assert.deepEqual(missing, [], "plugins whose facts entry differs from the listing");
    const listedIds = new Set(l.json.map((e) => e.id));
    assert.deepEqual(ids.filter((id) => !listedIds.has(id)), []);
  });
});
