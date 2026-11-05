// rig pin check <name> [--sha <sha>], and rig pin set <name>.

import { refreshOsv } from "../gate.ts";
import { osvFetch, pinCheck, pinSet } from "../lock.ts";
import { loadWorld } from "../world.ts";
import { logEvent } from "./log.ts";
import { findingLines, gateTree, usage } from "./shared.ts";
import type { Deps } from "./shared.ts";
import type { ParsedArgs } from "../commands.ts";

const PLUGIN_MANIFESTS = [".claude-plugin/plugin.json", "plugin.json"];

/** `{license}` from the first plugin manifest in the tree that declares one as a string, else `{}`. */
function pluginLicense(files) {
  for (const path of PLUGIN_MANIFESTS) {
    const f = files.find((x) => x.path === path);
    if (!f) continue;
    try {
      const license = JSON.parse(Buffer.from(f.bytes).toString("utf8"))?.license;
      if (typeof license === "string") return { license };
    } catch {
      // an unreadable manifest declares nothing; the license check then blocks as "license missing"
    }
  }
  return {};
}

/**
 * rig pin check, and rig pin set. Checks that --sha is set for every name except core (exit 2).
 * pin check gates the candidate tree before lock.pinCheck records it: a blocked candidate is not recorded, so
 * pin set can only promote a candidate that passed the gate. The `pin` check itself is skipped on the candidate:
 * it compares a tree with its lock entry, and a candidate is by definition not locked yet.
 * A plugin candidate refreshes the OSV cache for its lockfiles before the gate runs; core needs no network.
 * `deps.fetchFn` replaces the OSV transport and `deps.out` the stdout stream in tests.
 */
export async function pinCmd(a: ParsedArgs, env: NodeJS.ProcessEnv, deps: Deps = {}): Promise<0|1|2> {
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
  // A plugin tree has no pack.json, so the license check reads the license that the plugin manifest declares.
  const gateFiles = async (files) => {
    const refreshed = name === "core" ? { findings: [] } : await refreshOsv(world, name, files, deps.fetchFn ?? osvFetch);
    const gated = gateTree(name === "core" ? world : loadWorld(env), { name, root: "repo", manifest: { ...manifest, ...pluginLicense(files) }, files }, { skip: ["pin"] });
    return { findings: [...refreshed.findings, ...gated.findings], blocked: gated.blocked };
  };
  const r = await pinCheck(world, name, name === "core" ? null : sha, { gate: gateFiles });
  logEvent(world, { event: "pin.check", name, tree: r.candidate.tree, findings: r.findings.length, blocked: r.blocked });
  const blocks = r.findings.filter((f) => f.severity === "block" && !f.acked).length;
  // A plugin candidate names its version and commit before its tree hash; core has only the tree.
  const what = r.candidate.sha ? `${r.candidate.version} (${r.candidate.sha}) ${r.candidate.tree}` : r.candidate.tree;
  const head = r.blocked
    ? `${name} candidate ${what} is blocked; the lock is unchanged`
    : `recorded ${name} candidate ${what}; run rig pin set ${name}`;
  (deps.out ?? process.stdout).write(`${[head, ...findingLines(r.findings), `${r.findings.length} findings, ${blocks} blocks`].join("\n")}\n`);
  return r.blocked ? 1 : 0;
}
