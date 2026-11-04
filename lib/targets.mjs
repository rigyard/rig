// lib/targets.mjs — public: render, readSet, patch
// internals: lib/targets/place.mjs, cells.mjs, formats.mjs, terms.mjs (unreachable from outside, see boundary test)

/** @typedef {import("./world.mjs").World} World */
/** @typedef {import("./world.mjs").ModelSurface} ModelSurface */
/** @typedef {import("./world.mjs").TargetRecord} TargetRecord */
/** @typedef {import("./stack.mjs").Stack} Stack */
/** @typedef {import("./stack.mjs").RigError} RigError */

/**
 * What rig wants on disk, per absolute path. A `whole` surface renders as "owned"; with keep_header set,
 * patch() completes its bytes from the current file.
 * @typedef {{kind: "owned", path: string, bytes: Uint8Array, mode: number, unit: string, keep_header?: boolean}
 *         | {kind: "cells", path: string, surfaces: ModelSurface[], values: CellValue[], unit: string}
 *         | {kind: "block", path: string, marker: string, bytes: Uint8Array, unit: string, table?: string}
 *         | {kind: "json-element", path: string, pointer: string, id: string, value: unknown, unit: string}} DesiredEntry
 */
/** @typedef {{surface: number, key: string, element: number, value: string}} CellValue */
/** @typedef {{entries: Map<string, DesiredEntry>, errors: RigError[], info: string[]}} Desired */

/** Render every unit and surface for every harness. Pure: reads nothing from disk. @param {Stack} stack @param {World} world @returns {Desired} */
export function render(stack, world) { throw new Error("not implemented"); }

/**
 * Every skill each harness sees, managed or not, for plan and doctor. Reads dirs, skips dot entries.
 * @param {World} world
 * @returns {Map<string, {name: string, path: string, realpath: string, sha256: string, managed: boolean}[]>}  by harness
 */
export function readSet(world) { throw new Error("not implemented"); }

/**
 * Locate and patch one region in current bytes. Covers cells, block, json-element, and owned with keep_header.
 * @param {Uint8Array | null} bytes   current file bytes, null when absent
 * @param {DesiredEntry} entry        kind cells, block, json-element, or owned with keep_header
 * @returns {{current: CellValue[] | Uint8Array | unknown | null, next: Uint8Array, markers: "present"|"inserted"|"n/a", error?: RigError}}
 */
export function patch(bytes, entry) {
  // TODO cells (surface kinds frontmatter, cells, keys):
  //  1. Search scope: if surface.markers and rig markers exist, only between each start/end pair; else the whole file.
  //  2. kind cells: find the line equal to surface.header; the next line must be a separator row; for each row,
  //     split on unescaped "|", key = trimmed cell of key_column; skip rows whose key is not in roles.json consumer.
  //     Parse the column cell with the grammar: "{display}, {effort}[, {rest}]" -> tokens; rest is kept byte-exact.
  //     A header that matches twice in scope -> E_LOCATOR (ambiguous). Zero times -> E_LOCATOR (absent).
  //  3. kind keys: find the top-level line "<map>:" ; scan following lines indented deeper; "<key>: <value>"
  //     line-level only; never parse or reserialize YAML. colon-suffix splits model and effort on the last ":".
  //  4. kind frontmatter: inside the leading "---" block only; "<key>: <value>" for each of surface.keys; the display
  //     token = the first "(<display>)" in the display_in value whose text equals a known display name.
  //  5. current = located values. next = bytes with only the value spans replaced (byte offsets, right to left),
  //     plus marker lines inserted around each located table when surface.markers and markers are absent.
  //  6. Assert: next with cells reverted equals bytes with markers inserted. A failed assert is E_INTERNAL.
  // TODO block (the frame block and kind block): markers by file type, "<!-- <marker>:start -->" ... "<!-- <marker>:end -->"
  //  in markdown, "# <marker>:start" ... "# <marker>:end" in TOML; foreign blocks stay byte-identical;
  //  absent and entry.table set and a "[<table>]" line exists outside the markers -> E_LOCATOR (never a second table);
  //  absent otherwise -> append the block with one blank line before it; current = the bytes between markers.
  // TODO owned with keep_header: header = the leading "---" frontmatter block, if any, plus the leading "#" lines of
  //  the current bytes, byte-exact; a header line that starts with "# budget: " takes its value from the render;
  //  next = header + entry.bytes (the rendered label lines); absent file -> no header.
  // TODO json-element (a JSON merge): require JSON.stringify(JSON.parse(bytes), null, 2) + "\n" === bytes, else E_JSON_ROUNDTRIP;
  //  find the element under pointer whose command string equals entry.id; replace it or append it; every other
  //  key and element stays; reserialize.
  throw new Error("not implemented");
}
