import { readFileSync, readdirSync, statSync, realpathSync } from "node:fs";
import { join } from "node:path";

/** Parsed object lines of a JSONL file. A torn or malformed line is skipped. An unreadable file yields nothing. */
export function* jsonlObjects(file) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    if (!line) continue;
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) yield value;
  }
}

/** Recursive file walk. Symlinks are not followed. A missing directory yields nothing. */
export function walk(dir, accept, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, accept, out);
    else if (entry.isFile() && accept(path)) out.push(path);
  }
  return out;
}

export function listDirs(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch {
    return [];
  }
}

export function listFiles(dir, accept) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && accept(e.name))
      .map((e) => join(dir, e.name))
      .sort();
  } catch {
    return [];
  }
}

export function mtimeMs(file) {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

export function realpathOrNull(path) {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

/** ISO instant without milliseconds, from an ISO string or epoch milliseconds. Null when unparseable. */
export function toIso(value) {
  const ms = typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : NaN;
  if (!Number.isFinite(ms)) return null;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Earliest and latest of a list of ISO instants. */
export function span(stamps) {
  const sorted = stamps.filter(Boolean).sort();
  return { start: sorted[0] ?? null, end: sorted[sorted.length - 1] ?? null };
}
