// lib/targets.ts — public: render, readSet, patch
// internals: lib/targets/*.ts (unreachable from outside, see boundary test)

import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { treeHash } from "./tree.ts";
import { place } from "./targets/place.ts";
import { readSet as readSetOf } from "./targets/readset.ts";
import { patch as patchRegion } from "./targets/patch.ts";
import { substitute, substituteBytes } from "./targets/terms.ts";
import { fill } from "./targets/vars.ts";
import { codexAgent, cursorAgent, frontmatterValue, mdBody, mdc, setFrontmatterKey, setYamlKey, skillHidden } from "./targets/formats.ts";
import { absentLine, delivery, manifests, marketplaceOf, packOf, pluginDir, pluginPath } from "./targets/scope.ts";
import type { Delivery, Plugin } from "./targets/scope.ts";
import { renderModelSurfaces } from "./targets/models-render.ts";
import { insertAnchor, modeFiles } from "./mode.ts";
import type { Mode, UnitRef } from "./mode.ts";

import type { World } from "./world.ts";
import type { ModelSurface } from "./world.ts";
import type { TargetRecord } from "./world.ts";
import type { Stack } from "./stack.ts";
import type { RigError } from "./stack.ts";
import type { Unit } from "./stack.ts";

/**
 * What rig wants on disk, per absolute path. A `whole` surface renders as "owned"; with keep_header set,
 * patch() completes its bytes from the current file.
 */
export type DesiredEntry = {kind: "owned", path: string, bytes: Uint8Array, mode: number, unit: string, keep_header?: boolean}
  | {kind: "cells", path: string, surfaces: ModelSurface[], values: CellValue[], unit: string}
  | {kind: "block", path: string, marker: string, bytes: Uint8Array, unit: string, table?: string}
  | {kind: "json-element", path: string, pointer: string, id: string, value: unknown, unit: string};
/** One cell (models.cellValues): field is model, effort, display, model_effort or literal; displays lists every display name. */
export type CellValue = {surface: number, key: string, element: number, field: string, value: string, displays?: string[]};
export type Desired = {entries: Map<string, DesiredEntry>, errors: RigError[], info: string[]};
export type { Delivery } from "./targets/scope.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const FILE_MODE = 0o644;
/** The one reserved token of the core alias template `commands/alias.md` (section 2.3): the alias's target. */
const ALIAS_NAME = "target";
const ALIAS_TARGET = `{{${ALIAS_NAME}}}`;
const FRAME_MARKER = "rig:frame";
const FRAME_FILE = "frame.md";
const ANCHOR_LINK = "../craft/references/adapter.md";

/**
 * Render every unit for every harness. Pure: reads nothing from disk; input bytes come through stack and world.
 * Owned units in this version: skills, the mode skill, commands, agents, rules, the frame, the alias commands
 * that compose emits, the plugin manifest of a harness whose local plugin received files, the `whole` model
 * surfaces (a pack's model rules, the Codex fleet agent TOML) and the session-end hook: with rig.json
 * `metrics.session_hook` true, one json-element per target record that names `hooks.session_end`. The other model
 * surfaces render as cells entries (frontmatter, cells, keys) and one block (the Codex [agents] table). Core
 * templates fill a closed set of {{name}} variables from the target records; a name outside that set is
 * E_TERM_UNKNOWN.
 * A render error lands in `errors` and its entry is left out. A malformed World (an installed harness with no
 * target record) still throws, because loadWorld rules it out.
 */
export function render(stack: Stack, world: World): Desired {
  const ctx = {
    home: world.env.home,
    installed: world.config.harnesses,
    targets: world.targets,
    terms: world.terms ?? {},
    aliases: world.config.aliases ?? {},
    tiers: world.tiers,
    world,
    sessionHook: world.config.metrics?.session_hook === true,
    never: neverWriteGlobs(world),
    entries: new Map(),
    owners: new Map(), // home-relative path -> unit id, for clash messages and the plugin manifest
    plugins: new Map<string, Plugin>(), // project-scope plugins by "~/"-relative plugin dir (lib/targets/scope.ts)
    errors: [],
    info: [],
    auto: stack.mode?.auto ?? new Set<UnitRef>(),
    triggers: stack.mode?.triggers ?? [],
    types: new Map(stack.units.map((u) => [u.id, u.type])),
    anchored: {} as Record<string, string[]>,
  };
  for (const unit of stack.units) if (unit.type !== "mode" && unit.type !== "frame") renderUnit(ctx, unit);
  for (const unit of stack.units) if (unit.type === "frame") renderUnit(ctx, unit);
  for (const unit of stack.units) if (unit.type === "mode") renderMode(ctx, unit, stack.mode!);
  renderModels(ctx);
  renderPluginManifests(ctx);
  renderMarketplaces(ctx);
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
      if (ctx.targets.get(h).project_scope) renderProjectPart(ctx, unit, h);
      else if (!ctx.info.includes(absentLine(h, packOf(unit)))) ctx.info.push(absentLine(h, packOf(unit)));
    }
    if (scope === "project") return;
  }
  const hidden = !ctx.auto.has(unit.id);
  if (unit.type === "skill") renderSkill(ctx, unit, hidden);
  else if (unit.type === "frame") renderFrame(ctx, unit);
  else if (unit.type === "command" || unit.type === "agent" || unit.type === "rule") renderSingle(ctx, unit, unit.type);
  else ctx.errors.push({ code: "E_INTERNAL", message: `unit ${unit.id}: unknown unit type "${unit.type}"` });
}

