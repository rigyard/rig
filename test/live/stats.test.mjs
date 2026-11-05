// Live case for stats: rig stats over this machine's real transcripts, read-only, with a temp state root.
// Opt-in: RIG_LIVE=1. liveTest fails the case when any real harness config hash changes.
// The plan's six harness lanes (a sentinel session per harness, the real SessionEnd hook, a proposal) are not here.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe } from "node:test";
import { liveTest, realHome } from "../helpers/live.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const BIN = join(ROOT, "bin/rig.mjs");
/** A string this long with whitespace in it reads as prose: the store must hold none. */
const PROSE = /\s/;
const PROSE_MIN = 41;

/** Every string (keys included) inside a parsed JSON value. */
function strings(v, out = []) {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) (out.push(k), strings(x, out));
  return out;
}

/** Every file under dir, relative path to text. */
function texts(dir, rel = "") {
  const out = new Map();
  for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) for (const [k, v] of texts(dir, r)) out.set(k, v);
    else out.set(r, readFileSync(join(dir, r), "utf8"));
  }
  return out;
}

describe("stats", () => {
  liveTest("rig stats over the real transcripts keeps a content-free store", (t) => {
    const home = realHome();
    // loadWorld needs the state root inside HOME (E_STATE_ROOT), so the temp roots live under ~/.cache.
    mkdirSync(join(home, ".cache"), { recursive: true });
    const base = mkdtempSync(join(home, ".cache", "rig-live-stats-"));
    t.after(() => rmSync(base, { recursive: true, force: true }));
    const env = {
      PATH: process.env.PATH, HOME: home, RIG_ROOT: ROOT,
      XDG_STATE_HOME: join(base, "state"), XDG_DATA_HOME: join(base, "data"), XDG_CONFIG_HOME: join(base, "config"),
    };
    const started = Date.now();
    const r = spawnSync(process.execPath, [BIN, "stats", "--since", "7d"], { env, cwd: base, encoding: "utf8", input: "", maxBuffer: 64 * 1024 * 1024 });
    const ms = Date.now() - started;
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^rig stats {2}window 7d /);

    const state = join(base, "state", "rig");
    const files = texts(state);
    assert.ok(files.has("metrics.jsonl"), `no store written: ${[...files.keys()].join(", ")}`);
    const lines = files.get("metrics.jsonl").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    for (const [rel, text] of files) {
      for (const raw of text.split("\n").filter(Boolean)) {
        const prose = strings(JSON.parse(raw)).filter((s) => s.length >= PROSE_MIN && PROSE.test(s));
        assert.deepEqual(prose.map((s) => s.slice(0, 12)), [], `${rel} holds prose-shaped strings`);
      }
    }
    for (const line of lines) assert.ok(Buffer.byteLength(JSON.stringify(line)) + 1 < 4096, "every line fits one atomic append");

    // Summary numbers only, for the PR body: sessions and tokens per harness, cache hit where the inputs exist.
    const sum = {};
    for (const line of lines) {
      const h = (sum[line.harness] ??= { sessions: 0, input: 0, output: 0, cache_read: 0, cache_write: 0 });
      h.sessions += 1;
      for (const m of Object.values(line.models ?? {})) for (const k of ["input", "output", "cache_read", "cache_write"]) h[k] += m[k] ?? 0;
    }
    t.diagnostic(`wall ${ms} ms; ${JSON.stringify(sum)}`);
  });
});
