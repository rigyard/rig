import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { writeState } from "../lib/fs.ts";
import { SCHEMA_1_MESSAGE as SCHEMA_1, encode, loadWorld, projectDeclaration } from "../lib/world.ts";
import { makeFixtureHome } from "./helpers/fixture-home.ts";
import { NOW, ROOT, baseJson, pack, rigJson, skill, withFixture } from "./world.helpers.ts";

/** Assert that fn throws a typed error with this code, and optionally file and key path. */
function throwsCode(fn, code, { file, path } = {}) {
  assert.throws(fn, (err) => {
    assert.equal(err.code, code, err.message);
    if (file !== undefined) assert.equal(err.file, file, err.message);
    if (path !== undefined) assert.equal(err.path, path, err.message);
    return true;
  });
}

const SHA = "0123456789abcdef0123456789abcdef01234567";
const LOCKED = { repo: "r", sha: SHA, root: ".", paths: ["p"], exclude: [], license: "MIT", tree: "sha256:01", port: null, candidate: null };
const PORT = { paths: ["SKILL.md"], tree: "sha256:02", reviewed_sha: null, reviewed_tree: null };

const loads = (spec, code, where) => withFixture(spec, (fx) => throwsCode(() => fx.load(), code, where));

describe("loadWorld on the repo's own data", () => {
  test("loads, merges nothing, and returns a frozen world", () =>
    withFixture({}, (fx) => {
      const w = fx.load();
      assert.deepEqual(w.config.harnesses, ["claude", "codex", "omp", "cursor"]);
      assert.deepEqual(w.config.aliases, {});
      assert.deepEqual([...w.packs.keys()], ["core", "cli-for-agent", "cursor-team-kit", "product", "pstack"]);
      assert.deepEqual([...w.targets.keys()], ["claude", "codex", "omp", "cursor"]);
      assert.deepEqual(Object.keys(w.terms), ["ask-user", "subagent"]);
      assert.equal(w.now.toISOString(), NOW);
      assert.deepEqual(w.locks, { repo: { schema: 2, core: null, packs: {} }, overlay: null });
      assert.deepEqual(w.acks, []);
      assert.equal(w.roots.overlay, null);
      assert.equal(w.env.state, join(fx.home, ".local/state/rig"));
      assert.equal(w.env.data, join(fx.home, ".local/share/rig"));
      assert.ok(Object.isFrozen(w) && Object.isFrozen(w.config) && Object.isFrozen(w.config.harnesses));
      assert.throws(() => w.packs.set("x", {}), TypeError);
      assert.throws(() => w.targets.delete("claude"), TypeError);
      assert.throws(() => { w.config.aliases = {}; }, TypeError);
    }));

  test("the core pack holds the members the doc names", () =>
    withFixture({}, (fx) => {
      const files = [...fx.load().packs.get("core").files.keys()];
      assert.deepEqual(files.sort(), ["commands/alias.md", "domains.json", "frame.md", "skills/craft/SKILL.md", "terms.json"]);
    }));

  test("the repo's data files are in canonical encode form", () => {
    for (const [kind, rel] of [["rig", "rig.json"], ["roles", "models/roles.json"], ["tiers", "models/tiers.json"]]) {
      const bytes = readFileSync(join(ROOT, rel));
      assert.equal(Buffer.from(encode(kind, JSON.parse(bytes))).toString(), bytes.toString(), rel);
    }
  });

  test("models hold Claude aliases, and every tier names one string id for each other harness", () =>
    withFixture({}, (fx) => {
      const tiers: Record<string, Record<string, string>> = fx.load().tiers.tiers;
      assert.deepEqual(Object.fromEntries(Object.entries(tiers).map(([t, row]) => [t, row.claude])),
        { reason: "fable", strong: "opus", fast: "sonnet", cheap: "haiku" });
      for (const [t, row] of Object.entries(tiers)) {
        assert.deepEqual(Object.keys(row).sort(), ["claude", "codex", "cursor", "omp"], t);
        for (const h of ["codex", "cursor", "omp"]) assert.match(row[h], /^[^\s]+$/, `${t} ${h}`);
      }
    }));

  test("the real repo root loads with no RIG_ROOT and holds the core pack", () => {
      const fx = makeFixtureHome({});
      try {
        const w = loadWorld({ HOME: fx.home });
        assert.equal(w.roots.repo, ROOT.replace(/\/$/, ""));
        assert.ok(w.packs.has("core"));
      } finally {
        fx.cleanup();
      }
    });
});