// ---- skills

/** Harnesses that read a skill dir. A copy there carries the hide control of each (section 7). */
const readersOf = (ctx, dir) => ctx.installed.filter((h) => ctx.targets.get(h).reads.skills.some((e) => e.path === dir));

function vendored(ctx: any, unit: Unit) {
  const pack = ctx.world.packs?.get(packOf(unit));
  const lock = pack?.root === "overlay" ? ctx.world.locks?.overlay : ctx.world.locks?.repo;
  return (lock?.packs?.[packOf(unit)]?.paths?.length ?? 0) > 0;
}

function applyHide(ctx: any, unit: Unit, dir: string | null, files: Map<string, {bytes: Uint8Array, mode: number}>, errors: RigError[]) {
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

/**
 * The files of one skill copy in one dir. Terms resolve by the dir's format owner. A machine copy of a vendored
 * leaf gets the adapter anchor (design D5). Hide controls come from every harness that reads the dir.
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
  const skill = files.get("SKILL.md");
  if (dir !== null && skill && vendored(ctx, unit)) {
    const r = insertAnchor(decoder.decode(skill.bytes), ANCHOR_LINK);
    if (r.error) errors.push({ ...r.error, message: `unit ${unit.id}: ${r.error.message}` });
    else files.set("SKILL.md", { mode: skill.mode, bytes: encoder.encode(r.text) });
  }
  if (hidden) applyHide(ctx, unit, dir, files, errors);
  return { files: [...files].map(([path, f]) => ({ path, mode: f.mode, bytes: f.bytes })), errors };
}

function renderSkill(ctx, unit, hidden, copyOf = (dir: string, owner: string) => skillCopy(ctx, unit, dir, owner, hidden), anchored?: Record<string, string[]>) {
  // place() compares copies by the digest of each format owner's render, taken in that owner's first writable dir.
  // Exact for a visible unit. For a hidden unit the hide set can differ between two dirs of one owner. In the v0
  // records only Codex owns two dirs, and each hidden Codex copy carries the sidecar that no other owner's copy has.
  const digests = {};
  for (const owner of ctx.installed) {
    const dir = ctx.targets.get(owner).reads.skills.find((e) => e.writable)?.path;
    if (!dir) continue;
    const copy = copyOf(dir, owner);
    if (copy.errors.length === 0) digests[owner] = treeHash(copy.files, { core: true });
  }
  const placed = place(
    { id: unit.id, harnesses: harnessesOf(ctx, unit), channel: unit.channel ?? {}, digests, hidden, anchored },
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
    const copy = copyOf(d.path, d.owner);
    if (copy.errors.length) {
      ctx.errors.push(...copy.errors);
      continue;
    }
    for (const f of copy.files) {
      emit(ctx, `${d.path}/${unit.name}/${f.path}`, { kind: "owned", bytes: f.bytes, mode: f.mode, unit: unit.id });
    }
    if (!hidden && unit.type === "skill") sourceHideLines(ctx, unit, d.path);
    if (unit.type === "skill" && vendored(ctx, unit)) {
      const packs = (ctx.anchored[d.path] ??= []);
      if (!packs.includes(packOf(unit))) packs.push(packOf(unit));
    }
  }
}

/** An `auto` unit whose source already sets the hide control of a reader stays hidden there: rig keeps upstream bytes. */
function sourceHideLines(ctx: any, unit: Unit, dir: string) {
  for (const h of readersOf(ctx, dir)) {
    const hide = ctx.targets.get(h).hide ?? { method: "none" };
    let where = null;
    if (hide.method === "frontmatter-key") {
      const skill = unit.files.get("SKILL.md");
      if (skill && frontmatterValue(decoder.decode(skill.bytes), hide.key) === String(hide.value)) where = hide.key;
    } else if (hide.method === "sidecar") {
      const file = unit.files.get(hide.file);
      const [outer, inner] = hide.key.split(".");
      const set = new RegExp(`^${outer}:[ \\t]*\\r?\\n(?:[ \\t]+.*\\n)*?[ \\t]+${inner}:[ \\t]*${JSON.stringify(hide.value)}[ \\t]*\\r?$`, "m");
      if (file && set.test(decoder.decode(file.bytes))) where = `${hide.key} in ${hide.file}`;
    }
    const line = `${unit.id} stays hidden on ${h}: its source sets ${where}`;
    if (where && !ctx.info.includes(line)) ctx.info.push(line);
  }
}

// ---- the mode skill (lib/mode.ts)

/** Runs after every other unit, so `link` reads the leaf paths that the other units rendered and craft sits in every dir that holds an anchored leaf. */
function renderMode(ctx: any, unit: Unit, mode: Mode) {
  const shell = unit.files.get("SKILL.md");
  if (!shell) {
    ctx.errors.push({ code: "E_INTERNAL", message: `unit ${unit.id}: the mode skill has no SKILL.md template` });
    return;
  }
  const hidden = !ctx.auto.has(unit.id);
  const copyOf = (dir: string, owner: string) => {
    const shellText = substitute(decoder.decode(shell.bytes), ctx.terms, owner);
    const errors = shellText.errors.map((e) => termError(e, unit, "SKILL.md"));
    const link = (ref: UnitRef, from: string) => {
      const target = `${dir}/${ref.split("/")[1]}/SKILL.md`;
      return ctx.owners.get(target) === ref ? posix.relative(posix.dirname(`${dir}/${unit.name}/${from}`), target) : null;
    };
    const r = modeFiles(mode, shellText.text, { harness: owner, readers: readersOf(ctx, dir), link });
    errors.push(...r.errors.map((e) => termError(e, unit, "SKILL.md")));
    if (hidden) applyHide(ctx, unit, dir, r.files, errors);
    return { files: [...r.files].map(([path, f]) => ({ path, mode: f.mode, bytes: f.bytes })), errors };
  };
  renderSkill(ctx, unit, hidden, copyOf, ctx.anchored);
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
    const text = isCore(unit) ? coreVars(ctx, unit, src.rel, terms(ctx, unit, src, h), {}, [ALIAS_NAME]) : terms(ctx, unit, src, h);
    if (text === null) continue;
    const [file, transform] = format;
    emit(ctx, `${spec.dir}/${file(unit.name)}`, { kind: "owned", bytes: encoder.encode(transform(text, unit.name)), mode: FILE_MODE, unit: unit.id });
  }
}

