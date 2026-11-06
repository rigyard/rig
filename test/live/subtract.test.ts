import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe } from "node:test";
import { liveOmpTest, liveTest, runHarness } from "../helpers/live.ts";
import { makeFixtureHome } from "../helpers/fixture-home.ts";
import { harnessArgv, mirrorProject, realBin, replyOf, scratchRepo } from "../helpers/mirror.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const BIN = join(ROOT, "bin/rig.ts");
const NOW = "2026-11-05T12:00:00.000Z";

type Run = {code: number | null, stdout: string, stderr: string, json: unknown};
const run = runHarness as unknown as (o: {bin: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv, timeoutMs: number, input?: string}) => Promise<Run>;

const PROMPT = 'Quote verbatim the first numbered invariant line of the rig frame, the text headed "# rig frame". Reply with that line and nothing else.';

function seeded(t: {after: (fn: () => void) => void}) {
  const fx = makeFixtureHome();
  const repo = scratchRepo();
  t.after(() => (fx.cleanup(), repo.cleanup()));
  const r = spawnSync(process.execPath, [BIN, "apply"], { env: { PATH: process.env.PATH, HOME: fx.home, RIG_ROOT: ROOT, RIG_NOW: NOW }, cwd: fx.home, encoding: "utf8", input: "" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return { fx, dir: repo.dir };
}

function firstInvariant(frame: string) {
  assert.doesNotMatch(frame, /provider/i, "the frame still names a provider");
  const lines = frame.split("\n");
  const at = lines.findIndex((l) => l.startsWith("Invariants"));
  assert.ok(at >= 0, "the frame has no Invariants line");
  const line = lines[at + 1].replace(/^\d+\.\s*/, "");
  assert.ok(line.length > 0, "the frame has no first invariant");
  return line;
}

const squash = (s: string) => s.replace(/\s+/g, " ");

async function ask(harness: "claude" | "omp" | "codex" | "cursor", dir: string, home?: string) {
  const a = harnessArgv(harness, PROMPT, { dir, home, maxTurns: 3 });
  try {
    const r = await run({ ...a, bin: realBin(a.bin, a.env.PATH), timeoutMs: 180_000 });
    return { code: r.code, reply: replyOf(harness, r) };
  } finally {
    a.cleanup();
  }
}

describe("subtract", () => {
  liveTest("claude reads the frame", async (t) => {
    const { fx, dir } = seeded(t);
    const quote = firstInvariant(fx.read(".claude/rules/rig-frame.md"));
    mirrorProject(fx.home, "claude", dir);
    const r = await ask("claude", dir);
    assert.ok(r.reply && squash(r.reply).includes(quote), `exit ${r.code}: the reply does not quote the first invariant`);
  });

  liveTest("codex reads the frame block", async (t) => {
    const { fx, dir } = seeded(t);
    const agents = fx.read(".codex/AGENTS.md");
    assert.match(agents, /<!-- rig:frame:start -->/);
    const quote = firstInvariant(agents);
    mirrorProject(fx.home, "codex", dir);
    const r = await ask("codex", dir);
    assert.ok(r.reply && squash(r.reply).includes(quote), `exit ${r.code}: the reply does not quote the first invariant`);
  });

  liveOmpTest("omp reads the frame", async (t) => {
    const { fx, dir } = seeded(t);
    const quote = firstInvariant(fx.read(".omp/agent/AGENTS.md"));
    const r = await ask("omp", dir, fx.home);
    assert.ok(r.reply && squash(r.reply).includes(quote), `exit ${r.code}: the reply does not quote the first invariant`);
  });

  liveTest("cursor reads the frame rule", async (t) => {
    const { fx, dir } = seeded(t);
    const rule = fx.read(".cursor/rules/rig-frame.mdc");
    const quote = firstInvariant(rule);
    mirrorProject(fx.home, "cursor", dir);
    const r = await ask("cursor", dir);
    assert.ok(r.reply && squash(r.reply).includes(quote), `exit ${r.code}: the reply does not quote the first invariant`);
  });
});
