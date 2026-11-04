// One spec per config file (docs/design/rig-architecture.md section 2). Every root record is closed and carries
// `schema: 1`. Cross-file rules (scope modes, references between files) live in lib/world.mjs.

import { ID, S, overlayOf } from "./schema.mjs";

export const SCOPES = ["machine-hidden", "project", "hybrid"];
export const TIERS = ["reason", "strong", "fast", "cheap"];
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

const id = () => S.str({ pattern: ID });
const text = () => S.str({ nonEmpty: true });
const schema = S.lit(1);

/** `<pack>/<unit>`. A core unit is sealed: no disable and no replace may name it. */
const unitRef = () =>
  S.str({
    pattern: /^[a-z0-9]+(-[a-z0-9]+)*\/[a-z0-9]+(-[a-z0-9]+)*$/,
    reject: (v) => (v.startsWith("core/") ? "core units are sealed and cannot be named here" : null),
  });

const surface = S.rec(
  {
    path: text(),
    harness: id(),
    consumer: id(),
    kind: S.enum(["frontmatter", "cells", "whole", "keys", "block"]),
    markers: S.bool(),
    harness_rewrites: S.bool(),
    header: text(),
    key_column: text(),
    column: text(),
    map: text(),
    marker: text(),
    table: text(),
    keys: S.rec({ model: text(), effort: text() }),
    display_in: text(),
    keep_header: S.bool(),
    text_from: text(),
    grammar: text(),
    effort_syntax: S.enum(["separate-key", "colon-suffix", "dash-fused", "bracket"]),
  },
  ["path", "consumer", "kind"],
);

/** A model surface plus the rule of section 8: markers only on markdown files that people maintain. */
const modelSurface = S.fn((v, fail, sub) => {
  const out = sub(surface, v);
  if (out.markers === true && !out.path.endsWith(".md")) fail("markers: true needs a path that ends in .md");
  return out;
});

// rig.json

const packEntry = S.rec({
  scope: S.enum(SCOPES),
  projects: S.arr(text(), { unique: true, nonEmpty: true }),
  harnesses: S.arr(id(), { unique: true }),
  channel: S.map(S.enum(["plugin"]), { key: id() }),
});

const slotFiller = S.rec({ provider: id(), tier: S.enum(TIERS), harnesses: S.arr(id(), { unique: true }) }, ["provider"]);

const packName = () => S.str({ pattern: ID, reject: (v) => (v === "core" ? "core is always installed and is never listed in packs" : null) });

export const RIG = S.rec(
  {
    schema,
    harnesses: S.arr(id(), { unique: true, union: true }),
    packs: S.map(packEntry, { key: packName() }),
    pins: S.arr(id(), { unique: true, union: true }),
    providers: S.arr(id(), { unique: true, union: true }),
    default_provider: id(),
    aliases: S.map(id(), { key: id() }),
    slots: S.map(S.nul(slotFiller), { key: id(), slot: true }),
    disable: S.arr(unitRef(), { unique: true, union: true }),
    metrics: S.rec({ session_hook: S.bool() }, ["session_hook"]),
  },
  ["schema", "harnesses", "packs", "pins", "providers", "default_provider", "aliases", "slots", "disable", "metrics"],
);

export const RIG_OVERLAY = overlayOf(RIG, {
  projects: S.map(S.rec({ provider: id() }, ["provider"]), { key: text() }),
  model_surfaces: S.arr(modelSurface, { union: true }),
  private_terms: S.arr(text(), { unique: true, union: true }),
});

// pack.json

export const PACK = S.rec(
  {
    schema,
    name: id(),
    scopes: S.arr(S.enum(SCOPES), { unique: true, nonEmpty: true }),
    license: S.str(),
    source: S.nul(S.rec({ repo: text(), sha: text(), paths: S.arr(text(), { nonEmpty: true }) }, ["repo", "sha", "paths"])),
    units: S.map(S.rec({ harnesses: S.arr(id(), { unique: true }), replaces: unitRef() }), { key: id() }),
  },
  ["schema", "name"],
);

// targets/<h>.json. Only the read-set fields are required: the other fields arrive with the slices that use them.

