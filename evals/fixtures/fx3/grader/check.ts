import { test } from "node:test";
import assert from "node:assert/strict";
import { listMembers } from "./src/directory.ts";
import { findByName } from "./src/lookup.ts";
import { mergeDirectories } from "./src/sync.ts";

const names = (xs: { name: string }[]) => xs.map((m) => m.name);
const expected = ["Ángel", "Anna", "Bruno", "Chloé", "Chris", "Dana", "Émile", "Eve", "Íris", "Olga", "Óscar", "Zoe"];

test("behavior: accented names sort with their base letter", () => {
  assert.deepEqual(names(listMembers()), expected);
});
test("root: plain names are still found", () => {
  assert.equal(findByName("Eve")?.name, "Eve");
  assert.equal(findByName("Anna")?.name, "Anna");
});
test("root: every listed member can be looked up by name", () => {
  for (const n of expected) assert.equal(findByName(n)?.name, n, `lookup of ${n}`);
  assert.equal(findByName("Nobody"), undefined);
});
test("root: merging two ordered branch lists gives the directory order", () => {
  const all = listMembers();
  const a = all.filter((_, i) => i % 2 === 0);
  const b = all.filter((_, i) => i % 2 === 1);
  assert.deepEqual(names(mergeDirectories(a, b)), expected);
  assert.deepEqual(names(mergeDirectories(b, a)), expected);
  const north = all.filter((m) => m.name.length % 2 === 0);
  const south = all.filter((m) => m.name.length % 2 === 1);
  assert.deepEqual(names(mergeDirectories(north, south)), expected);
});
