// A state entry recorded as owned meets a target that now desires a managed block in the same file (omp, PR #44).

import assert from "node:assert/strict";
import { appendFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { kindChange } from "../lib/state/migrate.ts";
import { makeFixtureHome } from "./helpers/fixture-home.ts";
import { configCopy, json, rig, ROOT } from "./helpers/seed.ts";

const AGENTS = ".omp/agent/AGENTS.md";
const STATE = ".local/state/rig/installed.json";
const MARKER = "<!-- rig:frame:start -->\n";
const SHA = "a".repeat(64);
const run: Record<string, any> = {};

const setMode = (root: string, mode: "whole-file" | "managed-block") => {
  const p = join(root, "targets/omp.json");
  const t = json(p);
  t.instructions.mode = mode;
  writeFileSync(p, `${JSON.stringify(t, null, 2)}\n`);
};
const entryOf = (home: string) => json(join(home, STATE)).entries[`~/${AGENTS}`];

before(() => {
  run.root = configCopy(ROOT);
});
after(() => rmSync(run.root, { recursive: true, force: true }));

/** A HOME that ran `rig apply` while omp was whole-file, then the config moved to managed-block. */
function homeAppliedAsOwned() {
  const h = makeFixtureHome();
  setMode(run.root, "whole-file");
  const a = rig(run.root, h.home, ["apply"]);
  assert.equal(a.code, 0, a.all);
  assert.equal(entryOf(h.home).kind, "owned");
  setMode(run.root, "managed-block");
  return h;
}

describe("owned to block migration of omp AGENTS.md", () => {
  const mig: Record<string, any> = {};
  before(() => {
    mig.h = homeAppliedAsOwned();
    mig.ownedBytes = readFileSync(mig.h.path(AGENTS));
    mig.ownedEntry = entryOf(mig.h.home);
    mig.plan = rig(run.root, mig.h.home, ["plan"]);
    mig.apply = rig(run.root, mig.h.home, ["apply"]);
    mig.blockBytes = readFileSync(mig.h.path(AGENTS));
    mig.blockEntry = entryOf(mig.h.home);
    mig.again = rig(run.root, mig.h.home, ["plan"]);
    mig.undo = rig(run.root, mig.h.home, ["apply", "--undo", /^run (\S+):/m.exec(mig.apply.stdout)?.[1] ?? "none"]);
    mig.undone = { bytes: readFileSync(mig.h.path(AGENTS)), entry: entryOf(mig.h.home) };
  });
  after(() => mig.h?.cleanup());

  test("a rig-written whole file converts to the block: plan has 0 blocks, apply writes it, the second plan is empty", () => {
    assert.doesNotMatch(mig.plan.all, /E_DRIFT/);
    assert.match(mig.plan.stdout, /^1 change, 0 blocks$/m);
    assert.match(mig.plan.stdout, new RegExp(`~/${AGENTS}`));
    assert.equal(mig.apply.code, 0, mig.apply.all);
    assert.ok(mig.blockBytes.toString("utf8").startsWith(MARKER), "the file is now the block alone");
    assert.notDeepEqual(mig.blockBytes, mig.ownedBytes);
    assert.equal(mig.blockEntry.kind, "block");
    assert.match(mig.again.stdout, /^0 changes, 0 blocks$/m);
  });

  test("rig apply --undo of the migrating run restores the owned bytes and the owned entry", () => {
    assert.equal(mig.undo.code, 0, mig.undo.all);
    assert.deepEqual(mig.undone.bytes, mig.ownedBytes);
    assert.deepEqual(mig.undone.entry, mig.ownedEntry);
  });

  test("a person edited the file after rig wrote it: E_DRIFT still blocks and nothing is written", () => {
    const h = homeAppliedAsOwned();
    try {
      appendFileSync(h.path(AGENTS), "\n# mine\n");
      const before = readFileSync(h.path(AGENTS));
      const p = rig(run.root, h.home, ["plan"]);
      assert.match(p.all, /E_DRIFT .*recorded as owned, desired as block/);
      assert.match(p.stdout, /^0 changes, 1 block$/m);
      const a = rig(run.root, h.home, ["apply"]);
      assert.notEqual(a.code, 0);
      assert.deepEqual(readFileSync(h.path(AGENTS)), before);
      assert.equal(entryOf(h.home).kind, "owned");
    } finally {
      h.cleanup();
    }
  });
});

describe("kindChange", () => {
  const owned = { kind: "owned", sha256: SHA, mode: 0o644 };
  const rows: [string, {kind: string, sha256?: string, mode?: number}, string, {sha: string | null, mode: number | null}, string][] = [
    ["owned, block desired, bytes and mode as recorded", owned, "block", { sha: `sha256:${SHA}`, mode: 0o644 }, "convert"],
    ["owned, block desired, bytes edited", owned, "block", { sha: `sha256:${"b".repeat(64)}`, mode: 0o644 }, "drift"],
    ["owned, block desired, mode edited", owned, "block", { sha: `sha256:${SHA}`, mode: 0o600 }, "drift"],
    ["owned, block desired, file removed", owned, "block", { sha: null, mode: null }, "drift"],
    ["owned, cells desired", owned, "cells", { sha: `sha256:${SHA}`, mode: 0o644 }, "drift"],
    ["owned, json-element desired", owned, "json-element", { sha: `sha256:${SHA}`, mode: 0o644 }, "drift"],
    ["block, cells desired", { kind: "block" }, "cells", { sha: `sha256:${SHA}`, mode: 0o644 }, "drift"],
    ["cells, block desired", { kind: "cells" }, "block", { sha: `sha256:${SHA}`, mode: 0o644 }, "drift"],
  ];
  for (const [name, ent, desired, cur, want] of rows) test(name, () => assert.equal(kindChange(ent, desired, cur), want));
});