describe("closed keys: an unknown key in each schema is E_SCHEMA with file and key path", () => {
  const add = (obj, key) => ({ ...obj, [key]: 1 });
  const cases = [
    ["rig.json (repo)", { repo: { "rig.json": rigJson({ bogus: 1 }) } }, "rig.json", "bogus"],
    ["rig.json nested", { repo: { "rig.json": rigJson({ metrics: { session_hook: false, extra: true } }) } }, "rig.json", "metrics.extra"],
    ["rig.json overlay", { overlay: { "rig.json": { schema: 2, bogus: 1 } } }, "~/.config/rig/rig.json", "bogus"],
    ["pack.json", { repo: { "rig.json": rigJson({ packs: { own: {} } }), ...pack("own", skill("explain"), { bogus: 1 }) } }, "packs/own/pack.json", "bogus"],
    ["pack.json telemetry", { repo: { "rig.json": rigJson({ packs: { own: {} } }), ...pack("own", skill("explain"), { telemetry: { default_on: true, optout_env: [], url: "x" } }) } }, "packs/own/pack.json", "telemetry.url"],
    ["pack.json unit", { repo: { "rig.json": rigJson({ packs: { own: {} } }), ...pack("own", skill("explain"), { units: { explain: { hidden: true } } }) } }, "packs/own/pack.json", "units.explain.hidden"],
    ["targets/<h>.json", { repo: { "targets/claude.json": add(baseJson("targets/claude.json"), "bogus") } }, "targets/claude.json", "bogus"],
    ["targets read dir", { repo: { "targets/codex.json": { ...baseJson("targets/codex.json"), reads: { skills: [{ path: "~/.codex/skills", writable: true, dedupe: "none", x: 1 }], never_write: [] } } } }, "targets/codex.json", "reads.skills[0].x"],
    ["models/roles.json", { repo: { "models/roles.json": add(baseJson("models/roles.json"), "labels") } }, "models/roles.json", "labels"],
    ["models/tiers.json", { repo: { "models/tiers.json": { ...baseJson("models/tiers.json"), tiers: { ...baseJson("models/tiers.json").tiers, turbo: {} } } } }, "models/tiers.json", "tiers.turbo"],
    ["rig.lock.json", { repo: { "rig.lock.json": { schema: 2, packs: {}, extra: 1 } } }, "rig.lock.json", "extra"],
    ["rig.lock.json pack entry", { repo: { "rig.lock.json": { schema: 2, packs: { own: { ...LOCKED, port: { ...PORT, reviewed: null } } } } } }, "rig.lock.json", "packs.own.port.reviewed"],
    ["audit.allow.json", { repo: { "audit.allow.json": { schema: 1, acks: [{ id: "0123456789abcdef", check: "exec", pack: "own", path: "a.sh", reason: "read it", expires: "2027-01-01", note: "x" }] } } }, "audit.allow.json", "acks[0].note"],
    ["packs/core/terms.json", { repo: { "packs/core/terms.json": { schema: 1, terms: {}, version: 2 } } }, "packs/core/terms.json", "version"],
  ];
  for (const [name, spec, file, path] of cases) test(name, () => loads(spec, "E_SCHEMA", { file, path }));
});

