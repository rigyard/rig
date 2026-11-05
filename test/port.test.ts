// Port records: adopt form, pin check and pin set on packs, --diff, --exclude at a pin move, --ported, and the
// E_PORT_STALE block in rig plan. Upstreams are synthetic file:// repos; nothing reaches the network.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { writeConfig } from "../lib/fs.ts";
import { pinCheck, pinSet, vendor } from "../lib/lock.ts";
import { treeHash } from "../lib/tree.ts";
import { makeFixtureHome } from "./helpers/fixture-home.ts";
import { makeStubs } from "./helpers/stubs.ts";
import { cleanup, makeRepo, makeWorld, MIT_TEXT, scratch } from "./lock.helpers.ts";
import { filesUnder, json, repoJson, ROOT } from "./pstack.helpers.ts";

const BIN = join(ROOT, "bin/rig.ts");
const lockOf = (root: string) => JSON.parse(readFileSync(join(root, "rig.lock.json"), "utf8"));
const skill = (name: string, body: string) => `---\nname: ${name}\ndescription: ${name} skill.\n---\n${body}\n`;
const HUB_V1 = skill("hub", "Route the work.");

/** Upstream history: c1 the base, c2 changes only a non-port file, c3 changes the port source. */
const HISTORY = [
  { LICENSE: MIT_TEXT, "hub/SKILL.md": HUB_V1, "lib/notes.md": "notes v1\n" },
  { "lib/notes.md": "notes v2\n" },
  { "hub/SKILL.md": skill("hub", "Route the work, then verify it.") },
];

/** A config root from this repo's data, with an authored pack `fixture` that rig.json enables. */
function cli(t: {after: (fn: () => void) => void}, extraEnv: Record<string, string> = {}) {
  const spec: Record<string, Uint8Array | string | {content: Uint8Array, mode: number}> = {};
  const cfg = repoJson("rig.json");
  for (const dir of ["models", "targets", "packs/core", ...Object.keys(cfg.packs).map((n) => `packs/${n}`)]) {
    for (const f of filesUnder(join(ROOT, dir))) spec[`rig/${dir}/${f.path}`] = { content: f.bytes, mode: f.mode };
  }
  spec["rig/rig.json"] = json({ ...cfg, packs: { ...cfg.packs, fixture: {} } });
  spec["rig/packs/fixture/pack.json"] = json({ schema: 2, name: "fixture", scopes: ["machine-hidden"], license: "MIT", units: {} });
  spec["rig/packs/fixture/skills/fixture/SKILL.md"] = skill("fixture", "The rig port of hub.");
  const fx = makeFixtureHome(spec);
  const base = scratch();
  t.after(() => {
    fx.cleanup();
    cleanup(base);
  });
  const root = fx.path("rig");
  const core = { tree: treeHash(filesUnder(join(root, "packs/core")), { core: true }), candidate: null };
  writeFileSync(join(root, "rig.lock.json"), json({ schema: 2, core, packs: {} }));
  const env = { PATH: process.env.PATH, HOME: fx.home, RIG_ROOT: root, RIG_NOW: "2026-11-05T12:00:00.000Z" };
  const rig = (...args: string[]) => {
    const r = spawnSync(process.execPath, [BIN, ...args], { env: { ...env, ...extraEnv }, cwd: fx.home, encoding: "utf8" });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr, all: r.stdout + r.stderr };
  };
  return { root, rig, repo: makeRepo(base, HISTORY) };
}

