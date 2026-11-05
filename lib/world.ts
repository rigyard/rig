// lib/world.ts — public: loadWorld, projectDeclaration, encode

import { existsSync, readdirSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { RigError } from "./world/errors.ts";
import { mergeOverlay } from "./world/merge.ts";
import { projectDeclaration as declaration } from "./world/project.ts";
import { expandHome, homeRelative, readBytes, readConfig, readTree } from "./world/read.ts";
import { check } from "./world/schema.ts";
import {
  ALLOW, ENCODE, LOCK, PACK, PROVIDER, RIG, RIG_OVERLAY, ROLES, ROLES_OVERLAY, TARGET, TERMS, TIERS_FILE, TIERS_OVERLAY,
} from "./world/schemas.ts";

export type Effort = "low"|"medium"|"high"|"xhigh"|"max";
export type Tier = "reason"|"strong"|"fast"|"cheap";
export type Scope = "machine-hidden"|"project"|"hybrid";

// schema: rig.json
export type RigConfig = {
  schema: 1;
  harnesses: string[];
  /** no scope: machine-hidden */
  packs: Record<string, {scope?: Scope, projects?: string[], harnesses?: string[], channel?: Record<string, "plugin">}>;
  pins: string[];
  providers: string[];
  default_provider: string;
  aliases: Record<string, string>;
  slots: Record<string, {provider: string, tier?: Tier, harnesses?: string[]} | null>;
  disable: string[];
  metrics: {session_hook: boolean};
  /** overlay only */
  projects?: Record<string, {provider: string}>;
  /** overlay only */
  model_surfaces?: ModelSurface[];
  /** overlay only */
  private_terms?: string[];
};

// schema: pack.json
export type PackManifest = {
  schema: 1;
  name: string;
  scopes: Scope[];
  license: string;
  source: {repo: string, sha: string, paths: string[]} | null;
  /** provenance of a ported pack, info only */
  ported_from?: {source: string, sha: string} | null;
  units: Record<string, {harnesses?: string[], replaces?: string}>;
};

// schema: targets/<h>.json
export type TargetRecord = {
  schema: 1;
  name: string;
  root: string;
  reads: {skills: ReadDir[], never_write: string[]};
  channels?: {plugin?: {marketplace: string, dir: string}};
  units: {skill?: object, command?: {dir: string, format: string}, agent?: AgentFormat | null, rule?: {dir: string, format: "md"|"mdc"}};
  hide: {method: "frontmatter-key"|"sidecar"|"none", key?: string, file?: string, value?: unknown};
  instructions: {path: string, mode: "whole-file"|"managed-block"};
  /** the frame's Models line: where model choices live */
  models?: {source: string, effort_table?: boolean};
  /** a rig-owned local plugin's manifest (Cursor, probe j) */
  plugin_manifest?: {path: string, value: unknown};
  effort_syntax: "separate-key"|"colon-suffix"|"dash-fused"|"bracket";
  model_surfaces: ModelSurface[];
  project_scope: {channel: "plugin", enable_file: string} | null;
  hooks: {session_end: {event: string, file: string, pointer: string, payload: string[]} | null};
  transcripts: {format: "claude-jsonl"|"codex-rollout"|"omp-jsonl"|"cursor-agent-jsonl", root: string} | null;
  facts?: Record<string, string>;
  budget?: {description_max: number, listing_fraction?: number, instructions_max_bytes: number | null};
};
export type ReadDir = {path: string, writable: boolean, plugin?: boolean, dedupe: "none"|"identical-bytes"|"by-name"};
export type AgentFormat = {dir: string, format: "claude-md"|"codex-toml"|"cursor-md"};

/** A model surface: {path, kind, consumer} plus the kind's parameters (section 8). */
export type ModelSurface = {
  /** may hold {role}, expanded over the consumer's roles */
  path: string;
  /** defaults to the record that declares it */
  harness?: string;
  /** a key of roles.json consumers */
  consumer: "fleet"|"pstack"|"omp"|"codex"|string;
  /** decision 0011 */
  kind: "frontmatter"|"cells"|"whole"|"keys"|"block";
  /** cells: markdown files people maintain only */
  markers?: boolean;
  /** the harness rewrites this file (probe c) */
  harness_rewrites?: boolean;
  header?: string;
  key_column?: string;
  /** cells */
  column?: string;
  /** keys */
  map?: string;
  marker?: string;
  /** block */
  table?: string;
  /** frontmatter, whole, block */
  keys?: {model?: string, effort?: string};
  /** frontmatter: the key whose first "(<display>)" token is a cell */
  display_in?: string;
  /** whole: keep the current leading frontmatter and "#" lines */
  keep_header?: boolean;
  /** whole agent files: source of description and body */
  text_from?: string;
  /** placeholders: {model} {effort} {display} {model_effort} {rest} */
  grammar?: string;
  /** overrides the record's value for this surface */
  effort_syntax?: string;
};

// schema: providers/<p>.json
export type ProviderRecord = {
  schema: 1;
  name: string;
  kind: "workflow"|"headless"|"native";
  pin?: {plugin: string} | {cli: string, version: string} | null;
  /** workflow */
  entry?: Record<string, {read: string} | {command: string} | null>;
  /** workflow */
  phases?: string[];
  /** workflow, the frame's Providers line */
  artifacts?: string;
  /** workflow */
  model_surfaces?: ModelSurface[];
  /** workflow, info only */
  footprint?: Record<string, string>;
  /** workflow, the product-role handoff */
  intake?: Record<string, string | null>;
  /** headless, native */
  family?: string;
  /** headless */
  argv?: string[];
  /** headless, native */
  model_harness?: string;
  /** headless */
  forbid_same_family?: boolean;
  telemetry: {default_on: boolean, optout_env: string[]} | null;
};

export type TierEffort = [Tier, Effort|string];
export type RoleValue = TierEffort | TierEffort[] | {literal: string} | {all: RoleValue, [harness: string]: RoleValue | string};
// schema: models/roles.json
export type Roles = {schema: 1, consumers: Record<string, Record<string, RoleValue>>};
// schema: models/tiers.json
export type Tiers = {
  schema: 1;
  ladders: Record<string, Effort[]>;
  passthrough: Record<string, string[]>;
  tiers: Record<Tier, Record<string, string | {id: string, display?: string}>>;
};
// schema: rig.lock.json
export type Lock = {
  schema: 1;
  core: {tree: string, candidate: string | null};
  packs: Record<string, {repo: string, sha: string, paths: string[], license: string, tree: string}>;
  pins: Record<string, {plugin: string, current: PinState | null, candidate: (PinState & {checked: string}) | null}>;
};
export type PinState = {version: string, sha: string, tree: string};
// schema: audit.allow.json
export type Allow = {schema: 1, acks: {id: string, check: string, pack: string, path: string, reason: string, expires: string}[]};


/** Everything rig knows before compose. Frozen. Built only by loadWorld. */
export type World = {
  env: {home: string, state: string, data: string};
  /** the lib/fs.ts write context, built once here: never_write globs and read-set dirs of the loaded targets */
  ctx: {home: string, state: string, data: string, neverWrite: string[], readSets: string[]};
  /** the clock for ack expiry; RIG_NOW (ISO time) sets it in tests */
  now: Date;
  /** absolute config roots; overlay null when absent */
  roots: {repo: string, overlay: string | null};
  /** repo plus overlay, merged (adds only) */
  config: RigConfig;
  /** including core */
  packs: Map<string, Pack>;
  /** only the harnesses rig.json names */
  targets: Map<string, TargetRecord>;
  providers: Map<string, ProviderRecord>;
  roles: Roles;
  tiers: Tiers;
  locks: {repo: Lock, overlay: Lock | null};
  acks: Allow["acks"];
  /** term -> harness -> text, from packs/core/terms.json */
  terms: Record<string, Record<string, string>>;
  /** parsed facts files, keyed by home-relative path */
  facts: Map<string, unknown>;
  /** text_from files of whole surfaces, keyed by home-relative path */
  sources: Map<string, Uint8Array>;
  /** only the env vars checks read (DO_NOT_TRACK, telemetry opt-outs, model overrides) */
  vars: Record<string, string | undefined>;
  /** parsed `cache/osv/<ecosystem>.json` files of the state root, keyed by ecosystem */
  osv: Map<string, unknown>;
};
export type Pack = {name: string, root: "repo"|"overlay", manifest: PackManifest, files: Map<string, {bytes: Uint8Array, mode: number}>};

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

/** Read and validate both config roots, merge the overlay, pre-read facts. */
export function loadWorld(env: NodeJS.ProcessEnv): World {
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
 */
export function projectDeclaration(world: World, dir: string): {provider: string, source: "instructions"|"local-instructions"|"default", line: string | null, overlay: string | null, agrees: boolean, footprints: string[], packs: {name: string, enabled: boolean, source: "local"|"project"|"user"|null}[]} {
  return declaration(world, dir);
}

/**
 * Validate and serialize one config kind in canonical form: record keys in schema order, map keys sorted
 * (roles labels keep their order, because render emits them in that order), 2-space JSON, trailing newline.
 */
export function encode(kind: "tiers"|"lock"|"rig"|"roles", value: unknown): Uint8Array {
  const spec = ENCODE[kind];
  if (!spec) throw new RigError("E_INTERNAL", `encode: unknown kind ${kind}`);
  return Buffer.from(`${JSON.stringify(check(spec, value, `encode(${kind})`), null, 2)}\n`, "utf8");
}
