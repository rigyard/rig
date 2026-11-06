// CLI-level tests of the wired commands: doctor, stats, models, pack add and pin. Each test builds a fixture HOME
// whose repo config root (RIG_ROOT) is a temp copy of this repo's data, so no test writes into the worktree.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { dispatch, EXIT_2 } from "../lib/commands.ts";
import { treeHash } from "../lib/tree.ts";
import { makeFixtureHome } from "./helpers/fixture-home.ts";
import { makeStubs } from "./helpers/stubs.ts";
import { cleanup as rmScratch, makeRepo, MIT_TEXT, scratch } from "./lock.helpers.ts";
import { authoredEntry, repoLockPacks } from "./world.helpers.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BIN = join(ROOT, "bin/rig.ts");
const NOW = "2026-11-05T12:00:00.000Z";
const METRICS = join(ROOT, "test/fixtures/metrics");

/** @param {string} dir @returns {{path: string, mode: number, bytes: Buffer}[]} */
function filesUnder(dir, rel = "") {
  const out = [];
  for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...filesUnder(dir, r));
    else out.push({ path: r, mode: statSync(join(dir, r)).mode & 0o777, bytes: readFileSync(join(dir, r)) });
  }
  return out;
}

/** The repo data that a config root holds, as fixture entries under `rig/`: core and every pack rig.json lists. */
function repoSpec() {
  const rig = readFileSync(join(ROOT, "rig.json"));
  const spec = { "rig/rig.json": rig };
  const packs = Object.keys(JSON.parse(rig.toString("utf8")).packs).map((name) => `packs/${name}`);
  for (const dir of ["models", "targets", "packs/core", ...packs]) {
    for (const f of filesUnder(join(ROOT, dir))) spec[`rig/${dir}/${f.path}`] = { content: f.bytes, mode: f.mode };
  }
  return spec;
}

/**
 * A fixture HOME with a repo root at ~/rig and a rig.lock.json with the repo's pack entries. `sealed` gives the lock a
 * core seal that matches the copied core.
 * @param {{home?: Record<string, any>, sealed?: boolean, edit?: (root: string) => void}} [opts]
 */
function setup({ home = {}, sealed = true, edit } = {}) {
  const fx = makeFixtureHome({ ...repoSpec(), ...home });
  const root = fx.path("rig");
  const core = sealed ? { tree: treeHash(filesUnder(join(root, "packs/core")), { core: true }), candidate: null } : null;
  writeFileSync(join(root, "rig.lock.json"), `${JSON.stringify({ schema: 2, core, packs: repoLockPacks() }, null, 2)}\n`);
  edit?.(root);
  const env = { PATH: process.env.PATH, HOME: fx.home, RIG_ROOT: root, RIG_NOW: NOW };
  /** @param {string[]} args @param {{env?: Record<string, string>, input?: string}} [o] */
  const rig = (args, o = {}) => {
    const r = spawnSync(process.execPath, [BIN, ...args], { env: { ...env, ...o.env }, cwd: fx.home, encoding: "utf8", input: o.input ?? "" });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr };
  };
  return { fx, root, env, rig };
}

/** Paths whose sha256 or mode differ between two snapshots, or that exist in only one. */
function changed(a, b) {
  const out = [];
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    if (JSON.stringify(a.get(k)) !== JSON.stringify(b.get(k))) out.push(k);
  }
  return out.sort();
}

const STATE = ".local/state/rig/";

const editRig = (root, change) => {
  const path = join(root, "rig.json");
  writeFileSync(path, `${JSON.stringify(change(JSON.parse(readFileSync(path, "utf8"))), null, 2)}\n`);
};

