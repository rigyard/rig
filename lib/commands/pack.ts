// rig pack add <repo> --sha <sha> [--root <dir>] [--path <path>...] [--exclude <path>...] [--port <path>...] [--name <name>] [--into overlay].

import { refreshOsv } from "../gate.ts";
import { osvFetch, vendor } from "../lock.ts";
import { loadWorld } from "../world.ts";
import { logEvent } from "./log.ts";
import { findingLines, gateTree } from "./shared.ts";
import type { Deps } from "./shared.ts";
import type { ParsedArgs } from "../commands.ts";

/**
 * rig pack add. Exit 1 when the gate blocks the new pack; its files stay for review (section 1, case A).
 * Network use: git, then one OSV refresh for the pack's lockfiles. `deps.fetchFn` replaces the OSV transport and `deps.out` the stdout stream in tests.
 */
export async function packAddCmd(a: ParsedArgs, env: NodeJS.ProcessEnv, deps: Deps = {}): Promise<0|1|2> {
  const world = loadWorld(env);
  const into = a.flags.into === "overlay" ? "overlay" : "repo";
  const f = a.flags as {sha: string, root?: string, path?: string[], exclude?: string[], port?: string[], name?: string};
  const v = await vendor(world, { repo: a.args.repo, sha: f.sha, root: f.root, paths: f.path, exclude: f.exclude, port: f.port, name: f.name, into });

  // The refresh writes cache/osv before the reload, so the gate reads it and the pin check sees the lock entry vendor wrote.
  const refreshed = await refreshOsv(world, v.pack, v.files, deps.fetchFn ?? osvFetch);
  const after = loadWorld(env);
  const manifestFile = v.files.find((f) => f.path === "pack.json");
  const manifest = JSON.parse(Buffer.from(manifestFile.bytes).toString("utf8"));
  const files = v.files.filter((f) => f.path !== "pack.json");
  const gated = gateTree(after, { name: v.pack, root: v.root, manifest, files });
  // A new port is unreviewed by design; the port line below reports it, and rig plan blocks on it.
  const own = gated.findings.filter((f) => !(f.check === "pin" && f.evidence.startsWith("E_PORT_STALE ")));
  const findings = [...refreshed.findings, ...own];
  const blocked = own.some((f) => f.severity === "block" && !f.acked);
  logEvent(after, { event: "pack.add", pack: v.pack, root: v.root, noop: v.noop, findings: findings.length, blocked });

  const blocks = findings.filter((f) => f.severity === "block" && !f.acked).length;
  const head = v.noop
    ? `${v.pack} is already ${v.adopted ? "adopted" : "vendored"} at ${v.tree}`
    : v.adopted ? `adopted ${v.pack} in packs/${v.pack}/ of the ${v.root} root, tree ${v.tree}` : `vendored ${v.pack} into packs/${v.pack}/ of the ${v.root} root, tree ${v.tree}`;
  const kept = `kept ${v.kept} files${v.excludedBytes === null || v.adopted ? "" : `, excluded ${v.excludedBytes} bytes`}`;
  const port = v.port === null ? [] : v.port.reviewed_tree === v.port.tree ? [`port fresh: ${v.port.paths.join(", ")}`]
    : [`port not reviewed: ${v.port.paths.join(", ")}; rig plan blocks until rig pin set ${v.pack} --ported`];
  const lines = [head, kept, ...port, ...findingLines(findings), `${findings.length} findings, ${blocks} blocks`];
  (deps.out ?? process.stdout).write(`${lines.join("\n")}\n`);
  return blocked ? 1 : 0;
}