describe("types, required fields and the schema version", () => {
  test("wrong type", () => loads({ repo: { "rig.json": rigJson({ harnesses: "claude" }) } }, "E_SCHEMA", { file: "rig.json", path: "harnesses" }));
  test("missing required field", () => {
    const { aliases, ...rest } = baseJson("rig.json");
    loads({ repo: { "rig.json": rest } }, "E_SCHEMA", { file: "rig.json", path: "aliases" });
  });
  test("missing schema field", () => {
    const { schema, ...rest } = baseJson("models/roles.json");
    loads({ repo: { "models/roles.json": rest } }, "E_SCHEMA", { file: "models/roles.json", path: "schema" });
  });
  test("unsupported schema version", () => loads({ repo: { "models/tiers.json": { ...baseJson("models/tiers.json"), schema: 2 } } }, "E_SCHEMA", { path: "schema" }));
  test("a v0 rig.json (schema 1, with pins and providers) is refused on its version", () => {
    const v0 = { ...baseJson("rig.json"), schema: 1, pins: [], providers: ["pstack"], default_provider: "pstack", slots: {} };
    withFixture({ repo: { "rig.json": v0 } }, (fx) => throwsCode(() => fx.load(), "E_SCHEMA", { file: "rig.json", path: "schema" }));
    withFixture({ repo: { "rig.json": v0 } }, (fx) => assert.throws(() => fx.load(), { message: new RegExp(SCHEMA_1) }));
  });
  test("a v0 rig.lock.json (schema 1, with pins) is refused on its version", () => {
    const v0 = { schema: 1, core: { tree: "sha256:00", candidate: null }, packs: {}, pins: {} };
    withFixture({ repo: { "rig.lock.json": v0 } }, (fx) => throwsCode(() => fx.load(), "E_SCHEMA", { file: "rig.lock.json", path: "schema" }));
    withFixture({ repo: { "rig.lock.json": v0 } }, (fx) => assert.throws(() => fx.load(), { message: new RegExp(SCHEMA_1) }));
  });
  test("a v0 pack.json (schema 1, with source) is refused on its version", () =>
    loads({ repo: { "rig.json": rigJson({ packs: { own: {} } }), ...pack("own", skill("explain"), { schema: 1, source: null }) } }, "E_SCHEMA", { file: "packs/own/pack.json", path: "schema" }));
  test("rig.json fill takes a unit, a list of units, and triggers", () =>
    withFixture({ repo: { "rig.json": rigJson({ fill: { "eng:ground": "pstack/how", "eng:review.before": ["pstack/no-comments"], triggers: [{ when: "Building a CLI", use: "cli/cli-for-agents" }] } }) } }, (fx) =>
      assert.deepEqual(fx.load().config.fill, { "eng:ground": "pstack/how", "eng:review.before": ["pstack/no-comments"], triggers: [{ when: "Building a CLI", use: "cli/cli-for-agents" }] })));
  test("rig.json fill rejects a value that is no unit, list or trigger list", () =>
    loads({ repo: { "rig.json": rigJson({ fill: { "eng:ground": 3 } }) } }, "E_SCHEMA", { file: "rig.json", path: 'fill["eng:ground"]' }));
  test("pack.json mode must be an object", () =>
    loads({ repo: { "rig.json": rigJson({ packs: { own: {} } }), ...pack("own", skill("explain"), { mode: [] }) } }, "E_SCHEMA", { file: "packs/own/pack.json", path: "mode" }));
  test("pack.json mode takes any object", () =>
    withFixture({ repo: { "rig.json": rigJson({ packs: { own: {} } }), ...pack("own", skill("explain"), { mode: { triggers: [] } }) } }, (fx) =>
      assert.deepEqual(fx.load().packs.get("own").manifest.mode, { triggers: [] })));
  test("a lock pack entry needs a full commit sha", () =>
    loads({ repo: { "rig.lock.json": { schema: 2, packs: { own: { ...LOCKED, sha: "b244e6d" } } } } }, "E_SCHEMA", { file: "rig.lock.json", path: "packs.own.sha" }));
  test("a lock pack entry with a port and a candidate loads", () =>
    withFixture({ repo: { "rig.lock.json": { schema: 2, packs: { own: { ...LOCKED, port: PORT, candidate: { sha: SHA, exclude: [], tree: "sha256:03", port_tree: null, checked: "2026-11-05" } } } } } }, (fx) =>
      assert.deepEqual(fx.load().locks.repo.packs.own.port, PORT)));
  test("bad enum value", () => loads({ repo: { "targets/omp.json": { ...baseJson("targets/omp.json"), hide: { method: "hidden" } } } }, "E_SCHEMA", { path: "hide.method" }));
  test("invalid JSON", () => loads({ repo: { "models/roles.json": "{" } }, "E_SCHEMA", { file: "models/roles.json" }));
  test("markers on a non-markdown surface", () => loads({ overlay: { "rig.json": { schema: 2, model_surfaces: [{ path: "~/.omp/agent/config.yml", consumer: "omp", kind: "keys", markers: true }] } } }, "E_SCHEMA", { path: "model_surfaces[0]" }));
  test("an ack with an empty reason", () => loads({ repo: { "audit.allow.json": { schema: 1, acks: [{ id: "0123456789abcdef", check: "exec", pack: "own", path: "a.sh", reason: " ", expires: "2027-01-01" }] } } }, "E_SCHEMA", { path: "acks[0].reason" }));
  test("an ack with no expiry", () => loads({ repo: { "audit.allow.json": { schema: 1, acks: [{ id: "0123456789abcdef", check: "exec", pack: "own", path: "a.sh", reason: "read" }] } } }, "E_SCHEMA", { path: "acks[0].expires" }));
  test("a harness with no target record", () => loads({ repo: { "targets/omp.json": null } }, "E_SCHEMA", { file: "rig.json", path: "harnesses[2]" }));
  test("a listed pack with no directory", () => loads({ repo: { "rig.json": rigJson({ packs: { ghost: {} } }) } }, "E_SCHEMA", { path: "packs.ghost" }));
  test("an invalid RIG_NOW", () => loads({ env: { RIG_NOW: "soon" } }, "E_SCHEMA", { path: "RIG_NOW" }));
  test("acks and the lock load from the repo root", () =>
    withFixture({
      repo: {
        "audit.allow.json": { schema: 1, acks: [{ id: "0123456789abcdef", check: "exec", pack: "own", path: "a.sh", reason: "read", expires: "2027-01-01" }] },
        "rig.lock.json": { schema: 2, core: { tree: "sha256:00", candidate: null }, packs: {} },
      },
    }, (fx) => {
      const w = fx.load();
      assert.equal(w.acks.length, 1);
      assert.equal(w.locks.repo.core.tree, "sha256:00");
    }));
});