// ---- the frame

/** Runs after the skill units, so the trigger lines read the leaf paths that they rendered. */
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

function frameVars(ctx, h) {
  const prefix = ctx.targets.get(h).skill_prefix;
  return {
    models: () => modelsLine(ctx.targets.get(h)),
    craft: () => (prefix ? `${prefix}craft` : { error: { code: "E_INTERNAL", harness: h, message: `targets/${h}.json declares no skill_prefix, so the frame cannot name the typed form of craft` } }),
    triggers: () => frameTriggers(ctx, h),
  };
}

/** The first read dir in record order, because a by-name harness reads the first copy of a name. */
function frameTriggers(ctx: any, h: string): string {
  const dirs: string[] = ctx.targets.get(h).reads.skills.map((e: {path: string}) => e.path);
  const lines = (ctx.triggers as Mode["triggers"]).flatMap((t) => {
    if (!("use" in t)) return [];
    const name = t.use.split("/")[1];
    const dir = dirs.find((d) => ctx.owners.get(`${d}/${name}/SKILL.md`) === t.use);
    if (dir) return [`${t.when}: read ${dir}/${name}/SKILL.md and apply it.`];
    const type: string = ctx.types.get(t.use) ?? "skill";
    const why = type === "skill" ? "no skill dir of the harness holds it" : `the unit has type ${type}, not skill`;
    ctx.info.push(`absent ${h} ${t.use}: ${why}, so the frame has no line for the trigger "${t.when}"`);
    return [];
  });
  return lines.length ? lines.join("\n") : "None.";
}

