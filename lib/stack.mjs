// lib/stack.mjs — public: compose

/** @typedef {import("./world.mjs").World} World */
/** @typedef {import("./world.mjs").Scope} Scope */
/** @typedef {import("./world.mjs").ProviderRecord} ProviderRecord */

/**
 * @typedef {object} Unit
 * @property {string} id           "<pack>/<name>"
 * @property {"skill"|"command"|"agent"|"rule"|"frame"|"slot-stub"} type
 * @property {string} name         installed name
 * @property {Scope} scope
 * @property {string[]} projects
 * @property {string[]} harnesses  after pack, unit and rig.json narrowing
 * @property {Record<string, "plugin">} channel
 * @property {Map<string, {bytes: Uint8Array, mode: number}>} files   source files, relative to the unit
 */
/** @typedef {{units: Unit[], slots: Record<string, ProviderRecord | null>, providers: ProviderRecord[], errors: RigError[]}} Stack */
/** @typedef {{code: string, message: string, path?: string, harness?: string}} RigError */

/** Core seal, packs, scope, disable, replace, slots, clash rules. Pure. @param {World} world @returns {Stack} */
export function compose(world) { throw new Error("not implemented"); }
