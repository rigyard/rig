// rig apply [--undo <run-id>]: the pipeline, then the journaled write. state.apply and state.undo log the run.

import { apply, undo } from "../state.mjs";
import { loadWorld } from "../world.mjs";
import { report } from "./plan.mjs";
import { prepare } from "./shared.mjs";

/** @param {string} code @param {string} message @returns {Error & {code: string}} */
const failure = (code, message) => Object.assign(new Error(message), { code });

/**
 * prepare, then state.apply when nothing blocks. A plan that recovery made stale is prepared once more; a second
 * stale plan is a bug. `beforeWrite` runs once, after the first plan that does not block and before state.apply.
 * @param {object} world @param {{filter?: (e: object) => boolean, beforeWrite?: () => void}} [opts]
 * @returns {{p: ReturnType<typeof prepare>, r: ReturnType<typeof apply> | null}}  r is null when the plan blocks
 */
export function applyPipeline(world, { filter, beforeWrite } = {}) {
  let p = prepare(world, { filter });
  for (let attempt = 0; ; attempt++) {
    if (p.planned.blocked) return { p, r: null };
    if (attempt === 0) beforeWrite?.();
    const r = apply(p.planned, world);
    if (!r.replan) return { p, r };
    if (attempt > 0) throw failure("E_INTERNAL", "the plan was stale twice after recovery");
    p = prepare(world, { filter });
  }
}

/**
 * Print the report and the outcome of one applyPipeline run. Exit 1 when the plan blocks or the write failed.
 * @param {ReturnType<typeof applyPipeline>} res @returns {0|1}
 */
export function printApplied({ p, r }) {
  process.stdout.write(report(p));
  if (r === null) {
    process.stdout.write("blocked: nothing written\n");
    return 1;
  }
  if (r.error) {
    if (r.run) process.stdout.write(`run ${r.run} stopped after ${r.changed} ops\n`);
    throw failure(r.error.code ?? "E_INTERNAL", r.error.message ?? "apply failed");
  }
  if (r.run) process.stdout.write(`run ${r.run}: ${r.changed} ops applied\n`);
  return 0;
}

/** @param {object} world @param {string} runId @returns {0|1} */
function undoRun(world, runId) {
  const r = undo(runId, world);
  if (r.run === null && r.conflicts.length) {
    for (const c of r.conflicts) process.stdout.write(`conflict ${c.code} ${c.path ?? runId}: ${c.message}\n`);
    process.stdout.write(`${r.conflicts.length} conflicts: nothing restored\n`);
    return 1;
  }
  if (r.run === null) {
    process.stdout.write(`run ${runId}: nothing to undo\n`);
    return 0;
  }
  if (r.conflicts.length) {
    process.stdout.write(`undo run ${r.run} of ${runId} stopped after ${r.restored} ops\n`);
    const [e] = r.conflicts;
    throw failure(e.code ?? "E_INTERNAL", e.message ?? "undo failed");
  }
  process.stdout.write(`undid run ${runId} as run ${r.run}: ${r.restored} ops restored\n`);
  return 0;
}

/** rig apply [--undo <run-id>]. @param {import("../commands.mjs").ParsedArgs} a @param {NodeJS.ProcessEnv} env @returns {Promise<0|1|2>} */
export async function applyCmd(a, env) {
  const world = loadWorld(env);
  if (typeof a.flags.undo === "string") return undoRun(world, a.flags.undo);
  return printApplied(applyPipeline(world));
}
