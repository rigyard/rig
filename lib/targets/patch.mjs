// lib/targets/patch.mjs — internal to targets; exported through targets.patch.
//
// Locates and patches regions in the current bytes of a foreign file. Line level only: no file is ever parsed
// into a tree and reserialized. Every cell is found by structure, through one closed table of locator kinds:
//
//   frontmatter-key          "<key>: <value>" in the leading "---" block            (surface kind frontmatter)
//   frontmatter-paren-token  first "(<display>)" in a frontmatter value whose text is a known display name
//   md-table-cell            header row, row key, column, then a cell grammar       (surface kind cells)
//   role-line                "<label>: <value>[, <value>]" with labels from a known list (surface kind whole)
//   yaml-map-value           "<key>: <value>" under a top-level "<map>:" line        (surface kind keys)
//   toml-table               "[<table>]" header detection for a block that rig inserts (entry kind block)
//
// Markers exist only around tables of a cells surface with markers: true, and around a block. A locator that
// does not match exactly once throws an Error with code E_LOCATOR. The json-element kind lives in json-element.mjs.

import { patchJsonElement } from "./json-element.mjs";

const DECODER = new TextDecoder("utf-8", { fatal: true });
const ENCODER = new TextEncoder();
const CELL_MARKER = "rig:models";

function fail(code, message, extra = {}) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  Object.assign(error, extra);
  throw error;
}

/**
 * Locate and patch one region in current bytes.
 * @param {Uint8Array | null} bytes   current file bytes, null when absent
 * @param {object} entry              a DesiredEntry of kind cells, block, json-element, or owned with keep_header
 * @returns {{current: object[] | Uint8Array | null, next: Uint8Array, markers: "present"|"inserted"|"n/a"}}
 * @throws {Error} code E_LOCATOR when a declared region is absent, ambiguous or malformed
 */
export function patch(bytes, entry) {
  switch (entry.kind) {
    case "cells":
      return patchCells(bytes, entry);
    case "block":
      return patchBlock(bytes, entry);
    case "owned":
      if (entry.keep_header) return patchHeader(bytes, entry);
      break;
    case "json-element":
      return patchJsonElement(bytes, entry);
  }
  fail("E_INTERNAL", `patch: unsupported entry kind ${entry.kind}`);
}

// ---------------------------------------------------------------- text and lines

function decode(bytes, path) {
  let text;
  try {
    text = DECODER.decode(bytes);
  } catch {
    fail("E_LOCATOR", `${path}: not valid UTF-8`, { path });
  }
  if (text.includes("\r")) fail("E_LOCATOR", `${path}: CR or CRLF line endings are not supported`, { path });
  return text;
}

/** @returns {{s: number, e: number, t: string}[]} one record per line; s and e are offsets, e excludes "\n" */
function splitLines(text) {
  const out = [];
  let start = 0;
  for (const t of text.split("\n")) {
    out.push({ s: start, e: start + t.length, t });
    start += t.length + 1;
  }
  return out;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function applyEdits(text, edits) {
  let out = text;
  for (const ed of [...edits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, ed.start) + ed.text + out.slice(ed.end);
  }
  return out;
}

// ---------------------------------------------------------------- cell grammar

const PLACEHOLDERS = new Set(["model", "effort", "display", "model_effort", "rest"]);

/**
 * Compile a grammar such as "{display}, {effort}[, {rest}]".
 * @returns {{main: ({ph: string}|{lit: string})[], restLead: string | null}}
 */
function compileGrammar(grammar) {
  let body = grammar;
  let restLead = null;
  const opt = body.match(/\[([^\]]*)\{rest\}\]$/);
  if (opt) {
    restLead = opt[1];
    body = body.slice(0, opt.index);
    if (!restLead) fail("E_SCHEMA", `grammar ${grammar}: {rest} needs a leading separator`);
  }
  const main = [];
  const re = /\{(\w+)\}/g;
  let last = 0;
  let m;
  while ((m = re.exec(body))) {
    if (m.index > last) main.push({ lit: body.slice(last, m.index) });
    if (!PLACEHOLDERS.has(m[1]) || m[1] === "rest") fail("E_SCHEMA", `grammar ${grammar}: bad placeholder {${m[1]}}`);
    if (main.length && "ph" in main[main.length - 1]) fail("E_SCHEMA", `grammar ${grammar}: adjacent placeholders`);
    main.push({ ph: m[1] });
    last = re.lastIndex;
  }
  if (last < body.length) main.push({ lit: body.slice(last) });
  if (!main.some((t) => "ph" in t)) fail("E_SCHEMA", `grammar ${grammar}: no placeholder`);
  return { main, restLead };
}

