// The guarded logger of the writing commands (stats, pack, pin, models set). Never imported by doctor or plan.

import { log } from "../fs.mjs";

/** One line in log/rig.log. The write already happened, so a failed log line warns and does not fail the command. */
export function logEvent(world, event) {
  try {
    log(event, world.ctx);
  } catch (err) {
    process.stderr.write(`rig: warning: log/rig.log not written: ${err?.code ?? err?.message}\n`);
  }
}
