// package.json stays free of runtime dependencies: Node runs rig straight from the checkout, with no install step.
// Type tooling is dev-only and pinned exactly, with integrity hashes in package-lock.json.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (name) => JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), "utf8"));
const pkg = read("package.json");
const lock = read("package-lock.json");
const RUNTIME_FIELDS = ["dependencies", "optionalDependencies", "peerDependencies", "bundleDependencies", "bundledDependencies"];

test("package.json declares no runtime dependencies", () => {
  for (const field of RUNTIME_FIELDS) assert.equal(pkg[field], undefined, `package.json must not declare ${field}`);
});

test("every devDependency is pinned to an exact version", () => {
  for (const [name, version] of Object.entries(pkg.devDependencies ?? {})) {
    assert.match(version, /^\d+\.\d+\.\d+$/, `${name} must be pinned exactly, got ${version}`);
  }
});

test("package-lock.json installs dev packages only, each with an integrity hash", () => {
  for (const field of RUNTIME_FIELDS) assert.equal(lock.packages[""][field], undefined, `lock root must not declare ${field}`);
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (path === "") continue;
    assert.equal(entry.dev, true, `${path} is not a dev package`);
    assert.match(entry.integrity ?? "", /^sha512-/, `${path} has no sha512 integrity`);
  }
});
