import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { place } from "../lib/targets/place.ts";
import { readSet, duplicatesOf } from "../lib/targets/readset.ts";
import { HARNESSES, loadRecords, recordsWith, unit, paths, tempHome, skill, link } from "./placement.helpers.ts";

const CL = "~/.claude/skills";
const CX = "~/.codex/skills";
const AG = "~/.agents/skills";
const CHANNEL = "$XDG_DATA_HOME/rig/marketplace";
const CURSOR_PLUGIN = "~/.cursor/plugins/local/rig/skills";

const CURSOR = ["none", "identical-bytes", "by-name"];
const OMP = ["none", "identical-bytes"];

/** The rule itself: targets see exactly one copy, everyone else at most one, leaks are exactly the outsiders with a copy. */
function assertRule(r, u) {
  assert.ok(!r.error, r.error?.message);
  for (const h of HARNESSES) {
    if (u.harnesses.includes(h)) assert.equal(r.copies[h], 1, `${h} sees ${r.copies[h]} copies`);
    else assert.ok(r.copies[h] <= 1, `${h} (not a target) sees ${r.copies[h]} copies`);
  }
  assert.deepEqual(r.leaks, HARNESSES.filter((h) => !u.harnesses.includes(h) && r.copies[h] === 1));
}

function run(u, opts) {
  return place(u, HARNESSES, recordsWith(opts));
}

test("target records parse and carry the read-set keys", () => {
  const recs = loadRecords();
  for (const [name, rec] of recs) {
    assert.equal(rec.schema, 1);
    assert.equal(rec.name, name);
    assert.ok(Array.isArray(rec.reads.skills) && Array.isArray(rec.reads.never_write));
  }
  assert.equal(recs.get("claude").channels.plugin.marketplace, "rig-local");
  assert.deepEqual(
    recs.get("cursor").reads.skills.filter((e) => e.writable).map((e) => e.path),
    [CURSOR_PLUGIN],
  );
});

test("all four harnesses: each dedupe value of Cursor and omp", () => {
  const u = unit(HARNESSES);
  for (const cursor of CURSOR) {
    for (const omp of OMP) {
      const r = run(u, { cursor, omp });
      if (cursor === "none") {
        assert.equal(r.error?.code, "E_READSET", `cursor=${cursor} omp=${omp}`);
        assert.equal(r.error.harness, "cursor");
        assert.match(r.error.message, /cursor/);
        assert.match(r.error.message, /~\/\.claude\/skills/);
      } else {
        assertRule(r, u);
        // omp reads ~/.agents/skills, not ~/.codex/skills (probe e), so ~/.agents/skills is the only dir that serves Codex and omp at once
        assert.deepEqual(paths(r), [CL, AG], `cursor=${cursor} omp=${omp}`);
        assert.deepEqual(r.namespace, []);
      }
      // with the plugin channel the answer is the same for every value, and it reports the namespace cost
      const c = run(unit(HARNESSES, { channel: { claude: "plugin" } }), { cursor, omp });
      assertRule(c, u);
      assert.deepEqual(paths(c), [AG, CHANNEL]);
      assert.equal(c.dirs[1].channel, "plugin");
      assert.deepEqual(c.namespace, [{ harness: "claude", dir: CHANNEL, certainty: "documented" }]);
    }
  }
});

test("Claude plus Cursor: ~/.claude/skills under every dedupe value, no leak (omp does not read it)", () => {
  const u = unit(["claude", "cursor"]);
  for (const cursor of CURSOR) {
    for (const omp of OMP) {
      const r = run(u, { cursor, omp });
      assertRule(r, u);
      assert.deepEqual(paths(r), [CL]);
      assert.deepEqual(r.leaks, []);
    }
  }
});

test("Codex only: one dir, the leak is reported", () => {
  const u = unit(["codex"]);
  for (const cursor of CURSOR) {
    const r = run(u, { cursor });
    assertRule(r, u);
    assert.deepEqual(paths(r), [CX]);
    assert.deepEqual(r.leaks, ["cursor"]);
    assert.equal(r.copies.omp, 0);
  }
});

test("Cursor only goes through its own plugin dir and reports the unverified namespace", () => {
  const u = unit(["cursor"]);
  const r = run(u);
  assertRule(r, u);
  assert.deepEqual(paths(r), [CURSOR_PLUGIN]);
  assert.deepEqual(r.leaks, []);
  assert.deepEqual(r.namespace, [{ harness: "cursor", dir: CURSOR_PLUGIN, certainty: "unverified" }]);
});