describe("core is sealed", () => {
  test("core in repo packs is a parse error", () => loads({ repo: { "rig.json": rigJson({ packs: { core: {} } }) } }, "E_SCHEMA", { path: "packs.core" }));
  test("core in overlay packs is a parse error", () => loads({ overlay: { "rig.json": { schema: 2, packs: { core: {} } } } }, "E_SCHEMA", { path: "packs.core" }));
  test("an overlay that disables a core unit fails loadWorld", () =>
    loads({ overlay: { "rig.json": { schema: 2, disable: ["core/rig-frame"] } } }, "E_SCHEMA", { file: "~/.config/rig/rig.json", path: "disable[0]" }));
  test("the repo cannot disable a core unit either", () => loads({ repo: { "rig.json": rigJson({ disable: ["core/rig-frame"] }) } }, "E_SCHEMA", { path: "disable[0]" }));
  test("an overlay pack that replaces a core unit fails loadWorld", () =>
    loads({
      overlay: { "rig.json": { schema: 2, packs: { mine: {} } }, ...pack("mine", skill("frame2"), { units: { frame2: { replaces: "core/rig-frame" } } }) },
    }, "E_SCHEMA", { file: "~/.config/rig/packs/mine/pack.json", path: "units.frame2.replaces" }));
  test("an overlay packs/core directory is a conflict", () =>
    loads({ overlay: { "packs/core/frame.md": "# other frame\n" } }, "E_OVERLAY_CONFLICT", { file: "~/.config/rig/packs/core" }));
});

