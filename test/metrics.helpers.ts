import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "metrics");
export const CANARY = "Canary sentence zq7x must never reach the store.";
export const NOW = Date.parse("2026-11-05T00:00:00Z");

const TARGETS = {
  claude: { format: "claude-jsonl", root: "~/.claude/projects", from: "claude/projects" },
  codex: { format: "codex-rollout", root: "~/.codex/sessions", from: "codex/sessions" },
  omp: { format: "omp-jsonl", root: "~/.omp/agent/sessions", from: "omp/sessions" },
  cursor: { format: "cursor-agent-jsonl", root: "~/.cursor/projects", from: "cursor/projects" },
};

const IO = new WeakMap();

/** The writer a test injects for `world`: appends under the sandbox state root, like lib/fs.ts appendState and log will. */
export const ioFor = (world) => IO.get(world);

function makeIo(state) {
  const append = (rel, text) => {
    mkdirSync(dirname(join(state, rel)), { recursive: true });
    appendFileSync(join(state, rel), text);
  };
  const write = (rel, text) => {
    mkdirSync(dirname(join(state, rel)), { recursive: true });
    writeFileSync(join(state, rel), text);
  };
  return { append, write, log: (event) => append(join("log", "rig.log"), JSON.stringify(event) + "\n") };
}

/** A temp HOME with the named fixture harnesses copied in, and the minimal `world` the metrics module reads. */
export function makeSandbox(harnesses) {
  const base = mkdtempSync(join(tmpdir(), "rig-metrics-"));
  const home = join(base, "home");
  const state = join(base, "state", "rig");
  mkdirSync(home, { recursive: true });
  const targets = new Map();
  for (const name of harnesses) {
    const t = TARGETS[name];
    cpSync(join(FIXTURES, t.from), join(home, t.root.slice(2)), { recursive: true });
    targets.set(name, { name, transcripts: { format: t.format, root: t.root } });
  }
  const world = { env: { home, state, data: join(base, "data"), test: true }, targets };
  IO.set(world, makeIo(state));
  return { base, home, state, world, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

export const storePath = (sb) => join(sb.state, "metrics.jsonl");

export function storeLines(sb) {
  try {
    return readFileSync(storePath(sb), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

/** Every file under a directory, as text. */
export function allText(dir) {
  const parts = [];
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) parts.push(readFileSync(join(entry.parentPath, entry.name), "utf8"));
  }
  return parts.join("\n");
}

/** Run fn with process.stdout.write captured. */
export function captureStdout(fn) {
  const original = process.stdout.write;
  let out = "";
  process.stdout.write = (chunk) => {
    out += String(chunk);
    return true;
  };
  try {
    return { result: fn(), out };
  } finally {
    process.stdout.write = original;
  }
}