test("adopt form: --port without --path locks the authored folder and the port tree, writes only the lock, and is a no-op twice", async (t) => {
  const base = scratch();
  t.after(() => cleanup(base));
  const repo = makeRepo(base, HISTORY);
  const world = makeWorld(base);
  const args = { repo: repo.url, sha: repo.shas[0], name: "fixture", port: ["hub/SKILL.md"] };
  await assert.rejects(vendor(world, args), { code: "E_USAGE", message: /packs\/fixture\/pack\.json is absent/ });
  world.writeConfig(world.roots.repo, "packs/fixture/pack.json", Buffer.from(json({ schema: 2, name: "fixture", license: "MIT", units: {} })));
  world.writeConfig(world.roots.repo, "packs/fixture/skills/fixture/SKILL.md", Buffer.from(skill("fixture", "Port.")));
  await assert.rejects(vendor(world, { ...args, exclude: ["x"] }), { code: "E_USAGE", message: /--exclude needs --path/ });
  await assert.rejects(vendor(world, { ...args, port: ["nope.md"] }), { code: "E_PATH_MISSING" });
  const before = world.calls.length;

  const v = await vendor(world, args);
  assert.equal(v.adopted, true);
  assert.deepEqual(world.calls.slice(before).map((c) => c.rel), ["rig.lock.json"], "nothing vendored");
  const entry = lockOf(world.roots.repo).packs.fixture;
  assert.deepEqual(Object.keys(entry), ["repo", "sha", "root", "paths", "exclude", "license", "tree", "port", "candidate"]);
  assert.deepEqual({ paths: entry.paths, exclude: entry.exclude, license: entry.license, candidate: entry.candidate }, { paths: [], exclude: [], license: "MIT", candidate: null });
  assert.equal(entry.tree, treeHash(filesUnder(join(world.roots.repo, "packs/fixture"))));
  assert.deepEqual(entry.port, {
    paths: ["hub/SKILL.md"],
    tree: treeHash([{ path: "hub/SKILL.md", mode: 0o644, bytes: Buffer.from(HUB_V1) }]),
    reviewed_sha: null,
    reviewed_tree: null,
  });

  const writes = world.calls.length;
  assert.equal((await vendor(world, args)).noop, true);
  assert.equal(world.calls.length, writes, "the re-run writes nothing");
  await assert.rejects(vendor(world, { ...args, sha: repo.shas[1] }), { code: "E_PACK_EXISTS" });
});

test("rig: a pin move with unchanged port sources stays green with no attest", (t) => {
  const { root, rig, repo } = cli(t);
  const add = rig("pack", "add", repo.url, "--sha", repo.shas[0], "--name", "fixture", "--port", "hub/SKILL.md");
  assert.equal(add.code, 0, add.all);
  assert.match(add.stdout, /^adopted fixture in packs\/fixture\/ of the repo root, tree sha256:[0-9a-f]{64}\nkept 1 files\nport not reviewed: hub\/SKILL\.md; rig plan blocks until rig pin set fixture --ported$/m);
  const fresh = rig("plan");
  assert.equal(fresh.code, 1, "a new port is stale");
  assert.match(fresh.stdout, /^block pin fixture\/\.: E_PORT_STALE fixture: /m);

  assert.equal(rig("pin", "set", "fixture", "--ported").code, 0);
  const check = rig("pin", "check", "fixture", "--sha", repo.shas[1]);
  assert.equal(check.code, 0, check.all);
  assert.match(check.stdout, new RegExp(`^recorded fixture candidate sha256:[0-9a-f]{64} at ${repo.shas[1]}; run rig pin set fixture\\n0 files changed\\nport fresh: hub/SKILL\\.md$`, "m"));
  assert.equal(lockOf(root).packs.fixture.candidate.sha, repo.shas[1]);
  const set = rig("pin", "set", "fixture");
  assert.equal(set.code, 0, set.all);
  assert.equal(set.stdout, `promoted the fixture candidate to current at ${repo.shas[1]}\n`);
  const plan = rig("plan");
  assert.equal(plan.code, 0, plan.all);
  assert.match(plan.stdout, / 0 blocks$/m);
  const entry = lockOf(root).packs.fixture;
  assert.deepEqual([entry.sha, entry.port.reviewed_sha, entry.candidate], [repo.shas[1], repo.shas[0], null], "the attest stays on the reviewed commit");
});

