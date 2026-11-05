// One spec per config file (docs/design/rig-architecture.md section 2). Every root record is closed. rig.json,
// pack.json and rig.lock.json carry `schema: 2` (docs/design/rig-v1-first-seed.md), the other files `schema: 1`.
// Cross-file rules (scope modes, references between files) live in lib/world.ts.

import { ID, S, overlayOf } from "./schema.ts";

export const SCOPES = ["machine-hidden", "project", "hybrid"];
export const TIERS = ["reason", "strong", "fast", "cheap"];
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

const id = () => S.str({ pattern: ID });
const text = () => S.str({ nonEmpty: true });
const schema = S.lit(1);

export const SCHEMA_1_MESSAGE = "schema 1 is v0, see docs/design/rig-v1-first-seed.md";

const schema2 = (rec) => ({
  ...S.fn((v, fail, sub) => {
    if (v !== null && typeof v === "object" && !Array.isArray(v) && v.schema === 1) fail(SCHEMA_1_MESSAGE, ["schema"]);
    return sub(rec, v);
  }),
  spec: rec,
});

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

const packName = () => S.str({ pattern: ID, reject: (v) => (v === "core" ? "core is always installed and is never listed in packs" : null) });

/** A fill value: one unit, a list of units, or a list of {when, use}. */
const fillValue = S.fn((v, fail, sub) => {
  if (typeof v === "string") return sub(text(), v);
  if (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string")) return sub(S.arr(text(), { unique: true }), v);
  if (Array.isArray(v)) return sub(S.arr(S.rec({ when: text(), use: text() }, ["when", "use"])), v);
  return fail("expected a unit, a list of units, or a list of {when, use}");
});

const rigRec = S.rec(
  {
    schema: S.lit(2),
    harnesses: S.arr(id(), { unique: true, union: true }),
    packs: S.map(packEntry, { key: packName() }),
    aliases: S.map(id(), { key: id() }),
    fill: S.map(fillValue, { key: text() }),
    disable: S.arr(unitRef(), { unique: true, union: true }),
    metrics: S.rec({ session_hook: S.bool() }, ["session_hook"]),
  },
  ["schema", "harnesses", "packs", "aliases", "disable", "metrics"],
);
export const RIG = schema2(rigRec);

export const RIG_OVERLAY = schema2(overlayOf(rigRec, {
  model_surfaces: S.arr(modelSurface, { union: true }),
  private_terms: S.arr(text(), { unique: true, union: true }),
}));

// pack.json

export const PACK = schema2(S.rec(
  {
    schema: S.lit(2),
    name: id(),
    scopes: S.arr(S.enum(SCOPES), { unique: true, nonEmpty: true }),
    license: S.str(),
    units: S.map(S.rec({ harnesses: S.arr(id(), { unique: true }), replaces: unitRef() }), { key: id() }),
    mode: S.fn((v, fail) => (v !== null && typeof v === "object" && !Array.isArray(v) ? v : fail("expected an object"))),
    model_surfaces: S.arr(modelSurface),
    telemetry: S.nul(S.rec({ default_on: S.bool(), optout_env: S.arr(text()) }, ["default_on", "optout_env"])),
  },
  ["schema", "name"],
));

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
    // where model choices live: the frame's Models line
    models: S.rec({ source: text(), effort_table: S.bool() }, ["source"]),
    model_surfaces: S.arr(modelSurface),
    project_scope: S.nul(S.rec({ channel: S.enum(["plugin"]), enable_file: text() }, ["channel", "enable_file"])),
    hooks: S.rec({
      session_end: S.nul(S.rec({ event: text(), file: text(), pointer: text(), payload: S.arr(text()) }, ["event", "file", "pointer", "payload"])),
    }),
    transcripts: S.nul(S.rec({ format: S.enum(["claude-jsonl", "codex-rollout", "omp-jsonl", "cursor-agent-jsonl"]), root: text() }, ["format", "root"])),
    budget: S.rec({ description_max: S.int(), listing_fraction: S.num(), instructions_max_bytes: S.nul(S.int()) }),
  },
  ["schema", "name", "reads"],
);

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
const sha40 = () => S.str({ pattern: /^[0-9a-f]{40}$/ });

export const LOCK = schema2(S.rec(
  {
    schema: S.lit(2),
    core: S.nul(S.rec({ tree: S.nul(tree()), candidate: S.nul(tree()) }, ["tree", "candidate"])),
    packs: S.map(S.rec({
      repo: text(),
      sha: sha40(),
      root: text(),
      paths: S.arr(text()),
      exclude: S.arr(text(), { unique: true }),
      license: S.str(),
      tree: tree(),
      port: S.nul(S.rec({
        paths: S.arr(text(), { unique: true, nonEmpty: true }),
        tree: tree(),
        reviewed_sha: S.nul(sha40()),
        reviewed_tree: S.nul(tree()),
      }, ["paths", "tree", "reviewed_sha", "reviewed_tree"])),
      candidate: S.nul(S.rec({
        sha: sha40(),
        tree: tree(),
        port_tree: S.nul(tree()),
        checked: S.str({ pattern: /^\d{4}-\d{2}-\d{2}$/ }),
      }, ["sha", "tree", "port_tree", "checked"])),
    }, ["repo", "sha", "root", "paths", "exclude", "license", "tree", "port", "candidate"]), { key: id() }),
  },
  ["schema", "packs"],
));

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
