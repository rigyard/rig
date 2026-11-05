// rig pack add <repo> --sha <sha> --path <path>... [--into overlay].

import { vendor } from "../lock.mjs";
import { loadWorld } from "../world.mjs";
import { logEvent } from "./log.mjs";
import { findingLines, gateTree } from "./shared.mjs";

/** rig pack add. Exit 1 when the gate blocks the new pack; its files stay for review (section 1, case A). @param {import("../commands.mjs").ParsedArgs} a @param {NodeJS.ProcessEnv} env @returns {Promise<0|1|2>} */
export async function packAddCmd(a, env) {
  const world = loadWorld(env);
  const into = a.flags.into === "overlay" ? "overlay" : "repo";
  const paths = /** @type {string[]} */ (a.flags.path);
  const v = await vendor(world, { repo: a.args.repo, sha: /** @type {string} */ (a.flags.sha), paths, into });

  // Reload, so the gate's pin check compares the files with the lock entry vendor just wrote.
  const after = loadWorld(env);
  const manifestFile = v.files.find((f) => f.path === "pack.json");
  const manifest = JSON.parse(Buffer.from(manifestFile.bytes).toString("utf8"));
  const files = v.files.filter((f) => f.path !== "pack.json");
  const { findings, blocked } = gateTree(after, { name: v.pack, root: v.root, manifest, files });
  logEvent(after, { event: "pack.add", pack: v.pack, root: v.root, noop: v.noop, findings: findings.length, blocked });

  const blocks = findings.filter((f) => f.severity === "block" && !f.acked).length;
  const head = v.noop ? `${v.pack} is already vendored at ${v.tree}` : `vendored ${v.pack} into packs/${v.pack}/ of the ${v.root} root, tree ${v.tree}`;
  const lines = [head, ...findingLines(findings), `${findings.length} findings, ${blocks} blocks`];
  process.stdout.write(`${lines.join("\n")}\n`);
  return blocked ? 1 : 0;
}
