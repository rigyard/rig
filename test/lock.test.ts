import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, statSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { treeHash } from "../lib/tree.ts";
import { vendor, pinCheck, pinSet } from "../lib/lock.ts";
import { cleanup, makeRepo, makeWorld, MIT_TEXT, scratch } from "./lock.helpers.ts";

const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const f = (path, mode, text) => ({ path, mode, bytes: Buffer.from(text) });
const readLockFile = (root) => JSON.parse(readFileSync(join(root, "rig.lock.json"), "utf8"));

/** Read a pack dir back as the gate would see it. */
function filesOnDisk(dir, rel = "") {
  const out = [];
  for (const ent of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${ent.name}` : ent.name;
    if (ent.isDirectory()) out.push(...filesOnDisk(dir, r));
    else out.push({ path: r, mode: statSync(join(dir, r)).mode & 0o777, bytes: readFileSync(join(dir, r)) });
  }
  return out;
}

const KIT = (marker) => ({
  LICENSE: MIT_TEXT,
  "README.md": "# repo readme\n",
  "skills/kit/SKILL.md": "---\nname: kit\n---\nDo the kit thing.\n",
  "skills/kit/scripts/run.sh": { content: `#!/bin/sh\necho ran > "${marker}"\n`, mode: 0o755 },
  "skills/other/SKILL.md": "---\nname: other\n---\nNot vendored.\n",
});

test("treeHash: exact line format, order-free, mode-sensitive, pack.json only in core", () => {
  const a = f("skills/a/SKILL.md", 0o644, "alpha");
  const b = f("scripts/run.sh", 0o755, "beta");
  const manifest = f("pack.json", 0o644, "{}");
  const expectedLines = [
    `scripts/run.sh\x00755\x00${sha256("beta")}\n`,
    `skills/a/SKILL.md\x00644\x00${sha256("alpha")}\n`,
  ].join("");
  assert.equal(treeHash([a, b]), `sha256:${sha256(expectedLines)}`);
  assert.equal(treeHash([b, a]), treeHash([a, b]));
  assert.notEqual(treeHash([a, { ...b, mode: 0o644 }]), treeHash([a, b]));
  assert.equal(treeHash([a, b, manifest]), treeHash([a, b]));
  assert.notEqual(treeHash([a, b, manifest], { core: true }), treeHash([a, b], { core: true }));
  assert.equal(treeHash(new Map([[a.path, a], [b.path, b]])), treeHash([a, b]));
  assert.equal(treeHash([f("x", 0o100644, "z")]), treeHash([f("x", 0o644, "z")]));
});

test("vendor copies only the named paths and locks the tree hash of the copied files", async (t) => {
  const base = scratch();
  t.after(() => cleanup(base));
  const marker = join(base, "marker");
  const repo = makeRepo(base, [KIT(marker)]);
  const world = makeWorld(base);

  const r = await vendor(world, { repo: repo.url, sha: repo.shas[0], paths: ["skills/kit"], into: "repo" });

  assert.equal(r.pack, "kit");
  assert.equal(r.noop, false);
  const dir = join(world.roots.repo, "packs/kit");
  assert.deepEqual(filesOnDisk(dir).map((x) => x.path).sort(), ["SKILL.md", "pack.json", "scripts/run.sh"]);
  assert.equal(existsSync(join(world.roots.repo, "packs/other")), false);
  assert.equal(existsSync(join(dir, "README.md")), false);
  assert.equal(statSync(join(dir, "scripts/run.sh")).mode & 0o777, 0o755);

  const lock = readLockFile(world.roots.repo);
  const entry = lock.packs.kit;
  assert.deepEqual(entry, {
    repo: repo.url, sha: repo.shas[0], root: ".", paths: ["skills/kit"], exclude: [], license: "MIT", tree: treeHash(filesOnDisk(dir)),
    port: null, candidate: null,
  });
  assert.equal(r.tree, entry.tree);

  const manifest = JSON.parse(readFileSync(join(dir, "pack.json"), "utf8"));
  assert.deepEqual(manifest, { schema: 2, name: "kit", scopes: ["machine-hidden"], license: "MIT", units: {} });
  assert.equal(treeHash(r.files), entry.tree, "returned files, pack.json included, hash to the lock entry");
});

test("vendor never executes anything from the cloned tree", async (t) => {
  const base = scratch();
  t.after(() => cleanup(base));
  const marker = join(base, "marker");
  const repo = makeRepo(base, [KIT(marker)]);
  const world = makeWorld(base);
  await vendor(world, { repo: repo.url, sha: repo.shas[0], paths: ["skills/kit"] });
  assert.equal(existsSync(join(world.roots.repo, "packs/kit/scripts/run.sh")), true, "script is copied");
  assert.equal(existsSync(marker), false, "script did not run");
});

