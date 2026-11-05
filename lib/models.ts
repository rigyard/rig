// lib/models.ts — public: cellValues, setTier, effective
//
// Owns roles x tiers: effort ladders and clamping, passthrough efforts, literal values, Claude aliases versus
// pinned ids with display names, and the effort syntax that fuses a model and an effort into one token.

import { writeConfig } from "./fs.ts";

/** Canonical effort rungs, lowest first. */
const RUNGS = ["low", "medium", "high", "xhigh", "max"];

/** How each effort_syntax fuses a model token and an effort into one {model_effort} token. */
const FUSE = {
  "separate-key": null,
  "colon-suffix": (model, effort) => `${model}:${effort}`,
  "dash-fused": (model, effort) => `${model}-${effort}`,
  bracket: (model, effort) => `${model}[effort=${effort}]`,
};

function fail(code, message, extra = {}) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  Object.assign(error, extra);
  throw error;
}

/** Placeholders of a grammar, in order, without {rest}. */
function placeholders(grammar) {
  return [...grammar.replace(/\[[^\]]*\{rest\}\]$/, "").matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
}

/** The cell fields one role element renders into on this surface, in file order. */
function fieldsOf(surface, syntax) {
  let fields;
  if (surface.kind === "frontmatter") {
    fields = surface.grammar ? placeholders(surface.grammar) : ["model"];
    if (surface.keys?.effort) fields.push("effort");
    if (surface.display_in) fields.push("display");
  } else if (surface.grammar) {
    fields = placeholders(surface.grammar);
  } else if (surface.keys) {
    fields = ["model", "effort"].filter((f) => surface.keys[f]);
  } else {
    fail("E_SCHEMA", `surface ${surface.path}: no grammar and no keys`);
  }
  for (const f of fields) {
    if (!["model", "effort", "display", "model_effort"].includes(f)) fail("E_SCHEMA", `surface ${surface.path}: bad field {${f}}`);
  }
  if (fields.includes("model_effort") && !FUSE[syntax]) {
    fail("E_SCHEMA", `surface ${surface.path}: {model_effort} needs a fusing effort_syntax, not ${syntax}`);
  }
  return [...new Set(fields)];
}