/**
 * Parse a text by the grammar. Each placeholder ends at the first occurrence of the literal after it; the last one
 * ends at the first {rest} separator, or at the end of the text.
 * @returns {{fields: Record<string, string>, end: number} | null}  end: where the cell region stops; null: no parse
 */
function parseRegion(g, text) {
  const fields = {};
  let pos = 0;
  for (let i = 0; i < g.main.length; i++) {
    const tok = g.main[i];
    if ("lit" in tok) {
      if (!text.startsWith(tok.lit, pos)) return null;
      pos += tok.lit.length;
      continue;
    }
    const next = g.main[i + 1];
    let end;
    if (next) end = text.indexOf(next.lit, pos);
    else if (g.restLead !== null && text.indexOf(g.restLead, pos) >= 0) end = text.indexOf(g.restLead, pos);
    else end = text.length;
    if (end <= pos) return null;
    fields[tok.ph] = text.slice(pos, end);
    pos = end;
  }
  if (pos !== text.length && (g.restLead === null || !text.startsWith(g.restLead, pos))) return null;
  return { fields, end: pos };
}

/** End of the cell region in a cell text: the parsed end, or the whole text when it does not parse. */
function regionEnd(g, text, desired) {
  if (desired.some((v) => v.field === "literal")) {
    const i = g.restLead === null ? -1 : text.indexOf(g.restLead);
    return i < 0 ? text.length : i;
  }
  return parseRegion(g, text)?.end ?? text.length;
}

function composeRegion(g, values, where) {
  const literal = values.find((v) => v.field === "literal");
  if (literal) return literal.value;
  const byField = new Map(values.map((v) => [v.field, v.value]));
  return g.main
    .map((tok) => {
      if ("lit" in tok) return tok.lit;
      if (!byField.has(tok.ph)) fail("E_INTERNAL", `${where}: no rendered value for {${tok.ph}}`);
      return byField.get(tok.ph);
    })
    .join("");
}

/** Current cell values of one region, shaped like the desired values of that region. */
function currentOf(g, regionText, desired) {
  const base = { surface: desired[0].surface, key: desired[0].key, element: desired[0].element };
  if (desired.some((v) => v.field === "literal")) return [{ ...base, field: "literal", value: regionText }];
  const parsed = parseRegion(g, regionText);
  if (!parsed || parsed.end !== regionText.length) return [{ ...base, field: "literal", value: regionText }];
  return g.main.filter((t) => "ph" in t).map((t) => ({ ...base, field: t.ph, value: parsed.fields[t.ph] }));
}

// ---------------------------------------------------------------- cells entry

/**
 * A slot is one contiguous byte region that holds one or more cells.
 * @typedef {{start: number, end: number, render: string, current: object[]}} Slot
 */

function patchCells(bytes, entry) {
  const where = entry.path;
  if (bytes === null) fail("E_LOCATOR", `${where}: file is absent`, { path: where });
  const text = decode(bytes, where);

  // 1. Markers: insert a pair around each located table of a markers surface that sits outside every pair.
  const markerSurfaces = entry.surfaces
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.kind === "cells" && s.markers === true);
  let marked = text;
  let markers = "n/a";
  if (markerSurfaces.length) {
    const lines = splitLines(text);
    const pairs = markerPairs(lines, htmlMarker(CELL_MARKER), where);
    const inserts = [];
    for (const { s, i } of markerSurfaces) {
      const table = findTable(lines, s, i, pairs, where);
      if (!table.inPair) inserts.push(table);
    }
    if (inserts.length) {
      const { start, end } = htmlMarker(CELL_MARKER);
      marked = applyEdits(
        text,
        inserts.flatMap((t) => [
          { start: lines[t.header].s, end: lines[t.header].s, text: start + "\n" },
          { start: lines[t.last].e, end: lines[t.last].e, text: "\n" + end },
        ]),
      );
      markers = "inserted";
    } else {
      markers = "present";
    }
  }

  // 2. Cells: locate every slot in the marked text and replace each region with its render.
  const slots = locateSlots(marked, entry);
  const next = applyEdits(
    marked,
    slots.filter((sl) => marked.slice(sl.start, sl.end) !== sl.render).map((sl) => ({ ...sl, text: sl.render })),
  );

  // 3. Assert: next holds every render, and next with each region reverted equals the marked text.
  const after = locateSlots(next, entry);
  const ok =
    after.length === slots.length &&
    after.every((sl) => next.slice(sl.start, sl.end) === sl.render) &&
    applyEdits(next, after.map((sl, k) => ({ start: sl.start, end: sl.end, text: marked.slice(slots[k].start, slots[k].end) }))) ===
      marked;
  if (!ok) fail("E_INTERNAL", `${where}: patched bytes changed outside cells`, { path: where });

  return { current: slots.flatMap((sl) => sl.current), next: ENCODER.encode(next), markers };
}

