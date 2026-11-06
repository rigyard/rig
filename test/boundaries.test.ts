// Static boundary test over bin/ and lib/. The rules and allowlists below are data; the scanner is one pure function.
// Source: docs/design/rig-architecture.md, section 5, "Boundary test".

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * Modules that may import node:child_process. lib/lock.ts spawns git; lib/fs.ts spawns node on lib/fs/fsync-batch.ts to
 * fsync a batch at once; gate() is pure (doc section 4).
 */
const SPAWN_ALLOW = ["lib/lock.ts", "lib/lock/git.ts", "lib/fs.ts"];
/** Modules whose child_process use is pinned to one script, and the shapes the one allowed call may take (rule "spawn pin"). */
const SPAWN_PINNED: Record<string, string> = { "lib/fs.ts": "lib/fs/fsync-batch.ts" };
const SPAWN_FNS = ["spawnSync", "spawn", "execFileSync", "execFile"];
const SPAWN_OPTIONS = ["input", "encoding", "timeout", "killSignal", "env"];
const SPAWN_ENV = ["UV_THREADPOOL_SIZE"];
/** Modules that may import a network module or reference fetch. */
const NETWORK_ALLOW = ["lib/lock.ts", "lib/lock/git.ts"];
const NETWORK_MODULES = ["node:net", "node:http", "node:https", "node:http2", "node:tls", "node:dgram"];

/**
 * Every export of lib/fs.ts with the modules that may import it. A module name covers lib/<m>.mjs and lib/<m>/**.
 * null: no import rule; log is checked later by the call-graph Logger rule. An export missing here fails the test.
 */
const FS_EXPORTS = {
  writeHome: ["state"],
  stageHome: ["state"],
  installHome: ["state"],
  fsyncAll: ["state"],
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

function bracketParts(src: string, open: number): string[] | null {
  const parts: string[] = [];
  let depth = 0;
  let from = open + 1;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      i++;
      while (i < src.length && src[i] !== c) i += src[i] === "\\" ? 2 : 1;
    } else if ("([{".includes(c)) depth++;
    else if (")]}".includes(c) && --depth === 0) {
      parts.push(src.slice(from, i).trim());
      return parts.filter((p, k) => p || k < parts.length - 1);
    } else if (c === "," && depth === 1) (parts.push(src.slice(from, i).trim()), (from = i + 1));
  }
  return null;
}

type Statement = { index: number; end: number; kw: string; clause: string; spec: string };

