import { readFileSync, mkdirSync, writeFileSync, symlinkSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const HARNESSES = ["claude", "codex", "omp", "cursor"];

export function loadRecords() {
  const out = new Map();
  for (const h of HARNESSES) {
    out.set(h, JSON.parse(readFileSync(new URL(`../targets/${h}.json`, import.meta.url), "utf8")));
  }
  return out;
}

/** Records with probe-dependent values set. cursor, omp: dedupe value for every read dir. hide: codex hide method. */
export function recordsWith({ cursor = "none", omp = "identical-bytes", codexHide = "sidecar" } = {}) {
  const recs = loadRecords();
  for (const e of recs.get("cursor").reads.skills) e.dedupe = cursor;
  for (const e of recs.get("omp").reads.skills) e.dedupe = omp;
  if (codexHide === "none") recs.get("codex").hide = { method: "none" };
  return recs;
}

/** A unit. Hidden units differ in bytes where the owner adds a sidecar (codex), so digests differ by owner. */
export function unit(harnesses, { hidden = false, channel = {}, id = "kit/review" } = {}) {
  const digests = { claude: "d-plain", omp: "d-plain", cursor: "d-plain", codex: hidden ? "d-sidecar" : "d-plain" };
  return { id, harnesses, channel, digests, hidden };
}

export const paths = (r) => r.dirs.map((d) => d.path);

export function tempHome() {
  return mkdtempSync(join(tmpdir(), "rig-placement-"));
}

export function skill(root, name, body = `# ${name}\n`) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), body);
  return dir;
}

export function link(target, path) {
  mkdirSync(join(path, ".."), { recursive: true });
  symlinkSync(target, path);
}
