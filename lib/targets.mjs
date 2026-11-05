// lib/targets.mjs — public: render, readSet, patch
// internals: lib/targets/place.mjs, cells.mjs, formats.mjs, terms.mjs, vars.mjs, providers.mjs (unreachable from outside, see boundary test)

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cellValues } from "./models.mjs";
import { treeHash } from "./tree.mjs";
import { place } from "./targets/place.mjs";
import { readSet as readSetOf } from "./targets/readset.mjs";
import { patch as patchRegion } from "./targets/patch.mjs";
import { substitute, substituteBytes } from "./targets/terms.mjs";
import { fill } from "./targets/vars.mjs";
import { entryLines, intakeLines, modelsLine, providerLines, slotBody, slotLines } from "./targets/providers.mjs";
import { codexAgent, cursorAgent, mdBody, mdc, setFrontmatterKey, setYamlKey, skillHidden } from "./targets/formats.mjs";

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

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const FILE_MODE = 0o644;
/** The one reserved token of the core alias template `commands/alias.md` (section 2.3): the alias's target. */
const ALIAS_NAME = "target";
const ALIAS_TARGET = `{{${ALIAS_NAME}}}`;
const FRAME_MARKER = "rig:frame";
const FRAME_FILE = "frame.md";

/**
 * Render every unit for every harness. Pure: reads nothing from disk; input bytes come through stack and world.
 * Owned units in this version: skills, commands, agents, rules, the frame, the slot stubs, the alias commands
 * that compose emits, the plugin manifest of a harness whose local plugin received files, and the `whole` model
 * surfaces of the workflow providers (the pstack model rules). The one other entry is the session-end hook: with
 * rig.json `metrics.session_hook` true, one json-element per target record that names `hooks.session_end`. Other
 * model surfaces render nothing yet. Core templates fill a closed set of {{name}} variables from the provider
 * records, the target records, the slot fillers and the lock; a name outside that set is E_TERM_UNKNOWN.
 * A render error lands in `errors` and its entry is left out. A malformed World (an installed harness with no
 * target record) still throws, because loadWorld rules it out.
 * @param {Stack} stack @param {World} world @returns {Desired}
 */
export function render(stack, world) {
  const ctx = {
    home: world.env.home,
    installed: world.config.harnesses,
    targets: world.targets,
    // {{rig:intake}} is the one term derived from records (provider intake), not read from terms.json
    terms: { ...(world.terms ?? {}), intake: Object.fromEntries(world.config.harnesses.map((h) => [h, intakeLines(stack.providers ?? [], h)])) },
    aliases: world.config.aliases ?? {},
    providers: stack.providers ?? [],
    defaultProvider: world.config.default_provider,
    stubs: stack.units.filter((u) => u.type === "slot-stub"),
    slots: stack.slots ?? {},
    fillers: world.config.slots ?? {},
    tiers: world.tiers,
    world,
    locks: world.locks,
    sessionHook: world.config.metrics?.session_hook === true,
    never: neverWriteGlobs(world),
    entries: new Map(),
    owners: new Map(), // home-relative path -> unit id, for clash messages and the plugin manifest
    errors: [],
    info: [],
  };
  for (const unit of stack.units) renderUnit(ctx, unit);
  renderModelFiles(ctx);
  renderPluginManifests(ctx);
  renderSessionHooks(ctx);
  return { entries: ctx.entries, errors: uniqueErrors(ctx.errors), info: ctx.info };
}

const isCore = (unit) => unit.id.startsWith("core/");
const harnessesOf = (ctx, unit) => ctx.installed.filter((h) => unit.harnesses.includes(h));
const expand = (ctx, p) => (p.startsWith("~/") ? join(ctx.home, p.slice(2)) : p);

