// Static boundary test over bin/ and lib/. The rules and allowlists below are data; the scanner is one pure function.
// Source: docs/design/rig-architecture.md, section 5, "Boundary test".

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Modules that may import node:child_process. lib/lock.ts spawns git; gate() is pure (doc section 4). */
const SPAWN_ALLOW = ["lib/lock.ts", "lib/lock/git.ts"];
/** Modules that may import a network module or reference fetch. */
const NETWORK_ALLOW = ["lib/lock.ts", "lib/lock/git.ts"];
const NETWORK_MODULES = ["node:net", "node:http", "node:https", "node:http2", "node:tls", "node:dgram"];

/**
 * Every export of lib/fs.ts with the modules that may import it. A module name covers lib/<m>.mjs and lib/<m>/**.
 * null: no import rule; log is checked later by the call-graph Logger rule. An export missing here fails the test.
 */
const FS_EXPORTS = {
  writeHome: ["state"],
  writeState: ["state", "metrics", "gate"],
  appendState: ["state", "metrics", "gate"],
  writeConfig: ["lock", "models"],
  log: null,
};

/** Write functions of node:fs and node:fs/promises. Only lib/fs.ts may import them. */
const RAW_FS_WRITE = /^(writeFile|rename|unlink|rm|rmdir|appendFile|chmod|createWriteStream|copyFile|cp)(Sync)?$/;
const FS_MODULES = ["node:fs", "node:fs/promises"];
/** Modules that may import raw fs writes. lib/lock/git.ts deletes its own scratch clone dir, which lies outside every config root. */
const RAW_FS_ALLOW = ["lib/fs.ts", "lib/lock/git.ts"];

/** Modules that may read RIG_TEST or RIG_TEST_ABORT_AFTER. */
const TEST_HOOK_ALLOW = ["state"];

/** @param {string} rel @param {string[]} modules @returns {boolean} */
const inModules = (rel, modules) => modules.some((m) => rel === `lib/${m}.ts` || rel.startsWith(`lib/${m}/`));

/**
 * Blank out comments, keep strings and line numbers. Handles //, block comments, quotes and template literals.
 * A regex literal that holds a quote can confuse it; lib/ and bin/ must not depend on that.
 * @param {string} src @returns {string}
 */
function stripComments(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === "/" && n === "/") {
      while (i < src.length && src[i] !== "\n") (out += " "), i++;
    } else if (c === "/" && n === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === "\\" ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** @param {string} clause the text between "import" and "from" @returns {string[]} names; "*" for a namespace, "default" */
function importedNames(clause) {
  const names = [];
  const braces = clause.match(/\{([^}]*)\}/);
  if (braces) {
    for (const part of braces[1].split(",")) {
      const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
      if (name) names.push(name);
    }
  }
  const outside = clause.replace(/^\s*type\s+/, "").replace(/\{[^}]*\}/, "").replace(/,/g, " ").trim();
  if (/\*\s*as\s+\w+/.test(outside) || outside === "*") names.push("*");
  else if (outside) names.push("default");
  return names;
}

/** @param {string} from importer rel path @param {string} spec @returns {string} a node: id or a root-relative path */
function resolveSpec(from, spec) {
  if (spec.startsWith(".")) return posix.normalize(posix.join(posix.dirname(from), spec));
  if (builtinModules.includes(spec)) return `node:${spec}`;
  return spec;
}

/**
 * Every boundary violation in a set of files. Pure.
 * @param {Map<string, string>} files root-relative posix path -> source
 * @returns {string[]} one line per violation: "<path>:<line> <rule>: <detail>"
 */