describe("overlay merge adds only", () => {
  test("adds packs, private terms, fills and tier cells", () =>
    withFixture({
      repo: { "rig.json": rigJson({ packs: { own: {} } }), ...pack("own", skill("explain")) },
      overlay: {
        "rig.json": { schema: 2, packs: { mine: { scope: "project", projects: ["~/src/app"] } }, fill: { "eng:ground": "mine/notes" }, private_terms: ["acme-internal"] },
        ...pack("mine", skill("notes"), { scopes: ["machine-hidden", "project"] }),
        "models/tiers.json": { schema: 1, tiers: { strong: { acme: "<provider>/<model-a>" } } },
      },
    }, (fx) => {
      const w = fx.load();
      assert.deepEqual(Object.keys(w.config.packs), ["own", "mine"]);
      assert.equal(w.packs.get("own").root, "repo");
      assert.equal(w.packs.get("mine").root, "overlay");
      assert.deepEqual(w.config.fill, { "eng:ground": "mine/notes" });
      assert.deepEqual(w.config.private_terms, ["acme-internal"]);
      assert.deepEqual(w.tiers.tiers.strong, { claude: "opus", codex: "gpt-6.1-sol", cursor: "claude-opus-5-5", omp: "google-antigravity/claude-opus-5-5", acme: "<provider>/<model-a>" });
      assert.equal(w.roots.overlay, fx.path(".config/rig"));
    }));
  test("adds a scope choice to a repo pack entry that has none", () =>
    withFixture({
      repo: { "rig.json": rigJson({ packs: { own: {} } }), ...pack("own", skill("explain"), { scopes: ["machine-hidden", "hybrid"] }) },
      overlay: { "rig.json": { schema: 2, packs: { own: { scope: "hybrid", projects: ["~/src/app"] } } } },
    }, (fx) => assert.deepEqual(fx.load().config.packs.own, { scope: "hybrid", projects: ["~/src/app"] })));
  test("a scalar the repo sets", () =>
    loads({ overlay: { "rig.json": { schema: 2, metrics: { session_hook: true } } } }, "E_OVERLAY_CONFLICT", { file: "~/.config/rig/rig.json", path: "metrics.session_hook" }));
  test("a fill the repo sets", () =>
    loads({ repo: { "rig.json": rigJson({ fill: { "eng:ground": "a/b" } }) }, overlay: { "rig.json": { schema: 2, fill: { "eng:ground": "c/d" } } } }, "E_OVERLAY_CONFLICT", { path: 'fill["eng:ground"]' }));
  test("a list entry the repo already has", () =>
    loads({ overlay: { "rig.json": { schema: 2, harnesses: ["claude"] } } }, "E_OVERLAY_CONFLICT", { path: "harnesses[0]" }));
  test("a tier cell the repo sets", () =>
    loads({ overlay: { "models/tiers.json": { schema: 1, tiers: { strong: { claude: "sonnet" } } } } }, "E_OVERLAY_CONFLICT", { path: "tiers.strong.claude" }));
  test("a role the repo sets", () =>
    loads({ overlay: { "models/roles.json": { schema: 1, consumers: { fleet: { reviewer: ["fast", "low"] } } } } }, "E_OVERLAY_CONFLICT", { path: "consumers.fleet.reviewer" }));
});

describe("scope modes", () => {
  const repo = (entry, scopes) => ({ "rig.json": rigJson({ packs: { kit: entry } }), ...pack("kit", skill("review"), scopes ? { scopes } : {}) });
  test("no scope key loads as machine-hidden against the default pack scopes", () =>
    withFixture({ repo: repo({}) }, (fx) => assert.deepEqual(fx.load().packs.get("kit").manifest.scopes, ["machine-hidden"])));
  test("a scope the pack does not list is E_SCOPE_MODE", () =>
    loads({ repo: repo({ scope: "project", projects: ["~/src/app"] }) }, "E_SCOPE_MODE", { file: "rig.json", path: "packs.kit.scope" }));
  test("no scope key, and the pack does not list machine-hidden, is E_SCOPE_MODE", () =>
    loads({ repo: repo({}, ["project"]) }, "E_SCOPE_MODE", { path: "packs.kit.scope" }));
  test("a scope value machine does not parse", () =>
    loads({ repo: repo({ scope: "machine" }) }, "E_SCHEMA", { path: "packs.kit.scope" }));
  test("project needs projects", () =>
    loads({ repo: repo({ scope: "project" }, ["project"]) }, "E_SCHEMA", { path: "packs.kit.projects" }));
  test("projects need a project or hybrid scope", () =>
    loads({ repo: repo({ projects: ["~/src/app"] }) }, "E_SCHEMA", { path: "packs.kit.projects" }));
  test("pack harnesses must be rig.json harnesses", () =>
    loads({ repo: repo({ harnesses: ["pi"] }) }, "E_SCHEMA", { path: "packs.kit.harnesses[0]" }));
  test("a plugin channel needs the target's plugin channel", () =>
    loads({ repo: repo({ channel: { codex: "plugin" } }) }, "E_SCHEMA", { path: "packs.kit.channel.codex" }));
});