/** Group desired values by (surface, key) in first-appearance order, then dispatch each group to its locator. */
function locateSlots(text, entry) {
  const lines = splitLines(text);
  const groups = new Map();
  for (const v of entry.values) {
    const id = JSON.stringify([v.surface, v.key]);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(v);
  }
  const ctx = { text, lines, path: entry.path, entry };
  const slots = [];
  for (const values of groups.values()) {
    const surface = entry.surfaces[values[0].surface];
    if (!surface) fail("E_INTERNAL", `${entry.path}: value names surface ${values[0].surface}, which is not declared`);
    const locator = LOCATORS[surface.kind];
    if (!locator) fail("E_INTERNAL", `${entry.path}: no cell locator for surface kind ${surface.kind}`);
    slots.push(...locator(ctx, surface, values));
  }
  const sorted = [...slots].sort((a, b) => a.start - b.start);
  for (let k = 1; k < sorted.length; k++) {
    if (sorted[k].start < sorted[k - 1].end) fail("E_LOCATOR", `${entry.path}: two cells overlap`, { path: entry.path });
  }
  return slots;
}

function byElement(values) {
  const out = new Map();
  for (const v of values) {
    if (!out.has(v.element)) out.set(v.element, []);
    out.get(v.element).push(v);
  }
  return [...out.entries()].sort((a, b) => a[0] - b[0]).map(([, vs]) => vs);
}

const LOCATORS = {
  frontmatter: locateFrontmatter,
  cells: locateTableCell,
  whole: locateRoleLine,
  keys: locateYamlValue,
};

// ---------------------------------------------------------------- frontmatter-key, frontmatter-paren-token

function frontmatterRange(lines, where) {
  if (lines[0].t !== "---") fail("E_LOCATOR", `${where}: no leading frontmatter block`, { path: where });
  for (let k = 1; k < lines.length; k++) if (lines[k].t === "---") return [1, k - 1];
  fail("E_LOCATOR", `${where}: frontmatter block is not closed`, { path: where });
}

function frontmatterLine(ctx, range, key) {
  const re = new RegExp("^" + escapeRe(key) + ":[ \\t]*");
  const hits = [];
  for (let k = range[0]; k <= range[1]; k++) if (re.test(ctx.lines[k].t)) hits.push(k);
  if (hits.length !== 1) {
    fail("E_LOCATOR", `${ctx.path}: frontmatter key ${key} matches ${hits.length} times`, { path: ctx.path, key });
  }
  const line = ctx.lines[hits[0]];
  const lead = line.t.match(re)[0].length;
  return { line, lead };
}

