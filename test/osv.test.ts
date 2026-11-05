// refreshOsv and the OSV cache: lockfile parsing, severity mapping, the cache shape the cve check reads, and the
// command that may use the network. Every request goes through an injected fetchFn, so nothing here reaches OSV.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import type { TestContext } from "node:test";
import { packAddCmd, pinCmd } from "../lib/commands.ts";
import type { ParsedArgs } from "../lib/commands.ts";
import { refreshOsv } from "../lib/gate.ts";
import type { FetchFn } from "../lib/gate.ts";
import { osvFetch } from "../lib/lock.ts";
import { cvss3Score, parseNpmLock, severityOf } from "../lib/gate/osv.ts";
import type { Deps } from "../lib/commands/shared.ts";
import { makeFixtureHome } from "./helpers/fixture-home.ts";
import { cleanup as rmScratch, makeRepo, MIT_TEXT, scratch } from "./lock.helpers.ts";
import { json, ROOT, setup } from "./pstack.helpers.ts";

const STATE = ".local/state/rig";
const CACHE = `${STATE}/cache/osv/npm.json`;
const sha256 = (b: string | Uint8Array) => `sha256:${createHash("sha256").update(b).digest("hex")}`;

type Pkg = [name: string, version: string];
/** A package-lock.json: the root entry, the named packages under node_modules, and a legacy dependencies tree. */
const lockText = (pkgs: Pkg[], lockfileVersion = 3) => json({
  name: "app", lockfileVersion,
  packages: { "": { name: "app", version: "1.0.0" }, ...Object.fromEntries(pkgs.map(([n, v]) => [`node_modules/${n}`, { version: v }])) },
});

/** An OSV stand-in: querybatch answers ids per "name@version", GET /vulns/<id> answers a record, anything else 404s. */
function osvStub(ids: Record<string, string[]>, records: Record<string, object>) {
  const calls: { url: string; body?: string }[] = [];
  const fetchFn: FetchFn = async (url, body) => {
    calls.push({ url, body });
    if (url === "https://api.osv.dev/v1/querybatch") {
      const { queries } = JSON.parse(body ?? "{}");
      return JSON.stringify({ results: queries.map((q: { package: { name: string }; version: string }) => {
        const found = ids[`${q.package.name}@${q.version}`] ?? [];
        return found.length ? { vulns: found.map((id) => ({ id, modified: "2026-01-01T00:00:00Z" })) } : {};
      }) });
    }
    const id = decodeURIComponent(url.slice(url.lastIndexOf("/") + 1));
    if (!url.startsWith("https://api.osv.dev/v1/vulns/") || !(id in records)) throw new Error(`OSV answered 404 for ${url}`);
    return JSON.stringify(records[id]);
  };
  return { fetchFn, calls };
}
const failing = (): { fetchFn: FetchFn; calls: number[] } => {
  const calls: number[] = [];
  return { fetchFn: async () => { calls.push(1); throw new Error("getaddrinfo ENOTFOUND api.osv.dev"); }, calls };
};

const HIGH = { id: "GHSA-aaaa-bbbb-cccc", database_specific: { severity: "HIGH" } };

describe("parseNpmLock", () => {
  test("lockfileVersion 3 and 2: installed packages only, nested and scoped names, aliases, deduplicated, sorted", () => {
    for (const v of [3, 2]) {
      const bytes = Buffer.from(json({
        lockfileVersion: v,
        packages: {
          "": { name: "app", version: "1.0.0" },
          "node_modules/lodash": { version: "4.17.15" },
          "node_modules/a/node_modules/lodash": { version: "4.17.15" },
          "node_modules/a/node_modules/@scope/pkg": { version: "2.0.0" },
          "node_modules/alias": { name: "real", version: "1.0.0" },
          "node_modules/linked": { link: true, resolved: "../linked" },
          "node_modules/noversion": {},
        },
        dependencies: { lodash: { version: "9.9.9" } },
      }));
      assert.deepEqual(parseNpmLock(bytes), [
        { name: "@scope/pkg", version: "2.0.0" }, { name: "lodash", version: "4.17.15" }, { name: "real", version: "1.0.0" },
      ], `lockfileVersion ${v}`);
    }
  });

  test("lockfileVersion 1, a missing version and invalid JSON are refused with a reason", () => {
    assert.match(String(parseNpmLock(Buffer.from('{"lockfileVersion":1,"dependencies":{}}'))), /lockfileVersion 1 is not 2 or 3/);
    assert.match(String(parseNpmLock(Buffer.from("{}"))), /lockfileVersion null/);
    assert.match(String(parseNpmLock(Buffer.from("not json"))), /not valid JSON/);
  });
});

