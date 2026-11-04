// lib/world.mjs — public: loadWorld, projectDeclaration, encode

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
 * @property {{home: string, state: string, data: string, test: boolean}} env
 * @property {RigConfig} config            repo plus overlay, merged (adds only)
 * @property {Map<string, Pack>} packs     including core
 * @property {Map<string, TargetRecord>} targets   only the harnesses rig.json names
 * @property {Map<string, ProviderRecord>} providers
 * @property {Roles} roles
 * @property {Tiers} tiers
 * @property {{repo: Lock, overlay: Lock | null}} locks
 * @property {Allow["acks"]} acks
 * @property {Record<string, Record<string, Record<string, string>>>} terms
 * @property {Map<string, unknown>} facts  parsed facts files, keyed by home-relative path
 * @property {Map<string, Uint8Array>} sources   text_from files of whole surfaces, keyed by home-relative path
 * @property {Record<string, string | undefined>} vars   only the env vars checks read (DO_NOT_TRACK, model overrides)
 */
/** @typedef {{name: string, root: "repo"|"overlay", manifest: PackManifest, files: Map<string, {bytes: Uint8Array, mode: number}>}} Pack */

/** Read and validate both config roots, merge the overlay, pre-read facts. @param {NodeJS.ProcessEnv} env @returns {World} */
export function loadWorld(env) { throw new Error("not implemented"); }

/**
 * Read the provider declaration of one project. Never infers.
 * @param {World} world @param {string} dir
 * @returns {{provider: string, source: "instructions"|"local-instructions"|"default", line: string | null,
 *            overlay: string | null, agrees: boolean, footprints: string[], packs: {name: string, enabled: boolean, source: "local"|"project"|"user"|null}[]}}
 */
export function projectDeclaration(world, dir) { throw new Error("not implemented"); }

/** Validate and serialize one config kind in canonical form. @param {"tiers"|"lock"|"rig"|"roles"} kind @param {unknown} value @returns {Uint8Array} */
export function encode(kind, value) { throw new Error("not implemented"); }
