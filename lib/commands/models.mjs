// rig models, and rig models set <tier> <model> --harness <h>.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { effective, setTier } from "../models.mjs";
import { loadWorld } from "../world.mjs";
import { applyPipeline, printApplied } from "./apply.mjs";
import { logEvent } from "./log.mjs";
import { usage } from "./shared.mjs";

/** @param {string[][]} rows first row is the header @returns {string} */
function table(rows) {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  return rows.map((r) => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i]))).join("  ")).join("\n") + "\n";
}

/** @param {unknown} v a tiers.json cell: an alias string or {id, display} */
const shown = (v) => (typeof v === "string" ? v : v && typeof v === "object" && "id" in v ? String(v.id) : "(none)");

/**
 * The model-bearing filter of models set: a desired entry whose path is a declared model surface of a target
 * record, a provider record or the overlay rig.json. A `{role}` in a surface path matches one path segment.
 * @param {object} world @returns {(e: {path: string}) => boolean}
 */
export function modelBearing(world) {
  const surfaces = [
    ...[...world.targets.values()].flatMap((t) => t.model_surfaces ?? []),
    ...[...world.providers.values()].flatMap((p) => p.model_surfaces ?? []),
    ...(world.config.model_surfaces ?? []),
  ];
  const escape = (x) => x.replace(/[.*+?^$()|[\]{}\\]/g, "\\$&");
  const res = surfaces.map((s) => {
    const abs = s.path.startsWith("~/") ? join(world.env.home, s.path.slice(2)) : s.path;
    return new RegExp(`^${abs.split("{role}").map(escape).join("[^/]+")}$`);
  });
  return (e) => res.some((re) => re.test(e.path));
}

/** rig models, and rig models set. @param {import("../commands.mjs").ParsedArgs} a @param {NodeJS.ProcessEnv} env @returns {Promise<0|1|2>} */
export async function modelsCmd(a, env) {
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
  // One writer: the plan runs on the in-memory world first, and tiers.json is written only when nothing blocks.
  const res = applyPipeline(next.world, {
    filter: modelBearing(next.world),
    beforeWrite: () => {
      next.write();
      logEvent(world, { event: "models.set", tier, harness });
    },
  });
  return printApplied(res);
}
