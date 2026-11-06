// The first seed over the committed config of this repo, offline: assertions A1 to A17 of
// docs/design/rig-v1-first-seed.md. Each run copies the config and seeds empty HOMEs with bin/rig.ts.

import assert from "node:assert/strict";
import { appendFileSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import {
  assertAllHidden, assertAnchors, assertByteIdentity, assertLinks, assertModePaths, assertNoExcludedFile, assertOneCraft,
  assertPlanClean, codexListing, configCopy, json, manifest, rig, ROOT, runId, targetsOf,
} from "./helpers/seed.ts";
import { makeFixtureHome } from "./helpers/fixture-home.ts";

const GOLDEN = join(ROOT, "test/golden/first-seed.manifest");
/** A11: the warns of the first green run. Both are reference chains inside upstream pstack skills. */
const WARNS = [
  "warn budget pstack/skills/ketchup-video/SKILL.md: reference chain skills/ketchup-video/SKILL.md -> skills/ketchup/SKILL.md -> skills/bro/SKILL.md is 2 levels deep; keep references one level from SKILL.md",
  "warn budget pstack/skills/principle-attack-the-premise/SKILL.md: reference chain skills/principle-attack-the-premise/SKILL.md -> skills/principle-build-the-lever/SKILL.md -> skills/principle-laziness-protocol/SKILL.md is 2 levels deep; keep references one level from SKILL.md",
];
/** A13: kept pstack files that name an excluded script, skill or path. */
const DEGRADED = [
  "agents/poteto-agent.md",
  "skills/figure-it-out/SKILL.md",
  "skills/maintain-formal-verification-skill/SKILL.md",
  "skills/poteto-mode/playbooks/babysit.md",
  "skills/poteto-mode/playbooks/multi-phase-plan.md",
  "skills/poteto-mode/playbooks/shipping.md",
  "skills/poteto-mode/playbooks/worktree-cleanup.md",
  "skills/show-me-your-work/SKILL.md",
];
const A13_GREP = /(^|[^n])scripts\/|create-formal-verification-skill|Principles section of the \*\*poteto-mode\*\*|skills\/poteto-mode\/SKILL\.md/m;

const run: Record<string, any> = {};

before(() => {
  run.root = configCopy(ROOT);
  run.h1 = makeFixtureHome();
  run.h2 = makeFixtureHome();
  const h1 = run.h1.home;
  run.plan1 = rig(run.root, h1, ["plan"]);
  run.empty = manifest(h1);
  run.apply1 = rig(run.root, h1, ["apply"]);
  run.plan2 = rig(run.root, h1, ["plan"]);
  run.m1 = manifest(h1);
  run.apply2 = rig(run.root, run.h2.home, ["apply"]);
  run.m2 = manifest(run.h2.home);
});

after(() => {
  run.h1?.cleanup();
  run.h2?.cleanup();
  if (run.root) rmSync(run.root, { recursive: true, force: true });
});

describe("the first seed over the committed config", () => {
  test("A1: rig plan on a fresh HOME exits 0 with 0 blocks and no links or pin finding", () => assertPlanClean(run.plan1));

  test("A2, A3: rig apply prints a run id, and the next plan has 0 changes", () => {
    assert.equal(run.apply1.code, 0, run.apply1.all);
    runId(run.apply1.stdout);
    assert.equal(run.plan2.code, 0, run.plan2.all);
    assert.match(run.plan2.stdout, /^0 changes, 0 blocks$/m);
  });

  test("A4: two fresh HOMEs get the same manifest, and it equals test/golden/first-seed.manifest", () => {
    assert.equal(run.apply2.code, 0, run.apply2.all);
    assert.deepEqual(run.m1, run.m2);
    const golden = readFileSync(GOLDEN, "utf8").split("\n").filter(Boolean);
    assert.deepEqual(run.m1, golden, "a pin move changes the seeded bytes: review the diff, then write manifest(HOME) of a fresh apply to the golden file");
  });

  test("omp AGENTS.md is a managed block: user text below it survives plan and apply with 0 changes and no E_DRIFT", () => {
    const h = makeFixtureHome();
    try {
      const a = rig(run.root, h.home, ["apply"]);
      assert.equal(a.code, 0, a.all);
      const f = join(h.home, ".omp/agent/AGENTS.md");
      const mine = "\n# My own rules\nKeep this line.\n";
      appendFileSync(f, mine);
      const p = rig(run.root, h.home, ["plan"]);
      assert.equal(p.code, 0, p.all);
      assert.match(p.stdout, /^0 changes, 0 blocks$/m);
      assert.doesNotMatch(p.all, /E_DRIFT/);
      const b = rig(run.root, h.home, ["apply"]);
      assert.equal(b.code, 0, b.all);
      assert.ok(readFileSync(f, "utf8").endsWith(mine));
      // editing inside the block is drift
      writeFileSync(f, readFileSync(f, "utf8").replace("<!-- rig:frame:start -->\n", "<!-- rig:frame:start -->\nEDIT\n"));
      const d = rig(run.root, h.home, ["plan"]);
      assert.match(d.all, /E_DRIFT/);
    } finally {
      h.cleanup();
    }
  });

  test("A5: rig apply --undo of the run restores the manifest from before the apply", () => {
    const h = makeFixtureHome();
    try {
      const a = rig(run.root, h.home, ["apply"]);
      assert.equal(a.code, 0, a.all);
      const u = rig(run.root, h.home, ["apply", "--undo", runId(a.stdout)]);
      assert.equal(u.code, 0, u.all);
      assert.deepEqual(manifest(h.home), run.empty);
    } finally {
      h.cleanup();
    }
  });

  test("A6: each harness reads exactly one craft, hidden, next to an adapter section for it", () => assertOneCraft(run.h1.home, targetsOf(run.root)));

  test("A7: with auto empty, every skill in every read-set carries the harness hide switch", () => {
    assert.deepEqual(json(join(run.root, "rig.json")).auto, []);
    assert.ok(assertAllHidden(run.h1.home, targetsOf(run.root)) > 100);
  });

  test("A8: the hub, the playbooks and bugbot-triage.md are byte-identical; leaf copies differ only by hide keys and the anchor", () => {
    assert.ok(assertByteIdentity(run.h1.home, run.root, targetsOf(run.root), "pstack") > 100);
  });

  test("the poteto-agent copies on Codex and Cursor name the rig hub, which exists in the seeded HOME", () => {
    const upstream = readFileSync(join(run.root, "packs/pstack/agents/poteto-agent.md"), "utf8");
    const body = upstream.slice(upstream.indexOf("\n---\n", 4) + 5);
    assert.match(body, /skills\/poteto-mode\/SKILL\.md/, "the upstream fallback that rig points away from");
    for (const [rel, expected] of [
      [".codex/agents/poteto-agent.toml", "~/.agents/skills/craft/hub.md"],
      [".cursor/agents/poteto-agent.md", "~/.agents/skills/craft/hub.md"],
    ]) {
      const text = readFileSync(join(run.h1.home, rel), "utf8");
      const named = [...text.matchAll(/`(~\/[^`\s]*craft\/hub\.md)`/g)].map((m) => m[1]);
      assert.deepEqual(named, [expected], rel);
      assert.ok(existsSync(join(run.h1.home, named[0].slice(2))), `${rel} names ${named[0]}, which is absent from the HOME`);
      assert.ok(text.includes(body.trimEnd()), `${rel} keeps the upstream body`);
    }
    assert.equal(readFileSync(join(run.h1.home, ".claude/agents/poteto-agent.md"), "utf8"), upstream, "the Claude copy stays the upstream bytes");
  });

  test("A9: every relative Markdown link of a seeded skill dir resolves inside that dir", () => {
    assert.ok(assertLinks(run.h1.home, targetsOf(run.root)) > 100);
  });

  test("A10: the Codex listing holds no skill and stays under 8,000 characters", () => {
    const l = codexListing(run.h1.home, targetsOf(run.root));
    assert.deepEqual(l.listed, []);
    assert.ok(l.chars < 8000);
  });

  test("the guide quotes the change count of a fresh HOME that plan and apply print", () => {
    const n = /^(\d+) changes, 0 blocks$/m.exec(run.plan1.stdout)?.[1];
    assert.ok(n, run.plan1.stdout);
    assert.match(run.apply1.stdout, new RegExp(`^run \\S+: ${n} ops applied$`, "m"));
    const guide = (f: string) => readFileSync(join(ROOT, "docs/guide", f), "utf8");
    assert.deepEqual(guide("02-plan-and-apply.md").match(/^[1-9]\d* changes, 0 blocks$|^run \S+: \d+ ops applied$/gm)?.map((l) => /(\d+) (changes|ops)/.exec(l)![1]), [n, n, n]);
    assert.deepEqual(guide("01-setup.md").match(/drift (\d+) changes pending/g), [`drift ${n} changes pending`]);
  });

  test("A11: the warns equal the committed list", () => {
    assert.deepEqual(run.plan1.stdout.split("\n").filter((l: string) => l.startsWith("warn ")), WARNS);
  });

  test("A12: the shell names the domain files and the precedence rule; the domain files name the fills, the hook, bug-fix and brief", () => {
    const skills = join(run.h1.home, ".claude/skills/craft");
    const shell = readFileSync(join(skills, "SKILL.md"), "utf8");
    for (const d of ["business", "product", "engineering", "upkeep"]) assert.match(shell, new RegExp(`\\[${d}\\]\\(references/${d}\\.md\\)`));
    assert.match(shell, /A step of the domain file can have a `Replaces the hub trigger:` line or a `Replaces the frame trigger:` line\. Run that step in place of the line it quotes, inside `\/craft`\./);
    const eng = readFileSync(join(skills, "references/engineering.md"), "utf8");
    assert.match(eng, /^- `eng:ground`\. Before: none\. Slot: \[how\]\(\.\.\/\.\.\/how\/SKILL\.md\)\. After: none\.$/m);
    assert.match(eng, /^- `eng:design`\. Before: none\. Slot: \[architect\]\(\.\.\/\.\.\/architect\/SKILL\.md\)\. After: none\.$/m);
    assert.match(eng, /^- `eng:review`\. Before: \[no-comments\]\(\.\.\/\.\.\/no-comments\/SKILL\.md\)\. Slot: none\. After: none\.$/m);
    assert.match(eng, /^- `eng:ship`\. Before: \[deslop\]\(\.\.\/\.\.\/deslop\/SKILL\.md\)\. Slot: none\. After: none\.$/m);
    assert.match(eng, /^- When Building or changing a CLI: Use \[cli-for-agents\]\(\.\.\/\.\.\/cli-for-agents\/SKILL\.md\)\.$/m);
    assert.deepEqual([...eng.matchAll(/^- `(eng:[a-z]+)`\..*\n(?:  Replaces the hub trigger: .*\n)?  Replaces the frame trigger: "(.*)"$/gm)].map((m) => [m[1], m[2]]), [["eng:review", "Before review"], ["eng:ship", "Before commit"]]);
    const frame = readFileSync(join(run.h1.home, ".claude/rules/rig-frame.md"), "utf8");
    for (const [unit, when] of [["no-comments", "Before review"], ["deslop", "Before commit"]]) {
      assert.equal(frame.split("\n").filter((l) => l.includes(`/${unit}/SKILL.md`)).length, 1, `the frame names ${unit} once`);
      assert.ok(frame.includes(`${when}: read ~/.claude/skills/${unit}/SKILL.md and apply it.`), unit);
    }
    const hubLines = readFileSync(join(skills, "hub.md"), "utf8").split("\n");
    const quoted = [...eng.matchAll(/^- `(eng:[a-z]+)`\..*\n  Replaces the hub trigger: "(.*)"$/gm)].map((m) => [m[1], hubLines.indexOf(`- ${m[2]}`) + 1]);
    assert.deepEqual(quoted, [["eng:ground", 20], ["eng:design", 23], ["eng:review", 30], ["eng:ship", 29]]);
    assert.match(eng, /^- \[bug-fix\]\(\.\.\/playbooks\/bug-fix\.md\)\. Pack `pstack`\.$/m);
    const prod = readFileSync(join(skills, "references/product.md"), "utf8");
    assert.match(prod, /^- `prod:discover`\. Before: none\. Slot: \[office-hours\]\(\.\.\/\.\.\/office-hours\/SKILL\.md\)\. After: none\.$/m);
    assert.match(prod, /^- `brief` writes `docs\/designs\/<slug>\.md` at `prod:discover`\./m);
  });

  test("A13: the degraded files are exactly the 8 that the design lists", () => {
    const pack = join(run.root, "packs/pstack");
    const files = (dir: string, rel = ""): string[] => readdirSync(join(dir, rel), { withFileTypes: true })
      .flatMap((e) => (e.isDirectory() ? files(dir, `${rel}${e.name}/`) : [`${rel}${e.name}`]));
    const hits = files(pack).filter((f) => f !== "pack.json" && A13_GREP.test(readFileSync(join(pack, f), "utf8"))).sort();
    assert.deepEqual(hits, DEGRADED);
  });

  test("A14: no pack file sits under a locked exclude", () => assertNoExcludedFile(run.root));

  test("A15: rig plan gives no E_MODE_NAME finding, and the config holds no ack", () => {
    assert.doesNotMatch(run.plan1.stdout, /E_MODE_NAME/);
    assert.ok(!existsSync(join(run.root, "audit.allow.json")) || json(join(run.root, "audit.allow.json")).acks.length === 0);
  });

  test("A15b: disabling pstack/architect in the overlay leaves 0 blocks, and the hub and playbook names are info lines", () => {
    const h = makeFixtureHome({ ".config/rig/rig.json": JSON.stringify({ schema: 2, disable: ["pstack/architect"] }) });
    try {
      const p = rig(run.root, h.home, ["plan"]);
      assertPlanClean(p);
      assert.doesNotMatch(p.stdout, /E_MODE_NAME/);
      assert.match(p.stdout, /^info mode pstack\/skills\/poteto-mode\/SKILL\.md: architect at line \d+: pstack\/architect is disabled by rig\.json disable/m);
      assert.match(p.stdout, /^info mode pstack\/skills\/poteto-mode\/playbooks\/refactoring\.md: architect at line \d+: pstack\/architect is disabled/m);
      assert.match(p.stdout, /^info rig\.json fill\.eng:design names pstack\/architect, which disable or replaces removes; the domain file has no entry for it$/m);
    } finally {
      h.cleanup();
    }
  });

  test("A16: each leaf anchor reaches an adapter section for every harness that reads the leaf", () => {
    assert.ok(assertAnchors(run.h1.home, targetsOf(run.root)) > 100);
  });

  test("A17: the playbook and reference paths of the hub and the playbooks resolve in each skill dir", () => {
    assert.ok(assertModePaths(run.h1.home, targetsOf(run.root)) > 20);
  });
});
