// The synthetic twin of the first seed: a small pstack-shaped upstream built with makeRepo, vendored with a root,
// excludes and a port source, given a mode block, attested, and seeded into fresh HOMEs. The same assertions as
// test/first-seed.test.ts, plus E_FOREIGN_INSTALL and the removal hint of E_ADOPT_MISMATCH.

import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { treeHash } from "../lib/tree.ts";
import { cleanup, makeRepo, MIT_TEXT, scratch } from "./lock.helpers.ts";
import { filesUnder } from "./pstack.helpers.ts";
import { makeFixtureHome } from "./helpers/fixture-home.ts";
import {
  assertAllHidden, assertAnchors, assertByteIdentity, assertLinks, assertModePaths, assertNoExcludedFile, assertOneCraft,
  assertPlanClean, codexListing, json, manifest, rig, ROOT, runId, targetsOf,
} from "./helpers/seed.ts";

const leaf = (name: string, body: string) => `---\nname: ${name}\ndescription: Fixture ${name}.\n---\n\n${body}`;
const UPSTREAM = {
  "pstack/LICENSE": MIT_TEXT,
  "pstack/README.md": "# pstack\n",
  "pstack/docs/harness/claude-code.md": "# pstack in Claude Code\n\nRead `<pstack>/skills/<name>/SKILL.md`.\n",
  "pstack/skills/poteto-mode/SKILL.md": leaf("poteto-mode", "# Hub\n\n- Code crossing a function boundary: the **architect** skill.\n- A failing test: `playbooks/bug-fix.md`.\n- Review threads: `references/bugbot-triage.md`.\n"),
  "pstack/skills/poteto-mode/playbooks/bug-fix.md": "# Bug fix\n\n1. Reproduce the failure.\n2. Triage review threads per `../references/bugbot-triage.md`.\n",
  "pstack/skills/poteto-mode/references/bugbot-triage.md": "# Triage\n\nFix, dismiss or ask.\n",
  "pstack/skills/poteto-mode/scripts/watch.sh": { content: "#!/bin/sh\necho watch\n", mode: 0o755 },
  "pstack/skills/architect/SKILL.md": leaf("architect", "# Architect\n\nScreen candidates per [the red flags](references/red-flags.md).\n"),
  "pstack/skills/architect/references/red-flags.md": "# Red flags\n\nShallow modules.\n",
};
const MODE = {
  adopt: {
    "hub.md": { from: "skills/poteto-mode/SKILL.md" },
    "playbooks/": { from: "skills/poteto-mode/playbooks/" },
    "references/bugbot-triage.md": { from: "skills/poteto-mode/references/bugbot-triage.md" },
  },
  playbooks: { "bug-fix": { domain: "engineering", file: "skills/poteto-mode/playbooks/bug-fix.md" } },
  hooks: {},
  adapter: { claude: "| Cursor | Claude Code |\n| --- | --- |\n| `Task` | `Agent` |\n" },
};
const canon = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;
const s: Record<string, any> = {};

/** A config root with this repo's core, models and targets, a sealed lock with no pack, and a rig.json with no pack. */
function bareConfig() {
  const root = mkdtempSync(join(tmpdir(), "rig-seed-twin-"));
  for (const dir of ["models", "targets", "packs/core"]) cpSync(join(ROOT, dir), join(root, dir), { recursive: true });
  const cfg = { ...json(join(ROOT, "rig.json")), packs: {}, fill: {}, disable: [] };
  writeFileSync(join(root, "rig.json"), canon(cfg));
  writeFileSync(join(root, "rig.lock.json"), canon({ schema: 2, core: { tree: treeHash(filesUnder(join(root, "packs/core")), { core: true }), candidate: null }, packs: {} }));
  return root;
}

before(() => {
  s.base = scratch();
  s.repo = makeRepo(s.base, [UPSTREAM]);
  s.root = bareConfig();
  s.work = makeFixtureHome();
  const home = s.work.home;
  s.add = rig(s.root, home, ["pack", "add", s.repo.url, "--sha", s.repo.shas[0], "--root", "pstack", "--path", ".",
    "--exclude", "README.md", "--exclude", "skills/poteto-mode/scripts", "--port", "docs/harness/claude-code.md"]);
  s.added = json(join(s.root, "rig.lock.json")).packs.pstack;
  const packJson = join(s.root, "packs/pstack/pack.json");
  writeFileSync(packJson, canon({ ...json(packJson), mode: MODE }));
  writeFileSync(join(s.root, "rig.json"), canon({ ...json(join(s.root, "rig.json")), packs: { pstack: {} }, fill: { "eng:design": "pstack/architect" } }));
  s.stale = rig(s.root, home, ["plan"]);
  s.ported = rig(s.root, home, ["pin", "set", "pstack", "--ported"]);
});

after(() => {
  s.work?.cleanup();
  if (s.root) rmSync(s.root, { recursive: true, force: true });
  if (s.base) cleanup(s.base);
});