function capitalise(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Model token and display name of a tier on a harness. A string is an alias; {id, display} pins a full id. */
function modelOf(tiers, tier, harness) {
  const row = tiers.tiers?.[tier];
  if (!row) fail("E_SCHEMA", `tiers.json: unknown tier ${tier}`);
  const v = row[harness];
  if (v === undefined) fail("E_SCHEMA", `tiers.json: tier ${tier} has no value for harness ${harness}`);
  if (typeof v === "string") return { model: v, display: capitalise(v), pinned: false };
  if (v && typeof v.id === "string") return { model: v.id, display: v.display ?? capitalise(v.id), pinned: true };
  fail("E_SCHEMA", `tiers.json: tier ${tier} on ${harness} is neither a string nor {id, display}`);
}

function passthroughOf(tiers, harness) {
  const pass = tiers.passthrough?.[harness] ?? [];
  for (const p of pass) if (RUNGS.includes(p)) fail("E_SCHEMA", `tiers.json: passthrough ${p} on ${harness} is a canonical rung`);
  return pass;
}

/** The ladder of a harness. It holds canonical rungs only, so a walk over it can never return a passthrough value. */
function ladderOf(tiers, harness) {
  const ladder = tiers.ladders?.[harness];
  if (!Array.isArray(ladder) || !ladder.length) fail("E_SCHEMA", `tiers.json: no effort ladder for harness ${harness}`);
  for (const r of ladder) if (!RUNGS.includes(r)) fail("E_SCHEMA", `tiers.json: ladder of ${harness} holds ${r}, which is not a canonical rung`);
  return ladder;
}

/**
 * Clamp a canonical rung to the highest ladder rung at or below it. A passthrough literal listed for the harness
 * passes unchanged. Anything else is an error.
 */
function effortOf(tiers, effort, harness) {
  const ladder = ladderOf(tiers, harness);
  if (passthroughOf(tiers, harness).includes(effort)) return effort;
  const top = RUNGS.indexOf(effort);
  if (top < 0) fail("E_SCHEMA", `roles.json: effort ${effort} is neither a rung nor a passthrough value of ${harness}`);
  for (let i = top; i >= 0; i--) if (ladder.includes(RUNGS[i])) return RUNGS[i];
  fail("E_SCHEMA", `tiers.json: ladder of ${harness} has no rung at or below ${effort}`);
}

/** Resolve one roles.json entry for a harness into its elements: {literal} or {tier, effort}. */
function elementsOf(tiers, form, harness, where) {
  if (Array.isArray(form)) {
    if (Array.isArray(form[0])) return form.flatMap((f) => elementsOf(tiers, f, harness, where));
    if (form.length !== 2 || typeof form[0] !== "string" || typeof form[1] !== "string") {
      fail("E_SCHEMA", `roles.json ${where}: expected [tier, effort]`);
    }
    return [{ tier: form[0], effort: form[1] }];
  }
  if (form && typeof form === "object") {
    if (typeof form.literal === "string") return [{ literal: form.literal }];
    if ("all" in form) {
      const pick = Object.hasOwn(form, harness) ? form[harness] : form.all;
      if (typeof pick === "string") {
        if (!passthroughOf(tiers, harness).includes(pick)) {
          fail("E_SCHEMA", `roles.json ${where}: ${pick} is not a passthrough value of ${harness}`);
        }
        return [{ literal: pick }];
      }
      return elementsOf(tiers, pick, harness, where);
    }
  }
  fail("E_SCHEMA", `roles.json ${where}: unknown entry form`);
}

/**
 * Cell values for one surface: roles x tiers -> per-harness tokens, with ladders, clamping, aliases and pins. Pure.
 *
 * One value per (role, element, field). `key` is the roles.json key, `element` the panel index, `field` one of
 * model, effort, display, model_effort (a fused token) or literal (a value that fills the whole region).
 * `surface` is 0: the caller sets it to the surface's index in its DesiredEntry. Display values carry `displays`,
 * every display name of the harness, so the locator can find the current token.
 *
 */
export function cellValues(world: object, surface: object, harness: string): {surface: number, key: string, element: number, field: string, value: string, displays?: string[]}[] {
  const { tiers, roles } = world;
  const consumer = roles.consumers?.[surface.consumer];
  if (!consumer) fail("E_SCHEMA", `roles.json: unknown consumer ${surface.consumer}`);
  const syntax = surface.effort_syntax ?? world.targets.get(harness)?.effort_syntax;
  if (!(syntax in FUSE)) fail("E_SCHEMA", `harness ${harness}: unknown effort_syntax ${syntax}`);
  const fields = fieldsOf(surface, syntax);
  const displays = fields.includes("display")
    ? [...new Set(Object.keys(tiers.tiers).map((t) => modelOf(tiers, t, harness).display))]
    : null;

  const out = [];
  for (const [key, form] of Object.entries(consumer)) {
    elementsOf(tiers, form, harness, `${surface.consumer}.${key}`).forEach((el, element) => {
      if ("literal" in el) {
        out.push({ surface: 0, key, element, field: "literal", value: el.literal });
        return;
      }
      const { model, display } = modelOf(tiers, el.tier, harness);
      const effort = effortOf(tiers, el.effort, harness);
      for (const field of fields) {
        const value =
          field === "model" ? model : field === "effort" ? effort : field === "display" ? display : FUSE[syntax](model, effort);
        out.push(field === "display" ? { surface: 0, key, element, field, value, displays } : { surface: 0, key, element, field, value });
      }
    });
  }
  return out;
}

function deepFreeze(v) {
  if (v && typeof v === "object") {
    for (const x of Object.values(v)) deepFreeze(x);
    Object.freeze(v);
  }
  return v;
}

/**
 * Build a new world with one tier cell changed. Writes nothing.
 * A pinned value ({id, display}) stays pinned: only its id changes. A string stays a string.
 * @returns
 *   bytes: the new models/tiers.json in canonical form. write(): writes them to models/tiers.json of the repo root,
 *   world.roots.repo (World does not record which root defines tiers.json; v0 assumes the repo root).
 */
export function setTier(world: object, tier: string, model: string, harness: string): {world: object, bytes: Uint8Array, write: () => void} {
  if (!world.targets.has(harness)) fail("E_USAGE", `unknown harness ${harness}`);
  if (!Object.hasOwn(world.tiers.tiers ?? {}, tier)) fail("E_USAGE", `unknown tier ${tier}`);
  if (typeof model !== "string" || !model.trim() || model !== model.trim() || /\s/.test(model)) {
    fail("E_USAGE", `model must be one token without spaces, got "${model}"`);
  }
  const next = structuredClone(world.tiers);
  const old = next.tiers[tier][harness];
  next.tiers[tier][harness] = old && typeof old === "object" ? { ...old, id: model } : model;
  const bytes = new TextEncoder().encode(JSON.stringify(next, null, 2) + "\n");
  return {
    world: Object.freeze({ ...world, tiers: deepFreeze(next) }),
    bytes,
    write() {
      writeConfig(world.roots.repo, "models/tiers.json", bytes);
    },
  };
}

/** Claude Code remaps an alias for every session through this variable. */
function aliasEnv(alias) {
  return `ANTHROPIC_DEFAULT_${alias.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_MODEL`;
}

/**
 * The effective table per harness with the source of each value. An env override applies to Claude aliases
 * only; a pinned id is never overridden.
 */
export function effective(world: object): {harness: string, tier: string, model: string, source: "tiers.json"|"pinned id"|"env override", env?: string}[] {
  const rows = [];
  const vars = world.vars ?? {};
  for (const harness of world.targets.keys()) {
    for (const [tier, row] of Object.entries(world.tiers.tiers)) {
      if (!Object.hasOwn(row, harness)) continue;
      const { model, pinned } = modelOf(world.tiers, tier, harness);
      if (pinned) {
        rows.push({ harness, tier, model, source: "pinned id" });
        continue;
      }
      const env = harness === "claude" ? aliasEnv(model) : null;
      if (env && vars[env]) rows.push({ harness, tier, model: vars[env], source: "env override", env });
      else rows.push({ harness, tier, model, source: "tiers.json" });
    }
  }
  return rows;
}