test("a second vendor at the same sha is a no-op: no write, no fetch", async (t) => {
  const base = scratch();
  t.after(() => cleanup(base));
  const repo = makeRepo(base, [KIT(join(base, "m"))]);
  const world = makeWorld(base);
  const args = { repo: repo.url, sha: repo.shas[0], paths: ["skills/kit"] };
  await vendor(world, args);
  const lockBytes = readFileSync(join(world.roots.repo, "rig.lock.json"));
  const writes = world.calls.length;
  rmSync(repo.bare, { recursive: true, force: true });

  const again = await vendor(world, args);

  assert.equal(again.noop, true);
  assert.equal(world.calls.length, writes);
  assert.deepEqual(readFileSync(join(world.roots.repo, "rig.lock.json")), lockBytes);
});

test("vendor resolves an abbreviated sha through the full-fetch fallback", async (t) => {
  const base = scratch();
  t.after(() => cleanup(base));
  const repo = makeRepo(base, [KIT(join(base, "m")), { "skills/kit/NEW.md": "later\n" }]);
  const world = makeWorld(base);
  const r = await vendor(world, { repo: repo.url, sha: repo.shas[0].slice(0, 9), paths: ["skills/kit"] });
  assert.equal(readLockFile(world.roots.repo).packs.kit.sha, repo.shas[0]);
  assert.equal(existsSync(join(world.roots.repo, "packs/kit/NEW.md")), false, "the older commit was vendored");
  assert.equal(r.noop, false);
});

test("vendor refuses bad input and unsafe trees before writing", async (t) => {
  const base = scratch();
  t.after(() => cleanup(base));
  const repo = makeRepo(base, [{ ...KIT(join(base, "m")), "skills/link/SKILL.md": { symlink: "../../etc/passwd" } }]);
  const world = makeWorld(base);
  const ok = { repo: repo.url, sha: repo.shas[0] };

  await assert.rejects(vendor(world, { ...ok, paths: ["nope"] }), { code: "E_PATH_MISSING" });
  await assert.rejects(vendor(world, { ...ok, paths: ["skills/link"] }), { code: "E_LOCK_SYMLINK" });
  await assert.rejects(vendor(world, { ...ok, paths: ["../x"] }), { code: "E_USAGE" });
  await assert.rejects(vendor(world, { ...ok, paths: [] }), { code: "E_USAGE" });
  await assert.rejects(vendor(world, { ...ok, sha: "--upload-pack=x", paths: ["skills/kit"] }), { code: "E_USAGE" });
  await assert.rejects(vendor(world, { ...ok, repo: "--upload-pack=x", paths: ["skills/kit"] }), { code: "E_USAGE" });
  await assert.rejects(vendor(world, { ...ok, sha: "0".repeat(40), paths: ["skills/kit"] }), { code: "E_FETCH" });
  assert.equal(world.calls.length, 0);
  assert.equal(existsSync(join(world.roots.repo, "packs")), false);
});

test("vendor at another sha refuses to overwrite an existing pack dir", async (t) => {
  const base = scratch();
  t.after(() => cleanup(base));
  const repo = makeRepo(base, [KIT(join(base, "m")), { "skills/kit/NEW.md": "later\n" }]);
  const world = makeWorld(base);
  await vendor(world, { repo: repo.url, sha: repo.shas[0], paths: ["skills/kit"] });
  await assert.rejects(vendor(world, { repo: repo.url, sha: repo.shas[1], paths: ["skills/kit"] }), { code: "E_PACK_EXISTS" });
  assert.equal(readLockFile(world.roots.repo).packs.kit.sha, repo.shas[0]);
});

test("vendor merges several paths, refuses a collision, and writes into the overlay on request", async (t) => {
  const base = scratch();
  t.after(() => cleanup(base));
  const repo = makeRepo(base, [{ "a/skills/x/SKILL.md": "x\n", "b/commands/y.md": "y\n", "c/skills/x/SKILL.md": "other x\n", LICENSE: "all rights reserved\n" }]);
  const world = makeWorld(base);
  await assert.rejects(vendor(world, { repo: repo.url, sha: repo.shas[0], paths: ["a", "c"] }), { code: "E_PATH_COLLISION" });

  const r = await vendor(world, { repo: repo.url, sha: repo.shas[0], paths: ["a", "b"], into: "overlay" });
  assert.deepEqual(r.files.map((x) => x.path).sort(), ["commands/y.md", "pack.json", "skills/x/SKILL.md"]);
  assert.equal(existsSync(join(world.roots.repo, "rig.lock.json")), false);
  assert.equal(readLockFile(world.roots.overlay).packs.a.license, "NOASSERTION", "an unrecognised license text is not guessed");
});

test("license comes from package metadata before LICENSE text", async (t) => {
  const base = scratch();
  t.after(() => cleanup(base));
  const repo = makeRepo(base, [{ LICENSE: MIT_TEXT, "skills/p/SKILL.md": "p\n", "skills/p/package.json": '{"license": "Apache-2.0"}\n' }]);
  const world = makeWorld(base);
  await vendor(world, { repo: repo.url, sha: repo.shas[0], paths: ["skills/p"] });
  assert.equal(readLockFile(world.roots.repo).packs.p.license, "Apache-2.0");
});