describe("state root and read-sets", () => {
  test("world.ctx is the fs write context: state inside home, read-sets and never_write from the targets", () =>
    withFixture({ env: { XDG_STATE_HOME: "" } }, (fx) => {
      const w = fx.load();
      assert.equal(w.ctx.home, fx.home);
      assert.equal(w.ctx.state, join(fx.home, ".local/state/rig"));
      assert.ok(w.ctx.state.startsWith(`${fx.home}/`));
      assert.equal(w.ctx.data, join(fx.home, ".local/share/rig"));
      assert.ok(w.ctx.readSets.includes("~/.claude/skills") && w.ctx.readSets.includes("~/.cursor/plugins/local/rig/skills"));
      assert.ok(w.ctx.neverWrite.includes("~/.claude/plugins/**") && w.ctx.neverWrite.includes("~/.cursor/hooks.json"));
      assert.equal(new Set(w.ctx.readSets).size, w.ctx.readSets.length);
      writeState("probe.txt", Buffer.from("ok\n"), w.ctx);
      assert.equal(readFileSync(join(w.ctx.state, "probe.txt"), "utf8"), "ok\n");
    }));
  test("XDG_STATE_HOME inside home sets world.ctx.state", () =>
    withFixture({}, (fx) => assert.equal(loadWorld({ ...fx.env, XDG_STATE_HOME: join(fx.home, "st") }).ctx.state, join(fx.home, "st/rig"))));
  test("a state root outside HOME is E_STATE_ROOT", () => {
    const outside = makeFixtureHome({});
    try {
      loads({ env: { XDG_STATE_HOME: outside.home } }, "E_STATE_ROOT", { path: "XDG_STATE_HOME" });
    } finally {
      outside.cleanup();
    }
  });
  test("a data root outside HOME is E_STATE_ROOT", () => loads({ env: { XDG_DATA_HOME: "/" } }, "E_STATE_ROOT", { path: "XDG_DATA_HOME" }));
  test("a state root inside a read-set is E_STATE_IN_READSET", () =>
    withFixture({}, (fx) => throwsCode(() => loadWorld({ ...fx.env, XDG_STATE_HOME: join(fx.home, ".claude/skills/x") }), "E_STATE_IN_READSET", { file: "targets/claude.json" })));
});