const readDir = S.rec(
  { path: text(), writable: S.bool(), plugin: S.bool(), dedupe: S.enum(["none", "identical-bytes", "by-name"]) },
  ["path", "writable", "dedupe"],
);
const dirFormat = (formats) => S.rec({ dir: text(), format: S.enum(formats) }, ["dir", "format"]);

export const TARGET = S.rec(
  {
    schema,
    name: id(),
    root: text(),
    reads: S.rec({ skills: S.arr(readDir), never_write: S.arr(text()) }, ["skills", "never_write"]),
    channels: S.rec({ plugin: S.rec({ marketplace: text(), dir: text() }, ["marketplace", "dir"]) }),
    units: S.rec({
      skill: S.nul(S.rec({ frontmatter: S.enum(["keep", "strip-unknown"]), sidecar: S.nul(S.enum(["openai-yaml"])) })),
      command: S.nul(dirFormat(["md-frontmatter", "md-body", "skill-hidden"])),
      agent: S.nul(dirFormat(["claude-md", "codex-toml", "cursor-md"])),
      rule: S.nul(dirFormat(["md", "mdc"])),
    }),
    hide: S.rec({ method: S.enum(["frontmatter-key", "sidecar", "none"]), key: text(), file: text(), value: S.any() }, ["method"]),
    instructions: S.rec({ path: text(), mode: S.enum(["whole-file", "managed-block"]) }, ["path", "mode"]),
    // the manifest of a rig-owned local plugin; rendered when any file lands under its plugin root (probe j)
    plugin_manifest: S.rec({ path: text(), value: S.any() }, ["path", "value"]),
    effort_syntax: S.enum(["separate-key", "colon-suffix", "dash-fused", "bracket"]),
    model_surfaces: S.arr(modelSurface),
    project_scope: S.nul(S.rec({ channel: S.enum(["plugin"]), enable_file: text() }, ["channel", "enable_file"])),
    hooks: S.rec({
      session_end: S.nul(S.rec({ event: text(), file: text(), pointer: text(), payload: S.arr(text()) }, ["event", "file", "pointer", "payload"])),
    }),
    transcripts: S.nul(S.rec({ format: S.enum(["claude-jsonl", "codex-rollout", "omp-jsonl", "cursor-agent-jsonl"]), root: text() }, ["format", "root"])),
    facts: S.map(text(), { key: S.str({ pattern: /^[a-z0-9_]+$/ }) }),
    budget: S.rec({ description_max: S.int(), listing_fraction: S.num(), instructions_max_bytes: S.nul(S.int()) }),
  },
  ["schema", "name", "reads"],
);

// providers/<p>.json

const PROVIDER_FIELDS = {
  workflow: ["pin", "entry", "phases", "model_surfaces", "footprint"],
  headless: ["family", "argv", "model_harness", "forbid_same_family"],
  native: ["family", "model_harness"],
};

const providerRec = S.rec(
  {
    schema,
    name: id(),
    kind: S.enum(["workflow", "headless", "native"]),
    pin: S.nul(S.one([
      ["plugin", S.rec({ plugin: text() }, ["plugin"])],
      ["cli", S.rec({ cli: text(), version: text() }, ["cli", "version"])],
    ])),
    entry: S.map(S.nul(S.one([
      ["read", S.rec({ read: text() }, ["read"])],
      ["command", S.rec({ command: text() }, ["command"])],
    ])), { key: id() }),
    phases: S.arr(id()),
    model_surfaces: S.arr(modelSurface),
    footprint: S.map(text(), { key: id() }),
    family: id(),
    argv: S.arr(text(), { nonEmpty: true }),
    model_harness: id(),
    forbid_same_family: S.bool(),
    telemetry: S.nul(S.rec({ default_on: S.bool(), optout_env: S.arr(text()) }, ["default_on", "optout_env"])),
  },
  ["schema", "name", "kind", "telemetry"],
);

/** A provider record. Fields of another kind are an error: a headless record has no `entry`. */
export const PROVIDER = S.fn((v, fail, sub) => {
  const out = sub(providerRec, v);
  const own = PROVIDER_FIELDS[out.kind];
  for (const k of Object.values(PROVIDER_FIELDS).flat()) {
    if (k in out && !own.includes(k)) fail(`not a field of a ${out.kind} provider`, [k]);
  }
  return out;
});