/** The whole file counts, whatever the order of import and use: exactly one use of a SPAWN_FNS name, and it is the pinned call. */
function spawnPinBreaks(rel: string, src: string, imports: Statement[], script: string): { index: number; why: string }[] {
  const out: { index: number; why: string }[] = [];
  const bad = (index: number, why: string) => out.push({ index, why });
  const word = (name: string) => new RegExp(`(?<![\\w$])${name.replace(/\$/g, "\\$")}(?![\\w$])`, "g");
  let body = src;
  const names = new Set<string>();
  for (const s of imports) {
    body = body.slice(0, s.index) + " ".repeat(s.end - s.index) + body.slice(s.end);
    if (s.kw !== "import") bad(s.index, "re-exports node:child_process");
    if (/\sas\s/.test(s.clause)) bad(s.index, "aliases a child_process import");
    for (const n of importedNames(s.clause)) {
      if (SPAWN_FNS.includes(n)) names.add(n);
      else bad(s.index, `imports ${n} from node:child_process; allowed: ${SPAWN_FNS.join(", ")}`);
    }
  }
  const node = /\bNODE_(OPTIONS|PATH)\b/.exec(body);
  if (node) bad(node.index, `mentions ${node[0]}, which changes what node loads`);
  const uses = [...names].flatMap((n) => [...body.matchAll(word(n))]).sort((a, b) => a.index - b.index);
  if (uses.length !== 1) bad(uses[1]?.index ?? imports[0].index, `${uses.length} uses of child_process functions, expected exactly one call`);

  for (const use of uses) {
    const at = use.index;
    const open = at + use[0].length + (body.slice(at + use[0].length).match(/^\s*/)?.[0].length ?? 0);
    const args = body[open] === "(" ? bracketParts(body, open) : null;
    if (!args) bad(at, "child_process function used other than as a direct call");
    else if (args[0] !== "process.execPath") bad(at, `command is ${args[0]}, not process.execPath`);
    else if (args.length !== 3) bad(at, `${args.length} arguments, expected a command, an argv array and options`);
    if (!args || args.length !== 3 || args[0] !== "process.execPath") continue;

    const name = args[1].match(/^\[\s*([\w$]+)\s*\]$/)?.[1];
    const url = String.raw`fileURLToPath\(\s*new URL\(\s*(["'])([^"']+)\1\s*,\s*import\.meta\.url\s*\)\s*\)`;
    const bound = name && body.match(new RegExp(String.raw`\bconst\s+${name.replace(/\$/g, "\\$")}\s*=\s*${url}\s*;`));
    if (!name || !bound) bad(at, `argv ${args[1]} is not [<const>] bound to fileURLToPath(new URL("<path>", import.meta.url))`);
    else if ([...body.matchAll(word(name))].length !== 2) bad(at, `${name} appears other than twice: exactly one binding and this argv`);
    else if (resolveSpec(rel, bound[2]) !== script) bad(at, `argv script resolves to ${resolveSpec(rel, bound[2])}, not ${script}`);

    const options = args[2].startsWith("{") ? bracketParts(args[2], 0) : null;
    if (!options) bad(at, "options are not an object literal");
    for (const part of options ?? []) {
      const key = part.match(/^(\w+)\s*(?::|$)/)?.[1];
      if (!key || !SPAWN_OPTIONS.includes(key)) bad(at, `option ${part.slice(0, 24)} is not one of ${SPAWN_OPTIONS.join(", ")}`);
      if (key !== "env") continue;
      const entries = /^env\s*:\s*\{/.test(part) ? bracketParts(part, part.indexOf("{")) : null;
      if (!entries) bad(at, "env is not an object literal");
      for (const e of entries ?? []) {
        if (e.replace(/\s+/g, "") !== "...process.env" && !SPAWN_ENV.includes(e.match(/^(\w+)\s*:/)?.[1] ?? "")) {
          bad(at, `env entry ${e.slice(0, 24)} is neither ...process.env nor one of ${SPAWN_ENV.join(", ")}`);
        }
      }
    }
  }
  return out;
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

    const statements: Statement[] = [
      ...[...src.matchAll(/\b(import|export)\s+([^;'"]*?)\s*from\s*(["'])([^"']+)\3/g)].map((m) => ({ index: m.index, end: m.index + m[0].length, kw: m[1], clause: m[2], spec: m[4] })),
      ...[...src.matchAll(/\bimport\s*(["'])([^"']+)\1/g)].map((m) => ({ index: m.index, end: m.index + m[0].length, kw: "import", clause: "", spec: m[2] })),
    ];
    const childProcess: Statement[] = [];
    for (const { index, end, kw, clause, spec } of statements) {
      const target = resolveSpec(rel, spec);
      const names = importedNames(clause);

      if (target === "node:child_process" && !SPAWN_ALLOW.includes(rel)) fail(index, "network and spawn", `imports ${target}`);
      if (target === "node:child_process") childProcess.push({ index, end, kw, clause, spec });
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
    if (SPAWN_PINNED[rel] && childProcess.length) {
      for (const { index, why } of spawnPinBreaks(rel, src, childProcess, SPAWN_PINNED[rel])) fail(index, "spawn pin", why);
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

describe("the lib/fs.ts spawn pin", () => {
  const real = readFileSync(join(ROOT, "lib/fs.ts"), "utf8");
  const swap = (re: RegExp, to: string): string[] => {
    assert.match(real, re, `lib/fs.ts no longer matches ${re}; update this test`);
    return violations(new Map([["lib/fs.ts", real.replace(re, to)]]));
  };
  const added = (before: string, after = ""): string[] => violations(new Map([["lib/fs.ts", before + real + after]]));
  const pin = (v: string[], expected: RegExp) => {
    assert.ok(v.length > 0 && v.every((m) => /^lib\/fs\.ts:\d+ spawn pin: /.test(m)), JSON.stringify(v));
    assert.ok(v.some((m) => expected.test(m)), `none of ${JSON.stringify(v)} matches ${expected}`);
  };
  const BATCH = /\[BATCH\]/;
  const CALLING = /\bspawnSync\b(?=\s*\()/;

  test("the real lib/fs.ts holds the pin", () => assert.deepEqual(violations(new Map([["lib/fs.ts", real]])), []));
  test("every function in SPAWN_FNS passes by name", () => {
    for (const fn of SPAWN_FNS) assert.deepEqual(violations(new Map([["lib/fs.ts", real.replace(/\bspawnSync\b/g, fn)]])), [], fn);
  });
  test("a reformatted call passes", () => assert.deepEqual(swap(/,\s*\[BATCH\],\s*\{/, ",\n\n    [BATCH],\n    {"), []));

  test("a second binding of the argv name inside a function", () => pin(added("", '\nfunction evil() { const BATCH = "/tmp/evil.js"; }\n'), /BATCH appears other than twice/));
  test("a parameter that shadows the argv name", () => pin(added("", "\nfunction evil(BATCH) { return BATCH; }\n"), /BATCH appears other than twice/));
  test("an argv name bound to something else", () => pin(swap(/\bconst BATCH = [^;]*;/, 'const BATCH = "/tmp/evil.js";'), /not \[<const>\] bound to fileURLToPath/));
  test("an argv name whose fileURLToPath result is changed after the call", () => pin(swap(/(\bconst BATCH = fileURLToPath\([^;]*\));/, '$1.replace("fsync-batch", "evil");'), /not \[<const>\] bound to fileURLToPath/));
  test("a use above the import line", () => pin(added('function early() { spawnSync("sh", ["-c", "ls"]); }\n'), /2 uses of child_process functions/));
  test("a second call below the real one", () => pin(added("", "\nspawnSync(process.execPath, [BATCH], {});\n"), /2 uses of child_process functions/));
  test("execSync, which runs a shell", () => {
    const src = real.replace(/\{ spawnSync \}/, "{ spawnSync, execSync }") + '\nexecSync("ls");\n';
    pin(violations(new Map([["lib/fs.ts", src]])), /imports execSync from node:child_process; allowed/);
  });
  test("fork by name", () => pin(swap(/\{ spawnSync \}/, "{ fork }"), /imports fork from node:child_process; allowed/));
  test("NODE_OPTIONS in the env literal", () => pin(swap(/env:\s*\{/, 'env: { NODE_OPTIONS: "--require /tmp/evil.js",'), /env entry NODE_OPTIONS.* is neither/));
  test("NODE_OPTIONS in a quoted env key", () => pin(swap(/env:\s*\{/, 'env: { "NODE_OPTIONS": "--require /tmp/evil.js",'), /mentions NODE_OPTIONS/));
  test("NODE_OPTIONS set on process.env", () => pin(added("", '\nprocess.env.NODE_OPTIONS = "--require /tmp/evil.js";\n'), /mentions NODE_OPTIONS/));
  test("env as a variable", () => pin(swap(/env:\s*\{[^}]*\}/, "env: process.env"), /env is not an object literal/));
  test("env as a shorthand property", () => pin(swap(/env:\s*\{[^}]*\}/, "env"), /env is not an object literal/));
  test("env that spreads another object", () => pin(swap(/\.\.\.process\.env/, "...extra"), /env entry \.\.\.extra is neither/));
  test("shell in the options", () => pin(swap(/\btimeout:/, "shell: true, timeout:"), /option shell: true is not one of/));
  test("shell as a quoted key", () => pin(swap(/\btimeout:/, '"shell": "/bin/sh", timeout:'), /option "shell"/));
  test("shell as a shorthand property", () => pin(swap(/\btimeout:/, "shell, timeout:"), /option shell is not one of/));
  test("an option outside the list", () => pin(swap(/\btimeout:/, 'cwd: "/tmp", timeout:'), /option cwd/));
  test("options that spread another object", () => pin(swap(/\btimeout:/, "...extra, timeout:"), /option \.\.\.extra is not one of/));
  test("options passed as a variable", () => pin(swap(/(\[BATCH\],\s*)\{/, "$1opts); void {"), /options are not an object literal/));
  test("a command other than process.execPath", () => pin(swap(/\bprocess\.execPath\b/, '"sh"'), /command is "sh", not process\.execPath/));
  test("a command built from a variable", () => pin(swap(/\bprocess\.execPath\b/, "process.argv[0]"), /command is process\.argv\[0\]/));
  test("another script in the argv", () => pin(swap(/\.\/fs\/fsync-batch\.ts/, "./fs/other.ts"), /resolves to lib\/fs\/other\.ts, not lib\/fs\/fsync-batch\.ts/));
  test("a script outside lib/fs/", () => pin(swap(/\.\/fs\/fsync-batch\.ts/, "../bin/rig.ts"), /resolves to bin\/rig\.ts/));
  test("an extra argv element", () => pin(swap(BATCH, '[BATCH, "-e"]'), /is not \[<const>\]/));
  test("an argv that is not an array", () => pin(swap(BATCH, "args"), /is not \[<const>\]/));
  test("an argv element that is a string", () => pin(swap(BATCH, '["x.js"]'), /is not \[<const>\]/));
  test("a call with the options left out", () => pin(swap(/(\[BATCH\]),\s*\{/, "$1); void {"), /2 arguments, expected/));
  test("a child_process function used without a direct call", () => pin(swap(CALLING, "(0, spawnSync)"), /used other than as a direct call/));
  test("an aliased import", () => pin(swap(/\{ spawnSync \}/, "{ spawnSync as run }"), /aliases a child_process import/));
  test("a namespace import", () => pin(swap(/\{ spawnSync \}/, "* as cp"), /imports \* from node:child_process/));
  test("a re-export", () => pin(added("", '\nexport { spawn } from "node:child_process";\n'), /re-exports node:child_process/));
  test("a second import statement that adds a second use", () => pin(added('import { spawn } from "node:child_process";\n', "\nspawn(process.execPath, [BATCH], {});\n"), /2 uses of child_process functions/));
  test("the pin binds only the pinned module", () => {
    assert.deepEqual(violations(new Map([["lib/lock/git.ts", 'import { spawnSync } from "node:child_process";\nspawnSync("git", ["status"], { shell: false });']])), []);
  });
});
