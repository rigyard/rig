// lib/world.mjs — public: loadWorld, projectDeclaration, encode

import { existsSync, readdirSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { RigError } from "./world/errors.mjs";
import { mergeOverlay } from "./world/merge.mjs";
import { projectDeclaration as declaration } from "./world/project.mjs";
import { expandHome, homeRelative, readBytes, readConfig, readTree } from "./world/read.mjs";
import { check } from "./world/schema.mjs";
import {
  ALLOW, ENCODE, LOCK, PACK, PROVIDER, RIG, RIG_OVERLAY, ROLES, ROLES_OVERLAY, TARGET, TERMS, TIERS_FILE, TIERS_OVERLAY,
} from "./world/schemas.mjs";

/** @typedef {"low"|"medium"|"high"|"xhigh"|"max"} Effort */
/** @typedef {"reason"|"strong"|"fast"|"cheap"} Tier */
/** @typedef {"machine-hidden"|"project"|"hybrid"} Scope */

/** // schema: rig.json
 * @typedef {object} RigConfig
 * @property {1} schema
 * @property {string[]} harnesses
 * @property {Record<string, {scope?: Scope, projects?: string[], harnesses?: string[], channel?: Record<string, "plugin">}>} packs   no scope: machine-hidden
 * @property {string[]} pins
 * @property {string[]} providers
 * @property {string} default_provider
 * @property {Record<string, string>} aliases
 * @property {Record<string, {provider: string, tier?: Tier, harnesses?: string[]} | null>} slots
 * @property {string[]} disable
 * @property {{session_hook: boolean}} metrics
 * @property {Record<string, {provider: string}>} [projects]      overlay only
 * @property {ModelSurface[]} [model_surfaces]                     overlay only
 * @property {string[]} [private_terms]                            overlay only
 */

/** // schema: pack.json
 * @typedef {object} PackManifest
 * @property {1} schema
 * @property {string} name
 * @property {Scope[]} scopes
 * @property {string} license
 * @property {{repo: string, sha: string, paths: string[]} | null} source
 * @property {Record<string, {harnesses?: string[], replaces?: string}>} units
 */

/** // schema: targets/<h>.json
 * @typedef {object} TargetRecord
 * @property {1} schema
 * @property {string} name
 * @property {string} root
 * @property {{skills: ReadDir[], never_write: string[]}} reads
 * @property {{plugin?: {marketplace: string, dir: string}}} [channels]
 * @property {{skill?: object, command?: {dir: string, format: string}, agent?: AgentFormat | null, rule?: {dir: string, format: "md"|"mdc"}}} units
 * @property {{method: "frontmatter-key"|"sidecar"|"none", key?: string, file?: string, value?: unknown}} hide
 * @property {{path: string, mode: "whole-file"|"managed-block"}} instructions
 * @property {{path: string, value: unknown}} [plugin_manifest]   a rig-owned local plugin's manifest (Cursor, probe j)
 * @property {"separate-key"|"colon-suffix"|"dash-fused"|"bracket"} effort_syntax
 * @property {ModelSurface[]} model_surfaces
 * @property {{channel: "plugin", enable_file: string} | null} project_scope
 * @property {{session_end: {event: string, file: string, pointer: string, payload: string[]} | null}} hooks
 * @property {{format: "claude-jsonl"|"codex-rollout"|"omp-jsonl"|"cursor-agent-jsonl", root: string} | null} transcripts
 * @property {Record<string, string>} [facts]
 * @property {{description_max: number, listing_fraction?: number, instructions_max_bytes: number | null}} [budget]
 */
/** @typedef {{path: string, writable: boolean, plugin?: boolean, dedupe: "none"|"identical-bytes"|"by-name"}} ReadDir */
/** @typedef {{dir: string, format: "claude-md"|"codex-toml"|"cursor-md"}} AgentFormat */

/**
 * A model surface: {path, kind, consumer} plus the kind's parameters (section 8).
 * @typedef {object} ModelSurface
 * @property {string} path               may hold {role}, expanded over the consumer's roles
 * @property {string} [harness]          defaults to the record that declares it
 * @property {"fleet"|"pstack"|"omp"|"codex"|string} consumer   a key of roles.json consumers
 * @property {"frontmatter"|"cells"|"whole"|"keys"|"block"} kind   decision 0011
 * @property {boolean} [markers]         cells: markdown files people maintain only
 * @property {boolean} [harness_rewrites] the harness rewrites this file (probe c)
 * @property {string} [header] @property {string} [key_column] @property {string} [column]   cells
 * @property {string} [map]              keys
 * @property {string} [marker] @property {string} [table]   block
 * @property {{model?: string, effort?: string}} [keys]     frontmatter, whole, block
 * @property {string} [display_in]       frontmatter: the key whose first "(<display>)" token is a cell
 * @property {boolean} [keep_header]     whole: keep the current leading frontmatter and "#" lines
 * @property {string} [text_from]        whole agent files: source of description and body
 * @property {string} [grammar]          placeholders: {model} {effort} {display} {model_effort} {rest}
 * @property {string} [effort_syntax]    overrides the record's value for this surface
 */

/** // schema: providers/<p>.json
 * @typedef {object} ProviderRecord
 * @property {1} schema
 * @property {string} name
 * @property {"workflow"|"headless"|"native"} kind
 * @property {{plugin: string} | {cli: string, version: string} | null} [pin]
 * @property {Record<string, {read: string} | {command: string} | null>} [entry]      workflow
 * @property {string[]} [phases]                                                      workflow
 * @property {ModelSurface[]} [model_surfaces]                                        workflow
 * @property {Record<string, string>} [footprint]                                     workflow, info only
 * @property {string} [family]                                                        headless, native
 * @property {string[]} [argv]                                                        headless
 * @property {string} [model_harness]                                                 headless, native
 * @property {boolean} [forbid_same_family]                                           headless
 * @property {{default_on: boolean, optout_env: string[]} | null} telemetry
 */

/** @typedef {[Tier, Effort|string]} TierEffort */
/** @typedef {TierEffort | TierEffort[] | {literal: string} | {all: RoleValue, [harness: string]: RoleValue | string}} RoleValue */
/** // schema: models/roles.json
 * @typedef {{schema: 1, consumers: Record<string, Record<string, RoleValue>>}} Roles
 */
/** // schema: models/tiers.json
 * @typedef {object} Tiers
 * @property {1} schema
 * @property {Record<string, Effort[]>} ladders
 * @property {Record<string, string[]>} passthrough
 * @property {Record<Tier, Record<string, string | {id: string, display?: string}>>} tiers
 */
/** // schema: rig.lock.json
 * @typedef {object} Lock
 * @property {1} schema
 * @property {{tree: string, candidate: string | null}} core
 * @property {Record<string, {repo: string, sha: string, paths: string[], license: string, tree: string}>} packs
 * @property {Record<string, {plugin: string, current: PinState | null, candidate: (PinState & {checked: string}) | null}>} pins
 */
/** @typedef {{version: string, sha: string, tree: string}} PinState */
/** // schema: audit.allow.json
 * @typedef {{schema: 1, acks: {id: string, check: string, pack: string, path: string, reason: string, expires: string}[]}} Allow
 */


/**
 * Everything rig knows before compose. Frozen. Built only by loadWorld.
 * @typedef {object} World
 * @property {{home: string, state: string, data: string}} env
 * @property {{home: string, state: string, data: string, neverWrite: string[], readSets: string[]}} ctx
 *           the lib/fs.mjs write context, built once here: never_write globs and read-set dirs of the loaded targets
 * @property {Date} now                    the clock for ack expiry; RIG_NOW (ISO time) sets it in tests
 * @property {{repo: string, overlay: string | null}} roots   absolute config roots; overlay null when absent
 * @property {RigConfig} config            repo plus overlay, merged (adds only)
 * @property {Map<string, Pack>} packs     including core
 * @property {Map<string, TargetRecord>} targets   only the harnesses rig.json names
 * @property {Map<string, ProviderRecord>} providers
 * @property {Roles} roles
 * @property {Tiers} tiers
 * @property {{repo: Lock, overlay: Lock | null}} locks
 * @property {Allow["acks"]} acks
 * @property {Record<string, Record<string, string>>} terms   term -> harness -> text, from packs/core/terms.json
 * @property {Map<string, unknown>} facts  parsed facts files, keyed by home-relative path
 * @property {Map<string, Uint8Array>} sources   text_from files of whole surfaces, keyed by home-relative path
 * @property {Record<string, string | undefined>} vars   only the env vars checks read (DO_NOT_TRACK, telemetry opt-outs, model overrides)
 * @property {Map<string, unknown>} osv   parsed `cache/osv/<ecosystem>.json` files of the state root, keyed by ecosystem
 */
/** @typedef {{name: string, root: "repo"|"overlay", manifest: PackManifest, files: Map<string, {bytes: Uint8Array, mode: number}>}} Pack */

const PKG_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CORE_MANIFEST = { schema: 1, name: "core", scopes: ["machine-hidden"], source: null, units: {} };
const emptyLock = () => ({ schema: 1, core: null, packs: {}, pins: {} });
const MODEL_ENV = /^ANTHROPIC_DEFAULT_[A-Z0-9_]+_MODEL$/;
const SLOT_STUB = /^skills\/rig-([a-z0-9]+(?:-[a-z0-9]+)*)\/SKILL\.md$/;

/** @param {string} child @param {string} parent both absolute */
function inside(child, parent) {
  const r = relative(parent, child);
  return r === "" || (r !== ".." && !r.startsWith(`..${sep}`) && !isAbsolute(r));
}

const schemaError = (message, file, path) => new RigError("E_SCHEMA", message, { file, path });

function lockMap(m) {
  const deny = () => {
    throw new TypeError("World is frozen");
  };
  Object.defineProperties(m, { set: { value: deny }, delete: { value: deny }, clear: { value: deny } });
  return Object.freeze(m);
}

function deepFreeze(v) {
  if (v === null || typeof v !== "object" || ArrayBuffer.isView(v) || Object.isFrozen(v)) return v;
  if (v instanceof Map) {
    for (const x of v.values()) deepFreeze(x);
    return lockMap(v);
  }
  for (const x of Object.values(v)) deepFreeze(x);
  return Object.freeze(v);
}

/** @param {NodeJS.ProcessEnv} env */
function clock(env) {
  if (env.RIG_NOW === undefined) return new Date();
  const d = new Date(env.RIG_NOW);
  if (Number.isNaN(d.getTime())) throw schemaError("not an ISO date and time", "env", "RIG_NOW");
  return d;
}

/** Read and validate both config roots, merge the overlay, pre-read facts. @param {NodeJS.ProcessEnv} env @returns {World} */
export function loadWorld(env) {
  if (!env.HOME || !isAbsolute(env.HOME)) throw new RigError("E_STATE_ROOT", "HOME must be an absolute path", { path: "HOME" });
  const home = resolve(env.HOME);
  const now = clock(env);

  // State and data roots: inside HOME (exit 2 otherwise).
  const state = resolve(env.XDG_STATE_HOME || join(home, ".local/state"), "rig");
  const data = resolve(env.XDG_DATA_HOME || join(home, ".local/share"), "rig");
  for (const [name, p] of [["XDG_STATE_HOME", state], ["XDG_DATA_HOME", data]]) {
    if (!inside(p, home) || p === home) throw new RigError("E_STATE_ROOT", `${p} does not resolve inside HOME`, { path: name });
  }

  // Config roots.
  const repoRoot = resolve(env.RIG_ROOT || PKG_ROOT);
  const overlayRoot = join(resolve(env.XDG_CONFIG_HOME || join(home, ".config")), "rig");
  const hasOverlay = existsSync(overlayRoot);
  const R = (rel) => join(repoRoot, rel);
  const O = (rel) => join(overlayRoot, rel);
  const oname = (rel) => homeRelative(O(rel), home);
  const inOverlay = (rel) => hasOverlay && existsSync(O(rel));

  /** Repo file required, overlay file optional, merged adds-only. */
  const mergedFile = (rel, repoSpec, overlaySpec) => {
    const repo = readConfig(R(rel), rel, repoSpec);
    const over = inOverlay(rel) ? readConfig(O(rel), oname(rel), overlaySpec) : undefined;
    return over === undefined ? repo : mergeOverlay(overlaySpec, repo, over, oname(rel));
  };

  // rig.json
  const repoCfg = readConfig(R("rig.json"), "rig.json", RIG);
  const overCfg = inOverlay("rig.json") ? readConfig(O("rig.json"), oname("rig.json"), RIG_OVERLAY) : undefined;
  const config = overCfg === undefined ? repoCfg : mergeOverlay(RIG_OVERLAY, repoCfg, overCfg, oname("rig.json"));
  /** The rig.json that sets packs.<name> (or another top key): errors name the file the user must edit. */
  const cfgFile = (top, key) => (overCfg?.[top]?.[key] != null && repoCfg[top]?.[key] == null ? oname("rig.json") : "rig.json");

  // Core: repo only, sealed, never listed in packs (the rig.json schema rejects a `core` key).
  if (!existsSync(R("packs/core"))) throw schemaError("the core pack is missing", "packs/core");
  if (inOverlay("packs/core")) throw new RigError("E_OVERLAY_CONFLICT", "core lives only in the repo", { file: oname("packs/core") });
  const coreFiles = readTree(R("packs/core"));
  const slotNames = [...coreFiles.keys()].map((k) => k.match(SLOT_STUB)?.[1]).filter(Boolean);
  const terms = readConfig(R("packs/core/terms.json"), "packs/core/terms.json", TERMS).terms;

  // Targets: only the harnesses rig.json names, from the repo.
  const targets = new Map();
  config.harnesses.forEach((h, i) => {
    const rel = `targets/${h}.json`;
    if (!existsSync(R(rel))) throw schemaError(`no target record ${rel}`, "rig.json", `harnesses[${i}]`);
    const t = readConfig(R(rel), rel, TARGET);
    if (t.name !== h) throw schemaError(`must equal the file name ${h}`, rel, "name");
    targets.set(h, t);
  });

  // The fs write context gets every read-set dir and never_write glob. No harness may read the state root or
  // the data root (backups would load as units).
  const readSets = [];
  const neverWrite = [];
  for (const t of targets.values()) {
    const dirs = [...t.reads.skills.map((d) => d.path), ...Object.values(t.units ?? {}).map((u) => u?.dir).filter(Boolean)]
      .filter((d) => d.startsWith("~/") || isAbsolute(d));
    for (const g of t.reads.never_write) if (!neverWrite.includes(g)) neverWrite.push(g);
    for (const d of dirs) {
      if (!readSets.includes(d)) readSets.push(d);
      const abs = resolve(expandHome(d, home));
      for (const [name, p] of [["the state root", state], ["the data root", data]]) {
        if (inside(p, abs)) {
          throw new RigError("E_STATE_IN_READSET", `${name} ${homeRelative(p, home)} lies inside ${d}, which ${t.name} reads`, { file: `targets/${t.name}.json` });
        }
      }
    }
  }

  // Providers: listed names, from exactly one root.
  const providers = new Map();
  config.providers.forEach((p, i) => {
    const rel = `providers/${p}.json`;
    const repo = existsSync(R(rel));
    const over = inOverlay(rel);
    if (repo && over) throw new RigError("E_OVERLAY_CONFLICT", "the repo already has this provider record", { file: oname(rel) });
    if (!repo && !over) throw schemaError(`no provider record ${rel} in either root`, "rig.json", `providers[${i}]`);
    const file = repo ? rel : oname(rel);
    const rec = readConfig(repo ? R(rel) : O(rel), file, PROVIDER);
    if (rec.name !== p) throw schemaError(`must equal the file name ${p}`, file, "name");
    providers.set(p, rec);
  });

  // Cross-field rules of rig.json.
  if (!providers.has(config.default_provider)) throw schemaError("must name a listed provider", "rig.json", "default_provider");
  if (providers.get(config.default_provider).kind !== "workflow") throw schemaError("must name a workflow provider", "rig.json", "default_provider");
  const knownHarness = (list, file, path) =>
    (list ?? []).forEach((h, i) => {
      if (!config.harnesses.includes(h)) throw schemaError(`${h} is not in rig.json harnesses`, file, `${path}[${i}]`);
    });
  for (const [slot, filler] of Object.entries(config.slots)) {
    const file = cfgFile("slots", slot);
    if (!slotNames.includes(slot)) throw schemaError(`no core stub packs/core/skills/rig-${slot}/`, file, `slots.${slot}`);
    if (filler === null) continue;
    if (!providers.has(filler.provider)) throw schemaError("must name a listed provider", file, `slots.${slot}.provider`);
    knownHarness(filler.harnesses, file, `slots.${slot}.harnesses`);
  }
  for (const [dir, entry] of Object.entries(config.projects ?? {})) {
    if (!providers.has(entry.provider)) throw schemaError("must name a listed provider", oname("rig.json"), `projects[${JSON.stringify(dir)}].provider`);
  }

  // Packs: core plus every listed pack, each from exactly one root. Scope choice against pack.json scopes.
  const packs = new Map([["core", { name: "core", root: "repo", manifest: structuredClone(CORE_MANIFEST), files: coreFiles }]]);
  for (const [name, entry] of Object.entries(config.packs)) {
    const file = cfgFile("packs", name);
    const at = (k) => `packs.${name}.${k}`;
    const rel = `packs/${name}`;
    const repo = existsSync(R(rel));
    const over = inOverlay(rel);
    if (repo && over) throw new RigError("E_OVERLAY_CONFLICT", "the repo already has this pack", { file: oname(rel) });
    if (!repo && !over) throw schemaError(`no ${rel}/ in either root`, file, `packs.${name}`);
    const root = repo ? "repo" : "overlay";
    const mrel = `${rel}/pack.json`;
    const mfile = repo ? mrel : oname(mrel);
    const m = readConfig(repo ? R(mrel) : O(mrel), mfile, PACK);
    if (m.name !== name) throw schemaError(`must equal the directory name ${name}`, mfile, "name");
    const manifest = { schema: 1, name, scopes: ["machine-hidden"], source: null, units: {}, ...m };

    const scope = entry.scope ?? "machine-hidden";
    if (!manifest.scopes.includes(scope)) {
      throw new RigError("E_SCOPE_MODE", `scope ${scope} is not listed in ${mfile} scopes (${manifest.scopes.join(", ")})`, { file, path: at("scope") });
    }
    if (scope === "machine-hidden" && entry.projects) throw schemaError("projects needs scope project or hybrid", file, at("projects"));
    if (scope !== "machine-hidden" && !entry.projects) throw schemaError(`scope ${scope} needs projects`, file, at("projects"));
    knownHarness(entry.harnesses, file, at("harnesses"));
    for (const h of Object.keys(entry.channel ?? {})) {
      if (!config.harnesses.includes(h)) throw schemaError(`${h} is not in rig.json harnesses`, file, `${at("channel")}.${h}`);
      if (!targets.get(h).channels?.plugin) throw schemaError(`targets/${h}.json declares no plugin channel`, file, `${at("channel")}.${h}`);
    }
    for (const [unit, u] of Object.entries(manifest.units)) knownHarness(u.harnesses, mfile, `units.${unit}.harnesses`);
    packs.set(name, { name, root, manifest, files: readTree(repo ? R(rel) : O(rel)) });
  }

  // Models, locks, acks.
  const roles = mergedFile("models/roles.json", ROLES, ROLES_OVERLAY);
  const tiers = mergedFile("models/tiers.json", TIERS_FILE, TIERS_OVERLAY);
  const repoLock = { ...emptyLock(), ...readConfig(R("rig.lock.json"), "rig.lock.json", LOCK, { optional: true }) };
  const overLock = inOverlay("rig.lock.json") ? { ...emptyLock(), ...readConfig(O("rig.lock.json"), oname("rig.lock.json"), LOCK) } : null;
  const acks = [
    ...(readConfig(R("audit.allow.json"), "audit.allow.json", ALLOW, { optional: true })?.acks ?? []),
    ...(inOverlay("audit.allow.json") ? readConfig(O("audit.allow.json"), oname("audit.allow.json"), ALLOW).acks : []),
  ];

  // Facts: harness files that checks read. Absent files stay absent.
  const facts = new Map();
  for (const t of targets.values()) {
    for (const p of Object.values(t.facts ?? {})) {
      const abs = expandHome(p, home);
      const bytes = readBytes(abs);
      if (bytes === null) continue;
      try {
        facts.set(homeRelative(abs, home), JSON.parse(Buffer.from(bytes).toString("utf8")));
      } catch (err) {
        throw schemaError(`facts file is not valid JSON: ${err.message}`, homeRelative(abs, home));
      }
    }
  }

  // Sources: text_from files of whole surfaces, {role} expanded over the consumer's roles.
  const surfaces = [
    ...[...targets.values()].flatMap((t) => t.model_surfaces ?? []),
    ...[...providers.values()].flatMap((p) => p.model_surfaces ?? []),
    ...(config.model_surfaces ?? []),
  ];
  const sources = new Map();
  for (const s of surfaces) {
    if (!s.text_from) continue;
    const roleNames = Object.keys(roles.consumers[s.consumer] ?? {});
    const paths = s.text_from.includes("{role}") ? roleNames.map((r) => s.text_from.replaceAll("{role}", r)) : [s.text_from];
    for (const p of paths) {
      const abs = expandHome(p, home);
      const bytes = readBytes(abs);
      if (bytes !== null) sources.set(homeRelative(abs, home), bytes);
    }
  }

  // OSV cache: written only by refreshOsv. An unreadable or invalid file stays absent, so the cve check blocks.
  const osv = new Map();
  const osvDir = join(state, "cache", "osv");
  let osvNames = [];
  try {
    osvNames = readdirSync(osvDir).filter((n) => n.endsWith(".json")).sort();
  } catch {}
  for (const n of osvNames) {
    const bytes = readBytes(join(osvDir, n));
    if (bytes === null) continue;
    try {
      osv.set(n.slice(0, -".json".length), JSON.parse(Buffer.from(bytes).toString("utf8")));
    } catch {}
  }

  // Vars: only what checks and models.effective read. Claude Code remaps an alias through ANTHROPIC_DEFAULT_<ALIAS>_MODEL.
  const names = new Set(["DO_NOT_TRACK"]);
  for (const p of providers.values()) for (const spec of p.telemetry?.optout_env ?? []) names.add(spec.split("=")[0]);
  for (const k of Object.keys(env)) if (MODEL_ENV.test(k)) names.add(k);
  const vars = Object.fromEntries([...names].sort().map((n) => [n, env[n]]));

  return deepFreeze({
    env: { home, state, data },
    ctx: { home, state, data, neverWrite, readSets },
    now,
    roots: { repo: repoRoot, overlay: hasOverlay ? overlayRoot : null },
    config,
    packs,
    targets,
    providers,
    roles,
    tiers,
    locks: { repo: repoLock, overlay: overLock },
    acks,
    terms,
    facts,
    sources,
    osv,
    vars,
  });
}

/**
 * Read the provider declaration of one project. Never infers: footprints are info only.
 * @param {World} world @param {string} dir
 * @returns {{provider: string, source: "instructions"|"local-instructions"|"default", line: string | null,
 *            overlay: string | null, agrees: boolean, footprints: string[], packs: {name: string, enabled: boolean, source: "local"|"project"|"user"|null}[]}}
 */
export function projectDeclaration(world, dir) {
  return declaration(world, dir);
}

/**
 * Validate and serialize one config kind in canonical form: record keys in schema order, map keys sorted
 * (roles labels keep their order, because render emits them in that order), 2-space JSON, trailing newline.
 * @param {"tiers"|"lock"|"rig"|"roles"} kind @param {unknown} value @returns {Uint8Array}
 */
export function encode(kind, value) {
  const spec = ENCODE[kind];
  if (!spec) throw new RigError("E_INTERNAL", `encode: unknown kind ${kind}`);
  return Buffer.from(`${JSON.stringify(check(spec, value, `encode(${kind})`), null, 2)}\n`, "utf8");
}
