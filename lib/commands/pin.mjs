// rig pin check <name> [--sha <sha>], and rig pin set <name>.

import { pinCheck, pinSet } from "../lock.mjs";
import { loadWorld } from "../world.mjs";
import { logEvent } from "./log.mjs";
import { findingLines, gateTree, usage } from "./shared.mjs";

/**
 * rig pin check, and rig pin set. Checks that --sha is set for every name except core (exit 2).
 * pin check gates the candidate tree before lock.pinCheck records it: a blocked candidate is not recorded, so
 * pin set can only promote a candidate that passed the gate. The `pin` check itself is skipped on the candidate:
 * it compares a tree with its lock entry, and a candidate is by definition not locked yet.
 * @param {import("../commands.mjs").ParsedArgs} a @param {NodeJS.ProcessEnv} env @returns {Promise<0|1|2>}
 */
export async function pinCmd(a, env) {
  const name = a.args.name;
  const sha = typeof a.flags.sha === "string" ? a.flags.sha : null;
  if (a.sub === "check" && name !== "core" && sha === null) throw usage(`rig pin check ${name} needs --sha`);
  const world = loadWorld(env);

  if (a.sub === "set") {
    const r = pinSet(world, name);
    logEvent(world, { event: "pin.set", name, promoted: r.promoted, code: r.error?.code });
    if (!r.promoted) {
      process.stderr.write(`rig pin set: ${r.error?.code ?? "E_INTERNAL"} ${r.error?.message ?? "not promoted"}\n`);
      return 1;
    }
    process.stdout.write(`promoted the ${name} candidate to current\n`);
    return 0;
  }

  const manifest = { schema: 1, name, scopes: ["machine-hidden"], source: null, units: {} };
  const gateFiles = (files) => gateTree(world, { name, root: "repo", manifest, files }, { skip: ["pin"] });
  const r = await pinCheck(world, name, name === "core" ? null : sha, { gate: gateFiles });
  logEvent(world, { event: "pin.check", name, tree: r.candidate.tree, findings: r.findings.length, blocked: r.blocked });
  const blocks = r.findings.filter((f) => f.severity === "block" && !f.acked).length;
  const head = r.blocked
    ? `${name} candidate ${r.candidate.tree} is blocked; the lock is unchanged`
    : `recorded ${name} candidate ${r.candidate.tree}; run rig pin set ${name}`;
  process.stdout.write(`${[head, ...findingLines(r.findings), `${r.findings.length} findings, ${blocks} blocks`].join("\n")}\n`);
  return r.blocked ? 1 : 0;
}
