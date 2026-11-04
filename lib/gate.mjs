// lib/gate.mjs — public: gate, refreshOsv

/** @typedef {import("./world.mjs").World} World */
/** @typedef {import("./stack.mjs").Stack} Stack */
/** @typedef {import("./targets.mjs").Desired} Desired */

/** @typedef {"pin"|"exec"|"secret"|"unicode"|"license"|"cve"|"telemetry"|"budget"} CheckId */
/** @typedef {{check: CheckId, severity: "block"|"warn"|"info", pack: string, path: string, evidence: string, id: string, acked: boolean, stanza: string | null}} Finding */

/** Run every registered check over sources and rendered bytes. Pure over its inputs; reads the OSV cache from world.
 *  @param {Stack} stack @param {Desired} desired @param {World} world @returns {{findings: Finding[], blocked: boolean}} */
export function gate(stack, desired, world) { throw new Error("not implemented"); }

/** Refresh cache/osv for the manifests in the stack. Called only by lib/lock.mjs, which passes its fetch.
 *  @param {Stack} stack @param {(url: string, body: string) => Promise<string>} fetchFn @returns {Promise<void>} */
export async function refreshOsv(stack, fetchFn) { throw new Error("not implemented"); }
