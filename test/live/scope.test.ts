// Live seed cases for per-pack scope (decision 0017). Opt-in: RIG_LIVE=1.
// `rig apply` renders a fixture `project` pack as a local plugin in the rig-owned marketplace inside a fixture HOME.
// Claude Code then loads that plugin dir for one run only, with `--plugin-dir` (the no-write variant of probe k),
// in a scratch repo with the normal login. The full variant (marketplace add, user false, project-local true) writes
// user settings and stays operator-run. A case reads Claude output only for the reply text it asked for.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe } from "node:test";
import { treeHash } from "../../lib/tree.ts";
import { liveTest, runHarness } from "../helpers/live.ts";
import { harnessArgv, realBin, replyOf, scratchRepo, sentinel } from "../helpers/mirror.ts";
import { filesUnder, MARKET, setup } from "../scope.helpers.ts";

type Run = {code: number | null, stdout: string, stderr: string, json: unknown};
/** runHarness with the argument types this file passes (its JSDoc types infer `never[]` for args). */
const run = runHarness as unknown as (o: {bin: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv, timeoutMs: number, input?: string}) => Promise<Run>;

/** A fixture HOME with the pack `notes` in project scope for a scratch repo, applied. The command replies `token`. */
function seeded(t: {after: (fn: () => void) => void}, token: string) {
  const repo = scratchRepo();
  const tidy = `---\ndescription: Reply with the scope token.\n---\nReply with exactly ${token} and nothing else.\n`;
  const s = setup({ entry: { scope: "project", projects: [repo.dir], harnesses: ["claude"] }, tidy });
  t.after(() => (s.fx.cleanup(), repo.cleanup()));
  const a = s.rig(["apply"]);
  assert.equal(a.code, 0, a.all);
  return { s, dir: repo.dir, plugin: s.fx.path(`${MARKET}/plugins/notes`) };
}

/** Run claude headless in dir, with the plugin dir for this run only when given. */
async function claude(dir: string, prompt: string, pluginDir?: string) {
  const a = harnessArgv("claude", prompt, { dir, maxTurns: 2 });
  if (pluginDir) a.args.unshift("--plugin-dir", pluginDir);
  const r = await run({ ...a, bin: realBin(a.bin, a.env.PATH), timeoutMs: 180_000 });
  return { ...r, reply: replyOf("claude", r) };
}

/** git status and the tree hash of a repo dir, without .git. */
function repoState(dir: string) {
  const status = spawnSync("git", ["status", "--porcelain", "--ignored"], { cwd: dir, encoding: "utf8" }).stdout;
  return { status, tree: treeHash(filesUnder(dir).filter((f) => !f.path.startsWith(".git/")), { core: true }) };
}

describe("scope", () => {
  liveTest("project plugin loads in one project only", async (t) => {
    const token = sentinel("RIGSCOPE");
    const { dir, plugin } = seeded(t, token);
    const on = await claude(dir, "/notes:tidy", plugin);
    assert.ok(on.reply?.includes(token), `with --plugin-dir: exit ${on.code}, no token in the reply`);
    const off = await claude(dir, "/notes:tidy");
    assert.ok(!(off.stdout + off.stderr).includes(token), "without --plugin-dir the plugin is not loaded");
  });

  liveTest("the rendered marketplace and plugin validate", async (t) => {
    const { s, plugin } = seeded(t, sentinel("RIGSCOPE"));
    for (const target of [s.fx.path(MARKET), plugin]) {
      const r = await run({ bin: realBin("claude"), args: ["plugin", "validate", target, "--json"], cwd: s.fx.home, timeoutMs: 60_000 });
      const v = r.json as {success?: boolean, manifest?: {errors?: unknown[]}} | null;
      assert.equal(v?.success, true, `${target}: ${r.stdout.slice(0, 400)}`);
      assert.deepEqual(v?.manifest?.errors, []);
    }
  });

  liveTest("no write into the repository", async (t) => {
    const repo = scratchRepo();
    t.after(() => repo.cleanup());
    const before = repoState(repo.dir);
    const s = setup({ entry: { scope: "project", projects: [repo.dir], harnesses: ["claude", "codex", "omp", "cursor"] } });
    t.after(() => s.fx.cleanup());
    const a = s.rig(["apply"]);
    assert.equal(a.code, 0, a.all);
    const d = s.rig(["doctor", "--project", repo.dir]);
    assert.match(d.stdout, /claude pack notes is declared for this project but not enabled/);
    assert.match(d.stdout, /codex pack notes: commit \.agents\/skills\/notes\//);
    assert.deepEqual(repoState(repo.dir), before);
    assert.equal(before.status, "");
  });
});

