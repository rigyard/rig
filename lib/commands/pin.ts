// rig pin check <name>, and rig pin set <name>, for core and for any locked pack.

import { pinCheck, pinSet } from "../lock.ts";
import { loadWorld } from "../world.ts";
import { logEvent } from "./log.ts";
import { findingLines, gateTree, usage } from "./shared.ts";
import type { Deps } from "./shared.ts";
import type { ParsedArgs } from "../commands.ts";

/**
 * The gate skips its `pin` check on the candidate: that check compares a tree with its lock entry, and a candidate
 * is not locked yet. `deps.out` replaces the pin check and pin set stdout in tests.
 */
export async function pinCmd(a: ParsedArgs, env: NodeJS.ProcessEnv, deps: Deps = {}): Promise<0|1|2> {
  const name = a.args.name;
  const sha = typeof a.flags.sha === "string" ? a.flags.sha : null;
  if (a.flags.exclude && a.flags["no-exclude"]) throw usage("--exclude and --no-exclude do not go together");
  const exclude = a.flags["no-exclude"] === true ? [] : Array.isArray(a.flags.exclude) ? a.flags.exclude : undefined;
  const world = loadWorld(env);
  const out = deps.out ?? process.stdout;

  if (a.sub === "set") {
    const r = await pinSet(world, name, { ported: a.flags.ported === true });
    logEvent(world, { event: "pin.set", name, promoted: r.promoted, attested: r.attested, code: r.error?.code });
    if (r.error) {
      process.stderr.write(`rig pin set: ${r.error.code} ${r.error.message}\n`);
      return 1;
    }
    if (r.attested !== undefined) {
      out.write(r.attested ? `attested the ${name} port at ${r.sha}\n` : `the ${name} port is already attested at ${r.sha}\n`);
      return 0;
    }
    const stale = r.port === "stale" ? `\nport stale: run /rig-port ${name}, then rig pin set ${name} --ported` : "";
    out.write(`promoted the ${name} candidate to current${r.sha ? ` at ${r.sha}` : ""}${stale}\n`);
    return 0;
  }

  const fallback = { schema: 2, name, scopes: ["machine-hidden"], units: {} };
  const gateFiles = (files, pack: {root: string, manifest: object | null}) => gateTree(world, { name, root: pack.root, manifest: pack.manifest ?? fallback, files }, { skip: ["pin"] });
  const r = await pinCheck(world, name, sha, { gate: gateFiles, diff: a.flags.diff === true, exclude });
  logEvent(world, { event: "pin.check", name, tree: r.candidate.tree, findings: r.findings.length, blocked: r.blocked });
  const blocks = r.findings.filter((f) => f.severity === "block" && !f.acked).length;
  const at = r.candidate.sha ? ` at ${r.candidate.sha}` : "";
  const head = r.blocked
    ? `${name} candidate ${r.candidate.tree}${at} is blocked; the lock is unchanged`
    : r.recorded ? `recorded ${name} candidate ${r.candidate.tree}${at}; run rig pin set ${name}`
    : `checked ${name} candidate ${r.candidate.tree}${at}; --diff records nothing`;
  const lines = [head];
  if (r.changed !== null) lines.push(`${r.changed} files changed`);
  if (r.port) lines.push(`port ${r.port.stale ? "stale" : "fresh"}: ${r.port.paths.join(", ")}`);
  lines.push(...findingLines(r.findings), `${r.findings.length} findings, ${blocks} blocks`);
  if (r.diff !== null && r.port?.reviewed_sha === null) {
    lines.push("no reviewed commit: the whole port is unreviewed; the diff shows each port file in full");
    if (r.diff !== "") lines.push(r.diff.replace(/\n$/, ""));
  } else if (r.diff !== null) {
    lines.push(r.diff === "" ? "no port change" : r.diff.replace(/\n$/, ""));
  }
  out.write(`${lines.join("\n")}\n`);
  return r.blocked ? 1 : 0;
}