function renderUnit(ctx, unit) {
  const scope = unit.scope ?? "machine-hidden";
  if (scope === "project" || scope === "hybrid") {
    for (const h of harnessesOf(ctx, unit)) {
      if (ctx.targets.get(h).project_scope) {
        ctx.errors.push({ code: "E_INTERNAL", harness: h, message: `unit ${unit.id}: the ${h} project channel render is not implemented` });
      } else {
        ctx.info.push(`scope ${h} ${unit.id}: project part absent: commit its files (doctor --project)`);
      }
    }
    if (scope === "project") return;
  }
  // Decision 0017 has no machine-visible scope: every pack copy is hidden. Core units are rig's own and stay visible.
  const hidden = !isCore(unit);
  if (unit.type === "skill") renderSkill(ctx, unit, hidden);
  else if (unit.type === "slot-stub") renderSlotStub(ctx, unit);
  else if (unit.type === "frame") renderFrame(ctx, unit);
  else if (unit.type === "command" || unit.type === "agent" || unit.type === "rule") renderSingle(ctx, unit, unit.type);
  else ctx.errors.push({ code: "E_INTERNAL", message: `unit ${unit.id}: unknown unit type "${unit.type}"` });
}

// ---- skills

/** Harnesses that read a skill dir. A copy there carries the hide control of each (section 7). */
const readersOf = (ctx, dir) => ctx.installed.filter((h) => ctx.targets.get(h).reads.skills.some((e) => e.path === dir));

/**
 * The files of one skill copy in one dir. Terms resolve by the dir's format owner. Hide controls come from every
 * harness that reads the dir.
 * @returns {{files: {path: string, mode: number, bytes: Uint8Array}[], errors: RigError[]}}
 */
function skillCopy(ctx, unit, dir, owner, hidden) {
  const errors = [];
  const files = new Map();
  if ((ctx.targets.get(owner).units?.skill?.frontmatter ?? "keep") !== "keep") {
    errors.push({ code: "E_INTERNAL", harness: owner, message: `units.skill.frontmatter "${ctx.targets.get(owner).units.skill.frontmatter}" is not implemented` });
  }
  for (const rel of [...unit.files.keys()].sort()) {
    const src = unit.files.get(rel);
    const r = substituteBytes(src.bytes, ctx.terms, owner);
    for (const e of r.errors) errors.push(termError(e, unit, rel));
    files.set(rel, { mode: src.mode, bytes: r.bytes });
  }
  if (hidden) {
    for (const h of readersOf(ctx, dir)) {
      const hide = ctx.targets.get(h).hide ?? { method: "none" };
      if (hide.method === "frontmatter-key") {
        const skill = files.get("SKILL.md");
        if (!skill) {
          errors.push({ code: "E_INTERNAL", message: `unit ${unit.id}: no SKILL.md to carry the ${h} hide key` });
          continue;
        }
        const text = setFrontmatterKey(decoder.decode(skill.bytes), hide.key, hide.value);
        files.set("SKILL.md", { mode: skill.mode, bytes: encoder.encode(text) });
      } else if (hide.method === "sidecar") {
        const cur = files.get(hide.file);
        const r = setYamlKey(cur ? decoder.decode(cur.bytes) : null, hide.key, hide.value);
        if (r.error) errors.push({ code: "E_INTERNAL", harness: h, message: `unit ${unit.id}: ${r.error}` });
        else files.set(hide.file, { mode: cur?.mode ?? FILE_MODE, bytes: encoder.encode(r.text) });
      }
    }
  }
  return { files: [...files].map(([path, f]) => ({ path, mode: f.mode, bytes: f.bytes })), errors };
}