function violations(files) {
  const out = [];
  for (const [rel, raw] of files) {
    const src = stripComments(raw);
    const lineOf = (index) => src.slice(0, index).split("\n").length;
    const fail = (index, rule, detail) => out.push(`${rel}:${lineOf(index)} ${rule}: ${detail}`);

    for (const m of src.matchAll(/\bimport\s*\(/g)) fail(m.index, "code plugins", "dynamic import()");
    for (const m of src.matchAll(/\b(require\s*\(|createRequire\b)/g)) fail(m.index, "code plugins", m[1].replace(/\s*\($/, "()"));
    for (const m of src.matchAll(/\bfetch\b/g)) if (!NETWORK_ALLOW.includes(rel)) fail(m.index, "network and spawn", "references fetch");
    for (const m of src.matchAll(/\bRIG_TEST(_ABORT_AFTER)?\b/g)) {
      if (!inModules(rel, TEST_HOOK_ALLOW)) fail(m.index, "test hooks", `reads ${m[0]}`);
    }

    const statements = [
      ...[...src.matchAll(/\b(import|export)\s+([^;'"]*?)\s*from\s*(["'])([^"']+)\3/g)].map((m) => ({ index: m.index, kw: m[1], clause: m[2], spec: m[4] })),
      ...[...src.matchAll(/\bimport\s*(["'])([^"']+)\1/g)].map((m) => ({ index: m.index, kw: "import", clause: "", spec: m[2] })),
    ];
    for (const { index, kw, clause, spec } of statements) {
      const target = resolveSpec(rel, spec);
      const names = importedNames(clause);

      if (target === "node:child_process" && !SPAWN_ALLOW.includes(rel)) fail(index, "network and spawn", `imports ${target}`);
      if (NETWORK_MODULES.includes(target) && !NETWORK_ALLOW.includes(rel)) fail(index, "network and spawn", `imports ${target}`);

      if (FS_MODULES.includes(target) && !RAW_FS_ALLOW.includes(rel)) {
        if (names.includes("*") || names.includes("default")) fail(index, "raw fs writes", `namespace or default import of ${target}`);
        for (const n of names.filter((n) => RAW_FS_WRITE.test(n))) fail(index, "raw fs writes", `imports ${n} from ${target}`);
      }

      const internal = target.match(/^lib\/([^/]+)\/.+/);
      if (internal && rel !== `lib/${internal[1]}.ts` && !rel.startsWith(`lib/${internal[1]}/`)) {
        fail(index, "internals", `imports ${target}`);
      }

      if (target === "lib/fs.ts" && rel !== "lib/fs.ts") {
        if (kw === "export") fail(index, "fs exports", "re-exports from lib/fs.ts");
        if (names.includes("*") || names.includes("default")) fail(index, "fs exports", "namespace or default import of lib/fs.ts");
        for (const n of names) {
          const allow = FS_EXPORTS[n];
          if (allow && !inModules(rel, allow)) fail(index, "fs exports", `imports ${n}; allowed: ${allow.join(", ")}`);
        }
      }
    }
  }
  return out;
}

/** @returns {Map<string, string>} every .ts, .mjs and .js file under bin/ and lib/ */
function sourceTree() {
  const files = new Map();
  const walk = (dir) => {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = posix.join(dir, e.name);
      if (e.isDirectory()) walk(rel);
      else if (/\.(ts|mjs|js|cjs)$/.test(e.name)) files.set(rel, readFileSync(join(ROOT, rel), "utf8"));
    }
  };
  walk("bin");
  walk("lib");
  return files;
}

describe("boundaries of bin/ and lib/", () => {
  const tree = sourceTree();

  test("the scan sees the module map", () => {
    for (const m of ["world", "stack", "targets", "models", "gate", "state", "lock", "metrics", "fs", "commands"]) {
      assert.ok(tree.has(`lib/${m}.ts`), `lib/${m}.ts missing`);
    }
    assert.ok(tree.has("bin/rig.ts"));
  });

  test("no violation in the tree", () => {
    assert.deepEqual(violations(tree), []);
  });

  test("every export of lib/fs.ts has an entry in FS_EXPORTS", () => {
    const src = stripComments(tree.get("lib/fs.ts"));
    const exported = [...src.matchAll(/\bexport\s+(?:async\s+)?(?:function\*?|const|let|class)\s+(\w+)/g)].map((m) => m[1]);
    assert.ok(exported.length > 0);
    assert.deepEqual(exported.sort(), Object.keys(FS_EXPORTS).sort());
    assert.doesNotMatch(src, /\bexport\s*\{/, "lib/fs.ts exports only through declarations");
  });
});

describe("each rule catches its violation", () => {
  /** @param {string} rel @param {string} src @returns {string[]} */
  const check = (rel, src) => violations(new Map([[rel, src]]));
  /** @param {string} rel @param {string} src @param {RegExp} expected */
  const fails = (rel, src, expected) => {
    const v = check(rel, src);
    assert.equal(v.length, 1, `one violation expected, got ${JSON.stringify(v)}`);
    assert.match(v[0], expected);
  };

  test("dynamic import()", () => fails("lib/stack.ts", 'const m = await import("./x.ts");', /stack\.ts:1 code plugins: dynamic import/));
  test("dynamic import() split over lines", () => fails("lib/stack.ts", "\nconst m = await import\n  (p);", /stack\.ts:2 code plugins/));
  test("require through createRequire", () => assert.equal(check("lib/world.ts", 'import { createRequire } from "node:module";\nconst r = createRequire(import.meta.url);').length, 2));
  test("import.meta and a JSDoc import() type are not dynamic imports", () => {
    assert.deepEqual(check("lib/stack.ts", '/** @typedef {import("./world.ts").World} World */\n// import("x")\nconst u = import.meta.url;'), []);
  });
  test("child_process outside the allowlist", () => fails("lib/world.ts", 'import { spawnSync } from "node:child_process";', /network and spawn: imports node:child_process/));
  test("child_process without the node: prefix", () => fails("lib/world.ts", "import { spawn } from 'child_process';", /imports node:child_process/));
  test("child_process from gate", () => fails("lib/gate.ts", 'import { execFile } from "node:child_process";', /gate\.ts:1 network and spawn/));
  test("child_process inside the allowlist", () => assert.deepEqual(check("lib/lock.ts", 'import { spawnSync } from "node:child_process";'), []));
  test("network module outside lock", () => fails("lib/gate.ts", 'import https from "node:https";', /imports node:https/));
  test("fetch outside lock", () => fails("lib/metrics.ts", "const r = await fetch(url);", /references fetch/));
  test("writeHome from metrics", () => fails("lib/metrics.ts", 'import { writeHome } from "./fs.ts";', /fs exports: imports writeHome; allowed: state/));
  test("writeHome from a state internal", () => assert.deepEqual(check("lib/state/journal.ts", 'import { writeHome } from "../fs.ts";'), []));
  test("writeConfig from state", () => fails("lib/state.ts", 'import { writeState, writeConfig as wc } from "./fs.ts";', /imports writeConfig; allowed: lock, models/));
  test("writeState from gate", () => assert.deepEqual(check("lib/gate.ts", 'import { writeState } from "./fs.ts";'), []));
  test("import type is a named import", () => assert.deepEqual(check("lib/gate.ts", 'import type { writeState } from "./fs.ts";'), []));
  test("namespace import of lib/fs.ts", () => fails("lib/state.ts", 'import * as fs from "./fs.ts";', /namespace or default import of lib\/fs\.ts/));
  test("re-export from lib/fs.ts", () => fails("lib/state.ts", 'export { writeHome } from "./fs.ts";', /re-exports from lib\/fs\.ts/));
  test("raw fs write outside lib/fs.ts", () => fails("lib/world.ts", 'import { readFileSync, writeFileSync } from "node:fs";', /raw fs writes: imports writeFileSync from node:fs/));
  test("raw fs write through fs/promises", () => fails("lib/metrics.ts", 'import { rm } from "node:fs/promises";', /imports rm from node:fs\/promises/));
  test("namespace import of node:fs", () => fails("lib/world.ts", 'import * as fs from "fs";', /namespace or default import of node:fs/));
  test("raw fs write inside lib/fs.ts", () => assert.deepEqual(check("lib/fs.ts", 'import { renameSync, writeFileSync } from "node:fs";'), []));
  test("internals of another module", () => fails("lib/state.ts", 'import { place } from "./targets/place.ts";', /internals: imports lib\/targets\/place\.ts/));
  test("internals from their own module", () => assert.deepEqual(check("lib/targets.ts", 'import { place } from "./targets/place.ts";'), []));
  test("RIG_TEST outside state", () => fails("bin/rig.ts", 'if (process.env.RIG_TEST === "1") {}', /test hooks: reads RIG_TEST/));
  test("RIG_TEST_ABORT_AFTER inside state", () => assert.deepEqual(check("lib/state.ts", "const n = process.env.RIG_TEST_ABORT_AFTER;"), []));
});