test("rig: a changed port source blocks rig plan with E_PORT_STALE until pin set --ported, which is not ackable, idempotent and offline", (t) => {
  const stubs = makeStubs(["git"]);
  t.after(() => stubs.cleanup());
  const { root, rig, repo } = cli(t, stubs.env);
  const fetched = (from: number) => stubs.log().slice(from).filter((c) => c.name === "git" && c.argv[0] === "fetch").map((c) => c.argv.at(-1));
  assert.equal(rig("pack", "add", repo.url, "--sha", repo.shas[0], "--name", "fixture", "--port", "hub/SKILL.md").code, 0);
  assert.equal(rig("pin", "set", "fixture", "--ported").stdout, `attested the fixture port at ${repo.shas[0]}\n`);
  const beforeCheck = stubs.log().length;
  const check = rig("pin", "check", "fixture", "--sha", repo.shas[2]);
  assert.equal(check.code, 0, check.all);
  assert.match(check.stdout, /^port stale: hub\/SKILL\.md$/m);
  assert.deepEqual(fetched(beforeCheck), [repo.shas[2]], "without --diff pin check fetches only the candidate, not the reviewed commit");
  const set = rig("pin", "set", "fixture");
  assert.equal(set.stdout, `promoted the fixture candidate to current at ${repo.shas[2]}\nport stale: run /rig-port fixture, then rig pin set fixture --ported\n`);

  const stale = rig("plan");
  assert.equal(stale.code, 1, stale.all);
  assert.match(stale.stdout, /^block pin fixture\/\.: E_PORT_STALE fixture: port sources sha256:[0-9a-f]{12}\.\.\. are not reviewed \(reviewed sha256:[0-9a-f]{12}\.\.\.\); re-port, then rig pin set fixture --ported$/m);
  assert.doesNotMatch(stale.stdout, /^ {2}ack: .*"check":"pin"/m, "the pin check prints no ack stanza");

  const lockBeforeDiff = readFileSync(join(root, "rig.lock.json"));
  const beforeDiff = stubs.log().length;
  const review = rig("pin", "check", "fixture", "--diff");
  assert.equal(review.code, 0, review.all);
  assert.match(review.stdout, new RegExp(`^checked fixture candidate sha256:[0-9a-f]{64} at ${repo.shas[2]}; --diff records nothing$`, "m"));
  assert.deepEqual(fetched(beforeDiff), [repo.shas[2], repo.shas[0]], "--diff also fetches the reviewed commit");
  assert.deepEqual(readFileSync(join(root, "rig.lock.json")), lockBeforeDiff, "--diff writes no lock byte");

  const gitCalls = stubs.log().filter((c) => c.name === "git").length;
  assert.ok(gitCalls > 0, "pin check reached git through the stub");
  const attest = rig("pin", "set", "fixture", "--ported");
  assert.equal(attest.stdout, `attested the fixture port at ${repo.shas[2]}\n`);
  assert.equal(stubs.log().filter((c) => c.name === "git").length, gitCalls, "pin set --ported spawns no git");
  const green = rig("plan");
  assert.equal(green.code, 0, green.all);
  assert.match(green.stdout, / 0 blocks$/m);
  assert.equal(lockOf(root).packs.fixture.candidate, null, "the lock after the rig-port flow (pin check --diff, then --ported) has no candidate");

  const lockBytes = readFileSync(join(root, "rig.lock.json"));
  const again = rig("pin", "set", "fixture", "--ported");
  assert.equal(again.code, 0, again.all);
  assert.equal(again.stdout, `the fixture port is already attested at ${repo.shas[2]}\n`);
  const plain = rig("pin", "set", "fixture");
  assert.equal(plain.code, 1, "no candidate is left to promote");
  assert.match(plain.stderr, /^rig pin set: E_PIN_UNCHECKED fixture has no candidate/);
  assert.deepEqual(readFileSync(join(root, "rig.lock.json")), lockBytes, "neither second pin set writes a byte");
});