function renderSkill(ctx, unit, hidden) {
  // place() compares copies by the digest of each format owner's render, taken in that owner's first writable dir.
  // Exact for a visible unit. For a hidden unit the hide set can differ between two dirs of one owner. In the v0
  // records only Codex owns two dirs, and each hidden Codex copy carries the sidecar that no other owner's copy has.
  const digests = {};
  for (const owner of ctx.installed) {
    const dir = ctx.targets.get(owner).reads.skills.find((e) => e.writable)?.path;
    if (!dir) continue;
    const copy = skillCopy(ctx, unit, dir, owner, hidden);
    if (copy.errors.length === 0) digests[owner] = treeHash(copy.files, { core: true });
  }
  const placed = place(
    { id: unit.id, harnesses: harnessesOf(ctx, unit), channel: unit.channel ?? {}, digests, hidden },
    ctx.installed,
    ctx.targets,
  );
  if (placed.error) {
    ctx.errors.push(placed.error);
    return;
  }
  for (const h of placed.leaks) ctx.info.push(`leak ${h} ${unit.id}: sees one copy, not a target`);
  for (const h of placed.unhidden) ctx.info.push(`unhidden ${h} ${unit.id}: the harness has no hide control`);
  for (const d of placed.dirs) {
    if (d.channel) {
      ctx.errors.push({ code: "E_INTERNAL", harness: d.owner, message: `unit ${unit.id}: the ${d.channel} channel render is not implemented` });
      continue;
    }
    const copy = skillCopy(ctx, unit, d.path, d.owner, hidden);
    if (copy.errors.length) {
      ctx.errors.push(...copy.errors);
      continue;
    }
    for (const f of copy.files) {
      emit(ctx, `${d.path}/${unit.name}/${f.path}`, { kind: "owned", bytes: f.bytes, mode: f.mode, unit: unit.id });
    }
  }
}

// ---- slot stubs

/** A slot stub is a core skill whose SKILL.md body comes from the slot's filler (draft section 8). */
function renderSlotStub(ctx, unit) {
  const slot = unit.name.slice("rig-".length);
  const src = unit.files.get("SKILL.md");
  if (!src) {
    ctx.errors.push({ code: "E_INTERNAL", message: `unit ${unit.id}: a slot stub has no SKILL.md` });
    return;
  }
  const vars = { slot_body: () => slotBody(slot, ctx.slots[slot] ?? null, ctx.fillers[slot] ?? null, ctx.tiers) };
  const r = fill(decoder.decode(src.bytes), vars);
  if (r.errors.length) {
    for (const e of r.errors) ctx.errors.push(termError(e, unit, "SKILL.md"));
    return;
  }
  const files = new Map(unit.files);
  files.set("SKILL.md", { mode: src.mode, bytes: encoder.encode(r.text) });
  renderSkill(ctx, { ...unit, files }, false);
}

// ---- commands, agents, rules

/** The format table: unit kind -> format -> [file under the dir, text transform]. */
const FORMATS = {
  command: {
    "md-frontmatter": [(n) => `${n}.md`, (t) => t],
    "md-body": [(n) => `${n}.md`, (t) => mdBody(t)],
    "skill-hidden": [(n) => `${n}/SKILL.md`, (t, n) => skillHidden(t, n)],
  },
  agent: {
    "claude-md": [(n) => `${n}.md`, (t) => t],
    "codex-toml": [(n) => `${n}.toml`, (t, n) => codexAgent(t, n)],
    "cursor-md": [(n) => `${n}.md`, (t, n) => cursorAgent(t, n)],
  },
  rule: {
    md: [(n) => `${n}.md`, (t) => t],
    mdc: [(n) => `${n}.mdc`, (t) => mdc(t)],
  },
};

/** The one source file of a single-file unit (command, agent, rule). */
function soleFile(ctx, unit) {
  if (unit.files.size !== 1) {
    ctx.errors.push({ code: "E_INTERNAL", message: `unit ${unit.id}: a ${unit.type} unit has exactly one file, found ${unit.files.size}` });
    return null;
  }
  const [[rel, file]] = unit.files;
  return { rel, text: decoder.decode(file.bytes) };
}

/** A core command named by rig.json `aliases` is compose's copy of the alias template: fill in its target. */
function aliasText(ctx, unit, src) {
  if (unit.type !== "command" || !isCore(unit) || !Object.hasOwn(ctx.aliases, unit.name)) return src;
  return { rel: src.rel, text: src.text.replaceAll(ALIAS_TARGET, ctx.aliases[unit.name]) };
}

