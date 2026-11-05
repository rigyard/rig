// rig models, and rig models set <tier> <model> --harness <h>.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { effective, setTier } from "../models.ts";
import { loadWorld } from "../world.ts";
import { applyPipeline, printApplied } from "./apply.ts";
import { logEvent } from "./log.ts";
import { usage } from "./shared.ts";
import type { ParsedArgs } from "../commands.ts";

/** @param {string[][]} rows first row is the header @returns {string} */
function table(rows) {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  return rows.map((r) => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i]))).join("  ")).join("\n") + "\n";
}

/** @param {unknown} v a tiers.json cell: an alias string or {id, display} */
const shown = (v) => (typeof v === "string" ? v : v && typeof v === "object" && "id" in v ? String(v.id) : "(none)");

/**
 * The model-bearing filter of models set: a desired entry whose path is a declared model surface of a target
 * record, a provider record or the overlay rig.json. A `{role}` in a surface path expands over the roles of the
 * surface's consumer in roles.json, so a pack agent file of another name in the same dir stays out.
 */
export function modelBearing(world: object): (e: {path: string}) => boolean {
  const surfaces = [
    ...[...world.targets.values()].flatMap((t) => t.model_surfaces ?? []),
    ...[...world.providers.values()].flatMap((p) => p.model_surfaces ?? []),
    ...(world.config.model_surfaces ?? []),
  ];
  const paths = new Set();
  for (const s of surfaces) {
    const abs = s.path.startsWith("~/") ? join(world.env.home, s.path.slice(2)) : s.path;
    const roles = abs.includes("{role}") ? Object.keys(world.roles.consumers?.[s.consumer] ?? {}) : [null];
    for (const r of roles) paths.add(r === null ? abs : abs.replaceAll("{role}", r));
  }
  return (e) => paths.has(e.path);
}

/** rig models, and rig models set. */
export async function modelsCmd(a: ParsedArgs, env: NodeJS.ProcessEnv): Promise<0|1|2> {
  const world = loadWorld(env);
  if (a.sub !== "set") {
    const rows = effective(world).map((r) => [r.harness, r.tier, r.model, r.env ? `${r.source} (${r.env})` : r.source]);
    process.stdout.write(table([["harness", "tier", "model", "source"], ...rows]));
    return 0;
  }

  const { tier, model } = a.args;
  const harness = /** @type {string} */ (a.flags.harness);
  // world.tiers is repo plus overlay, merged. Writing it into the repo file would copy overlay values into git.
  if (world.roots.overlay && existsSync(join(world.roots.overlay, "models/tiers.json"))) {
    throw usage("the overlay has models/tiers.json, and rig models set would copy its values into the repo file; edit the file by hand, then run rig apply");
  }
  const before = world.tiers.tiers?.[tier]?.[harness];
  const next = setTier(world, tier, model, harness);
  process.stdout.write(`models/tiers.json: tiers.${tier}.${harness}: ${shown(before)} -> ${model}\n`);
  // One writer: the plan runs on the in-memory world, and tiers.json follows the plan that state.apply ran.
  const res = applyThenWrite(next.world, () => {
    next.write();
    logEvent(world, { event: "models.set", tier, harness });
  });
  return printApplied(res);
}

/**
 * Run the apply pipeline restricted to model-bearing files, then write tiers.json. The write waits for the pipeline,
 * because state.apply recovers inside its lock and can make the first plan stale; a fresh plan that blocks returns
 * r null, and then tiers.json keeps its bytes. A run that started and stopped part way still writes tiers.json,
 * so the next rig apply finishes the swap instead of reverting the cells it already wrote. A failure before the
 * run started (another run holds the lock, a recovery conflict) writes nothing.
 * @param run the pipeline; a test passes a stub
 */
export function applyThenWrite(world: object, write: () => void, run: typeof applyPipeline = applyPipeline): ReturnType<typeof applyPipeline> {
  const res = run(world, { filter: modelBearing(world) });
  const { r } = res;
  if (r !== null && !(r.error && !r.run)) write();
  return res;
}