test("rig: pin check --diff prints a unified diff of the port paths from the reviewed commit, or every port file before the first attest", (t) => {
  const { root, rig, repo } = cli(t);
  assert.equal(rig("pack", "add", repo.url, "--sha", repo.shas[0], "--name", "fixture", "--port", "hub/SKILL.md").code, 0);
  const first = rig("pin", "check", "fixture", "--diff");
  assert.equal(first.code, 0, first.all);
  assert.match(first.stdout, /^port stale: hub\/SKILL\.md$/m);
  assert.match(first.stdout, /^no reviewed commit: the whole port is unreviewed; the diff shows each port file in full\ndiff --git a\/hub\/SKILL\.md b\/hub\/SKILL\.md\nnew file mode 100644\n.*\n--- \/dev\/null\n\+\+\+ b\/hub\/SKILL\.md\n@@ .* @@\n(?:\+.*\n)*\+Route the work\.$/m);
  assert.doesNotMatch(first.stdout, /no port change/);

  assert.equal(rig("pin", "set", "fixture", "--ported").code, 0);
  const lockBytes = readFileSync(join(root, "rig.lock.json"));
  const d = rig("pin", "check", "fixture", "--sha", repo.shas[2], "--diff");
  assert.equal(d.code, 0, d.all);
  assert.match(d.stdout, /^--- a\/hub\/SKILL\.md\n\+\+\+ b\/hub\/SKILL\.md\n@@ .* @@\n(?: .*\n)*-Route the work\.\n\+Route the work, then verify it\.$/m);
  assert.doesNotMatch(d.stdout, /notes|no reviewed commit/, "only port paths are diffed");
  assert.deepEqual(readFileSync(join(root, "rig.lock.json")), lockBytes, "--diff records no candidate");

  assert.equal(rig("pin", "check", "fixture", "--sha", repo.shas[2]).code, 0);
  assert.equal(rig("pin", "set", "fixture").code, 0);
  const after = rig("pin", "check", "fixture", "--diff");
  assert.match(after.stdout, /^\+Route the work, then verify it\.$/m, "after the pin move the diff still starts at the reviewed commit");
  const same = rig("pin", "check", "fixture", "--sha", repo.shas[1], "--diff");
  assert.match(same.stdout, /^port fresh: hub\/SKILL\.md\n0 findings, 0 blocks\nno port change$/m);
});

const KIT = [
  { LICENSE: MIT_TEXT, "kit/SKILL.md": skill("kit", "Kit v1."), "kit/hub.md": "hub v1\n", "kit/old.md": "old\n" },
  { "kit/SKILL.md": skill("kit", "Kit v2."), "kit/hub.md": "hub v2\n", "kit/old.md": null, "kit/scripts/run.sh": { content: "#!/bin/sh\n", mode: 0o755 } },
];

