// rig stats [--since <dur>] [--harness <h>] [--suggest], and rig stats --record [--session <id>].

import { readFileSync } from "node:fs";
import { recordSession, stats } from "../metrics.ts";
import { compose } from "../stack.ts";
import { loadWorld } from "../world.ts";
import { usage } from "./shared.ts";
import type { ParsedArgs } from "../commands.ts";

/**
 * Hook mode: the session-end hook pipes its JSON on stdin. Prints 0 bytes and returns 0 on every error, including
 * a world that does not load: a hook must never fail the harness session (section 13).
 * @param {NodeJS.ProcessEnv} env @returns {0}
 */
function hook(env) {
  try {
    let world = null;
    try {
      world = loadWorld(env);
    } catch {
      // no world, no state root: recordSession(null, ...) records nothing and returns 0
    }
    let stdin = new Uint8Array();
    try {
      stdin = readFileSync(0);
    } catch {
      // no stdin: an empty payload, which recordSession logs as E_HOOK_PAYLOAD
    }
    recordSession(world, { stdin });
  } catch {
    // hook mode never fails
  }
  return 0;
}

/** rig stats. Checks the --record and --session combinations (exit 2). */
export async function statsCmd(a: ParsedArgs, env: NodeJS.ProcessEnv): Promise<0|1|2> {
  const f = a.flags;
  if (f.record) {
    if (f.since !== undefined || f.harness !== undefined || f.suggest) throw usage("--record cannot combine with --since, --harness or --suggest");
    if (typeof f.session === "string") return recordSession(loadWorld(env), { session: f.session });
    return hook(env);
  }
  if (f.session !== undefined) throw usage("--session needs --record");
  const world = loadWorld(env);
  if (typeof f.harness === "string" && !world.targets.has(f.harness)) throw usage(`unknown harness ${f.harness}; rig.json lists ${[...world.targets.keys()].join(", ")}`);
  const suggest = f.suggest === true;
  const r = stats(world, {
    since: typeof f.since === "string" ? f.since : undefined,
    harness: typeof f.harness === "string" ? f.harness : undefined,
    suggest,
    units: suggest ? compose(world).units : undefined,
    now: world.now.getTime(),
  });
  process.stdout.write(r.text.endsWith("\n") || r.text === "" ? r.text : `${r.text}\n`);
  if (r.patch !== null) process.stdout.write(r.patch);
  return 0;
}