describe("rig doctor", () => {
  test("a sealed fixture HOME: exit 0, the /pm reminder, and nothing written, not even a log line", (t) => {
    const own = { "commands/tidy.md": "---\ndescription: Tidy the notes.\n---\nTidy the notes.\n" };
    const s = setup({
      home: { "rig/packs/own/pack.json": `${JSON.stringify({ schema: 2, name: "own", license: "MIT" })}\n`, "rig/packs/own/commands/tidy.md": own["commands/tidy.md"] },
      edit: (root) => {
        editRig(root, (c) => ({ ...c, packs: { ...c.packs, own: {} }, aliases: { pm: "tidy" } }));
        const lock = JSON.parse(readFileSync(join(root, "rig.lock.json"), "utf8"));
        writeFileSync(join(root, "rig.lock.json"), `${JSON.stringify({ ...lock, packs: { ...lock.packs, own: authoredEntry("own", own) } }, null, 2)}\n`);
      },
    });
    t.after(() => s.fx.cleanup());
    const before = s.fx.snapshot();
    const r = s.rig(["doctor"]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^info +alias +\/pm is an alias of \/tidy/m);
    assert.match(r.stdout, /^0 errors, \d+ warnings$/m);
    assert.deepEqual(changed(before, s.fx.snapshot()), []);
  });

  test("an unsealed repo root is an error: exit 1, names the core seal", (t) => {
    const s = setup({ sealed: false });
    t.after(() => s.fx.cleanup());
    const r = s.rig(["doctor"]);
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /^error +pin +core\/\.: core seal missing/m);
  });

  test("a Claude alias override in the env is a warning with its variable", (t) => {
    const s = setup();
    t.after(() => s.fx.cleanup());
    const r = s.rig(["doctor"], { env: { ANTHROPIC_DEFAULT_OPUS_MODEL: "model-x" } });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /^warn +models +claude strong: ANTHROPIC_DEFAULT_OPUS_MODEL overrides the alias, the harness runs model-x$/m);
  });

  test("a planted unmanaged duplicate is printed as info, exit 0", (t) => {
    // Codex reads ~/.codex/skills and ~/.agents/skills and deduplicates nothing (targets/codex.json).
    const s = setup({ home: { ".codex/skills/dup/SKILL.md": "---\nname: dup\n---\nA\n", ".agents/skills/dup/SKILL.md": "---\nname: dup\n---\nB\n" } });
    t.after(() => s.fx.cleanup());
    const r = s.rig(["doctor"]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^info +duplicates +codex lists dup 2 times: .*\.codex\/skills\/dup, .*\.agents\/skills\/dup$/m);
    assert.doesNotMatch(r.stdout, /^info +duplicates +(claude|omp|cursor) /m, "harnesses that read one copy, or dedupe by name, list it once");
  });

  test("a Claude plugin cache copy marked .orphaned_at is not a duplicate; two live copies still are", (t) => {
    const body = (v: string) => `---\nname: dup\n---\n${v}\n`;
    const cache = ".claude/plugins/cache/mkt/plug";
    const stale = setup({ home: { [`${cache}/1.0.0/skills/dup/SKILL.md`]: body("old"), [`${cache}/1.0.0/.orphaned_at`]: "1\n", [`${cache}/2.0.0/skills/dup/SKILL.md`]: body("new") } });
    t.after(() => stale.fx.cleanup());
    const r1 = stale.rig(["doctor"]);
    assert.equal(r1.code, 0, r1.stdout + r1.stderr);
    assert.doesNotMatch(r1.stdout, /^\w+ +duplicates /m);

    const live = setup({ home: { [`${cache}/1.0.0/skills/dup/SKILL.md`]: body("old"), [`${cache}/2.0.0/skills/dup/SKILL.md`]: body("new") } });
    t.after(() => live.fx.cleanup());
    const r2 = live.rig(["doctor"]);
    assert.match(r2.stdout, /^info +duplicates +claude lists dup 2 times: .*1\.0\.0\/skills\/dup, .*2\.0\.0\/skills\/dup$/m);
  });

  test("a Claude plugin cache copy marked only .in_use is live, so it still counts as a duplicate", (t) => {
    const body = (v: string) => `---\nname: dup\n---\n${v}\n`;
    const cache = ".claude/plugins/cache/mkt/plug";
    const s = setup({ home: { [`${cache}/1.0.0/skills/dup/SKILL.md`]: body("old"), [`${cache}/1.0.0/.in_use`]: "", [`${cache}/2.0.0/skills/dup/SKILL.md`]: body("new") } });
    t.after(() => s.fx.cleanup());
    assert.match(s.rig(["doctor"]).stdout, /^info +duplicates +claude lists dup 2 times: /m);
  });

  test("--project with a path that is not a directory: exit 2", (t) => {
    const s = setup();
    t.after(() => s.fx.cleanup());
    const r = s.rig(["doctor", "--project", s.fx.path("missing")]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /^rig doctor: E_USAGE --project .* is not a directory\n$/);
  });
});

