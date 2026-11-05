// rig pin check core, and rig pin set core.

import { pinCheck, pinSet } from "../lock.ts";
import { loadWorld } from "../world.ts";
import { logEvent } from "./log.ts";
import { findingLines, gateTree } from "./shared.ts";
import type { Deps } from "./shared.ts";
import type { ParsedArgs } from "../commands.ts";

/**
 * The gate skips its `pin` check on the candidate: that check compares a tree with its lock entry, and a candidate
 * is not locked yet. `deps.out` replaces the pin check stdout in tests.
 */
export async function pinCmd(a: ParsedArgs, env: NodeJS.ProcessEnv, deps: Deps = {}): Promise<0|1|2> {
  const name = a.args.name;
  const sha = typeof a.flags.sha === "string" ? a.flags.sha : null;
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

  if (sha !== null && name === "core") {
    process.stderr.write("rig pin: E_USAGE rig pin check core does not take --sha\n");
    return 2;
  }
  const manifest = { schema: 2, name, scopes: ["machine-hidden"], units: {} };
  const gateFiles = (files) => gateTree(world, { name, root: "repo", manifest, files }, { skip: ["pin"] });
  const r = await pinCheck(world, name, sha, { gate: gateFiles });
  logEvent(world, { event: "pin.check", name, tree: r.candidate.tree, findings: r.findings.length, blocked: r.blocked });
  const blocks = r.findings.filter((f) => f.severity === "block" && !f.acked).length;
  const head = r.blocked
    ? `${name} candidate ${r.candidate.tree} is blocked; the lock is unchanged`
    : `recorded ${name} candidate ${r.candidate.tree}; run rig pin set ${name}`;
  (deps.out ?? process.stdout).write(`${[head, ...findingLines(r.findings), `${r.findings.length} findings, ${blocks} blocks`].join("\n")}\n`);
  return r.blocked ? 1 : 0;
}