describe("pre-read sources and vars", () => {
  test("text_from files of whole surfaces, {role} expanded over the consumer's roles", () => {
    const codex = { ...baseJson("targets/codex.json"), model_surfaces: [{ path: "~/.codex/agents/{role}.toml", consumer: "fleet", kind: "whole", text_from: "~/.claude/agents/{role}.md" }] };
    withFixture({ repo: { "targets/codex.json": codex }, home: { ".claude/agents/reviewer.md": "reviewer body\n" } }, (fx) => {
      const w = fx.load();
      assert.deepEqual([...w.sources.keys()], ["~/.claude/agents/reviewer.md"]);
      assert.equal(Buffer.from(w.sources.get("~/.claude/agents/reviewer.md")).toString(), "reviewer body\n");
    });
  });
  test("vars hold only the variables checks read", () =>
    withFixture({ env: { DO_NOT_TRACK: "1", SOME_SECRET: "x" } }, (fx) =>
      assert.deepEqual({ ...fx.load().vars }, { DO_NOT_TRACK: "1" })));
  test("vars also hold the opt-out variables of a pack.json with telemetry", () =>
    withFixture({ repo: { "rig.json": rigJson({ packs: { own: {} } }), ...pack("own", skill("explain"), { telemetry: { default_on: true, optout_env: ["OWN_TELEMETRY=0"] } }) }, env: { OWN_TELEMETRY: "0" } }, (fx) =>
      assert.deepEqual({ ...fx.load().vars }, { DO_NOT_TRACK: undefined, OWN_TELEMETRY: "0" })));
  test("vars also hold the Claude alias overrides that models.effective reports", () =>
    withFixture({ env: { ANTHROPIC_DEFAULT_OPUS_MODEL: "remapped", ANTHROPIC_API_KEY: "x" } }, (fx) =>
      assert.deepEqual({ ...fx.load().vars }, { ANTHROPIC_DEFAULT_OPUS_MODEL: "remapped", DO_NOT_TRACK: undefined })));
  test("pack files keep their mode and symlinks stay links", () =>
    withFixture({ repo: { "rig.json": rigJson({ packs: { own: {} } }), ...pack("own", skill("explain")) }, home: { "rig/packs/own/skills/explain/link": { symlink: "SKILL.md" } } }, (fx) => {
      const files = fx.load().packs.get("own").files;
      assert.equal(files.get("skills/explain/SKILL.md").mode & 0o777, 0o644);
      const link = files.get("skills/explain/link");
      assert.equal(link.mode & 0o170000, 0o120000);
      assert.equal(Buffer.from(link.bytes).toString(), "SKILL.md");
    }));
});

describe("projectDeclaration", () => {
  const project = (files) => Object.fromEntries(Object.entries(files).map(([k, v]) => [`src/app/${k}`, v]));
  test("scope packs for the dir, enabled through settings.local.json", () =>
    withFixture({
      repo: { "rig.json": rigJson({ packs: { notes: { scope: "project", projects: ["~/src/app"] } } }), ...pack("notes", skill("notes"), { scopes: ["project"] }) },
      home: project({ ".claude/settings.local.json": '{"enabledPlugins": {"notes@rig-local": true}}' }),
    }, (fx) => {
      assert.deepEqual(projectDeclaration(fx.load(), "~/src/app").packs, [{ name: "notes", enabled: true, source: "local" }]);
      assert.deepEqual(projectDeclaration(fx.load(), "~/src/other").packs, []);
    }));
});

describe("encode", () => {
  const tiers = baseJson("models/tiers.json");
  const shuffle = (v) => {
    if (Array.isArray(v)) return v.map(shuffle);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, shuffle(x)]));
    return v;
  };
  test("is stable across key orders, with a trailing newline", () => {
    const a = Buffer.from(encode("tiers", tiers)).toString();
    assert.equal(Buffer.from(encode("tiers", shuffle(tiers))).toString(), a);
    assert.ok(a.endsWith("}\n"));
    assert.deepEqual(JSON.parse(a), tiers);
    const { repo, ...rest } = LOCKED;
    const lock = { schema: 2, packs: { b: LOCKED, a: { ...rest, repo } } };
    assert.deepEqual(Object.keys(JSON.parse(Buffer.from(encode("lock", lock)).toString()).packs), ["a", "b"]);
    assert.equal(Buffer.from(encode("lock", shuffle(lock))).toString(), Buffer.from(encode("lock", lock)).toString());
  });
  test("keeps the order of role labels, which render emits in order", () => {
    const roles = { schema: 1, consumers: { pstack: { "z label": ["fast", "high"], "a label": ["strong", "high"] } } };
    assert.deepEqual(Object.keys(JSON.parse(Buffer.from(encode("roles", roles)).toString()).consumers.pstack), ["z label", "a label"]);
  });
  test("validates before it serializes", () => {
    throwsCode(() => encode("tiers", { ...tiers, extra: 1 }), "E_SCHEMA", { path: "extra" });
    throwsCode(() => encode("rig", { schema: 2, disable: ["core/rig-frame"] }), "E_SCHEMA", { path: "disable[0]" });
    throwsCode(() => encode("nope", {}), "E_INTERNAL");
  });
});