describe("rig stats", () => {
  /** A fixture root whose Claude record names the fixture transcripts. */
  const withTranscripts = () => {
    const home = {};
    for (const f of filesUnder(join(METRICS, "claude/projects"))) home[`.claude/projects/${f.path}`] = f.bytes;
    return setup({
      home,
      edit: (root) => {
        const file = join(root, "targets/claude.json");
        const rec = JSON.parse(readFileSync(file, "utf8"));
        writeFileSync(file, `${JSON.stringify({ ...rec, transcripts: { format: "claude-jsonl", root: "~/.claude/projects" } }, null, 2)}\n`);
      },
    });
  };

  test("--since 30d over fixture transcripts prints totals and writes only under the state root", (t) => {
    const s = withTranscripts();
    t.after(() => s.fx.cleanup());
    const before = s.fx.snapshot();
    const r = s.rig(["stats", "--since", "30d"]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /claude/);
    assert.match(r.stdout, /\b1 session/);
    const diff = changed(before, s.fx.snapshot());
    assert.ok(diff.includes(`${STATE}metrics.jsonl`), JSON.stringify(diff));
    assert.deepEqual(diff.filter((p) => !p.startsWith(STATE)), [], "every write is under the state root");
  });

  test("--record with malformed stdin prints 0 bytes and exits 0", (t) => {
    const s = withTranscripts();
    t.after(() => s.fx.cleanup());
    const r = s.rig(["stats", "--record"], { input: "{not json" });
    assert.equal(r.code, 0);
    assert.equal(r.stdout, "");
    assert.equal(r.stderr, "");
    assert.match(s.fx.read(`${STATE}log/rig.log`), /"code":"E_HOOK_PAYLOAD"/);
  });

  test("--record with a world that does not load still prints 0 bytes and exits 0", (t) => {
    const s = setup();
    t.after(() => s.fx.cleanup());
    const r = s.rig(["stats", "--record"], { env: { RIG_ROOT: s.fx.path("no-such-root") }, input: "{}" });
    assert.equal(r.code, 0);
    assert.equal(r.stdout, "");
    assert.equal(r.stderr, "");
  });

  test("--session without --record, and --record with --since, exit 2", (t) => {
    const s = setup();
    t.after(() => s.fx.cleanup());
    for (const args of [["stats", "--session", "s1"], ["stats", "--record", "--since", "7d"]]) {
      const r = s.rig(args);
      assert.equal(r.code, 2, args.join(" "));
      assert.match(r.stderr, /^rig stats: E_USAGE /);
    }
  });
});

