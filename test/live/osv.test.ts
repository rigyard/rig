// Live case for the OSV refresh: one real querybatch for a known-vulnerable package version.
// Opt-in: RIG_LIVE=1. Needs the network; reads api.osv.dev only and writes into a fixture HOME.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe } from "node:test";
import { refreshOsv } from "../../lib/gate.ts";
import { osvFetch } from "../../lib/lock.ts";
import { makeFixtureHome } from "../helpers/fixture-home.ts";
import { liveTest } from "../helpers/live.ts";

describe("osv", () => {
  liveTest("lodash 4.17.15 comes back from api.osv.dev with at least one advisory and a known severity", async (t) => {
    const fx = makeFixtureHome();
    t.after(() => fx.cleanup());
    const ctx = { home: fx.home, state: fx.path(".local/state/rig"), data: fx.path(".local/share/rig"), neverWrite: [], readSets: [] };
    const lock = `${JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "node_modules/lodash": { version: "4.17.15" } } })}\n`;
    const r = await refreshOsv({ ctx, osv: new Map() }, "live", [{ path: "package-lock.json", bytes: Buffer.from(lock) }], osvFetch);
    assert.deepEqual(r.findings, []);
    const cache = JSON.parse(fx.read(".local/state/rig/cache/osv/npm.json"));
    const { advisories } = cache.results[`sha256:${createHash("sha256").update(lock).digest("hex")}`];
    assert.ok(advisories.length >= 1, JSON.stringify(advisories));
    assert.ok(advisories.some((a: { severity: string }) => ["critical", "high", "moderate", "medium", "low"].includes(a.severity)), JSON.stringify(advisories));
  });
});
