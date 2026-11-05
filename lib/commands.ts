// lib/commands.ts — one handler per top-level command, and the exit-code policy. bin/rig.ts parses argv and
// calls dispatch(). Each handler lives in lib/commands/<command>.mjs.

import { applyCmd } from "./commands/apply.ts";
import { doctorCmd } from "./commands/doctor.ts";
import { modelsCmd } from "./commands/models.ts";
import { packAddCmd } from "./commands/pack.ts";
import { pinCmd } from "./commands/pin.ts";
import { planCmd } from "./commands/plan.ts";
import { statsCmd } from "./commands/stats.ts";

export { applyCmd, doctorCmd, modelsCmd, packAddCmd, pinCmd, planCmd, statsCmd };

/** What bin/rig.ts passes to a handler after strict parsing against the command table. */
export type ParsedArgs = {
  /** top-level command name */
  cmd: string;
  /** subcommand name, or null for a command without one */
  sub: string | null;
  /** positional arguments by the names in the table row */
  args: Record<string, string>;
  /** by flag name without "--"; repeatable flags are arrays */
  flags: Record<string, string | boolean | string[]>;
};

/** Error codes that exit 2: usage and config errors (docs/design/rig-architecture.md section 1, exit codes). */
export const EXIT_2 = new Set(["E_USAGE", "E_SCHEMA", "E_SCOPE_MODE", "E_STATE_ROOT", "E_OVERLAY_CONFLICT", "E_STATE_IN_READSET"]);

/**
 * Run one handler and turn its result into an exit code. A typed throw exits 2 for a code in EXIT_2, else 1,
 * with one stderr line that names the code. A result other than 0, 1 or 2 is a bug: E_INTERNAL, exit 1.
 */
export async function dispatch(cmd: string, handler: (a: ParsedArgs, env: NodeJS.ProcessEnv) => Promise<unknown>, a: ParsedArgs, env: NodeJS.ProcessEnv, stderr: {write: (s: string) => unknown} = process.stderr): Promise<0|1|2> {
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
