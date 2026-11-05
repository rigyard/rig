// Child process for crash tests: converge FIXTURE_HOME on desired version RIG_V.
// RIG_TEST=1 plus RIG_TEST_ABORT_AFTER=<n> make apply SIGKILL itself after n mutations.
// `node --test` also loads this file; without RIG_STATE_CHILD=1 it does nothing.

import { converge, desiredV, makeWorld } from "../../state.helpers.ts";

if (process.env.RIG_STATE_CHILD === "1") {
  const home = process.env.FIXTURE_HOME;
  if (!home || !home.includes("rig-state-")) throw new Error("FIXTURE_HOME must be a rig-state- temp dir");
  const world = makeWorld(home);
  const desired = desiredV(home, Number(process.env.RIG_V), { n: Number(process.env.RIG_N), bulk: process.env.RIG_BULK === "1" });
  const { result } = converge(desired, world);
  if (result.error) {
    process.stderr.write(`${result.error.code}: ${result.error.message}\n`);
    process.exit(1);
  }
}
