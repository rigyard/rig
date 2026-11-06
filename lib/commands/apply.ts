// rig apply [--undo <run-id> | --repair]: the pipeline, then the journaled write. state.apply and state.undo log the run.

import { join } from "node:path";
import { apply, undo } from "../state.ts";
import type { EntryFilter } from "../state.ts";
import { projectDelivery } from "../targets.ts";
import { loadWorld } from "../world.ts";
import { report } from "./plan.ts";
import { prepare, usage } from "./shared.ts";
import type { ParsedArgs } from "../commands.ts";
import type { Delivery } from "../targets.ts";

/** @param {string} code @param {string} message @returns {Error & {code: string}} */
const failure = (code, message) => Object.assign(new Error(message), { code });

/**
 * prepare, then state.apply when nothing blocks. A plan that recovery made stale is prepared once more; a second
 * stale plan is a bug. `beforeWrite` runs once, after the first plan that does not block and before state.apply.
 * @param {object} world @param {{filter?: EntryFilter, beforeWrite?: () => void, repair?: boolean}} [opts]
 * @returns {{p: ReturnType<typeof prepare>, r: ReturnType<typeof apply> | null}}  r is null when the plan blocks
 */
export function applyPipeline(world, { filter, beforeWrite, repair }: {filter?: EntryFilter, beforeWrite?: () => void, repair?: boolean} = {}) {
  let p = prepare(world, { filter, repair });
  for (let attempt = 0; ; attempt++) {
    if (p.planned.blocked) return { p, r: null };
    if (attempt === 0) beforeWrite?.();
    const r = apply(p.planned, world);
    if (!r.replan) return { p, r };
    if (attempt > 0) throw failure("E_INTERNAL", "the plan was stale twice after recovery");
    p = prepare(world, { filter, repair });
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

/** A word for a POSIX shell: bare when safe, else single-quoted. */
const shellWord = (s: string): string => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(s) ? s : `'${s.replaceAll("'", "'\\''")}'`);

/** The `enabledPlugins` snippet for one project's enable file. */
const snippet = (ids: string[]): string => `{"enabledPlugins": {${ids.map((id) => `${JSON.stringify(id)}: true`).join(", ")}}}`;

/**
 * The lines apply prints for the Claude plugins of project and hybrid packs (decision 0017, doc section 14 row 16):
 * the one-time registration commands per marketplace and pack, then one snippet per listed project. rig runs none of
 * them and writes no enabledPlugins entry. Empty when no pack has a plugin.
 */
export function registrationLines(deliveries: Delivery[]): string[] {
  const plugins = deliveries.flatMap((d) => (d.plugin ? [{ ...d, plugin: d.plugin }] : []));
  if (!plugins.length) return [];
  const lines = ["register claude: run once; it installs each project pack and disables it at user scope:"];
  for (const market of [...new Set(plugins.map((d) => d.plugin.marketplace))]) {
    lines.push(`  claude plugin marketplace add ${shellWord(market)}`);
    for (const d of plugins.filter((x) => x.plugin.marketplace === market)) {
      lines.push(`  claude plugin install ${d.plugin.id}`, `  claude plugin disable --scope user ${d.plugin.id}`);
    }
  }
  const byProject = new Map<string, {file: string, ids: string[]}>();
  for (const d of plugins) {
    for (const p of d.projects) {
      const e = byProject.get(p) ?? { file: join(p, d.plugin.enable_file), ids: [] };
      if (!e.ids.includes(d.plugin.id)) e.ids.push(d.plugin.id);
      byProject.set(p, e);
    }
  }
  for (const [p, e] of byProject) lines.push(`enable in ${p}: paste into ${e.file} (uncommitted)`, `  ${snippet(e.ids)}`);
  return lines;
}

/** rig apply [--undo <run-id> | --repair]. After a write that succeeded, the registration lines of the project plugins. */
export async function applyCmd(a: ParsedArgs, env: NodeJS.ProcessEnv): Promise<0|1|2> {
  const repair = a.flags.repair === true;
  if (repair && "undo" in a.flags) throw usage("--repair and --undo exclude each other; run rig apply --undo <run-id> to restore a run, or rig apply --repair to rewrite drift, in separate runs");
  const world = loadWorld(env);
  if (typeof a.flags.undo === "string") return undoRun(world, a.flags.undo);
  const res = applyPipeline(world, { repair });
  const code = printApplied(res);
  if (code === 0) {
    const lines = registrationLines(projectDelivery(res.p.stack, world));
    if (lines.length) process.stdout.write(`${lines.join("\n")}\n`);
  }
  return code;
}