// models/roles.json and models/tiers.json

const tierEffort = S.fn((v, fail, sub) => {
  if (!Array.isArray(v) || v.length !== 2) fail("expected [tier, effort]");
  return [sub(S.enum(TIERS), v[0], 0), sub(text(), v[1], 1)];
});

/** [tier, effort] | [[tier, effort], ...] | {literal} | {all, <harness>: form or passthrough literal} */
const roleValue = S.fn(function form(v, fail, sub) {
  if (Array.isArray(v)) {
    if (v.length > 0 && v.every(Array.isArray)) return v.map((x, i) => sub(tierEffort, x, i));
    return sub(tierEffort, v);
  }
  if (v !== null && typeof v === "object" && "literal" in v) return sub(S.rec({ literal: text() }, ["literal"]), v);
  if (v !== null && typeof v === "object" && "all" in v) {
    const out = { all: sub(roleValue, v.all, "all") };
    for (const k of Object.keys(v).filter((k) => k !== "all").sort()) {
      sub(id(), k, k);
      out[k] = typeof v[k] === "string" ? sub(text(), v[k], k) : sub(roleValue, v[k], k);
    }
    return out;
  }
  return fail("expected [tier, effort], a panel, {literal} or {all, <harness>}");
});

export const ROLES = S.rec(
  { schema, consumers: S.map(S.map(roleValue, { key: text(), ordered: true }), { key: id() }) },
  ["schema", "consumers"],
);
export const ROLES_OVERLAY = overlayOf(ROLES);

const modelToken = S.fn((v, fail, sub) =>
  typeof v === "string" ? sub(text(), v) : sub(S.rec({ id: text(), display: text() }, ["id"]), v));

export const TIERS_FILE = S.rec(
  {
    schema,
    ladders: S.map(S.arr(S.enum(EFFORTS), { unique: true, nonEmpty: true }), { key: id() }),
    passthrough: S.map(S.arr(text(), { unique: true }), { key: id() }),
    tiers: S.rec(Object.fromEntries(TIERS.map((t) => [t, S.map(modelToken, { key: id() })]))),
  },
  ["schema", "ladders", "passthrough", "tiers"],
);
export const TIERS_OVERLAY = overlayOf(TIERS_FILE);

// rig.lock.json

const tree = () => S.str({ pattern: /^sha256:[0-9a-f]+$/ });
const pinState = S.rec({ version: text(), sha: text(), tree: tree() }, ["version", "sha", "tree"]);

export const LOCK = S.rec(
  {
    schema,
    core: S.nul(S.rec({ tree: tree(), candidate: S.nul(tree()) }, ["tree", "candidate"])),
    packs: S.map(S.rec({ repo: text(), sha: text(), paths: S.arr(text()), license: S.str(), tree: tree() },
      ["repo", "sha", "paths", "license", "tree"]), { key: id() }),
    pins: S.map(S.rec({
      plugin: text(),
      current: S.nul(pinState),
      candidate: S.nul(S.rec({ ...pinState.fields, checked: S.str({ pattern: /^\d{4}-\d{2}-\d{2}$/ }) }, [...pinState.req, "checked"])),
    }, ["plugin", "current", "candidate"]), { key: id() }),
  },
  ["schema", "packs", "pins"],
);

// audit.allow.json

export const ALLOW = S.rec(
  {
    schema,
    acks: S.arr(S.rec({
      id: S.str({ pattern: /^[0-9a-f]{16}$/ }),
      check: id(),
      pack: id(),
      path: text(),
      reason: text(),
      expires: S.str({ pattern: /^\d{4}-\d{2}-\d{2}$/, reject: (v) => (Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? "not a date" : null) }),
    }, ["id", "check", "pack", "path", "reason", "expires"])),
  },
  ["schema", "acks"],
);

// packs/core/terms.json

export const TERMS = S.rec({ schema, terms: S.map(S.map(text(), { key: id() }), { key: id() }) }, ["schema", "terms"]);

/** Spec per `encode` kind. The overlay variants: same closed keys, fewer required fields, so either root encodes. */
export const ENCODE = { rig: RIG_OVERLAY, tiers: TIERS_OVERLAY, roles: ROLES_OVERLAY, lock: LOCK };
