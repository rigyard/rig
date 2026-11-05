// lib/commands.mjs — one handler per top-level command, and the exit-code policy. bin/rig.mjs parses argv and
// calls dispatch(). Each handler lives in lib/commands/<command>.mjs.

import { applyCmd } from "./commands/apply.mjs";
import { doctorCmd } from "./commands/doctor.mjs";
import { modelsCmd } from "./commands/models.mjs";
import { packAddCmd } from "./commands/pack.mjs";
import { pinCmd } from "./commands/pin.mjs";
import { planCmd } from "./commands/plan.mjs";
import { statsCmd } from "./commands/stats.mjs";

export { applyCmd, doctorCmd, modelsCmd, packAddCmd, pinCmd, planCmd, statsCmd };

/**
 * What bin/rig.mjs passes to a handler after strict parsing against the command table.
 * @typedef {object} ParsedArgs
 * @property {string} cmd                       top-level command name
 * @property {string | null} sub                subcommand name, or null for a command without one
 * @property {Record<string, string>} args      positional arguments by the names in the table row
 * @property {Record<string, string | boolean | string[]>} flags   by flag name without "--"; repeatable flags are arrays
 */

/** Error codes that exit 2: usage and config errors (docs/design/rig-architecture.md section 1, exit codes). */
export const EXIT_2 = new Set(["E_USAGE", "E_SCHEMA", "E_SCOPE_MODE", "E_STATE_ROOT", "E_OVERLAY_CONFLICT", "E_STATE_IN_READSET"]);

/**
 * Run one handler and turn its result into an exit code. A typed throw exits 2 for a code in EXIT_2, else 1,
 * with one stderr line that names the code. A result other than 0, 1 or 2 is a bug: E_INTERNAL, exit 1.
 * @param {string} cmd @param {(a: ParsedArgs, env: NodeJS.ProcessEnv) => Promise<unknown>} handler
 * @param {ParsedArgs} a @param {NodeJS.ProcessEnv} env @param {{write: (s: string) => unknown}} [stderr]
 * @returns {Promise<0|1|2>}
 */
export async function dispatch(cmd, handler, a, env, stderr = process.stderr) {
  let code;
  try {
    code = await handler(a, env);
  } catch (err) {
    const c = typeof err?.code === "string" && /^E_[A-Z0-9_]+$/.test(err.code) ? err.code : null;
    const msg = err instanceof Error ? err.message : String(err);
    stderr.write(`rig ${cmd}: ${c && !msg.includes(c) ? `${c} ${msg}` : msg}\n`);
    return c && EXIT_2.has(c) ? 2 : 1;
  }
  if (code === 0 || code === 1 || code === 2) return code;
  stderr.write(`rig ${cmd}: E_INTERNAL the handler returned ${JSON.stringify(code) ?? String(code)}, not an exit code\n`);
  return 1;
}