function modelsLine(target) {
  const m = target.models;
  const where = m?.source ?? "the session model";
  const raise = m?.effort_table ? "Raise effort per the effort-table conditions or after a verified failure." : "Raise effort after a verified failure.";
  return `${where}. ${raise} Change the model only for a new dispatch.`;
}

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

// ---- model surfaces (lib/targets/models-render.ts)

function renderModels(ctx) {
  const r = renderModelSurfaces({ installed: ctx.installed, targets: ctx.targets, packs: [...(ctx.world.packs?.values() ?? [])], tiers: ctx.tiers, world: ctx.world });
  ctx.errors.push(...r.errors);
  ctx.info.push(...r.info);
  for (const { rel, entry } of r.entries) emit(ctx, rel, entry);
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

// ---- project delivery: the Claude plugin of a project or hybrid pack (decision 0017, lib/targets/scope.ts)

/**
 * The project part of one unit on a harness with a project channel: a copy inside the pack's plugin dir in the
 * rig-owned marketplace. The copy carries no hide key: in a project that enables the plugin the pack is invocable.
 * A unit type with no plugin component (a rule) is absent, with an info line. `ctx` is render()'s context, which this
 * file does not type yet.
 */
function renderProjectPart(ctx: any, unit: Unit, h: string) {
  const market = marketplaceOf(ctx.targets.get(h), ctx.home, ctx.world.env.data);
  if ("error" in market) {
    ctx.errors.push({ code: "E_INTERNAL", harness: h, message: `unit ${unit.id}: ${market.error}` });
    return;
  }
  if (pluginPath(unit, "") === null) {
    ctx.info.push(`absent ${h} ${unit.id}: a ${h} plugin has no ${unit.type} component`);
    return;
  }
  let files;
  if (unit.type === "skill") {
    const copy = skillCopy(ctx, unit, null, h, false);
    if (copy.errors.length) {
      ctx.errors.push(...copy.errors);
      return;
    }
    files = copy.files;
  } else {
    const src = soleFile(ctx, unit);
    const text = src ? terms(ctx, unit, src, h) : null;
    if (!src || text === null) return;
    files = [{ path: src.rel, mode: FILE_MODE, bytes: encoder.encode(text) }];
  }
  const dir = pluginDir(market.dir, packOf(unit));
  if (!ctx.plugins.has(dir)) ctx.plugins.set(dir, { pack: packOf(unit), harness: h, marketplace: market, files: [] });
  for (const f of files) {
    const path = pluginPath(unit, f.path);
    ctx.plugins.get(dir).files.push({ path, mode: f.mode, bytes: f.bytes });
    emit(ctx, `${dir}/${path}`, { kind: "owned", bytes: f.bytes, mode: f.mode, unit: unit.id, harness: h });
  }
}

/** The plugin.json of every rendered plugin and the marketplace.json of every marketplace that holds one. */
function renderMarketplaces(ctx: any) {
  for (const m of manifests(ctx.plugins)) emit(ctx, m.path, { kind: "owned", bytes: m.bytes, mode: FILE_MODE, unit: m.unit, harness: m.harness });
}

// ---- the session-end hook

const RIG_BIN = fileURLToPath(new URL("../bin/rig.ts", import.meta.url));
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
 * @param installed  installed.json, its `entries`, or a Map of path to entry; marks rig-written copies managed
 * @returns by harness
 */
export function readSet(world: World, installed?: unknown): Map<string, {name: string, path: string, realpath: string, sha256: string, managed: boolean, dir: string}[]> {
  return readSetOf(world, installed);
}

/**
 * Locate and patch one region in current bytes. Covers cells, block, json-element, and owned with keep_header.
 * A locator failure does not throw: the internal's coded error (E_LOCATOR, E_JSON_ROUNDTRIP) comes back as `error`,
 * with `next` equal to the current bytes and `current` null.
 * An error without a code is a bug and still throws.
 * @param bytes   current file bytes, null when absent
 * @param entry        kind cells, block, json-element, or owned with keep_header
 */
export function patch(bytes: Uint8Array | null, entry: DesiredEntry): {current: CellValue[] | Uint8Array | unknown | null, next: Uint8Array, markers: "present"|"inserted"|"n/a", error?: RigError} {
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

/**
 * How each `project` or `hybrid` pack reaches its listed projects, per pack and harness: the Claude plugin facts for
 * the registration commands and the `enabledPlugins` snippet, or the repository paths to commit on a harness with no
 * project channel. Pure; apply and doctor --project print it.
 */
export function projectDelivery(stack: Stack, world: World): Delivery[] {
  return delivery(stack, world);
}
