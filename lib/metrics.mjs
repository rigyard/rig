// lib/metrics.mjs — public: stats, recordSession. Both call the internal record().
// internals: lib/metrics/readers/{claude-jsonl,codex-rollout,omp-jsonl,cursor-agent-jsonl}.mjs, record.mjs, propose.mjs

/** @typedef {import("./world.mjs").World} World */

/** // schema: metrics.jsonl
 * @typedef {object} MetricsLine
 * @property {1} schema @property {string} harness @property {string} session_id @property {string} project
 * @property {"stats"|"record"} source @property {string} start @property {string} end @property {string} reader
 * @property {Record<string, {input?: number, output?: number, cache_read?: number, cache_write?: number, requests: number}>} models
 * @property {number | null} cost_usd
 * @property {Record<string, [number, number]>} tools          [calls, errors]
 * @property {Record<string, number>} skills
 * @property {Record<string, {dispatches: number, effort: Record<string, number>}>} agents
 * @property {number | null} compactions
 * @property {Record<string, number> | null} hook_bytes
 */

/** rig stats. patch is null unless opts.suggest. @param {World} world @param {{since: string, harness?: string, suggest: boolean}} opts
 *  @returns {{text: string, patch: string | null}} */
export function stats(world, opts) { throw new Error("not implemented"); }

/** rig stats --record. From stdin (hook mode: never throws, never prints, returns 0) or from a named session (by hand).
 *  @param {World | null} world @param {{stdin: Uint8Array} | {session: string}} input @returns {0|1} */
export function recordSession(world, input) { throw new Error("not implemented"); }
