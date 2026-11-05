// lib/targets/json-element.ts — internal to targets; reached through targets.patch.
//
// One element inside a JSON array at a JSON pointer (RFC 6901), found by its identity: the command string.
// An element is rig's when its `command` equals the id (Cursor hooks.json shape), or when it is a matcher group whose
// only hook has that command (Claude settings.json shape). A group that also holds foreign hooks is never rig's.
//
// Precondition: the file round-trips byte-identical through JSON.parse and JSON.stringify(v, null, 2) + "\n".
// Under it, reserializing the edited value changes only the bytes of the one element (plus the comma or the
// containers that the insert needs), so every foreign entry keeps its value, its order and its bytes.
// A file that fails the precondition is never rewritten: E_JSON_ROUNDTRIP carries the element for the user to paste.
// Remove leaves an emptied array or object in place: rig cannot tell a container it created from one the user wrote.

const DECODER = new TextDecoder("utf-8", { fatal: true });
const ENCODER = new TextEncoder();

function fail(code, message, path) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.path = path;
  throw error;
}

const canonicalText = (value) => `${JSON.stringify(value, null, 2)}\n`;
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
/** JSON with sorted object keys: two elements that differ only in key order are the same element. */
const sorted = (v) =>
  Array.isArray(v) ? `[${v.map(sorted).join(",")}]`
    : isObject(v) ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${sorted(v[k])}`).join(",")}}`
      : JSON.stringify(v);

/** The first shell word of a command (bare, or single-quoted with `'\''` escapes) and the rest after one space. */
const HEAD = /^('(?:[^']|'\\'')*'|[^\s']+) (.+)$/s;
const unquote = (w: string): string => (w.startsWith("'") ? w.slice(1, -1).replaceAll("'\\''", "'") : w);
const isNode = (w: string): boolean => /(^|\/)node(\.exe)?$/.test(unquote(w));

/**
 * One command identity. rig's hook command is `<node> <rig-bin> ...` and the node path carries a version (a node
 * upgrade moves it), so two commands that differ only in a first word naming a node executable are the same element:
 * plan updates it in place instead of reporting drift.
 */
export function sameCommand(a: unknown, id: string): boolean {
  if (typeof a !== "string") return false;
  if (a === id) return true;
  const x = a.match(HEAD);
  const y = id.match(HEAD);
  return !!x && !!y && x[2] === y[2] && isNode(x[1]) && isNode(y[1]);
}

/** True when `el` is rig's element for `id`. */
export function isOwnElement(el, id) {
  if (!isObject(el)) return false;
  if (sameCommand(el.command, id)) return true;
  return Array.isArray(el.hooks) && el.hooks.length === 1 && isObject(el.hooks[0]) && sameCommand(el.hooks[0].command, id);
}

/** @param {string} pointer @returns {string[]} */
function tokens(pointer, where) {
  if (typeof pointer !== "string" || !pointer.startsWith("/")) fail("E_INTERNAL", `${where}: pointer ${JSON.stringify(pointer)} is not a JSON pointer`, where);
  return pointer.slice(1).split("/").map((t) => t.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function snippet(entry) {
  const what = entry.remove
    ? `remove the element whose command is ${JSON.stringify(entry.id)} from the array at ${entry.pointer}`
    : `add this element to the array at ${entry.pointer}:\n${JSON.stringify(entry.value, null, 2)}`;
  return `rig does not reformat it; ${what}`;
}

/** Parse under the round-trip precondition. @returns {unknown} */
function parseCanonical(bytes, entry) {
  const where = entry.path;
  let text;
  let value;
  try {
    text = DECODER.decode(bytes);
    value = JSON.parse(text);
  } catch {
    fail("E_JSON_ROUNDTRIP", `${where} is not valid JSON; ${snippet(entry)}`, where);
  }
  if (canonicalText(value) !== text) {
    fail("E_JSON_ROUNDTRIP", `${where} does not round-trip through JSON.stringify(v, null, 2); ${snippet(entry)}`, where);
  }
  return value;
}

/**
 * Walk to the array at the pointer. With `create`, missing objects and the final array are added.
 * @returns {unknown[] | null} null when absent and not created
 */
function arrayAt(root, keys, create, where) {
  let node = root;
  for (const [i, key] of keys.entries()) {
    if (!isObject(node)) fail("E_LOCATOR", `${where}: /${keys.slice(0, i).join("/")} is not an object`, where);
    const last = i === keys.length - 1;
    if (!Object.hasOwn(node, key)) {
      if (!create) return null;
      node[key] = last ? [] : {};
    }
    node = node[key];
  }
  if (!Array.isArray(node)) fail("E_LOCATOR", `${where}: ${"/" + keys.join("/")} is not an array`, where);
  return node;
}

/**
 * Insert, find or remove rig's element.
 * @param bytes  current file bytes, null when absent
 * @returns current: rig's element as found, or null
 */
export function patchJsonElement(bytes: Uint8Array | null, entry: {path: string, pointer: string, id: string, value?: unknown, remove?: boolean}): {current: unknown | null, next: Uint8Array, markers: "n/a"} {
  const where = entry.path;
  if (typeof entry.id !== "string" || !entry.id) fail("E_INTERNAL", `${where}: json-element entry has no id`, where);
  const keys = tokens(entry.pointer, where);
  if (!entry.remove && !isOwnElement(entry.value, entry.id)) fail("E_INTERNAL", `${where}: the rendered element does not carry its own id`, where);

  if (bytes === null) {
    if (entry.remove) return { current: null, next: new Uint8Array(), markers: "n/a" };
    const root = {};
    arrayAt(root, keys, true, where).push(entry.value);
    return { current: null, next: ENCODER.encode(canonicalText(root)), markers: "n/a" };
  }

  const root = parseCanonical(bytes, entry);
  const list = arrayAt(root, keys, !entry.remove, where);
  const hits = (list ?? []).flatMap((el, i) => (isOwnElement(el, entry.id) ? [i] : []));
  if (hits.length > 1) fail("E_LOCATOR", `${where}: ${hits.length} elements at ${entry.pointer} carry the command ${JSON.stringify(entry.id)}`, where);
  const at = hits[0];
  const current = at === undefined ? null : list[at];

  if (entry.remove) {
    if (at === undefined) return { current: null, next: bytes, markers: "n/a" };
    list.splice(at, 1);
  } else if (at === undefined) {
    list.push(entry.value);
  } else if (sorted(current) === sorted(entry.value)) {
    return { current, next: bytes, markers: "n/a" };
  } else {
    list[at] = entry.value;
  }
  return { current, next: ENCODER.encode(canonicalText(root)), markers: "n/a" };
}
