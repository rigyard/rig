// Test helpers for test/state.test.ts. Every fixture lives in its own temp dir; nothing touches the real HOME.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { apply, plan } from "../lib/state.ts";

export const CHILD = fileURLToPath(new URL("./fixtures/state/child-apply.ts", import.meta.url));
export const STATE_REL = ".local/state/rig";

export function tmpDir(prefix = "rig-state-") {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

export function makeWorld(home, extra = {}) {
  return {
    env: { home, state: path.join(home, STATE_REL), data: path.join(home, ".local/share/rig"), test: true },
    targets: new Map([
      ["claude", { reads: { skills: [{ path: "~/.claude/skills", writable: true, dedupe: "none" }], never_write: ["~/.cursor/skills-cursor/**"] } }],
    ]),
    ...extra,
  };
}
export const ctxOf = (world) => ({ home: world.env.home, state: world.env.state, neverWrite: ["~/.cursor/skills-cursor/**"], readSets: ["~/.claude/skills"] });

/** A trivial stand-in for targets.patch: kind block only, TOML comment markers. */
export function fakePatch(bytes, entry) {
  if (entry.kind !== "block") return { current: null, next: bytes ?? Buffer.alloc(0), markers: "n/a", error: { code: "E_LOCATOR", message: "fake patch: block only" } };
  const text = bytes ? Buffer.from(bytes).toString("utf8") : "";
  const start = `# ${entry.marker}:start\n`;
  const end = `# ${entry.marker}:end\n`;
  const i = text.indexOf(start);
  const k = i < 0 ? -1 : text.indexOf(end, i + start.length);
  if (i >= 0 && k < 0) return { current: null, next: Buffer.from(text), markers: "present", error: { code: "E_LOCATOR", message: "unclosed block" } };
  const current = i < 0 ? null : Buffer.from(text.slice(i + start.length, k));
  let next;
  if (entry.remove) next = i < 0 ? text : text.slice(0, i) + text.slice(k + end.length);
  else {
    const block = start + Buffer.from(entry.bytes).toString("utf8") + end;
    if (i >= 0) next = text.slice(0, i) + block + text.slice(k + end.length);
    else next = (text ? `${text}${text.endsWith("\n") ? "" : "\n"}\n` : "") + block;
  }
  return { current, next: Buffer.from(next), markers: "present" };
}

const body = (rel, rev) => Buffer.from(`# ${rel} rev ${rev}\n${`lorem ipsum ${rel.length}\n`.repeat(20)}`);
const skill = (i) => `.claude/skills/s${String(i).padStart(3, "0")}/SKILL.md`;

/**
 * Desired state version v (0, 1, 2) over n skills. bulk: v1 updates every skill (many mutations).
 * v1 vs v0: updates, two removes, creates, a 0600 update, a mode-only change, a block update.
 * v2 vs v1: removes files that v1 created, more updates.
 */
export function desiredV(home, v, { n = 6, bulk = false } = {}) {
  const owned = new Map();
  const put = (rel, rev, mode = 0o644) => owned.set(rel, { rev, mode });
  for (let i = 0; i < n; i++) put(skill(i), 0);
  put(".config/tool/token.env", 0, 0o600);
  put(".claude/agents/reviewer.md", 0);
  put(".claude/scripts/run.sh", 0, 0o644);
  if (v >= 1) {
    owned.delete(skill(n - 1));
    owned.delete(skill(n - 2));
    for (let i = 0; i < (bulk ? n - 2 : 2); i++) put(skill(i), 1);
    put(".config/tool/token.env", 1, 0o600);
    put(".claude/scripts/run.sh", 0, 0o755);
    put(skill(n), 1);
    put(".new/deep/dir/file.md", 1);
  }
  if (v >= 2) {
    owned.delete(skill(n));
    owned.delete(".new/deep/dir/file.md");
    put(skill(0), 2);
  }
  const entries = new Map();
  for (const [rel, { rev, mode }] of owned) {
    const p = path.join(home, rel);
    entries.set(p, { kind: "owned", path: p, bytes: body(rel, rev), mode, unit: `pack/${path.basename(path.dirname(rel))}` });
  }
  const cfg = path.join(home, ".codex/config.toml");
  entries.set(cfg, { kind: "block", path: cfg, marker: "rig:models", bytes: Buffer.from(`model = "m${v}"\n`), unit: "models/codex" });
  return { entries, errors: [], info: [] };
}

/** Files the user owns before rig runs. config.toml is later patched by the block entry. */
export function seedUserFiles(home) {
  const files = {
    ".codex/config.toml": '[user]\nname = "placeholder"\n',
    "notes.txt": "not rig\n",
    ".claude/settings.json": '{\n  "foreign": true\n}\n',
  };
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(home, rel)), { recursive: true });
    fs.writeFileSync(path.join(home, rel), text);
  }
}

const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");