describe("the synthetic seed", () => {
  test("pack add vendors the root minus its excludes and records the port source as not reviewed", () => {
    assert.equal(s.add.code, 0, s.add.all);
    assert.match(s.add.stdout, /^vendored pstack into packs\/pstack\/ of the repo root, tree sha256:[0-9a-f]{64}\nkept 7 files, excluded \d+ bytes$/m);
    const entry = s.added;
    assert.deepEqual([entry.root, entry.paths, entry.exclude], ["pstack", ["."], ["README.md", "skills/poteto-mode/scripts"]]);
    assert.deepEqual([entry.port.paths, entry.port.reviewed_sha, entry.port.reviewed_tree], [["docs/harness/claude-code.md"], null, null]);
    assertNoExcludedFile(s.root);
  });

  test("the plan blocks with E_PORT_STALE until pin set --ported", () => {
    assert.equal(s.stale.code, 1, s.stale.all);
    assert.match(s.stale.stdout, /^block pin pstack\/\.: E_PORT_STALE pstack: /m);
    assert.equal(s.ported.code, 0, s.ported.all);
    assert.equal(json(join(s.root, "rig.lock.json")).packs.pstack.port.reviewed_sha, s.repo.shas[0]);
  });

  test("plan, apply, a second HOME and undo: the same manifest twice, and undo restores the empty HOME", () => {
    const [h1, h2] = [makeFixtureHome(), makeFixtureHome()];
    try {
      const empty = manifest(h1.home);
      assertPlanClean(rig(s.root, h1.home, ["plan"]));
      const a = rig(s.root, h1.home, ["apply"]);
      assert.equal(a.code, 0, a.all);
      assert.match(rig(s.root, h1.home, ["plan"]).stdout, /^0 changes, 0 blocks$/m);
      assert.equal(rig(s.root, h2.home, ["apply"]).code, 0);
      const m1 = manifest(h1.home);
      assert.deepEqual(m1, manifest(h2.home));
      assert.ok(m1.some((l) => l.startsWith(".claude/skills/craft/hub.md\t")));
      const t = targetsOf(s.root);
      assertOneCraft(h1.home, t);
      assert.ok(assertAllHidden(h1.home, t) >= 8);
      assert.ok(assertByteIdentity(h1.home, s.root, t, "pstack") >= 2);
      assert.ok(assertLinks(h1.home, t) >= 2);
      assert.ok(assertAnchors(h1.home, t) >= 4);
      assert.ok(assertModePaths(h1.home, t) >= 3);
      assert.deepEqual(codexListing(h1.home, t).listed, []);
      assert.equal(rig(s.root, h1.home, ["apply", "--undo", runId(a.stdout)]).code, 0);
      assert.deepEqual(manifest(h1.home), empty);
    } finally {
      h1.cleanup();
      h2.cleanup();
    }
  });
});

describe("a harness install of a seeded upstream", () => {
  const plugins = (ids: string[]) => canon({ version: 2, plugins: Object.fromEntries(ids.map((id) => [id, [{ scope: "user", installPath: `/x/${id}`, version: "1.0.0" }]])) });

  test("a Claude Code plugin record of pstack: rig plan prints E_FOREIGN_INSTALL pstack and exits 1, and apply keeps the record", () => {
    const h = makeFixtureHome({ ".claude/plugins/installed_plugins.json": plugins(["pstack@cursor-plugins", "warp@claude-code-warp"]) });
    try {
      const before = readFileSync(h.path(".claude/plugins/installed_plugins.json"));
      const p = rig(s.root, h.home, ["plan"]);
      assert.equal(p.code, 1, p.all);
      assert.match(p.stdout, /^block pin \*\/harness:claude: E_FOREIGN_INSTALL pstack: Claude Code has the plugin pstack@cursor-plugins installed \(scope user\), and pack pstack seeds the same upstream; rig never deletes what it does not own, so run claude plugin uninstall pstack@cursor-plugins --scope user$/m);
      assert.doesNotMatch(p.stdout, /warp/);
      assert.doesNotMatch(p.stdout, /"id"/, "a pin finding has no ack stanza");
      assert.equal(rig(s.root, h.home, ["apply"]).code, 1);
      assert.deepEqual(readFileSync(h.path(".claude/plugins/installed_plugins.json")), before);
    } finally {
      h.cleanup();
    }
  });

  test("a Cursor plugin folder of pstack blocks and names the folder", () => {
    const h = makeFixtureHome({ ".cursor/plugins/local/pstack/plugin.json": "{}\n", ".cursor/plugins/cache/cursor-public/slack/x/plugin.json": "{}\n" });
    try {
      const p = rig(s.root, h.home, ["plan"]);
      assert.equal(p.code, 1, p.all);
      assert.match(p.stdout, /^block pin \*\/harness:cursor: E_FOREIGN_INSTALL pstack: Cursor has the plugin pstack in ~\/\.cursor\/plugins\/local\/pstack, .*delete ~\/\.cursor\/plugins\/local\/pstack by hand/m);
      assert.doesNotMatch(p.stdout, /slack/);
    } finally {
      h.cleanup();
    }
  });

  test("an unmanaged folder with a seeded skill name gives E_ADOPT_MISMATCH with the removal hint", () => {
    const h = makeFixtureHome({ ".agents/skills/architect/SKILL.md": leaf("architect", "Mine.\n") });
    try {
      const p = rig(s.root, h.home, ["plan"]);
      assert.equal(p.code, 1, p.all);
      assert.match(p.stdout, /E_ADOPT_MISMATCH ~\/\.agents\/skills\/architect\/SKILL\.md exists and is not managed: bytes differ; rig never deletes what it does not own, so move or delete it by hand/);
    } finally {
      h.cleanup();
    }
  });
});