describe("rig models", () => {
  test("prints the effective table with the source of each value", (t) => {
    const s = setup();
    t.after(() => s.fx.cleanup());
    const r = s.rig(["models"], { env: { ANTHROPIC_DEFAULT_SONNET_MODEL: "model-y" } });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /^harness +tier +model +source$/m);
    assert.match(r.stdout, /^claude +strong +opus +tiers\.json$/m);
    assert.match(r.stdout, /^claude +fast +model-y +env override \(ANTHROPIC_DEFAULT_SONNET_MODEL\)$/m);
  });

  test("set changes exactly one value in models/tiers.json of the fixture root, and nothing else", (t) => {
    const s = setup();
    t.after(() => s.fx.cleanup());
    const file = join(s.root, "models/tiers.json");
    const beforeText = readFileSync(file, "utf8");
    const before = s.fx.snapshot();
    const r = s.rig(["models", "set", "strong", "model-z", "--harness", "claude"]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /^models\/tiers\.json: tiers\.strong\.claude: opus -> model-z\n/);
    assert.match(r.stdout, /^create +owned +claude +~\/\.claude\/rules\/pstack-models\.md +pstack\/models$/m);
    for (const rel of ["~/.codex/pstack-models.md", "~/.cursor/rules/pstack-models.mdc", "~/.omp/agent/pstack-models.md", "~/.codex/config.toml"]) {
      assert.match(r.stdout, new RegExp(`^create +(owned|block) +\\w+ +${rel.replaceAll(".", "\\.")} `, "m"), rel);
    }
    assert.match(r.stdout, /^5 changes, 0 blocks$/m);
    assert.match(readFileSync(s.fx.path(".claude/rules/pstack-models.md"), "utf8"), /^hardest tasks: model-z xhigh$/m);
    const afterText = readFileSync(file, "utf8");
    const a = beforeText.split("\n");
    const b = afterText.split("\n");
    assert.equal(a.length, b.length);
    assert.deepEqual(a.map((l, i) => (l === b[i] ? null : [l.trim(), b[i].trim()])).filter(Boolean), [['"claude": "opus",', '"claude": "model-z",']]);
    const expected = JSON.parse(beforeText);
    expected.tiers.strong.claude = "model-z";
    assert.deepEqual(JSON.parse(afterText), expected);
    const diff = changed(before, s.fx.snapshot());
    assert.deepEqual(diff.filter((p) => !p.startsWith(STATE)), [".claude/rules/pstack-models.md", ".codex/config.toml", ".codex/pstack-models.md", ".cursor/rules/pstack-models.mdc", ".omp/agent/pstack-models.md", "rig/models/tiers.json"]);
  });

  test("set refuses when the overlay has models/tiers.json: exit 2, the repo file keeps its bytes", (t) => {
    // world.tiers is repo plus overlay, merged; writing it back would copy overlay values into the repo file.
    const s = setup({ home: { ".config/rig/models/tiers.json": `${JSON.stringify({ schema: 1, tiers: { strong: { "private-h": "model-p" } } }, null, 2)}\n` } });
    t.after(() => s.fx.cleanup());
    assert.equal(s.rig(["models"]).code, 0, "the overlay loads");
    const before = s.fx.snapshot();
    const r = s.rig(["models", "set", "strong", "model-z", "--harness", "claude"]);
    assert.equal(r.code, 2, r.stderr);
    assert.match(r.stderr, /^rig models: E_USAGE the overlay has models\/tiers\.json/);
    assert.deepEqual(changed(before, s.fx.snapshot()), []);
  });

  test("set with an unknown harness or tier exits 2 and writes nothing", (t) => {
    const s = setup();
    t.after(() => s.fx.cleanup());
    const before = s.fx.snapshot();
    for (const args of [["models", "set", "strong", "m", "--harness", "nope"], ["models", "set", "huge", "m", "--harness", "claude"]]) {
      const r = s.rig(args);
      assert.equal(r.code, 2, `${args.join(" ")}: ${r.stderr}`);
      assert.match(r.stderr, /E_USAGE/);
    }
    assert.deepEqual(changed(before, s.fx.snapshot()), []);
  });
});

