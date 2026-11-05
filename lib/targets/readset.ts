// lib/targets/readset.ts — internal to targets. See docs/design/rig-architecture.md section 7, "doctor duplicates".
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { collapseCopies } from "./place.ts";

const MAX_PLUGIN_DEPTH = 6;

const expand = (p, home) => (p === "~" ? home : p.startsWith("~/") ? join(home, p.slice(2)) : p);
const missing = (e) => e.code === "ENOENT" || e.code === "ENOTDIR";

function list(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    if (missing(e)) return [];
    throw e;
  }
}

/** A directory entry that is a directory, or a symlink that resolves to one. Dot entries never count. */
function subdirs(dir) {
  const out = [];
  for (const ent of list(dir)) {
    if (ent.name.startsWith(".")) continue;
    const path = join(dir, ent.name);
    let isDir = ent.isDirectory();
    if (ent.isSymbolicLink()) {
      try {
        isDir = statSync(path).isDirectory();
      } catch (e) {
        if (!missing(e)) throw e;
      }
    }
    if (isDir) out.push({ name: ent.name, path });
  }
  return out;
}

function skillsIn(dir, plugin) {
  const found = [];
  const walk = (d, depth) => {
    for (const sub of subdirs(d)) {
      const file = join(sub.path, "SKILL.md");
      let bytes = null;
      try {
        bytes = readFileSync(file);
      } catch (e) {
        if (!missing(e) && e.code !== "EISDIR") throw e;
      }
      if (bytes) found.push({ name: sub.name, path: sub.path, file, bytes });
      else if (plugin && depth < MAX_PLUGIN_DEPTH) walk(sub.path, depth + 1);
    }
  };
  walk(dir, 1);
  return found;
}

/** @param {unknown} installed installed.json, its entries object, or a Map of path to entry */
function managedFiles(installed, home) {
  if (!installed) return new Set();
  const raw = installed instanceof Map ? Object.fromEntries(installed) : (installed.entries ?? installed);
  const out = new Set();
  for (const [path, entry] of Object.entries(raw)) {
    if (entry?.kind === "owned") out.add(expand(path, home));
  }
  return out;
}

/**
 * Every skill each harness lists, after its own dedupe rule. Reads the dirs the world's targets declare,
 * skips dot entries, and keys each skill by (name, realpath, SKILL.md sha256). Copies that the harness collapses
 * become one entry. Copies it keeps apart stay separate, even a symlink and its target.
 * @param installed  installed.json (or its `entries`). With it, `managed` marks rig-written SKILL.md files.
 */
export function readSet(world: {env: {home: string}, targets: Map<string, object>}, installed?: unknown): Map<string, {name: string, path: string, realpath: string, sha256: string, managed: boolean, dir: string}[]> {
  const home = world.env.home;
  const managedSet = managedFiles(installed, home);
  const result = new Map();
  for (const [harness, record] of world.targets) {
    const items = [];
    for (const entry of record.reads.skills) {
      const dir = expand(entry.path, home);
      for (const s of skillsIn(dir, Boolean(entry.plugin))) {
        items.push({
          name: s.name,
          path: s.path,
          realpath: realpathSync(s.path),
          sha256: createHash("sha256").update(s.bytes).digest("hex"),
          managed: managedSet.has(s.file),
          dir: entry.path,
          dedupe: entry.dedupe,
        });
      }
    }
    const byName = new Map();
    for (const it of items) byName.set(it.name, [...(byName.get(it.name) ?? []), it]);
    const listed = [];
    for (const group of byName.values()) {
      for (const copies of collapseCopies(group.map((it) => ({ ...it, digest: it.sha256 })))) {
        const { dedupe, digest, ...rep } = copies[0];
        listed.push({ ...rep, managed: copies.some((c) => c.managed) });
      }
    }
    result.set(harness, listed);
  }
  return result;
}

/**
 * Effective duplicates: a name with two or more listed entries in one harness.
 * Severity follows the doctor rule: `error` when any entry is managed (a placement bug), else `info`.
 */
export function duplicatesOf(set: ReturnType<typeof readSet>): Map<string, {name: string, severity: "info" | "error", entries: object[]}[]> {
  const out = new Map();
  for (const [harness, entries] of set) {
    const byName = new Map();
    for (const e of entries) byName.set(e.name, [...(byName.get(e.name) ?? []), e]);
    const dups = [];
    for (const [name, group] of byName) {
      if (group.length >= 2) dups.push({ name, severity: group.some((e) => e.managed) ? "error" : "info", entries: group });
    }
    out.set(harness, dups.sort((a, b) => a.name.localeCompare(b.name)));
  }
  return out;
}
