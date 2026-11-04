// lib/lock.mjs — public: vendor, pinCheck, pinSet. The only module that spawns (git) or calls fetch.

/** @typedef {import("./world.mjs").World} World */
/** @typedef {import("./world.mjs").PinState} PinState */
/** @typedef {import("./stack.mjs").RigError} RigError */
/** @typedef {import("./gate.mjs").Finding} Finding */

/** @param {World} world @param {{repo: string, sha: string, paths: string[], into: "repo"|"overlay"}} args
 *  @returns {Promise<{pack: string, findings: Finding[], blocked: boolean}>} */
export async function vendor(world, args) { throw new Error("not implemented"); }

/** @param {World} world @param {string} name  a pin name or "core" @param {string | null} sha
 *  @returns {Promise<{candidate: PinState, findings: Finding[], blocked: boolean}>} */
export async function pinCheck(world, name, sha) { throw new Error("not implemented"); }

/** @param {World} world @param {string} name @returns {{promoted: boolean, error?: RigError}}  E_PIN_UNCHECKED on mismatch */
export function pinSet(world, name) { throw new Error("not implemented"); }