function renderSingle(ctx, unit, kind) {
  const raw = soleFile(ctx, unit);
  if (!raw) return;
  const src = aliasText(ctx, unit, raw);
  for (const h of harnessesOf(ctx, unit)) {
    const spec = ctx.targets.get(h).units?.[kind];
    if (!spec) {
      ctx.info.push(`absent ${h} ${unit.id}: the harness has no ${kind} format`);
      continue;
    }
    const format = FORMATS[kind][spec.format];
    if (!format) {
      ctx.errors.push({ code: "E_INTERNAL", harness: h, message: `unit ${unit.id}: unknown ${kind} format "${spec.format}"` });
      continue;
    }
    const text = isCore(unit) ? coreVars(ctx, unit, src.rel, terms(ctx, unit, src, h), commandVars(ctx, h), [ALIAS_NAME]) : terms(ctx, unit, src, h);
    if (text === null) continue;
    const [file, transform] = format;
    emit(ctx, `${spec.dir}/${file(unit.name)}`, { kind: "owned", bytes: encoder.encode(transform(text, unit.name)), mode: FILE_MODE, unit: unit.id });
  }
}

// ---- the frame

/** The frame renders from frame.md. Its other files (compose adds principles.md) do not render in this version. */
function renderFrame(ctx, unit) {
  const file = unit.files.get(FRAME_FILE);
  if (!file) {
    ctx.errors.push({ code: "E_INTERNAL", message: `unit ${unit.id}: a frame unit has no ${FRAME_FILE}` });
    return;
  }
  const src = { rel: FRAME_FILE, text: decoder.decode(file.bytes) };
  for (const h of harnessesOf(ctx, unit)) {
    const instr = ctx.targets.get(h).instructions;
    if (!instr) {
      ctx.info.push(`absent ${h} ${unit.id}: the harness declares no instructions file`);
      continue;
    }
    const text = coreVars(ctx, unit, src.rel, terms(ctx, unit, src, h), frameVars(ctx, h));
    if (text === null) continue;
    if (instr.mode === "whole-file") {
      const body = instr.path.endsWith(".mdc") ? mdc(text) : text;
      emit(ctx, instr.path, { kind: "owned", bytes: encoder.encode(body), mode: FILE_MODE, unit: unit.id });
    } else if (instr.mode === "managed-block") {
      // The bytes between the markers. patch() owns the marker lines.
      emit(ctx, instr.path, { kind: "block", marker: FRAME_MARKER, bytes: encoder.encode(text), unit: unit.id });
    } else {
      ctx.errors.push({ code: "E_INTERNAL", harness: h, message: `unknown instructions.mode "${instr.mode}"` });
    }
  }
}

// ---- template variables of core templates

/** The variables of a core command: /craft fills {{entries}} and {{default_provider}}. */
function commandVars(ctx, h) {
  const target = ctx.targets.get(h);
  return {
    entries: () => entryLines(ctx.providers, h, target, ctx.locks),
    default_provider: () => defaultProvider(ctx),
  };
}

/** The variables of the frame. {{providers}}, {{slots}} and {{models}} are its per-harness lines. */
function frameVars(ctx, h) {
  const target = ctx.targets.get(h);
  return {
    providers: () => providerLines(ctx.providers, h, target, ctx.locks),
    default_provider: () => defaultProvider(ctx),
    slots: () => slotLines(ctx.stubs, ctx.slots, h),
    models: () => modelsLine(target),
  };
}

const defaultProvider = (ctx) =>
  ctx.defaultProvider ?? { error: { code: "E_INTERNAL", message: "rig.json names no default_provider" } };

/** Fill core template variables into text that terms() returned. Null when terms or a variable failed. */
function coreVars(ctx, unit, rel, text, vars, keep = []) {
  if (text === null) return null;
  const r = fill(text, vars, keep);
  if (r.errors.length) {
    for (const e of r.errors) ctx.errors.push(termError(e, unit, rel));
    return null;
  }
  return r.text;
}