describe("severity", () => {
  test("cvss3Score matches the FIRST calculator on published vectors", () => {
    const score = (v: string) => cvss3Score(`CVSS:3.1/${v}`);
    assert.equal(score("AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"), 9.8);
    assert.equal(score("AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H"), 10);
    assert.equal(score("AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H"), 7.5);
    assert.equal(score("AV:N/AC:L/PR:L/UI:R/S:C/C:L/I:L/A:N"), 5.4);
    assert.equal(score("AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N"), 5.5);
    assert.equal(score("AV:L/AC:H/PR:H/UI:R/S:U/C:L/I:N/A:N"), 1.8);
    assert.equal(score("AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N"), 0);
  });

  test("cvss3Score refuses CVSS v4, v2 and malformed vectors", () => {
    assert.equal(cvss3Score("CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N"), null);
    assert.equal(cvss3Score("AV:N/AC:L/Au:N/C:P/I:P/A:P"), null);
    assert.equal(cvss3Score("CVSS:3.1/AV:N/AC:L"), null);
    assert.equal(cvss3Score("CVSS:3.1/AV:X/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"), null);
  });

  test("database_specific.severity wins; else the highest CVSS v3 band; else unknown", () => {
    assert.equal(severityOf({ database_specific: { severity: "MODERATE" }, severity: [{ type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H" }] }), "moderate");
    const v = (s: string) => ({ severity: [{ type: "CVSS_V3", score: `CVSS:3.1/${s}` }] });
    assert.equal(severityOf(v("AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H")), "critical");
    assert.equal(severityOf(v("AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H")), "high");
    assert.equal(severityOf(v("AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N")), "moderate");
    assert.equal(severityOf(v("AV:L/AC:H/PR:H/UI:R/S:U/C:L/I:N/A:N")), "low");
    assert.equal(severityOf({ severity: [{ type: "CVSS_V3", score: "7.5" }] }), "high");
    assert.equal(severityOf({ database_specific: { severity: "MEDIUM" } }), "moderate");
    assert.equal(severityOf({ severity: [{ type: "CVSS_V3", score: "CVSS:3.1/AV:L/AC:H/PR:H/UI:R/S:U/C:L/I:N/A:N" }, { type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H" }] }), "high");
  });

  test("unknown severity stays unknown: nothing, a v4-only vector, an unrecognized label, or a score above 10", () => {
    assert.equal(severityOf({}), "unknown");
    assert.equal(severityOf(null), "unknown");
    assert.equal(severityOf({ severity: [{ type: "CVSS_V4", score: "CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N" }] }), "unknown");
    assert.equal(severityOf({ database_specific: { severity: "SEVERE" } }), "unknown");
    assert.equal(severityOf({ severity: [{ type: "CVSS_V3", score: "42" }] }), "unknown");
  });
});

/** A fixture HOME and the fs context refreshOsv writes through. */
function ctxHome(t: TestContext) {
  const fx = makeFixtureHome();
  t.after(() => fx.cleanup());
  const ctx = { home: fx.home, state: fx.path(STATE), data: fx.path(".local/share/rig"), neverWrite: [], readSets: [] };
  return { fx, ctx, world: (osv = new Map()) => ({ ctx, osv }) };
}
const file = (path: string, text: string) => ({ path, bytes: Buffer.from(text) });

describe("refreshOsv", () => {
  test("writes cache/osv/npm.json in the shape the cve check reads, keyed by the sha256 of the manifest bytes", async (t) => {
    const h = ctxHome(t);
    const text = lockText([["lodash", "4.17.15"], ["left-pad", "1.3.0"]]);
    const stub = osvStub({ "lodash@4.17.15": ["GHSA-aaaa-bbbb-cccc", "GHSA-dddd-eeee-ffff"] }, {
      "GHSA-aaaa-bbbb-cccc": HIGH,
      "GHSA-dddd-eeee-ffff": { id: "GHSA-dddd-eeee-ffff", database_specific: { severity: "LOW" } },
    });
    const r = await refreshOsv(h.world(), "deps", [file("package-lock.json", text), file("skills/a/SKILL.md", "# A\n")], stub.fetchFn);
    assert.deepEqual(r.findings, []);
    assert.deepEqual(JSON.parse(h.fx.read(CACHE)), {
      schema: 1,
      results: { [sha256(text)]: { advisories: [{ id: "GHSA-aaaa-bbbb-cccc", severity: "high" }, { id: "GHSA-dddd-eeee-ffff", severity: "low" }] } },
    });
    const batch = stub.calls.filter((c) => c.url.endsWith("/querybatch"));
    assert.equal(batch.length, 1, "one batch for both packages");
    assert.deepEqual(JSON.parse(batch[0].body ?? "{}").queries, [
      { package: { name: "left-pad", ecosystem: "npm" }, version: "1.3.0" },
      { package: { name: "lodash", ecosystem: "npm" }, version: "4.17.15" },
    ]);
  });

  test("a pack without a lockfile makes no request and writes nothing", async (t) => {
    const h = ctxHome(t);
    const stub = osvStub({}, {});
    const r = await refreshOsv(h.world(), "plain", [file("pack.json", "{}"), file("skills/a/SKILL.md", "# A\n")], stub.fetchFn);
    assert.deepEqual(r.findings, []);
    assert.deepEqual(stub.calls, []);
    assert.equal(existsSync(h.fx.path(`${STATE}/cache`)), false);
  });

  test("a lockfile with no dependencies caches an empty advisory list without a request", async (t) => {
    const h = ctxHome(t);
    const stub = osvStub({}, {});
    const text = lockText([]);
    await refreshOsv(h.world(), "deps", [file("package-lock.json", text)], stub.fetchFn);
    assert.deepEqual(stub.calls, []);
    assert.deepEqual(JSON.parse(h.fx.read(CACHE)).results[sha256(text)], { advisories: [] });
  });

  test("a failed request writes nothing and reports a warn finding that names the cause", async (t) => {
    const h = ctxHome(t);
    const f = failing();
    const r = await refreshOsv(h.world(), "deps", [file("package-lock.json", lockText([["lodash", "4.17.15"]]))], f.fetchFn);
    assert.equal(existsSync(h.fx.path(`${STATE}/cache`)), false);
    assert.equal(r.findings.length, 1);
    assert.match(r.findings[0].evidence, /^OSV refresh failed: getaddrinfo ENOTFOUND api\.osv\.dev; nothing was cached, so the cve check blocks on package-lock\.json$/);
    assert.deepEqual([r.findings[0].check, r.findings[0].severity, r.findings[0].path], ["cve", "warn", "package-lock.json"]);
  });

  test("a failed detail request caches nothing for that lockfile, not an advisory of unknown severity", async (t) => {
    const h = ctxHome(t);
    const stub = osvStub({ "lodash@4.17.15": ["GHSA-aaaa-bbbb-cccc"] }, {});
    const r = await refreshOsv(h.world(), "deps", [file("package-lock.json", lockText([["lodash", "4.17.15"]]))], stub.fetchFn);
    assert.equal(existsSync(h.fx.path(`${STATE}/cache`)), false);
    assert.match(r.findings[0].evidence, /^OSV refresh failed: OSV answered 404/);
  });

  test("a malformed batch answer (wrong result count) is a failure, not a pass", async (t) => {
    const h = ctxHome(t);
    const r = await refreshOsv(h.world(), "deps", [file("package-lock.json", lockText([["lodash", "4.17.15"]]))], async () => '{"results":[]}');
    assert.equal(existsSync(h.fx.path(`${STATE}/cache`)), false);
    assert.match(r.findings[0].evidence, /wrong number of results/);
  });

  test("a lockfile with no parser is an info finding and makes no request", async (t) => {
    const h = ctxHome(t);
    const stub = osvStub({}, {});
    const r = await refreshOsv(h.world(), "deps", [file("yarn.lock", "# yarn\n"), file("requirements.txt", "flask==1.0\n"), file("package-lock.json", '{"lockfileVersion":1}')], stub.fetchFn);
    assert.deepEqual(stub.calls, []);
    assert.equal(existsSync(h.fx.path(`${STATE}/cache`)), false);
    assert.deepEqual(r.findings.map((f) => [f.severity, f.path]), [["info", "yarn.lock"], ["info", "requirements.txt"], ["info", "package-lock.json"]]);
    assert.match(r.findings[0].evidence, /no OSV parser for yarn\.lock/);
    assert.match(r.findings[2].evidence, /lockfileVersion 1 is not 2 or 3/);
  });

  test("one lockfile failing does not drop the cache of another", async (t) => {
    const h = ctxHome(t);
    const good = lockText([["left-pad", "1.3.0"]]);
    const bad = lockText([["lodash", "4.17.15"]]);
    const stub = osvStub({ "lodash@4.17.15": ["GHSA-aaaa-bbbb-cccc"] }, {});
    const r = await refreshOsv(h.world(), "deps", [file("a/package-lock.json", good), file("b/package-lock.json", bad)], stub.fetchFn);
    const results = JSON.parse(h.fx.read(CACHE)).results;
    assert.deepEqual(Object.keys(results), [sha256(good)]);
    assert.deepEqual([r.findings.length, r.findings[0]?.path], [1, "b/package-lock.json"]);
  });

  test("a new result merges into the existing file and replaces the entry of the same digest", async (t) => {
    const h = ctxHome(t);
    const text = lockText([["lodash", "4.17.15"]]);
    const old = { schema: 1, results: { "sha256:other": { advisories: [] }, [sha256(text)]: { advisories: [{ id: "STALE", severity: "high" }] } } };
    const stub = osvStub({}, {});
    await refreshOsv(h.world(new Map([["npm", old]])), "deps", [file("package-lock.json", text)], stub.fetchFn);
    assert.deepEqual(JSON.parse(h.fx.read(CACHE)).results, { "sha256:other": { advisories: [] }, [sha256(text)]: { advisories: [] } });
  });

  test("a cache file of another schema is replaced, not merged", async (t) => {
    const h = ctxHome(t);
    const text = lockText([]);
    await refreshOsv(h.world(new Map([["npm", { schema: 2, results: { "sha256:other": { advisories: [] } } }]])), "deps", [file("package-lock.json", text)], osvStub({}, {}).fetchFn);
    assert.deepEqual(Object.keys(JSON.parse(h.fx.read(CACHE)).results), [sha256(text)]);
  });

  test("more than 1000 dependencies go out in batches of 1000", async (t) => {
    const h = ctxHome(t);
    const pkgs: Pkg[] = Array.from({ length: 1001 }, (_, i) => [`p${String(i).padStart(4, "0")}`, "1.0.0"]);
    const stub = osvStub({}, {});
    await refreshOsv(h.world(), "deps", [file("package-lock.json", lockText(pkgs))], stub.fetchFn);
    const sizes = stub.calls.map((c) => JSON.parse(c.body ?? "{}").queries.length);
    assert.deepEqual(sizes, [1000, 1]);
  });

  test("a next_page_token is followed until the listing ends, and an endless one fails", async (t) => {
    const h = ctxHome(t);
    const text = lockText([["lodash", "4.17.15"]]);
    const seen: (string | undefined)[] = [];
    const paged: FetchFn = async (url, body) => {
      if (!url.endsWith("/querybatch")) return JSON.stringify(HIGH);
      const q = JSON.parse(body ?? "{}").queries[0];
      seen.push(q.page_token);
      return JSON.stringify({ results: [q.page_token ? { vulns: [{ id: "GHSA-aaaa-bbbb-cccc" }] } : { vulns: [{ id: "GHSA-dddd-eeee-ffff" }], next_page_token: "p2" }] });
    };
    await refreshOsv(h.world(), "deps", [file("package-lock.json", text)], paged);
    assert.deepEqual(seen, [undefined, "p2"]);
    assert.deepEqual(JSON.parse(h.fx.read(CACHE)).results[sha256(text)].advisories.map((a: { id: string }) => a.id), ["GHSA-aaaa-bbbb-cccc", "GHSA-dddd-eeee-ffff"]);

    const h2 = ctxHome(t);
    const endless: FetchFn = async () => JSON.stringify({ results: [{ vulns: [{ id: "X" }], next_page_token: "again" }] });
    const r = await refreshOsv(h2.world(), "deps", [file("package-lock.json", text)], endless);
    assert.match(r.findings[0].evidence, /still had result pages/);
    assert.equal(existsSync(h2.fx.path(`${STATE}/cache`)), false);
  });

  test("an advisory with no usable severity is cached as unknown", async (t) => {
    const h = ctxHome(t);
    const text = lockText([["lodash", "4.17.15"]]);
    await refreshOsv(h.world(), "deps", [file("package-lock.json", text)], osvStub({ "lodash@4.17.15": ["MAL-2026-1"] }, { "MAL-2026-1": { id: "MAL-2026-1" } }).fetchFn);
    assert.deepEqual(JSON.parse(h.fx.read(CACHE)).results[sha256(text)].advisories, [{ id: "MAL-2026-1", severity: "unknown" }]);
  });
});

// The commands. They run in-process so the test can inject fetchFn; the plan that follows runs as a child process.

/** Run a handler with its output collected through deps.out. */
async function run(handler: (a: ParsedArgs, env: NodeJS.ProcessEnv, deps: Deps) => Promise<unknown>, a: ParsedArgs, env: NodeJS.ProcessEnv, fetchFn: FetchFn) {
  let out = "";
  const code = await handler(a, env, { fetchFn, out: { write: (s: string) => ((out += s), true) } });
  return { code, out };
}
const packAdd = (repo: string, sha: string, path: string): ParsedArgs => ({ cmd: "pack", sub: "add", args: { repo }, flags: { sha, root: path, path: ["."] } });

/** A repo whose skill carries a package-lock.json (or nothing else when `lock` is null). */
function depsRepo(t: TestContext, lock: string | null) {
  const base = scratch();
  t.after(() => rmScratch(base));
  return makeRepo(base, [{
    LICENSE: MIT_TEXT,
    "skills/deps/SKILL.md": "---\nname: deps\ndescription: Deps.\n---\nUse deps.\n",
    ...(lock === null ? {} : { "skills/deps/package-lock.json": lock }),
  }]);
}

/** List the vendored pack in rig.json, so rig plan gates it. */
function listPack(s: ReturnType<typeof setup>, name: string) {
  const path = join(s.root, "rig.json");
  writeFileSync(path, json({ ...JSON.parse(readFileSync(path, "utf8")), packs: { ...JSON.parse(readFileSync(path, "utf8")).packs, [name]: {} } }));
}

describe("rig pack add refreshes the OSV cache", () => {
  const LOCK = lockText([["lodash", "4.17.15"], ["left-pad", "1.3.0"]]);
  const vulnerable = () => osvStub({ "lodash@4.17.15": ["GHSA-aaaa-bbbb-cccc"] }, { "GHSA-aaaa-bbbb-cccc": HIGH });

  test("a vulnerable lockfile writes the cache, and the next rig plan blocks on cve", async (t) => {
    const s = setup();
    t.after(() => s.fx.cleanup());
    const repo = depsRepo(t, LOCK);
    const stub = vulnerable();
    const r = await run(packAddCmd, packAdd(repo.url, repo.shas[0], "skills/deps"), s.env, stub.fetchFn);
    assert.match(r.out, /^vendored deps into packs\/deps\/ of the repo root/m);
    assert.match(r.out, /^block cve deps\/package-lock\.json: GHSA-aaaa-bbbb-cccc: high advisory for npm dependencies$/m);
    assert.equal(r.code, 1, "pack add reports the cve block");
    const cache = JSON.parse(s.read(CACHE));
    assert.deepEqual(cache.results[sha256(LOCK)].advisories, [{ id: "GHSA-aaaa-bbbb-cccc", severity: "high" }]);

    listPack(s, "deps");
    const p = s.rig(["plan"]);
    assert.equal(p.code, 1, p.stdout + p.stderr);
    assert.match(p.stdout, /^block cve deps\/package-lock\.json: GHSA-aaaa-bbbb-cccc: high advisory/m);
  });

  test("a clean lockfile caches an empty list, and the next rig plan has no cve finding", async (t) => {
    const s = setup();
    t.after(() => s.fx.cleanup());
    const repo = depsRepo(t, LOCK);
    const r = await run(packAddCmd, packAdd(repo.url, repo.shas[0], "skills/deps"), s.env, osvStub({}, {}).fetchFn);
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(JSON.parse(s.read(CACHE)).results[sha256(LOCK)], { advisories: [] });
    listPack(s, "deps");
    const p = s.rig(["plan"]);
    assert.equal(p.code, 0, p.stdout + p.stderr);
    assert.doesNotMatch(p.stdout, /\bcve\b/);
  });

  test("a network failure writes no cache, pack add says so, and the next rig plan blocks on the missing cache", async (t) => {
    const s = setup();
    t.after(() => s.fx.cleanup());
    const repo = depsRepo(t, LOCK);
    const f = failing();
    const r = await run(packAddCmd, packAdd(repo.url, repo.shas[0], "skills/deps"), s.env, f.fetchFn);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /^warn cve deps\/package-lock\.json: OSV refresh failed: getaddrinfo ENOTFOUND api\.osv\.dev; nothing was cached/m);
    assert.match(r.out, /^block cve deps\/package-lock\.json: no cached OSV result: cache\/osv\/npm\.json is absent\./m);
    assert.equal(existsSync(s.fx.path(CACHE)), false);

    listPack(s, "deps");
    const p = s.rig(["plan"]);
    assert.equal(p.code, 1, p.stdout + p.stderr);
    assert.match(p.stdout, /^block cve deps\/package-lock\.json: no cached OSV result/m);
  });

  test("a pack without a manifest makes no request", async (t) => {
    const s = setup();
    t.after(() => s.fx.cleanup());
    const repo = depsRepo(t, null);
    const stub = vulnerable();
    const r = await run(packAddCmd, packAdd(repo.url, repo.shas[0], "skills/deps"), s.env, stub.fetchFn);
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(stub.calls, []);
    assert.equal(existsSync(s.fx.path(`${STATE}/cache`)), false);
  });

  test("a yarn.lock gets an info finding, no request, and the cve block of a missing cache", async (t) => {
    const s = setup();
    t.after(() => s.fx.cleanup());
    const base = scratch();
    t.after(() => rmScratch(base));
    const repo = makeRepo(base, [{ LICENSE: MIT_TEXT, "skills/deps/SKILL.md": "---\nname: deps\ndescription: Deps.\n---\nUse deps.\n", "skills/deps/yarn.lock": "# yarn lockfile v1\n" }]);
    const stub = vulnerable();
    const r = await run(packAddCmd, packAdd(repo.url, repo.shas[0], "skills/deps"), s.env, stub.fetchFn);
    assert.deepEqual(stub.calls, []);
    assert.match(r.out, /^info cve deps\/yarn\.lock: no OSV parser for yarn\.lock/m);
    assert.match(r.out, /^block cve deps\/yarn\.lock: no cached OSV result/m);
    assert.equal(r.code, 1);
  });
});

describe("rig pin check core", () => {
  const pinArgs = (name: string): ParsedArgs => ({ cmd: "pin", sub: "check", args: { name }, flags: {} });

  test("pin check core makes no request", async (t) => {
    const s = setup();
    t.after(() => s.fx.cleanup());
    const stub = osvStub({}, {});
    const r = await run(pinCmd, pinArgs("core"), s.env, stub.fetchFn);
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(stub.calls, []);
  });
});

describe("the network stays in rig pack add", () => {
  test("osvFetch refuses a URL outside api.osv.dev before any request", async () => {
    await assert.rejects(() => osvFetch("https://example.com/v1/querybatch", "{}"), /not an OSV URL/);
    await assert.rejects(() => osvFetch("https://api.osv.dev.evil.test/v1/querybatch", "{}"), /not an OSV URL/);
  });


  test("plan and apply never import the OSV transport", () => {
    for (const f of ["lib/commands/plan.ts", "lib/commands/apply.ts", "lib/commands/doctor.ts"]) {
      assert.doesNotMatch(readFileSync(join(ROOT, f), "utf8"), /osvFetch|refreshOsv/, f);
    }
  });
});