function frontmatterValueSpan(ctx, range, key) {
  const { line, lead } = frontmatterLine(ctx, range, key);
  let start = line.s + lead;
  let end = line.s + line.t.replace(/[ \t]+$/, "").length;
  const raw = ctx.text.slice(start, end);
  if (/^(["']).*\1$/.test(raw) && raw.length >= 2) {
    start += 1;
    end -= 1;
  }
  if (end <= start) fail("E_LOCATOR", `${ctx.path}: frontmatter key ${key} has no inline value`, { path: ctx.path, key });
  return { start, end };
}

function displaySpan(ctx, range, key, displays) {
  const { line, lead } = frontmatterLine(ctx, range, key);
  const known = new Set(displays);
  for (const m of line.t.slice(lead).matchAll(/\(([^()]*)\)/g)) {
    if (known.has(m[1])) {
      const start = line.s + lead + m.index + 1;
      return { start, end: start + m[1].length };
    }
  }
  fail("E_LOCATOR", `${ctx.path}: no "(<display>)" token with a known display name in ${key}`, { path: ctx.path, key });
}

/**
 * Known display names: the ones the render lists, plus the display of the alias the file names now
 * (models: "display defaults to the capitalised alias"). The second source lets a tier swap find the old token
 * after the old alias left tiers.json. A renamed display of a pinned id is not derivable and fails E_LOCATOR.
 */
function knownDisplays(ctx, range, keys, v) {
  const known = [...(v.displays ?? [v.value])];
  if (keys.model) {
    const span = frontmatterValueSpan(ctx, range, keys.model);
    const alias = ctx.text.slice(span.start, span.end);
    known.push(alias.charAt(0).toUpperCase() + alias.slice(1));
  }
  return known;
}

function locateFrontmatter(ctx, surface, values) {
  const range = frontmatterRange(ctx.lines, ctx.path);
  const keys = surface.keys ?? {};
  return values.map((v) => {
    // Each frontmatter cell fills its whole span, so its grammar is the one placeholder.
    const g = compileGrammar(`{${v.field === "literal" ? "model" : v.field}}`);
    let span;
    if (v.field === "display") {
      if (!surface.display_in) fail("E_INTERNAL", `${ctx.path}: display value without display_in`);
      span = displaySpan(ctx, range, surface.display_in, knownDisplays(ctx, range, keys, v));
    } else if (v.field === "effort") {
      if (!keys.effort) fail("E_INTERNAL", `${ctx.path}: effort value without an effort key`);
      span = frontmatterValueSpan(ctx, range, keys.effort);
    } else {
      if (!keys.model) fail("E_INTERNAL", `${ctx.path}: surface declares no model key`);
      span = frontmatterValueSpan(ctx, range, keys.model);
    }
    const regionText = ctx.text.slice(span.start, span.end);
    return { ...span, render: composeRegion(g, [v], ctx.path), current: currentOf(g, regionText, [v]) };
  });
}

// ---------------------------------------------------------------- md-table-cell

function splitRow(line) {
  const t = line.t;
  if (!t.startsWith("|")) return null;
  const bars = [];
  for (let i = 0; i < t.length; i++) if (t[i] === "|" && t[i - 1] !== "\\") bars.push(i);
  const cells = [];
  for (let k = 0; k < bars.length - 1; k++) {
    let a = bars[k] + 1;
    let b = bars[k + 1];
    while (a < b && /\s/.test(t[a])) a++;
    while (b > a && /\s/.test(t[b - 1])) b--;
    cells.push({ start: line.s + a, end: line.s + b, text: t.slice(a, b) });
  }
  return cells;
}

const SEPARATOR_ROW = /^\|(\s*:?-+:?\s*\|)+\s*$/;

function htmlMarker(name) {
  return { start: `<!-- ${name}:start -->`, end: `<!-- ${name}:end -->` };
}

function hashMarker(name) {
  return { start: `# ${name}:start`, end: `# ${name}:end` };
}

/** @returns {[number, number][]} line index pairs of start and end markers, validated */
function markerPairs(lines, marker, where) {
  const pairs = [];
  let open = -1;
  for (let k = 0; k < lines.length; k++) {
    if (lines[k].t === marker.start) {
      if (open >= 0) fail("E_LOCATOR", `${where}: nested ${marker.start}`, { path: where });
      open = k;
    } else if (lines[k].t === marker.end) {
      if (open < 0) fail("E_LOCATOR", `${where}: ${marker.end} without a start marker`, { path: where });
      pairs.push([open, k]);
      open = -1;
    }
  }
  if (open >= 0) fail("E_LOCATOR", `${where}: ${marker.start} without an end marker`, { path: where });
  return pairs;
}

/**
 * Find the one table of a cells surface. Inside marker pairs first; when no pair holds the header, the whole file.
 * @returns {{header: number, last: number, inPair: boolean}}
 */
function findTable(lines, surface, index, pairs, where) {
  const want = JSON.stringify(splitRow({ s: 0, e: 0, t: surface.header.trim() })?.map((c) => c.text));
  const inside = (k) => pairs.some(([a, b]) => k > a && k < b);
  const hits = [];
  for (let k = 0; k < lines.length; k++) {
    const row = splitRow(lines[k]);
    if (row && JSON.stringify(row.map((c) => c.text)) === want) hits.push(k);
  }
  const paired = hits.filter(inside);
  const use = surface.markers === true && paired.length ? paired : hits;
  if (use.length !== 1) {
    fail("E_LOCATOR", `${where}: table "${surface.header}" matches ${use.length} times`, { path: where, surface: index });
  }
  const header = use[0];
  if (!lines[header + 1] || !SEPARATOR_ROW.test(lines[header + 1].t)) {
    fail("E_LOCATOR", `${where}: table "${surface.header}" has no separator row`, { path: where, surface: index });
  }
  const pair = pairs.find(([a, b]) => header > a && header < b);
  const stop = pair ? pair[1] : lines.length;
  let last = header + 1;
  while (last + 1 < stop && lines[last + 1].t.startsWith("|")) last++;
  return { header, last, inPair: Boolean(pair) };
}

const tableCache = new WeakMap();

function locateTableCell(ctx, surface, values) {
  const index = values[0].surface;
  let cached = tableCache.get(ctx.lines)?.get(index);
  if (!cached) {
    const pairs = surface.markers === true ? markerPairs(ctx.lines, htmlMarker(CELL_MARKER), ctx.path) : [];
    const table = findTable(ctx.lines, surface, index, pairs, ctx.path);
    const head = splitRow(ctx.lines[table.header]).map((c) => c.text);
    const keyCol = head.indexOf(surface.key_column);
    const col = head.indexOf(surface.column);
    if (keyCol < 0 || col < 0) {
      fail("E_LOCATOR", `${ctx.path}: table "${surface.header}" lacks column ${keyCol < 0 ? surface.key_column : surface.column}`, {
        path: ctx.path,
        surface: index,
      });
    }
    const rows = [];
    for (let k = table.header + 2; k <= table.last; k++) rows.push(splitRow(ctx.lines[k]));
    cached = { rows, keyCol, col, g: compileGrammar(surface.grammar) };
    if (!tableCache.has(ctx.lines)) tableCache.set(ctx.lines, new Map());
    tableCache.get(ctx.lines).set(index, cached);
  }
  const { rows, keyCol, col, g } = cached;
  const key = values[0].key;
  const hits = rows.filter((r) => r[keyCol]?.text === key);
  if (hits.length !== 1) {
    fail("E_LOCATOR", `${ctx.path}: row ${key} in table "${surface.header}" matches ${hits.length} times`, {
      path: ctx.path,
      surface: index,
      key,
    });
  }
  const cell = hits[0][col];
  if (!cell) fail("E_LOCATOR", `${ctx.path}: row ${key} has no ${surface.column} cell`, { path: ctx.path, surface: index, key });
  if (values.some((v) => v.element !== 0)) fail("E_INTERNAL", `${ctx.path}: a table cell holds one element, row ${key} has a panel`);
  const end = cell.start + regionEnd(g, cell.text, values);
  const regionText = ctx.text.slice(cell.start, end);
  return [{ start: cell.start, end, render: composeRegion(g, values, ctx.path), current: currentOf(g, regionText, values) }];
}

// ---------------------------------------------------------------- role-line

/** pstack's "# budget:" line carries the role key "budget". Every other label is the role key itself. */
function labelOf(key) {
  return key === "budget" ? "# budget" : key;
}

const roleLineCache = new WeakMap();

function roleLines(ctx, surfaceIndex) {
  let perSurface = roleLineCache.get(ctx.lines);
  if (!perSurface) roleLineCache.set(ctx.lines, (perSurface = new Map()));
  if (perSurface.has(surfaceIndex)) return perSurface.get(surfaceIndex);
  // Known labels: every role key the entry renders for this surface. Longest label wins, so a label that is a
  // prefix of another label cannot capture its line.
  const labels = [...new Set(ctx.entry.values.filter((v) => v.surface === surfaceIndex).map((v) => labelOf(v.key)))].sort(
    (a, b) => b.length - a.length,
  );
  const found = new Map();
  for (const line of ctx.lines) {
    const label = labels.find((l) => line.t.startsWith(l + ": "));
    if (!label) continue;
    if (found.has(label)) fail("E_LOCATOR", `${ctx.path}: role line "${label}" appears twice`, { path: ctx.path, key: label });
    found.set(label, line);
  }
  perSurface.set(surfaceIndex, found);
  return found;
}

function locateRoleLine(ctx, surface, values) {
  const index = values[0].surface;
  const key = values[0].key;
  const label = labelOf(key);
  const line = roleLines(ctx, index).get(label);
  if (!line) fail("E_LOCATOR", `${ctx.path}: role line "${label}" is absent`, { path: ctx.path, surface: index, key });
  const start = line.s + label.length + 2;
  const end = line.s + line.t.replace(/[ \t]+$/, "").length;
  const g = compileGrammar(surface.grammar ?? "{model}");
  const elements = byElement(values);
  const render = elements.map((vs) => composeRegion(g, vs, ctx.path)).join(", ");
  // Cut the known label first, then split the values on ", ".
  const parts = ctx.text.slice(start, end).split(", ");
  const current =
    parts.length === elements.length
      ? parts.flatMap((p, i) => currentOf(g, p, elements[i]))
      : [{ surface: index, key, element: 0, field: "literal", value: ctx.text.slice(start, end) }];
  return [{ start, end, render, current }];
}

// ---------------------------------------------------------------- yaml-map-value

const yamlCache = new WeakMap();

function yamlMap(ctx, map) {
  let perMap = yamlCache.get(ctx.lines);
  if (!perMap) yamlCache.set(ctx.lines, (perMap = new Map()));
  if (perMap.has(map)) return perMap.get(map);
  const head = new RegExp("^" + escapeRe(map) + ":[ \\t]*(#.*)?$");
  const heads = [];
  for (let k = 0; k < ctx.lines.length; k++) if (head.test(ctx.lines[k].t)) heads.push(k);
  if (heads.length !== 1) {
    fail("E_LOCATOR", `${ctx.path}: top-level block "${map}:" matches ${heads.length} times`, { path: ctx.path });
  }
  let last = heads[0];
  for (let k = heads[0] + 1; k < ctx.lines.length; k++) {
    const t = ctx.lines[k].t;
    if (!t.trim() || /^\s*#/.test(t)) continue;
    if (!/^[ \t]/.test(t)) break;
    last = k;
  }
  const children = [];
  let indent = null;
  for (let k = heads[0] + 1; k <= last; k++) {
    const m = ctx.lines[k].t.match(/^([ \t]+)([^\s#:][^:]*?):(?:[ \t]+|$)/);
    if (!m) continue;
    if (indent === null) indent = m[1];
    if (m[1] === indent) children.push({ line: ctx.lines[k], key: m[2].replace(/^(["'])(.*)\1$/, "$2"), lead: m[0].length });
  }
  perMap.set(map, children);
  return children;
}

function locateYamlValue(ctx, surface, values) {
  const key = values[0].key;
  const hits = yamlMap(ctx, surface.map).filter((c) => c.key === key);
  if (hits.length !== 1) {
    fail("E_LOCATOR", `${ctx.path}: ${surface.map}.${key} matches ${hits.length} times`, { path: ctx.path, key });
  }
  const { line, lead } = hits[0];
  let raw = line.t.slice(lead);
  let start = line.s + lead;
  if (/^["']/.test(raw)) {
    const q = raw[0];
    const close = raw.indexOf(q, 1);
    if (close < 0) fail("E_LOCATOR", `${ctx.path}: ${surface.map}.${key} has an unclosed quote`, { path: ctx.path, key });
    raw = raw.slice(1, close);
    start += 1;
  } else {
    raw = raw.replace(/[ \t]+#.*$/, "").replace(/[ \t]+$/, "");
  }
  if (!raw || /^[|>{[&*!]/.test(raw)) {
    fail("E_LOCATOR", `${ctx.path}: ${surface.map}.${key} is not a single-line scalar`, { path: ctx.path, key });
  }
  const g = compileGrammar(surface.grammar ?? "{model_effort}");
  const render = composeRegion(g, values, ctx.path);
  if (/[\n#]|: /.test(render)) fail("E_INTERNAL", `${ctx.path}: value "${render}" is not a plain YAML scalar`);
  return [{ start, end: start + raw.length, render, current: currentOf(g, raw, values) }];
}

// ---------------------------------------------------------------- block (with toml-table detection)

function blockMarker(path, marker) {
  return /\.(toml|ya?ml)$/.test(path) ? hashMarker(marker) : htmlMarker(marker);
}

function patchBlock(bytes, entry) {
  const where = entry.path;
  const body = decode(entry.bytes, where);
  if (body && !body.endsWith("\n")) fail("E_INTERNAL", `${where}: block render must end with a newline`);
  const marker = blockMarker(where, entry.marker);
  const wrapped = `${marker.start}\n${body}${marker.end}\n`;
  if (bytes === null) return { current: null, next: ENCODER.encode(wrapped), markers: "inserted" };

  const text = decode(bytes, where);
  const lines = splitLines(text);
  const pairs = markerPairs(lines, marker, where);
  if (pairs.length > 1) fail("E_LOCATOR", `${where}: block ${entry.marker} appears ${pairs.length} times`, { path: where });
  if (entry.table) {
    const header = new RegExp("^[ \\t]*\\[[ \\t]*" + escapeRe(entry.table) + "[ \\t]*\\][ \\t]*(#.*)?$");
    const inside = (k) => pairs.some(([a, b]) => k > a && k < b);
    const outside = lines.findIndex((l, k) => header.test(l.t) && !inside(k));
    if (outside >= 0) {
      fail("E_LOCATOR", `${where}: a [${entry.table}] table exists outside the ${entry.marker} markers (line ${outside + 1})`, {
        path: where,
      });
    }
  }
  if (pairs.length === 1) {
    const [a, b] = pairs[0];
    const start = lines[a].e + 1;
    const end = lines[b].s;
    const next = text.slice(0, start) + body + text.slice(end);
    return { current: ENCODER.encode(text.slice(start, end)), next: ENCODER.encode(next), markers: "present" };
  }
  let lead = text;
  if (lead && !lead.endsWith("\n")) lead += "\n";
  if (lead && !lead.endsWith("\n\n")) lead += "\n";
  return { current: null, next: ENCODER.encode(lead + wrapped), markers: "inserted" };
}

// ---------------------------------------------------------------- owned with keep_header

/** Leading "---" frontmatter block (if any) plus the leading "#" lines, as line indexes [0, end). */
function headerEnd(lines) {
  let k = 0;
  if (lines[0].t === "---") {
    const close = lines.findIndex((l, i) => i > 0 && l.t === "---");
    if (close > 0) k = close + 1;
  }
  while (k < lines.length && lines[k].t.startsWith("#")) k++;
  return k;
}

function patchHeader(bytes, entry) {
  const where = entry.path;
  const render = decode(entry.bytes, where);
  if (bytes === null) return { current: null, next: entry.bytes, markers: "n/a" };
  const text = decode(bytes, where);
  const lines = splitLines(text);
  const end = headerEnd(lines);
  const hashLines = lines.slice(0, end).filter((l) => l.t.startsWith("#"));
  const rLines = splitLines(render);
  if (!hashLines.length) {
    // The current frontmatter, when there is one, takes the place of the render's own.
    const head = end ? text.slice(0, lines[end - 1].e + 1) : "";
    const own = head && rLines[0].t === "---" ? rLines.findIndex((l, i) => i > 0 && l.t === "---") : -1;
    const body = own > 0 ? render.slice(Math.min(rLines[own].e + 1, render.length)) : render;
    return { current: bytes, next: ENCODER.encode(head + body), markers: "n/a" };
  }
  const rEnd = headerEnd(rLines);
  const budget = rLines.slice(0, rEnd).find((l) => l.t.startsWith("# budget: "));
  let head = lines.slice(0, end).map((l) => l.t);
  if (budget) {
    const at = head.findIndex((t) => t.startsWith("# budget: "));
    if (at >= 0) head[at] = budget.t;
    else head.push(budget.t);
  }
  const rest = rEnd ? render.slice(Math.min(rLines[rEnd - 1].e + 1, render.length)) : render;
  return { current: bytes, next: ENCODER.encode(head.join("\n") + "\n" + rest), markers: "n/a" };
}