test("Claude only: the plugin channel replaces the skill dir and removes the leaks", () => {
  const plain = run(unit(["claude"]));
  assert.deepEqual(paths(plain), [CL]);
  assert.deepEqual(plain.leaks, ["cursor"]);
  const u = unit(["claude"], { channel: { claude: "plugin" } });
  const chan = run(u);
  assertRule(chan, u);
  assert.deepEqual(paths(chan), [CHANNEL]);
  assert.deepEqual(chan.leaks, []);
});

test("hidden unit for all four: the Codex sidecar makes digests differ, so only the channel or by-name Cursor places it", () => {
  const u = unit(HARNESSES, { hidden: true });
  for (const cursor of CURSOR) {
    for (const omp of OMP) {
      const r = run(u, { cursor, omp });
      if (cursor === "by-name") {
        assertRule(r, u);
        assert.deepEqual(r.unhidden, []);
      } else {
        assert.equal(r.error?.code, "E_READSET", `cursor=${cursor} omp=${omp}`);
        assert.equal(r.error.harness, "cursor");
      }
      const hc = unit(HARNESSES, { hidden: true, channel: { claude: "plugin" } });
      const c = run(hc, { cursor, omp });
      assertRule(c, u);
      assert.deepEqual(paths(c), [AG, CHANNEL]);
      assert.deepEqual(c.unhidden, []);
    }
  }
});

test("hidden unit: a harness with no hide control is reported, not silent", () => {
  const u = unit(HARNESSES, { hidden: true, channel: { claude: "plugin" } });
  const r = run(u, { codexHide: "none" });
  assertRule(r, u);
  assert.deepEqual(r.unhidden, ["codex"]);
  const plain = run(unit(HARNESSES, { channel: { claude: "plugin" } }), { codexHide: "none" });
  assert.deepEqual(plain.unhidden, [], "a non-hidden unit has nothing to hide");
});

test("a never-write dir is never chosen", () => {
  const recs = recordsWith();
  recs.get("codex").reads.never_write.push("~/.agents/skills/**");
  const r = place(unit(["codex"]), HARNESSES, recs);
  assert.deepEqual(paths(r), [CX]);
  recs.get("codex").reads.never_write.push("~/.codex/skills/**");
  const none = place(unit(["codex"]), HARNESSES, recs);
  assert.equal(none.error.code, "E_READSET");
  assert.equal(none.error.harness, "codex");
  // the real records: no solution ever names Cursor's read-only dirs
  for (const set of [HARNESSES, ["cursor"], ["claude", "cursor"], ["codex", "omp", "cursor"]]) {
    for (const cursor of CURSOR) {
      const res = run(unit(set), { cursor });
      for (const p of res.error ? [] : paths(res)) {
        assert.ok(!p.startsWith("~/.cursor/skills"), `${p} is read-only or never-write`);
      }
    }
  }
});

test("a channel dir under a never-write glob is never chosen", () => {
  const recs = recordsWith();
  recs.get("claude").reads.never_write.push("$XDG_DATA_HOME/rig/**");
  const r = place(unit(["claude"], { channel: { claude: "plugin" } }), HARNESSES, recs);
  assert.equal(r.error.code, "E_READSET");
  assert.equal(r.error.harness, "claude");
});

test("a channel request on a harness with no channel is E_READSET naming it", () => {
  const r = run(unit(["codex"], { channel: { codex: "plugin" } }));
  assert.equal(r.error.code, "E_READSET");
  assert.equal(r.error.harness, "codex");
});

test("E_READSET names the harness, the colliding dirs and both exits", () => {
  const r = run(unit(["claude", "codex"]), { cursor: "none" });
  assert.equal(r.error.code, "E_READSET");
  assert.equal(r.error.harness, "cursor");
  assert.match(r.error.message, /~\/\.claude\/skills and ~\/\.codex\/skills/);
  assert.match(r.error.message, /packs\.kit\.harnesses/);
  assert.match(r.error.message, /packs\.kit\.channel\.claude = "plugin"/);
  // narrowing is the second clause of the rule: Claude alone places
  assert.ok(!run(unit(["claude"]), { cursor: "none" }).error);
});

