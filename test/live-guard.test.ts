import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { makeFixtureHome } from "./helpers/fixture-home.ts";
import { guardRealConfig, HARNESS_OWNED, isHarnessOwned, PLUGIN_REGISTRY, REAL_CONFIG_PATHS, realConfigHashes, runHarness } from "./helpers/live.ts";
import { harnessArgv, ompEnv } from "./helpers/mirror.ts";
import { json, ROOT } from "./helpers/seed.ts";

const ORG = "8d8c7cbc-0e34-4fee-ab6e-1b7156611784";
const ACCOUNT = "2c43f156-7591-48dd-bc88-c8890ccaf1cc";
const BUCKET = `${ORG}_${ACCOUNT}`;

const tail = (p: string) => p.replace(/^~\//, "");
const files = (dir: string): string[] => readdirSync(join(ROOT, dir)).filter((f) => f.endsWith(".json")).map((f) => join(dir, f));

/** Home-relative files that rig could write, derived from the targets and the pack model surfaces. */
function placeable(): string[] {
  const out = new Set<string>();
  const probes = (dir: string, leaf: (name: string) => string) => ["rig-probe", "synced"].forEach((n) => out.add(`${tail(dir)}/${leaf(n)}`));
  const surface = (s: { path: string }) => out.add(tail(s.path).replace("{role}", "rig-probe"));
  for (const f of files("targets")) {
    const t = json(join(ROOT, f));
    for (const r of t.reads.skills) if (r.writable) probes(r.path, (n) => `${n}/SKILL.md`);
    for (const u of Object.values<any>(t.units)) if (u?.dir) probes(u.dir, (n) => (u.format === "skill-hidden" ? `${n}/SKILL.md` : `${n}.md`));
    if (t.instructions) out.add(tail(t.instructions.path));
    if (t.plugin_manifest) out.add(tail(t.plugin_manifest.path));
    if (t.skill_registry) out.add(tail(t.skill_registry.path));
    for (const h of Object.values<any>(t.hooks ?? {})) if (h?.file) out.add(tail(h.file));
    for (const s of t.model_surfaces ?? []) surface(s);
  }
  for (const f of readdirSync(join(ROOT, "packs")).map((d) => join("packs", d, "pack.json")).filter((p) => existsSync(join(ROOT, p)))) {
    for (const s of json(join(ROOT, f)).model_surfaces ?? []) surface(s);
  }
  return [...out].sort();
}

const write = (home: string, rel: string, text = "x\n") => {
  mkdirSync(dirname(join(home, rel)), { recursive: true });
  writeFileSync(join(home, rel), text);
};

const covered = (rel: string) => REAL_CONFIG_PATHS.some((p) => rel === p || rel.startsWith(`${p}/`));

describe("live guard: harness-owned writes", () => {
  test("Claude Code's own skill sync does not fail the guard", async (t) => {
    const fx = makeFixtureHome({ ".claude/skills/a/SKILL.md": "# a\n" });
    t.after(fx.cleanup);
    await guardRealConfig(() => {
      write(fx.home, `.claude/skills/synced/${BUCKET}/manifest.json`, "{}\n");
      write(fx.home, `.claude/skills/synced/${BUCKET}/morning/SKILL.md`);
      write(fx.home, `.claude/skills/synced/${BUCKET}/.last-complete-round`);
      write(fx.home, `.claude/skills/synced/${BUCKET}/.staging/tmp`);
      write(fx.home, `.claude/skills/synced/.bucket-${BUCKET}`, "");
    }, fx.home)(t);
  });

  test("a rewrite of installed_plugins.json is recorded as a diagnostic and does not fail the guard", async (t) => {
    const fx = makeFixtureHome({ [PLUGIN_REGISTRY]: "{}\n" });
    t.after(fx.cleanup);
    const notes: string[] = [];
    await guardRealConfig(() => write(fx.home, PLUGIN_REGISTRY, '{"version":2}\n'), fx.home)({ diagnostic: (m: string) => notes.push(m) } as never);
    assert.equal(notes.length, 1);
    assert.match(notes[0], /installed_plugins\.json changed/);
  });

  test("an unchanged installed_plugins.json records nothing, and a real config change still fails next to a rewrite", async (t) => {
    const fx = makeFixtureHome({ [PLUGIN_REGISTRY]: "{}\n" });
    t.after(fx.cleanup);
    const notes: string[] = [];
    const stub = { diagnostic: (m: string) => notes.push(m) } as never;
    await guardRealConfig(() => {}, fx.home)(stub);
    assert.deepEqual(notes, []);
    await assert.rejects(guardRealConfig(() => {
      write(fx.home, PLUGIN_REGISTRY, "{\"v\":3}\n");
      write(fx.home, ".claude/settings.json");
    }, fx.home)(stub), /changed: \.claude\/settings\.json$/);
  });

  test("the first sync, which creates skills/synced, does not fail the guard", async (t) => {
    const fx = makeFixtureHome({ ".claude/skills/a/SKILL.md": "# a\n" });
    t.after(fx.cleanup);
    const before = realConfigHashes(fx.home);
    mkdirSync(join(fx.home, ".claude/skills/synced"), { recursive: true });
    assert.deepEqual(realConfigHashes(fx.home), before);
  });

  test("a harness-owned entry is not read while the harness rewrites it", () => {
    const fx = makeFixtureHome({});
    try {
      write(fx.home, `.claude/skills/synced/${BUCKET}/manifest.json`);
      const before = realConfigHashes(fx.home);
      write(fx.home, `.claude/skills/synced/${BUCKET}/manifest.json`, "y\n");
      write(fx.home, `.claude/skills/synced/${BUCKET}/new/SKILL.md`);
      assert.deepEqual(realConfigHashes(fx.home), before);
    } finally {
      fx.cleanup();
    }
  });

  test("every owned entry names a reason and a path shape", () => {
    assert.ok(HARNESS_OWNED.length >= 2);
    for (const e of HARNESS_OWNED) {
      assert.ok(e.path instanceof RegExp);
      assert.ok(e.reason.length > 40, String(e.path));
    }
  });
});

describe("live guard: everything rig could write stays guarded", () => {
  const paths = placeable();

  test("the derived list holds the paths of all five targets and the pstack model surfaces", () => {
    for (const p of [".claude/skills/rig-probe/SKILL.md", ".claude/agents/rig-probe.md", ".claude/rules/rig-frame.md", ".claude/rules/pstack-models.md",
      ".codex/agents/rig-probe.toml", ".codex/AGENTS.md", ".codex/config.toml", ".agents/skills/rig-probe/SKILL.md", ".cursor/rules/rig-frame.mdc",
      ".cursor/agents/rig-probe.md", ".cursor/plugins/local/rig/.cursor-plugin/plugin.json", ".omp/agent/AGENTS.md", ".omp/agent/config.yml",
      ".claude/settings.json", ".gemini/config/skills.json", ".gemini/config/rules/rig-frame.md", ".gemini/config/agents/rig-probe.md"]) assert.ok(paths.includes(p), p);
  });

  test("the guard watches every derived path", () => {
    assert.deepEqual(paths.filter((p) => !covered(p)), []);
  });

  test("no derived path and no seeded file is harness-owned", () => {
    const seeded = readFileSync(join(ROOT, "test/golden/first-seed.manifest"), "utf8").split("\n").filter(Boolean).map((l) => l.split("\t")[0]);
    assert.ok(seeded.length > 100);
    assert.deepEqual([...paths, ...seeded].filter(isHarnessOwned), []);
  });

  test("a rig skill named synced is guarded, and so is any other file next to the harness's buckets", async (t) => {
    const fx = makeFixtureHome({});
    t.after(fx.cleanup);
    for (const rel of [".claude/skills/synced/SKILL.md", ".claude/skills/synced/notes/SKILL.md", `.claude/skills/synced/${ORG}/x.md`, ".claude/skills/synced/.bucket-x"]) {
      await assert.rejects(guardRealConfig(() => write(fx.home, rel), fx.home)(t), new RegExp(`changed: \\.claude/skills`), rel);
    }
  });

  test("each derived path fails the guard when written", async (t) => {
    for (const rel of paths) {
      const fx = makeFixtureHome({});
      t.after(fx.cleanup);
      await assert.rejects(guardRealConfig(() => write(fx.home, rel), fx.home)(t), /the real harness config changed/, rel);
    }
  });

  test("installed_plugins.json is not a watched path, so no hashed path can fail on it", () => {
    assert.equal(covered(PLUGIN_REGISTRY), false);
    assert.equal(HARNESS_OWNED.some((e) => e.path.test(PLUGIN_REGISTRY)), false);
  });
});

describe("live guard: ORCA_* env", () => {
  const base = { PATH: "/usr/bin", ORCA_TAB_ID: "t", ORCA_AGENT_HOOK_TOKEN: "k", ORCA_CLAUDE_CONFIG_DIR: "/c", CLAUDE_CONFIG_DIR: "/c", KEEP: "1" };

  test("a spawned harness inherits no ORCA_* key and no relocating key, and keeps the rest", () => {
    const fx = makeFixtureHome({});
    for (const h of ["claude", "codex", "cursor", "omp"] as const) {
      const a = harnessArgv(h, "p", { dir: fx.home, home: fx.home, env: base });
      try {
        assert.deepEqual(Object.keys(a.env).filter((k) => /^ORCA_|^CLAUDE_CONFIG_DIR$/.test(k)), [], h);
        assert.equal(a.env.KEEP, "1", h);
        assert.equal(a.env.PATH, "/usr/bin", h);
      } finally {
        a.cleanup();
      }
    }
    fx.cleanup();
  });

  test("ompEnv drops them too", () => {
    const home = makeFixtureHome({});
    try {
      assert.deepEqual(Object.keys(ompEnv(home.home, undefined, base)).filter((k) => k.startsWith("ORCA_")), []);
    } finally {
      home.cleanup();
    }
  });

  const keysOf = async (env?: NodeJS.ProcessEnv) => {
    const run = runHarness as unknown as (o: { bin: string; args: string[]; env?: NodeJS.ProcessEnv }) => Promise<{ stdout: string }>;
    const r = await run({ bin: process.execPath, args: ["-e", "console.log(JSON.stringify(Object.keys(process.env)))"], env });
    return JSON.parse(r.stdout) as string[];
  };

  test("runHarness with no env passes no ORCA_* key and no relocating key to the child", async () => {
    const set = { ORCA_RUNHARNESS_PROBE: "1", CODEX_HOME: "/c", RUNHARNESS_KEEP: "1" };
    Object.assign(process.env, set);
    try {
      const keys = await keysOf();
      assert.deepEqual(keys.filter((k) => /^ORCA_|^CODEX_HOME$/.test(k)), []);
      assert.ok(keys.includes("RUNHARNESS_KEEP"));
    } finally {
      for (const k of Object.keys(set)) delete process.env[k];
    }
  });

  test("runHarness uses a passed env as is, so a caller can set CODEX_HOME on purpose", async () => {
    const keys = await keysOf({ CODEX_HOME: "/c", ORCA_X: "1" });
    assert.ok(keys.includes("CODEX_HOME") && keys.includes("ORCA_X"));
    assert.ok(!keys.includes("PATH"));
  });
});