/** rel -> "sha:mode" for every file in HOME outside the state root. */
export function snapshot(home) {
  const out = new Map();
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      const rel = path.relative(home, p);
      if (rel === STATE_REL) continue;
      if (e.isDirectory()) walk(p);
      else {
        const st = fs.lstatSync(p);
        out.set(rel, e.isSymbolicLink() ? `link:${fs.readlinkSync(p)}` : `${sha256(fs.readFileSync(p))}:${(st.mode & 0o7777).toString(8)}`);
      }
    }
  };
  walk(home);
  return out;
}
export const asObj = (m) => Object.fromEntries([...m].sort(([a], [b]) => (a < b ? -1 : 1)));

/** Temp files of a write in HOME, outside the state root. */
export const litter = (home: string): string[] => [...snapshot(home).keys()].filter((rel) => rel.endsWith(".rig-tmp"));

/** Each intent of one run with its disk state: "after", "before" or "neither", by sha and mode, as recovery classifies it. */
export function intentStates(world: {env: {home: string, state: string}}, run: string): {path: string, op: string, state: string}[] {
  return journalLines(world, run).filter((l) => l.type === "intent").map((it) => {
    const p = path.join(world.env.home, it.path.slice(2));
    let sha = null;
    let mode = null;
    if (fs.existsSync(p)) {
      sha = `sha256:${sha256(fs.readFileSync(p))}`;
      mode = fs.statSync(p).mode & 0o7777;
    }
    const is = (s: string | null, m: number | null) => sha === s && (s === null || mode === m);
    return { path: it.path, op: it.op, state: is(it.after_sha, it.after_mode) ? "after" : is(it.before_sha, it.before_mode) ? "before" : "neither" };
  });
}

export function readInstalledFile(world) {
  return JSON.parse(fs.readFileSync(path.join(world.env.state, "installed.json"), "utf8"));
}
export function journals(world) {
  const dir = path.join(world.env.state, "journal");
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith(".jsonl")).sort() : [];
}
export function journalLines(world, run) {
  return fs.readFileSync(path.join(world.env.state, "journal", `${run}.jsonl`), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

/** installed.json agrees with disk: keys equal the desired set, owned sha and mode match, block digests match. */
export function installedMismatch(world, desired) {
  const inst = readInstalledFile(world).entries;
  const home = world.env.home;
  const want = [...desired.entries.values()].map((e) => `~/${path.relative(home, e.path)}`).sort();
  const have = Object.keys(inst).sort();
  if (JSON.stringify(want) !== JSON.stringify(have)) return `keys differ: ${JSON.stringify(have)} vs ${JSON.stringify(want)}`;
  for (const [tilde, e] of Object.entries(inst)) {
    const p = path.join(home, tilde.slice(2));
    const bytes = fs.readFileSync(p);
    if (e.kind === "owned") {
      if (sha256(bytes) !== e.sha256 || (fs.statSync(p).mode & 0o7777) !== e.mode) return `owned ${tilde} differs from disk`;
    } else {
      const d = `sha256:${sha256(fakePatch(bytes, { kind: "block", marker: e.marker, bytes: Buffer.alloc(0) }).current)}`;
      if (d !== e.digest) return `block ${tilde} digest differs from disk`;
    }
  }
  return null;
}

/** plan then apply, re-planning when apply says the plan is stale. */
export function converge(desired, world, opts = { patch: fakePatch }) {
  for (let i = 0; i < 3; i++) {
    const p = plan(desired, { findings: [], blocked: false }, world, opts);
    const r = apply(p, world);
    if (!r.replan) return { plan: p, result: r };
  }
  throw new Error("apply kept asking for a re-plan");
}

/** Run the child apply. killAfterMs: send SIGKILL after that delay. fdLimit: run it under `ulimit -n <fdLimit>`. */
export function runChild(home, v, { env = {}, killAfterMs = 0, n = 6, bulk = false, fdLimit = 0 } = {}): Promise<{code: number | null, signal: string | null, stderr: string, ms: number}> {
  return new Promise((resolve) => {
    const t0 = process.hrtime.bigint();
    const [cmd, args] = fdLimit ? ["bash", ["-c", `ulimit -n ${fdLimit} && exec "$0" "$@"`, process.execPath, CHILD]] : [process.execPath, [CHILD]];
    const ch = spawn(cmd, args, {
      env: { PATH: process.env.PATH, RIG_STATE_CHILD: "1", FIXTURE_HOME: home, RIG_V: String(v), RIG_N: String(n), RIG_BULK: bulk ? "1" : "", ...env },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    ch.stderr.on("data", (d) => (stderr += d));
    const timer = killAfterMs ? setTimeout(() => ch.kill("SIGKILL"), killAfterMs) : null;
    ch.on("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stderr, ms: Number(process.hrtime.bigint() - t0) / 1e6 });
    });
  });
}

/** Seeded PRNG (mulberry32). */
export function prng(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