test("the lock is written in canonical form with sorted names, and a non-canonical lock is refused", async (t) => {
  const base = scratch();
  t.after(() => cleanup(base));
  const repo = makeRepo(base, [{ LICENSE: MIT_TEXT, "z/SKILL.md": "z\n", "m/SKILL.md": "m\n" }]);
  const world = makeWorld(base);
  await vendor(world, { repo: repo.url, sha: repo.shas[0], paths: ["z"] });
  await vendor(world, { repo: repo.url, sha: repo.shas[0], paths: ["m"] });
  const text = readFileSync(join(world.roots.repo, "rig.lock.json"), "utf8");
  assert.equal(text, JSON.stringify(JSON.parse(text), null, 2) + "\n");
  assert.deepEqual(Object.keys(JSON.parse(text).packs), ["m", "z"]);
  assert.deepEqual(Object.keys(JSON.parse(text)), ["schema", "core", "packs"]);

  writeFileSync(join(world.roots.repo, "rig.lock.json"), '{"schema":2,"core":{"tree":"","candidate":null},"packs":{}}');
  await assert.rejects(vendor(world, { repo: repo.url, sha: repo.shas[0], paths: ["z"], into: "repo" }), { code: "E_JSON_ROUNDTRIP" });
});

test("a schema 1 lock is refused on its version, before any fetch", async (t) => {
  const base = scratch();
  t.after(() => cleanup(base));
  const world = makeWorld(base);
  const v0 = { schema: 1, core: null, packs: {}, pins: {} };
  writeFileSync(join(world.roots.repo, "rig.lock.json"), `${JSON.stringify(v0, null, 2)}\n`);
  await assert.rejects(vendor(world, { repo: "file:///nowhere", sha: "0".repeat(40), paths: ["z"] }), { code: "E_SCHEMA", message: /schema 1 is v0, see docs\/design\/rig-v1-first-seed\.md/ });
  assert.throws(() => pinSet(world, "core"), { code: "E_SCHEMA" });
});

test("pinCheck and pinSet take core only until pack pins land", async (t) => {
  const base = scratch();
  t.after(() => cleanup(base));
  const world = makeWorld(base);
  await assert.rejects(pinCheck(world, "demo", "0".repeat(40)), { code: "E_USAGE", message: /core only/ });
  assert.throws(() => pinSet(world, "demo"), { code: "E_USAGE", message: /core only/ });
  assert.equal(existsSync(join(world.roots.repo, "rig.lock.json")), false);
});

test("core: pinCheck hashes packs/core with no network and pinSet seals it", async (t) => {
  const base = scratch();
  t.after(() => cleanup(base));
  const world = makeWorld(base);
  const core = join(world.roots.repo, "packs/core");
  world.writeConfig(world.roots.repo, "packs/core/frame.md", Buffer.from("frame\n"));
  world.writeConfig(world.roots.repo, "packs/core/pack.json", Buffer.from("{}\n"));

  assert.equal(pinSet(world, "core").error.code, "E_PIN_UNCHECKED");
  const r = await pinCheck(world, "core", null);
  assert.equal(r.candidate.tree, treeHash(filesOnDisk(core), { core: true }));
  assert.equal(readLockFile(world.roots.repo).core.candidate, r.candidate.tree);

  assert.deepEqual(pinSet(world, "core"), { promoted: true });
  assert.deepEqual(readLockFile(world.roots.repo).core, { tree: r.candidate.tree, candidate: null });
});

test("core: a blocked gate keeps the candidate out of the lock, so pinSet cannot promote it", async (t) => {
  const base = scratch();
  t.after(() => cleanup(base));
  const world = makeWorld(base);
  world.writeConfig(world.roots.repo, "packs/core/frame.md", Buffer.from("frame\n"));
  const seen = [];
  const r = await pinCheck(world, "core", null, { gate: (files) => (seen.push(files.map((x) => x.path)), { findings: [{ check: "exec" }], blocked: true }) });
  assert.deepEqual(seen, [["frame.md"]], "the gate sees the candidate files");
  assert.equal(r.blocked, true);
  assert.equal(existsSync(join(world.roots.repo, "rig.lock.json")), false, "no lock write on a block");
  assert.equal(pinSet(world, "core").error.code, "E_PIN_UNCHECKED");
  const ok = await pinCheck(world, "core", null, { gate: () => ({ findings: [], blocked: false }) });
  assert.equal(ok.blocked, false);
  assert.deepEqual(readLockFile(world.roots.repo).core, { tree: null, candidate: ok.candidate.tree }, "no seal before pin set");
});

test("the lock that vendor and pinCheck write on an empty root has the shape world reads: core null, then tree null", async (t) => {
  const base = scratch();
  t.after(() => cleanup(base));
  const repo = makeRepo(base, [{ LICENSE: MIT_TEXT, "z/SKILL.md": "z\n" }]);
  const world = makeWorld(base);
  await vendor(world, { repo: repo.url, sha: repo.shas[0], paths: ["z"] });
  assert.equal(readLockFile(world.roots.repo).core, null);
});
