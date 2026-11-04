// lib/models.mjs — public: cellValues, setTier, effective

/** @typedef {import("./world.mjs").World} World */
/** @typedef {import("./world.mjs").ModelSurface} ModelSurface */
/** @typedef {import("./world.mjs").Tier} Tier */
/** @typedef {import("./targets.mjs").CellValue} CellValue */

/** Cell values for one surface: roles x tiers -> per-harness tokens, with ladders, clamping, aliases and pins. Pure.
 *  @param {World} world @param {ModelSurface} surface @param {string} harness @returns {CellValue[]} */
export function cellValues(world, surface, harness) { throw new Error("not implemented"); }

/** Build a new world with one tier cell changed. Writes nothing until write() runs.
 *  @param {World} world @param {Tier} tier @param {string} model @param {string} harness
 *  @returns {{world: World, write: () => void}}   write() replaces models/tiers.json of the defining root */
export function setTier(world, tier, model, harness) { throw new Error("not implemented"); }

/** The effective table per harness with the source of each value.
 *  @param {World} world @returns {{harness: string, tier: Tier, model: string, source: "tiers.json"|"pinned id"|"env override", env?: string}[]} */
export function effective(world) { throw new Error("not implemented"); }