// ---- model files

/**
 * The `whole` model surfaces of the workflow providers: one owned file per surface on an installed harness. The body
 * is the `# budget:` line and one `<label>: <value>[, <value>]` line per roles.json key of the consumer, in
 * roles.json order. With keep_header, patch() keeps the current frontmatter and "#" lines. A `.mdc` file carries
 * `alwaysApply: true`. A harness that tiers.json names in no tier renders no file, with an info line; any other
 * cell error is a render error.
 */
function renderModelFiles(ctx) {
  for (const p of ctx.providers) {
    for (const s of p.model_surfaces ?? []) {
      if (s.kind !== "whole" || !ctx.installed.includes(s.harness)) continue;
      const unit = `${p.name}/models`;
      if (!Object.values(ctx.tiers?.tiers ?? {}).some((row) => Object.hasOwn(row, s.harness))) {
        ctx.info.push(`absent ${s.harness} ${unit}: tiers.json names no ${s.harness} model, so ${s.path} does not render`);
        continue;
      }
      let values;
      try {
        values = cellValues(ctx.world, s, s.harness);
      } catch (e) {
        if (typeof e?.code !== "string") throw e;
        const message = e.message.startsWith(`${e.code}: `) ? e.message.slice(e.code.length + 2) : e.message;
        ctx.errors.push({ code: e.code, harness: s.harness, path: s.path, message: `unit ${unit}: ${message}` });
        continue;
      }
      const body = roleLines(s, values);
      const bytes = encoder.encode(s.path.endsWith(".mdc") ? mdc(body) : body);
      emit(ctx, s.path, { kind: "owned", bytes, mode: FILE_MODE, unit, ...(s.keep_header ? { keep_header: true } : {}) });
    }
  }
}

/** The role lines of one surface from its cell values. The `budget` key is the `# budget:` line. */
function roleLines(surface, values) {
  const byKey = new Map();
  for (const v of values) {
    if (!byKey.has(v.key)) byKey.set(v.key, []);
    (byKey.get(v.key)[v.element] ??= {})[v.field] = v.value;
  }
  const grammar = surface.grammar ?? "{model}";
  const lines = [...byKey].map(([key, elements]) => {
    const tokens = elements.map((f) => f.literal ?? grammar.replace(/\{(\w+)\}/g, (_, name) => f[name]));
    return `${key === "budget" ? "# budget" : key}: ${tokens.join(", ")}`;
  });
  return `${lines.join("\n")}\n`;
}

// ---- plugin manifests

/** A record's plugin_manifest renders once any file lands under its plugin root, the dir above the manifest's dir. */
function renderPluginManifests(ctx) {
  for (const h of ctx.installed) {
    const m = ctx.targets.get(h).plugin_manifest;
    if (!m) continue;
    const root = m.path.split("/").slice(0, -2).join("/") + "/";
    if (![...ctx.owners.keys()].some((p) => p.startsWith(root))) continue;
    const bytes = encoder.encode(JSON.stringify(m.value, null, 2) + "\n");
    emit(ctx, m.path, { kind: "owned", bytes, mode: FILE_MODE, unit: `core/${h}-plugin` });
  }
}

// ---- the session-end hook

const RIG_BIN = fileURLToPath(new URL("../bin/rig.mjs", import.meta.url));
const shellWord = (s) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(s) ? s : `'${s.replaceAll("'", "'\\''")}'`);
/** The hook command, and the element's identity in the JSON merge (section 2.10): `<node> <rig-bin> stats --record`. */
const SESSION_HOOK_COMMAND = `${shellWord(process.execPath)} ${shellWord(RIG_BIN)} stats --record`;

