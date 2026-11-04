// lib/commands.mjs — one handler per top-level command. bin/rig.mjs parses argv and dispatches here.
// A handler returns its exit code. A throw becomes "rig <cmd>: <message>" and exit 1 in bin/rig.mjs.

/**
 * What bin/rig.mjs passes to a handler after strict parsing against the command table.
 * @typedef {object} ParsedArgs
 * @property {string} cmd                       top-level command name
 * @property {string | null} sub                subcommand name, or null for a command without one
 * @property {Record<string, string>} args      positional arguments by the names in the table row
 * @property {Record<string, string | boolean | string[]>} flags   by flag name without "--"; repeatable flags are arrays
 */

/** rig plan. @param {ParsedArgs} a @param {NodeJS.ProcessEnv} env @returns {Promise<0|1|2>} */
export async function planCmd(a, env) { throw new Error("not implemented"); }

/** rig apply [--undo <run-id>]. @param {ParsedArgs} a @param {NodeJS.ProcessEnv} env @returns {Promise<0|1|2>} */
export async function applyCmd(a, env) { throw new Error("not implemented"); }

/** rig doctor [--project <dir>]. @param {ParsedArgs} a @param {NodeJS.ProcessEnv} env @returns {Promise<0|1|2>} */
export async function doctorCmd(a, env) { throw new Error("not implemented"); }

/** rig stats. Checks the --record and --session combinations (exit 2). @param {ParsedArgs} a @param {NodeJS.ProcessEnv} env @returns {Promise<0|1|2>} */
export async function statsCmd(a, env) { throw new Error("not implemented"); }

/** rig models, and rig models set. @param {ParsedArgs} a @param {NodeJS.ProcessEnv} env @returns {Promise<0|1|2>} */
export async function modelsCmd(a, env) { throw new Error("not implemented"); }

/** rig pack add. @param {ParsedArgs} a @param {NodeJS.ProcessEnv} env @returns {Promise<0|1|2>} */
export async function packAddCmd(a, env) { throw new Error("not implemented"); }

/** rig pin check, and rig pin set. Checks that --sha is set for every name except core (exit 2). @param {ParsedArgs} a @param {NodeJS.ProcessEnv} env @returns {Promise<0|1|2>} */
export async function pinCmd(a, env) { throw new Error("not implemented"); }