test("equal-cost solutions are a tie broken by declared order, not by chance", () => {
  const recs = recordsWith();
  // omp also reads ~/.codex/skills here, so ~/.codex/skills and ~/.agents/skills leak to the same harnesses
  recs.get("omp").reads.skills.push({ path: CX, writable: false, dedupe: "identical-bytes" });
  const first = place(unit(["codex"]), HARNESSES, recs);
  assert.deepEqual(paths(first), [CX]);
  assert.deepEqual(first.leaks, ["omp", "cursor"]);
  const swapped = structuredClone(recs);
  swapped.get("codex").reads.skills.reverse();
  assert.deepEqual(paths(place(unit(["codex"]), HARNESSES, swapped)), [AG]);
  assert.deepEqual(place(unit(["codex"]), HARNESSES, recs), first);
});

test("all four on the real records (probe-driven omp and Cursor read-sets): ~/.claude/skills plus ~/.agents/skills", () => {
  const recs = loadRecords();
  const omp = recs.get("omp").reads.skills.map((e) => e.path);
  assert.deepEqual(omp, ["~/.omp/agent/skills", AG]);
  assert.ok(recs.get("cursor").reads.skills.every((e) => e.dedupe === "by-name"));
  for (const hidden of [false, true]) {
    const u = unit(HARNESSES, { hidden });
    const r = place(u, HARNESSES, recs);
    assertRule(r, u);
    assert.deepEqual(paths(r), [CL, AG]);
    // omp sees only the ~/.agents/skills copy; Cursor sees both and collapses them by name
    assert.deepEqual(r.copies, { claude: 1, codex: 1, omp: 1, cursor: 1 });
    assert.deepEqual(r.unhidden, []);
  }
});

test("place rejects a harness it has no record for", () => {
  assert.throws(() => place(unit(["pi"]), HARNESSES, recordsWith()), TypeError);
  assert.throws(() => place(unit(["claude"]), ["claude", "pi"], recordsWith()), TypeError);
});

test("an installed subset: harnesses that are not installed neither need nor see copies", () => {
  const u = unit(["claude", "codex"]);
  const r = place(u, ["claude", "codex"], recordsWith({ cursor: "none" }));
  assert.deepEqual(paths(r), [CL, CX]);
  assert.deepEqual(r.leaks, []);
});

// ---- readSet

function plantedHome() {
  const home = tempHome();
  const real = realpathSync(home);
  const at = (rel) => join(home, rel);
  const body = (s) => `---\nname: x\n---\n${s}\n`;
  skill(at(".codex/skills"), "alpha", body("alpha"));
  link(at(".codex/skills/alpha"), at(".agents/skills/alpha"));
  skill(at(".codex/skills"), "beta", body("beta"));
  skill(at(".agents/skills"), "beta", body("beta"));
  skill(at(".omp/agent/skills"), "beta", body("beta"));
  skill(at(".codex/skills"), "gamma", body("one"));
  skill(at(".agents/skills"), "gamma", body("two"));
  skill(at(".claude/skills"), "delta", body("delta"));
  skill(at(".codex/skills"), "delta", body("delta"));
  skill(at(".claude/skills"), "solo", body("solo"));
  skill(at(".claude/skills/.trash"), "ghost", body("ghost"));
  skill(at(".codex/skills/.system"), "sys", body("sys"));
  skill(at(".agents/skills"), ".backup-1", body("old"));
  mkdirSync(at(".codex/skills/not-a-skill"), { recursive: true });
  writeFileSync(at(".codex/skills/.sync-manifest.json"), "{}");
  writeFileSync(at(".codex/skills/stray.txt"), "x");
  return { home, real, at };
}

function worldFor(home, opts) {
  return { env: { home }, targets: recordsWith(opts) };
}

