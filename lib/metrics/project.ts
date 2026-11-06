// Field allowlist projection. A reader never touches a raw transcript line:
// every line goes through project() first, so a key that is not named in a
// spec cannot reach the aggregate. Dropped key paths are reported by name only.
import { createHash } from "node:crypto";
import { NO_REFS } from "./unit-paths.ts";
import type { UnitRefs } from "./unit-paths.ts";

// A string leaf survives only when it looks like an identifier (model id, tool
// name, timestamp). Prose has spaces, so it fails this shape check.
const SAFE_STRING = /^[A-Za-z0-9_.:/@+?-]{1,100}$/;
const KEY_NAME = /^[A-Za-z_][A-Za-z0-9_-]{0,39}$/;
const MAX_DROPPED = 200;

// Prompt-like keys. A spec that names one fails at module load.
const FORBIDDEN_ANYWHERE = new Set([
  "last-prompt", "lastPrompt", "queue-operation", "wireToolInputs", "ai-title", "aiTitle",
  "hookInfos", "command", "body", "origin", "text", "prompt", "instructions", "arguments",
  "summary", "stdin", "message_text",
]);
const FORBIDDEN_TOP_LEVEL = new Set(["content"]);

const UNITS = Symbol("units");

/**
 * A leaf that keeps no text: the string is handed to the resolver and only the unit dir names it returns survive.
 * `startsWith` skips a string that does not begin so. `within` (a global RegExp) narrows the scan to its matches.
 * A scanned string with no match is not a dropped key: the key is allowed, and nothing of it survives.
 */
export function units(opts: {startsWith?: string, within?: RegExp} = {}) {
  return Object.freeze({ ...opts, [UNITS]: true });
}
const isUnits = (spec: any): boolean => spec?.[UNITS] === true;
const onlyUnits = (spec: any): boolean => isUnits(spec) || (spec && typeof spec === "object" && Object.values(spec).length > 0 && Object.values(spec).every(onlyUnits));

/** A prompt-like key may carry only `units()` leaves: nothing below it can reach the aggregate as text. */
export function assertSafeSpec(spec, where = "spec", depth = 0) {
  for (const [key, sub] of Object.entries(spec)) {
    if ((FORBIDDEN_ANYWHERE.has(key) || (depth === 0 && FORBIDDEN_TOP_LEVEL.has(key))) && !onlyUnits(sub)) {
      throw new Error(`${where}: prompt-like key "${key}" is not allowed in an allowlist`);
    }
    if (sub && typeof sub === "object" && !isUnits(sub)) assertSafeSpec(sub, `${where}.${key}`, depth + 1);
  }
}

function note(sink, path) {
  const last = path.slice(path.lastIndexOf(".") + 1).replace(/\[\]$/, "");
  if (sink.size < MAX_DROPPED && KEY_NAME.test(last)) sink.add(path);
}

export function sha256Short(text) {
  return "sha256:" + createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/**
 * Leaf specs: `true` keeps a number, a boolean or an identifier-shaped string.
 * "LEN" keeps the UTF-8 byte length of a string. "HASH" keeps a short hash.
 * `units()` keeps the unit dir names the resolver finds in a string, as an array, never the string.
 * An object spec keeps only the keys it names. An array applies the spec to each element.
 */
export function project(value, spec, sink, path, refs: UnitRefs = NO_REFS) {
  if (isUnits(spec)) {
    if (typeof value !== "string" || (spec.startsWith && !value.startsWith(spec.startsWith))) {
      note(sink, path);
      return undefined;
    }
    const scanned = spec.within ? (value.match(spec.within) ?? []).join("\n") : value;
    const names = refs(scanned);
    return names.length ? names : undefined;
  }
  if (spec === "LEN") {
    if (typeof value === "string") return Buffer.byteLength(value);
    note(sink, path);
    return undefined;
  }
  if (spec === "HASH") {
    if (typeof value === "string" && value) return sha256Short(value);
    note(sink, path);
    return undefined;
  }
  if (spec === true) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "boolean") return value;
    if (typeof value === "string" && SAFE_STRING.test(value)) return value;
    note(sink, path);
    return undefined;
  }
  if (Array.isArray(value)) {
    const out = [];
    for (const item of value) {
      const kept = project(item, spec, sink, `${path}[]`, refs);
      if (kept !== undefined) out.push(kept);
    }
    return out;
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(spec, key)) {
        note(sink, `${path}.${key}`);
        continue;
      }
      const kept = project(value[key], spec[key], sink, `${path}.${key}`, refs);
      if (kept !== undefined) out[key] = kept;
    }
    return out;
  }
  note(sink, path);
  return undefined;
}

/** Project one transcript line. The path root is the line's own type when it is identifier-shaped. */
export function projectLine(line, spec, sink, refs: UnitRefs = NO_REFS) {
  const type = typeof line.type === "string" && SAFE_STRING.test(line.type) ? line.type : "?";
  return project(line, spec, sink, type, refs);
}