describe("rig pack add", () => {
  test("vendors through git, keeps the exec bit, prints the gate findings with ack stanzas, exit 1 on the block", (t) => {
    const s = setup();
    const base = scratch();
    const stubs = makeStubs(["git"]);
    t.after(() => {
      s.fx.cleanup();
      rmScratch(base);
      stubs.cleanup();
    });
    const repo = makeRepo(base, [{
      LICENSE: MIT_TEXT,
      "skills/kit/SKILL.md": "---\nname: kit\ndescription: Kit.\n---\nUse the kit.\n",
      "skills/kit/scripts/run.sh": { content: "#!/bin/sh\necho kit\n", mode: 0o755 },
      "skills/kit/docs/notes.md": "twelve bytes",
    }]);
    const r = s.rig(["pack", "add", repo.url, "--sha", repo.shas[0], "--root", "skills/kit", "--path", ".", "--exclude", "docs"], { env: stubs.env });
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /^vendored kit into packs\/kit\/ of the repo root, tree sha256:[0-9a-f]{64}\nkept 2 files, excluded 12 bytes$/m);
    assert.match(r.stdout, /^block exec kit\/scripts\/run\.sh: /m);
    assert.match(r.stdout, /^ {2}ack: \{"id":"[0-9a-f]{16}","check":"exec","pack":"kit","path":"scripts\/run\.sh","reason":"","expires":""\}$/m);
    assert.doesNotMatch(r.stdout, /^block pin /m, "the lock entry matches the files");
    assert.equal(statSync(join(s.root, "packs/kit/scripts/run.sh")).mode & 0o777, 0o755);
    assert.ok(stubs.log().some((c) => c.name === "git"), "lock reached git through PATH");
    assert.ok(stubs.log().every((c) => !c.argv.some((x) => /^(https?|ssh|git):/.test(x))), "no network URL");

    const lockBytes = readFileSync(join(s.root, "rig.lock.json"));
    const again = s.rig(["pack", "add", repo.url, "--sha", repo.shas[0], "--root", "skills/kit", "--path", ".", "--exclude", "docs"]);
    assert.match(again.stdout, /^kit is already vendored at sha256:[0-9a-f]{64}\nkept 2 files$/m);
    assert.deepEqual(readFileSync(join(s.root, "rig.lock.json")), lockBytes, "the re-run writes no lock byte");

    // The lock it wrote loads, and its tree equals the files on disk once the pack is listed.
    const rigJson = JSON.parse(readFileSync(join(s.root, "rig.json"), "utf8"));
    writeFileSync(join(s.root, "rig.json"), `${JSON.stringify({ ...rigJson, packs: { kit: {} }, fill: {} }, null, 2)}\n`);
    const d = s.rig(["doctor"]);
    assert.equal(d.code, 0, d.stdout + d.stderr);
    assert.doesNotMatch(d.stdout, /^error/m);
  });

  test("a pack root with its script folder excluded vendors with 0 blocks under the name of the root", (t) => {
    const s = setup();
    const base = scratch();
    t.after(() => {
      s.fx.cleanup();
      rmScratch(base);
    });
    const repo = makeRepo(base, [{
      "toolkit/LICENSE": MIT_TEXT,
      "toolkit/skills/how/SKILL.md": "---\nname: how\ndescription: How.\n---\nExplain how.\n",
      "toolkit/skills/statechart/SKILL.md": "---\nname: statechart\ndescription: S.\n---\nRun it.\n",
      "toolkit/skills/statechart/scripts/run.sh": { content: "#!/bin/sh\necho statechart\n", mode: 0o755 },
      "other/SKILL.md": "not under the root\n",
    }]);
    const r = s.rig(["pack", "add", repo.url, "--sha", repo.shas[0], "--root", "toolkit", "--path", ".", "--exclude", "skills/statechart"]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^vendored toolkit into packs\/toolkit\/ /m);
    assert.match(r.stdout, /^kept 2 files, excluded \d+ bytes$/m);
    assert.match(r.stdout, /^0 findings, 0 blocks$/m);
    assert.deepEqual(filesUnder(join(s.root, "packs/toolkit")).map((f: {path: string}) => f.path).sort(), ["LICENSE", "pack.json", "skills/how/SKILL.md"]);
  });

  test("pack add with neither --path nor --port exits 2 with E_USAGE", (t) => {
    const s = setup();
    t.after(() => s.fx.cleanup());
    const r = s.rig(["pack", "add", "file:///nowhere", "--sha", "0".repeat(40)]);
    assert.equal(r.code, 2, r.stdout + r.stderr);
    assert.equal(r.stderr, "rig pack: E_USAGE at least one --path or --port is required\n");
  });

  test("a short sha exits 2 with E_USAGE before any fetch", (t) => {
    const s = setup();
    t.after(() => s.fx.cleanup());
    const before = readFileSync(join(s.root, "rig.lock.json"));
    const r = s.rig(["pack", "add", "file:///nowhere", "--sha", "2776ddd", "--path", "x"]);
    assert.equal(r.code, 2, r.stdout + r.stderr);
    assert.equal(r.stderr, 'rig pack: E_USAGE --sha must be the full 40-hex commit, got "2776ddd"\n');
    assert.deepEqual(readFileSync(join(s.root, "rig.lock.json")), before);
  });
});