test("readSet reports a planted duplicate exactly: link plus target, identical copies, different bytes", () => {
  const { home, real } = plantedHome();
  try {
    const dups = duplicatesOf(readSet(worldFor(home)));
    const codex = dups.get("codex");
    assert.deepEqual(codex.map((d) => d.name), ["alpha", "beta", "gamma"]);
    const [alpha, beta, gamma] = codex;
    // symlink plus target: two entries, one real file
    assert.deepEqual(alpha.entries.map((e) => e.path), [join(home, ".codex/skills/alpha"), join(home, ".agents/skills/alpha")]);
    assert.equal(alpha.entries[0].realpath, join(real, ".codex/skills/alpha"));
    assert.equal(alpha.entries[1].realpath, alpha.entries[0].realpath);
    assert.equal(alpha.entries[0].sha256, alpha.entries[1].sha256);
    // identical copy in two dirs
    assert.equal(beta.entries.length, 2);
    assert.notEqual(beta.entries[0].realpath, beta.entries[1].realpath);
    assert.equal(beta.entries[0].sha256, beta.entries[1].sha256);
    // different bytes
    assert.equal(gamma.entries.length, 2);
    assert.notEqual(gamma.entries[0].sha256, gamma.entries[1].sha256);
    for (const d of codex) {
      assert.equal(d.severity, "info");
      assert.ok(d.entries.every((e) => e.managed === false));
    }
    // claude reads only ~/.claude/skills and the plugin cache: no duplicate
    assert.deepEqual(dups.get("claude"), []);
    // omp collapses identical copies in ~/.omp/agent/skills and ~/.agents/skills: beta is not a duplicate
    assert.deepEqual(dups.get("omp"), []);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("readSet applies each harness's dedupe rule", () => {
  const { home } = plantedHome();
  try {
    const names = (opts, harness) =>
      duplicatesOf(readSet(worldFor(home, opts))).get(harness).map((d) => d.name);
    assert.deepEqual(names({ cursor: "none" }, "cursor"), ["alpha", "beta", "delta", "gamma"]);
    assert.deepEqual(names({ cursor: "identical-bytes" }, "cursor"), ["gamma"]);
    assert.deepEqual(names({ cursor: "by-name" }, "cursor"), []);
    assert.deepEqual(names({ omp: "none" }, "omp"), ["beta"]);
    const omp = readSet(worldFor(home)).get("omp");
    assert.equal(omp.filter((e) => e.name === "beta").length, 1);
    // omp does not read ~/.claude/skills or ~/.codex/skills (probe e)
    assert.equal(omp.filter((e) => e.name === "delta").length, 0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("readSet skips dot entries, stray files and dirs without SKILL.md", () => {
  const { home } = plantedHome();
  try {
    const set = readSet(worldFor(home));
    const all = [...set.values()].flat().map((e) => e.name);
    for (const bad of ["ghost", "sys", ".backup-1", "not-a-skill", "stray.txt", ".trash", ".system"]) {
      assert.ok(!all.includes(bad), `${bad} listed`);
    }
    assert.ok(set.get("claude").some((e) => e.name === "solo"));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("readSet marks managed copies from installed.json, and a managed duplicate is an error", () => {
  const { home } = plantedHome();
  try {
    const installed = {
      schema: 1,
      entries: {
        "~/.codex/skills/alpha/SKILL.md": { kind: "owned", sha256: "x", mode: 420, unit: "kit/alpha", run: "r" },
        "~/.codex/models.toml": { kind: "cells", digest: "x" },
      },
    };
    const world = worldFor(home);
    const dups = duplicatesOf(readSet(world, installed)).get("codex");
    const alpha = dups.find((d) => d.name === "alpha");
    assert.equal(alpha.severity, "error");
    assert.deepEqual(alpha.entries.map((e) => e.managed), [true, false]);
    assert.equal(dups.find((d) => d.name === "beta").severity, "info");
    // the same entries as a Map give the same answer
    const viaMap = duplicatesOf(readSet(world, new Map(Object.entries(installed.entries)))).get("codex");
    assert.deepEqual(viaMap, dups);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("readSet reads plugin dirs: nested Claude plugin cache and the flat Cursor plugin dir", () => {
  const home = tempHome();
  try {
    skill(join(home, ".claude/plugins/cache/mkt/plug/1.0.0/skills"), "pskill");
    skill(join(home, ".claude/plugins/cache/mkt/plug/1.0.0/.hidden"), "nope");
    skill(join(home, ".cursor/plugins/local/rig/skills"), "cskill");
    const set = readSet(worldFor(home));
    assert.deepEqual(set.get("claude").map((e) => e.name), ["pskill"]);
    assert.deepEqual(set.get("cursor").map((e) => e.name), ["cskill"]);
    assert.equal(set.get("codex").length, 0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("readSet on an empty HOME lists nothing for every harness", () => {
  const home = tempHome();
  try {
    const set = readSet(worldFor(home));
    assert.deepEqual([...set.keys()], HARNESSES);
    for (const entries of set.values()) assert.deepEqual(entries, []);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