test("a vendored pack with a port: pin check records its exclude list, pin set applies it, rewrites files, deletes removed ones and keeps pack.json", async (t) => {
  const base = scratch();
  t.after(() => cleanup(base));
  const repo = makeRepo(base, KIT);
  const world = makeWorld(base, { now: new Date("2026-11-05T00:00:00Z") });
  const root = world.roots.repo;
  await vendor(world, { repo: repo.url, sha: repo.shas[0], root: "kit", paths: ["."], exclude: ["hub.md"], port: ["hub.md"] });
  assert.deepEqual(filesUnder(join(root, "packs/kit")).map((f) => f.path).sort(), ["SKILL.md", "old.md", "pack.json"]);
  await pinSet(world, "kit", { ported: true });
  const manifest = readFileSync(join(root, "packs/kit/pack.json"));

  const lockBytes = readFileSync(join(root, "rig.lock.json"));
  const d = await pinCheck(world, "kit", repo.shas[1], { diff: true });
  assert.match(d.diff ?? "", /^--- a\/hub\.md\n\+\+\+ b\/hub\.md\n@@ -1 \+1 @@\n-hub v1\n\+hub v2\n$/m, "diff paths are relative to the pack root");
  assert.deepEqual(readFileSync(join(root, "rig.lock.json")), lockBytes, "--diff records nothing");

  const c = await pinCheck(world, "kit", repo.shas[1], { exclude: ["scripts", "hub.md"] });
  assert.deepEqual(c.port, { paths: ["hub.md"], stale: true, reviewed_sha: repo.shas[0] });
  assert.equal(c.changed, 2, "SKILL.md modified and old.md removed");
  assert.deepEqual(c.files.map((f) => f.path), ["SKILL.md"]);
  const candidate = { sha: repo.shas[1], exclude: ["hub.md", "scripts"], tree: treeHash(c.files), port_tree: c.candidate.port_tree, checked: "2026-11-05" };
  assert.deepEqual(lockOf(root).packs.kit.candidate, candidate);

  const checked = readFileSync(join(root, "rig.lock.json"));
  const tampered = lockOf(root);
  tampered.packs.kit.candidate.exclude = ["hub.md"];
  writeFileSync(join(root, "rig.lock.json"), json(tampered));
  const wrong = await pinSet(world, "kit");
  assert.equal(wrong.error?.code, "E_PIN_UNCHECKED", "another exclude list gives another tree than the candidate");
  assert.match(wrong.error?.message ?? "", /run rig pin check kit again/);
  assert.ok(existsSync(join(root, "packs/kit/old.md")), "a refused pin set writes nothing");
  writeFileSync(join(root, "rig.lock.json"), checked);

  assert.deepEqual(await pinSet(world, "kit"), { promoted: true, sha: repo.shas[1], port: "stale" });
  assert.deepEqual(filesUnder(join(root, "packs/kit")).map((f) => f.path).sort(), ["SKILL.md", "pack.json"]);
  assert.deepEqual(readFileSync(join(root, "packs/kit/pack.json")), manifest, "pack.json is kept");
  const entry = lockOf(root).packs.kit;
  assert.deepEqual({ sha: entry.sha, exclude: entry.exclude, tree: entry.tree, port_tree: entry.port.tree, candidate: entry.candidate },
    { sha: repo.shas[1], exclude: ["hub.md", "scripts"], tree: c.candidate.tree, port_tree: c.candidate.port_tree, candidate: null });
  assert.notEqual(entry.port.tree, entry.port.reviewed_tree, "the port stays stale until --ported");
});

test("pin check of a vendored pack with a blocked candidate writes nothing, and --diff needs a port record", async (t) => {
  const base = scratch();
  t.after(() => cleanup(base));
  const repo = makeRepo(base, KIT);
  const world = makeWorld(base);
  await vendor(world, { repo: repo.url, sha: repo.shas[0], root: "kit", paths: ["."] });
  const lockBytes = readFileSync(join(world.roots.repo, "rig.lock.json"));
  const seen: string[][] = [];
  const blocked = await pinCheck(world, "kit", repo.shas[1], { gate: (files) => (seen.push(files.map((f) => f.path)), { findings: [{ check: "exec" }], blocked: true }) });
  assert.equal(blocked.blocked, true);
  assert.deepEqual(seen, [["SKILL.md", "hub.md", "scripts/run.sh"].sort()]);
  assert.equal(blocked.port, null);
  assert.deepEqual(readFileSync(join(world.roots.repo, "rig.lock.json")), lockBytes);
  await assert.rejects(pinCheck(world, "kit", repo.shas[1], { diff: true }), { code: "E_USAGE", message: /no port record/ });
  await assert.rejects(pinSet(world, "kit", { ported: true }), { code: "E_USAGE", message: /no port record/ });
  await assert.rejects(pinCheck(world, "kit", "abc"), { code: "E_USAGE", message: /full 40-hex/ });
  const again = await pinCheck(world, "kit", null);
  assert.equal(again.candidate.sha, repo.shas[0], "without --sha the locked commit is checked again");
  assert.equal(again.changed, 0);
});