describe("rig pin", () => {
  test("pin set core without a candidate exits 1 with E_PIN_UNCHECKED", (t) => {
    const s = setup();
    t.after(() => s.fx.cleanup());
    const r = s.rig(["pin", "set", "core"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /^rig pin set: E_PIN_UNCHECKED core has no candidate/);
  });

  test("pin check and pin set of a pack with no lock entry exit 2", (t) => {
    const s = setup();
    t.after(() => s.fx.cleanup());
    const before = readFileSync(join(s.root, "rig.lock.json"));
    for (const sub of ["check", "set"]) {
      const r = s.rig(["pin", sub, "x", ...(sub === "check" ? ["--sha", "0".repeat(40)] : [])]);
      assert.equal(r.code, 2, r.stderr);
      assert.equal(r.stderr, "rig pin: E_USAGE x has no lock entry; rig pack add writes it\n");
    }
    assert.deepEqual(readFileSync(join(s.root, "rig.lock.json")), before);
  });

  test("pin check core --sha exits 2 with E_USAGE and leaves the lock alone", (t) => {
    const s = setup();
    t.after(() => s.fx.cleanup());
    const before = readFileSync(join(s.root, "rig.lock.json"));
    const r = s.rig(["pin", "check", "core", "--sha", "0".repeat(40)]);
    assert.equal(r.code, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /^rig pin: E_USAGE rig pin check core does not take --sha\n$/);
    assert.deepEqual(readFileSync(join(s.root, "rig.lock.json")), before);
  });

  test("bootstrap: pin check core, then pin set core, seals an unsealed root and doctor exits 0", (t) => {
    const s = setup({ sealed: false });
    t.after(() => s.fx.cleanup());
    const c = s.rig(["pin", "check", "core"]);
    assert.equal(c.code, 0, c.stdout + c.stderr);
    assert.match(c.stdout, /^recorded core candidate sha256:[0-9a-f]{64}; run rig pin set core$/m);
    assert.equal(JSON.parse(readFileSync(join(s.root, "rig.lock.json"), "utf8")).core.tree, null);
    assert.equal(s.rig(["doctor"]).code, 1, "a candidate alone is no seal");
    const p = s.rig(["pin", "set", "core"]);
    assert.equal(p.code, 0, p.stderr);
    const d = s.rig(["doctor"]);
    assert.equal(d.code, 0, d.stdout + d.stderr);
  });
});

describe("exit codes", () => {
  test("a schema error in rig.json exits 2 with E_SCHEMA", (t) => {
    const s = setup({ edit: (root) => writeFileSync(join(root, "rig.json"), '{"schema": 1, "bogus": true}\n') });
    t.after(() => s.fx.cleanup());
    for (const cmd of ["doctor", "models", "stats"]) {
      const r = s.rig([cmd]);
      assert.equal(r.code, 2, `${cmd}: ${r.stderr}`);
      assert.match(r.stderr, new RegExp(`^rig ${cmd}: E_SCHEMA `));
    }
  });

  test("a state root outside HOME exits 2 with E_STATE_ROOT", (t) => {
    const s = setup();
    t.after(() => s.fx.cleanup());
    const r = s.rig(["doctor"], { env: { XDG_STATE_HOME: "/" } });
    assert.equal(r.code, 2, r.stderr);
    assert.match(r.stderr, /E_STATE_ROOT/);
  });

  /** @returns {{write: (s: string) => void, text: () => string}} */
  const sink = () => {
    let out = "";
    return { write: (x) => void (out += x), text: () => out };
  };
  const typed = (code, message = "boom") => async () => {
    throw Object.assign(new Error(message), { code });
  };

  test("dispatch: a typed config or usage error exits 2, every other error exits 1, the line names the code", async () => {
    for (const code of EXIT_2) {
      const e = sink();
      assert.equal(await dispatch("x", typed(code), /** @type {any} */ ({}), {}, e), 2, code);
      assert.equal(e.text(), `rig x: ${code} boom\n`);
    }
    for (const code of ["E_PIN_UNCHECKED", "E_GIT", "E_INTERNAL", "E_JSON_ROUNDTRIP"]) {
      assert.equal(await dispatch("x", typed(code), /** @type {any} */ ({}), {}, sink()), 1, code);
    }
    const e = sink();
    assert.equal(await dispatch("x", typed("E_SCHEMA", "E_SCHEMA rig.json: bad"), /** @type {any} */ ({}), {}, e), 2);
    assert.equal(e.text(), "rig x: E_SCHEMA rig.json: bad\n", "a message that names its code is not prefixed twice");
    assert.equal(await dispatch("x", async () => { throw new TypeError("bug"); }, /** @type {any} */ ({}), {}, sink()), 1);
  });

  test("dispatch: a handler that returns anything other than 0, 1 or 2 is E_INTERNAL, exit 1", async () => {
    for (const v of [undefined, null, 3, -1, "0", true]) {
      const e = sink();
      assert.equal(await dispatch("x", async () => v, /** @type {any} */ ({}), {}, e), 1, String(v));
      assert.match(e.text(), /^rig x: E_INTERNAL the handler returned .*, not an exit code\n$/);
    }
    for (const v of [0, 1, 2]) assert.equal(await dispatch("x", async () => v, /** @type {any} */ ({}), {}, sink()), v);
  });
});
