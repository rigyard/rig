// Live seed cases for the model surfaces. Opt-in: RIG_LIVE=1. omp runs with HOME and PI_CODING_AGENT_DIR inside the
// fixture HOME (ompEnv), so the real ~/.omp/agent/config.yml is never read or written. The cases read the config
// through `omp config get`, which calls no model provider.

import assert from "node:assert/strict";
import { describe } from "node:test";
import { liveTest, runHarness } from "../helpers/live.ts";
import { ompEnv, realBin } from "../helpers/mirror.ts";
import { modelOps, modelsHome } from "../models-cmd.helpers.ts";

const CONFIG = ".omp/agent/config.yml";
type Run = (o: {bin: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number}) => Promise<{code: number | null, stdout: string, stderr: string, json: unknown}>;
const run = runHarness as Run;

/** omp's own reading of modelRoles in the fixture agent dir. */
async function modelRoles(home: string): Promise<Record<string, string>> {
  const r = await run({ bin: realBin("omp"), args: ["config", "get", "modelRoles", "--json"], cwd: home, env: ompEnv(home), timeoutMs: 60_000 });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  return (r.json as {value: Record<string, string>}).value;
}

describe("omp modelRoles", () => {
  liveTest("omp reads the modelRoles values that rig rendered, and an omp rewrite of other keys is not drift", async (t) => {
    const s = modelsHome();
    t.after(() => s.fx.cleanup());
    const a = s.rig(["apply"]);
    assert.equal(a.code, 0, a.stdout + a.stderr);
    assert.match(a.stdout, /^adopt +cells +omp +~\/\.omp\/agent\/config\.yml/m);
    const adopted = { task: "prov/model-f-high:auto", advisor: "prov/model-a:medium", judge: "other/model-j:medium", plan: "prov/model-r:high", default: "prov/model-c:medium" };
    assert.deepEqual(await modelRoles(s.fx.home), adopted);

    const set = s.rig(["models", "set", "strong", "prov/model-z", "--harness", "omp"]);
    assert.equal(set.code, 0, set.stdout + set.stderr);
    assert.match(set.stdout, /^patch-cells +cells +omp +~\/\.omp\/agent\/config\.yml/m);
    assert.deepEqual(await modelRoles(s.fx.home), { ...adopted, advisor: "prov/model-z:medium" }, "omp reads rig's swapped value");

    // omp writes its own config: another key changes, modelRoles keeps rig's values.
    const before = s.read(CONFIG);
    const w = await run({ bin: realBin("omp"), args: ["config", "set", "symbolPreset", "ascii"], cwd: s.fx.home, env: ompEnv(s.fx.home), timeoutMs: 60_000 });
    assert.equal(w.code, 0, w.stdout + w.stderr);
    assert.notEqual(s.read(CONFIG), before, "omp changed the file");
    const p = s.rig(["plan"]);
    assert.equal(p.code, 0, p.stdout + p.stderr);
    assert.deepEqual(modelOps(p.stdout), [], "no model op after the omp rewrite");
  });
});