test("rig: an upstream license change is gated at pin check; a disallowed one leaves lock and pack.json unchanged, an allowed one moves both", (t) => {
  const { root, rig } = cli(t);
  const base = scratch();
  t.after(() => cleanup(base));
  const pkg = (license: string) => JSON.stringify({ name: "lic", license });
  const repo = makeRepo(base, [
    { "package.json": pkg("MIT"), "skills/lic/SKILL.md": skill("lic", "v1.") },
    { "package.json": pkg("GPL-3.0"), "skills/lic/SKILL.md": skill("lic", "v2.") },
    { "package.json": pkg("Apache-2.0") },
  ]);
  const add = rig("pack", "add", repo.url, "--sha", repo.shas[0], "--path", "skills", "--name", "lic");
  assert.equal(add.code, 0, add.all);
  const manifestPath = join(root, "packs/lic/pack.json");
  assert.equal(json(JSON.parse(readFileSync(manifestPath, "utf8"))), readFileSync(manifestPath, "utf8"), "pack add writes canonical JSON");
  assert.equal(JSON.parse(readFileSync(manifestPath, "utf8")).license, "MIT");
  const lockBytes = readFileSync(join(root, "rig.lock.json"));
  const manifestBytes = readFileSync(manifestPath);

  const gpl = rig("pin", "check", "lic", "--sha", repo.shas[1]);
  assert.equal(gpl.code, 1, gpl.all);
  assert.match(gpl.stdout, /^block license lic\/pack\.json: license not allowed: GPL-3\.0$/m);
  assert.deepEqual(readFileSync(join(root, "rig.lock.json")), lockBytes, "a blocked candidate leaves the lock unchanged");
  assert.deepEqual(readFileSync(manifestPath), manifestBytes, "a blocked candidate leaves pack.json unchanged");
  assert.equal(rig("pin", "set", "lic").code, 1, "nothing to promote");

  const apache = rig("pin", "check", "lic", "--sha", repo.shas[2]);
  assert.equal(apache.code, 0, apache.all);
  assert.equal(rig("pin", "set", "lic").code, 0);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.deepEqual(manifest, { ...JSON.parse(manifestBytes.toString("utf8")), license: "Apache-2.0" }, "pin set changes only the license of pack.json");
  assert.equal(json(manifest), readFileSync(manifestPath, "utf8"), "in canonical JSON");
  assert.equal(lockOf(root).packs.lic.license, "Apache-2.0");
});

test("rig: --no-exclude records an empty exclude list, so an excluded folder that upstream deleted needs no hand edit", (t) => {
  const { root, rig } = cli(t);
  const base = scratch();
  t.after(() => cleanup(base));
  const repo = makeRepo(base, [
    { LICENSE: MIT_TEXT, "kit/SKILL.md": skill("kit", "Kit v1."), "kit/docs/notes.md": "notes\n" },
    { "kit/SKILL.md": skill("kit", "Kit v2."), "kit/docs": null },
  ]);
  assert.equal(rig("pack", "add", repo.url, "--sha", repo.shas[0], "--root", "kit", "--path", ".", "--exclude", "docs").code, 0);
  const lockBytes = readFileSync(join(root, "rig.lock.json"));
  const missing = rig("pin", "check", "kit", "--sha", repo.shas[1]);
  assert.equal(missing.code, 1, missing.all);
  assert.match(missing.stderr, /E_PATH_MISSING exclude docs matches no vendored path/);
  const both = rig("pin", "check", "kit", "--sha", repo.shas[1], "--exclude", "docs", "--no-exclude");
  assert.equal(both.code, 2, both.all);
  assert.match(both.stderr, /E_USAGE .*--exclude and --no-exclude do not go together/);
  assert.deepEqual(readFileSync(join(root, "rig.lock.json")), lockBytes);

  const none = rig("pin", "check", "kit", "--sha", repo.shas[1], "--no-exclude");
  assert.equal(none.code, 0, none.all);
  assert.deepEqual(lockOf(root).packs.kit.candidate.exclude, []);
  assert.equal(rig("pin", "set", "kit").code, 0);
  const entry = lockOf(root).packs.kit;
  assert.deepEqual([entry.sha, entry.exclude, entry.candidate], [repo.shas[1], [], null]);
});