/** One hook element per record whose `hooks.session_end` is set, in the Claude matcher-group shape (probe h). */
function renderSessionHooks(ctx) {
  if (!ctx.sessionHook) return;
  const command = SESSION_HOOK_COMMAND;
  for (const h of ctx.installed) {
    const hook = ctx.targets.get(h).hooks?.session_end;
    if (!hook) continue;
    const value = { hooks: [{ type: "command", command }] };
    emit(ctx, hook.file, { kind: "json-element", pointer: hook.pointer, id: command, value, unit: "core/session-end" });
  }
}

// ---- shared

/** Substitute terms for one harness. Null when any placeholder fails; the errors are recorded. */
function terms(ctx, unit, src, harness) {
  const r = substitute(src.text, ctx.terms, harness);
  if (r.errors.length) {
    for (const e of r.errors) ctx.errors.push(termError(e, unit, src.rel));
    return null;
  }
  return r.text;
}

const termError = (e, unit, rel) => ({ ...e, message: `unit ${unit.id} (${rel}): ${e.message}` });

/** `**` crosses slashes, `*` does not (the rule of place.mjs, which does not export it). */
function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      re += ".*";
      i++;
    } else if (c === "*") re += "[^/]*";
    else re += c.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

function neverWriteGlobs(world) {
  const out = [];
  for (const h of world.config.harnesses) {
    for (const glob of world.targets.get(h).reads.never_write ?? []) out.push({ glob, re: globToRegExp(glob), harness: h });
  }
  return out;
}

/** Record one entry at a home-relative path. A never_write match or a second claim on a path is an error. */
function emit(ctx, rel, entry) {
  const hit = ctx.never.find((g) => g.re.test(rel));
  if (hit) {
    ctx.errors.push({ code: "E_CONTAINMENT", harness: hit.harness, path: rel, message: `unit ${entry.unit}: ${rel} matches never_write glob ${hit.glob} of ${hit.harness}` });
    return;
  }
  if (ctx.owners.has(rel)) {
    ctx.errors.push({ code: "E_CLASH", path: rel, message: `units ${ctx.owners.get(rel)} and ${entry.unit} both render ${rel}` });
    return;
  }
  const path = expand(ctx, rel);
  ctx.owners.set(rel, entry.unit);
  ctx.entries.set(path, { kind: entry.kind, path, ...entry });
}

function uniqueErrors(errors) {
  const seen = new Set();
  return errors.filter((e) => {
    const key = `${e.code}\0${e.harness ?? ""}\0${e.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Every skill each harness sees, managed or not, for plan and doctor. Reads dirs, skips dot entries. Copies that a
 * harness collapses under its dedupe rule are one entry; `dir` names the read dir of each entry.
 * @param {World} world
 * @param {unknown} [installed]  installed.json, its `entries`, or a Map of path to entry; marks rig-written copies managed
 * @returns {Map<string, {name: string, path: string, realpath: string, sha256: string, managed: boolean, dir: string}[]>}  by harness
 */
export function readSet(world, installed) {
  return readSetOf(world, installed);
}

/**
 * Locate and patch one region in current bytes. Covers cells, block, json-element, and owned with keep_header.
 * A locator failure does not throw: the internal's coded error (E_LOCATOR, E_JSON_ROUNDTRIP) comes back as `error`,
 * with `next` equal to the current bytes and `current` null.
 * An error without a code is a bug and still throws.
 * @param {Uint8Array | null} bytes   current file bytes, null when absent
 * @param {DesiredEntry} entry        kind cells, block, json-element, or owned with keep_header
 * @returns {{current: CellValue[] | Uint8Array | unknown | null, next: Uint8Array, markers: "present"|"inserted"|"n/a", error?: RigError}}
 */
export function patch(bytes, entry) {
  try {
    return patchRegion(bytes, entry);
  } catch (e) {
    if (typeof e?.code !== "string") throw e;
    const prefix = `${e.code}: `;
    const message = e.message.startsWith(prefix) ? e.message.slice(prefix.length) : e.message;
    const error = { code: e.code, message, ...(e.path ? { path: e.path } : {}) };
    return { current: null, next: bytes ?? new Uint8Array(), markers: "n/a", error };
  }
}