const realWorld = (base: string, extra = {}) => {
  const repo = join(base, "config");
  mkdirSync(repo, { recursive: true });
  return { roots: { repo }, now: new Date("2026-11-05T00:00:00Z"), ...extra };
};
const diskPaths = (root: string, name: string) => filesUnder(join(root, "packs", name)).map((f) => f.path).sort();

test("pin set replaces a file with a folder and a folder with a file, and a retry after a failed write converges", async (t) => {
  const base = scratch();
  t.after(() => cleanup(base));
  const repo = makeRepo(base, [
    { LICENSE: MIT_TEXT, "skills/a": "a file\n", "skills/k.md": "k\n" },
    { "skills/a": null, "skills/a/b.md": "now a folder\n" },
    { "skills/a": "a file again\n" },
  ]);
  let failOnce = true;
  const world = realWorld(base, {
    writeConfig: (root: string, rel: string, bytes: Uint8Array | null, mode?: number) => {
      if (failOnce && rel === "packs/p/skills/a/b.md") {
        failOnce = false;
        throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
      }
      return writeConfig(root, rel, bytes, mode);
    },
  });
  const root = world.roots.repo;
  await vendor(world, { repo: repo.url, sha: repo.shas[0], paths: ["skills"], name: "p" });

  await pinCheck(world, "p", repo.shas[1]);
  await assert.rejects(pinSet(world, "p"), { code: "E_PIN_WRITE", message: /ENOSPC.*run rig pin set p again/ });
  const failed = lockOf(root).packs.p;
  assert.deepEqual([failed.sha, failed.candidate?.sha], [repo.shas[0], repo.shas[1]], "a failed pin set leaves the lock and its candidate");
  assert.deepEqual(await pinSet(world, "p"), { promoted: true, sha: repo.shas[1], port: "none" });
  assert.deepEqual(diskPaths(root, "p"), ["pack.json", "skills/a/b.md", "skills/k.md"]);
  assert.equal(lockOf(root).packs.p.tree, treeHash(filesUnder(join(root, "packs/p"))));

  await pinCheck(world, "p", repo.shas[2]);
  assert.deepEqual(await pinSet(world, "p"), { promoted: true, sha: repo.shas[2], port: "none" });
  assert.deepEqual(diskPaths(root, "p"), ["pack.json", "skills/a", "skills/k.md"]);
  assert.equal(readFileSync(join(root, "packs/p/skills/a"), "utf8"), "a file again\n");
  assert.equal(lockOf(root).packs.p.tree, treeHash(filesUnder(join(root, "packs/p"))));
});

test("writeConfig unlink refuses a symlink target and a parent folder that links outside the root", (t) => {
  const base = scratch();
  t.after(() => cleanup(base));
  const root = join(base, "config");
  const outside = join(base, "outside");
  mkdirSync(join(root, "packs/p"), { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(outside, "keep.md"), "keep\n");
  symlinkSync(join(outside, "keep.md"), join(root, "packs/p/link.md"));
  symlinkSync(outside, join(root, "packs/out"));

  assert.throws(() => writeConfig(root, "packs/p/link.md", null), { code: "E_CONTAINMENT", message: /is a symlink or not a regular file/ });
  assert.ok(lstatSync(join(root, "packs/p/link.md")).isSymbolicLink(), "the symlink stays");
  assert.throws(() => writeConfig(root, "packs/out/keep.md", null), { code: "E_CONTAINMENT", message: /resolves outside/ });
  assert.equal(readFileSync(join(outside, "keep.md"), "utf8"), "keep\n", "the file outside the root stays");
});
