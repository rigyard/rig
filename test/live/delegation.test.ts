// Live delegation lanes: /craft on Cursor and $craft on Codex run a playbook step that delegates, and the harness must call
// its own subagent tool (Cursor keeps `Task`, Codex maps it to `spawn_agent`). Opt-in: RIG_LIVE=1.
// A case reads only tool names and file paths from a harness transcript. It copies no message text to disk.
//
// Why Codex differs from the boot recipe: `codex exec --json` (0.166.0) never emits the spawn_agent call. The stream shows
// only a `collab_tool_call` with tool `wait`. And with `--ephemeral` the spawn fails ("no rollout found for thread id"),
// because the child needs the parent's rollout. So this lane drops `--ephemeral`, gives codex a temp CODEX_HOME (a copy of
// auth.json, the rig-installed agents, no config.toml) and reads the spawn_agent call from the parent rollout in that dir.
// The Codex case is opt-in (RIG_LIVE_CODEX_AUTH_COPY=1): Codex refresh tokens are single-use, so a refresh inside the temp home
// would leave the real auth.json with a spent token. The case hashes the copy before and after, and fails when it changed.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe } from "node:test";
import type { TestContext } from "node:test";
import { assertCursorMention, cursorGuard } from "../helpers/cursor-guard.ts";
import { codexSpawns, cursorCall, cursorTaskOutcomes, cursorToolNames, parseJsonl as parse } from "../helpers/delegation.ts";
import { makeFixtureHome } from "../helpers/fixture-home.ts";
import { liveTest, realHome, runHarness } from "../helpers/live.ts";
import { assertOutsideRealHome, harnessArgv, mirrorProject, realBin, scratchRepo } from "../helpers/mirror.ts";
import { configCopy, rig, ROOT } from "../helpers/seed.ts";

type Run = {code: number | null, stdout: string, stderr: string};
const run = runHarness as unknown as (o: {bin: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv, timeoutMs: number, input?: string}) => Promise<Run>;

const TASK = "Delegate exactly one small read-only task to a subagent: read the file notes/answer.txt and report its first line. Do not edit any file.";
const BUG = "a test fails after the last merge in this repo. Follow the Bug fix playbook and delegate the root-cause search to a subagent.";

/** Apply the committed seed into a fresh HOME, mirror one harness into a scratch repo that holds notes/answer.txt. */
function seeded(t: TestContext, harness: "codex" | "cursor") {
  const root = configCopy(ROOT);
  const fx = makeFixtureHome();
  const repo = scratchRepo();
  t.after(() => (fx.cleanup(), repo.cleanup(), rmSync(root, { recursive: true, force: true })));
  const a = rig(root, fx.home, ["apply"]);
  assert.equal(a.code, 0, a.all);
  mirrorProject(fx.home, harness, repo.dir);
  mkdirSync(join(repo.dir, "notes"));
  writeFileSync(join(repo.dir, "notes", "answer.txt"), "forty-two\nsecond line\n");
  return { home: fx.home, dir: repo.dir };
}

/** Codex stream items carry a call's input under these keys, never its output. */
const INPUT_KEYS = new Set(["input", "args", "arguments", "command", "parameters"]);
const inputs = (v: unknown, out: string[] = []): string[] => {
  if (Array.isArray(v)) for (const x of v) inputs(x, out);
  else if (v !== null && typeof v === "object") for (const [k, x] of Object.entries(v)) INPUT_KEYS.has(k) ? out.push(JSON.stringify(x)) : inputs(x, out);
  return out;
};
const reads = (events: unknown[], needle: string) => events.some((e) => inputs(e).some((s) => s.includes(needle)));

const rolloutFiles = (codexHome: string) => {
  const dir = join(codexHome, "sessions");
  return existsSync(dir) ? readdirSync(dir, { recursive: true }).map(String).filter((p) => p.endsWith(".jsonl")).map((p) => join(dir, p)) : [];
};

/** The parent thread's rollout in a codex home: its filename ends with the thread id. */
const parentRollout = (codexHome: string, threadId: string) => rolloutFiles(codexHome).find((p) => p.endsWith(`-${threadId}.jsonl`));

/** A child agent writes its own rollout next to the parent's. */
const childRollouts = (codexHome: string, threadId: string) => rolloutFiles(codexHome).filter((p) => !p.endsWith(`-${threadId}.jsonl`)).length;

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

const AUTH_COPY_SKIP = "set RIG_LIVE_CODEX_AUTH_COPY=1 to run: this lane copies ~/.codex/auth.json into a temp CODEX_HOME, and if Codex refreshes its single-use refresh token there, the real login holds a spent token and needs `codex login`.";
const AUTH_REFRESHED = "Codex refreshed its token inside the lane: the temp auth.json changed while the real ~/.codex/auth.json did not. The real refresh token may now be spent, so you may need to run `codex login`.";

/** A run that made no assistant turn and no tool call, such as a login or quota failure, gives no verdict. */
function noVerdict(t: TestContext, h: string, acted: boolean, r: Run) {
  if (acted) return false;
  t.skip(`no verdict: ${h} made no assistant turn or tool call (exit ${r.code}): ${r.stderr.trim().split("\n").at(-1) ?? ""}`);
  return true;
}

describe("delegation", () => {
  liveTest("codex delegates with spawn_agent", async (t) => {
    if (process.env.RIG_LIVE_CODEX_AUTH_COPY !== "1") return t.skip(AUTH_COPY_SKIP);
    const realAuth = join(realHome(), ".codex", "auth.json");
    if (!existsSync(realAuth)) return t.skip("no ~/.codex/auth.json: log in with `codex login` first");
    const s = seeded(t, "codex");
    const a = harnessArgv("codex", `$craft ${BUG} ${TASK}`, { dir: s.dir, home: s.home });
    const codexHome = mkdtempSync(join(tmpdir(), "rig-codex-deleg-"));
    t.after(() => (a.cleanup(), rmSync(codexHome, { recursive: true, force: true })));
    assertOutsideRealHome(codexHome);
    const authCopy = join(codexHome, "auth.json");
    copyFileSync(realAuth, authCopy);
    chmodSync(authCopy, 0o600);
    const authBefore = sha256(authCopy);
    cpSync(join(s.home, ".codex", "agents"), join(codexHome, "agents"), { recursive: true });
    const args = a.args.filter((x) => x !== "--ephemeral");
    assert.equal(args.length, a.args.length - 1, "harnessArgv no longer passes --ephemeral; revisit this lane");
    const refreshed = () => assert.equal(sha256(authCopy), authBefore, AUTH_REFRESHED);
    let r: Run;
    try {
      r = await run({ ...a, args, env: { ...a.env, CODEX_HOME: codexHome }, bin: realBin(a.bin, a.env.PATH), timeoutMs: 600_000 });
    } catch (e) {
      refreshed();
      throw e;
    }
    refreshed();
    const events = parse(r.stdout);
    const threadId = events.find((e) => e.type === "thread.started")?.thread_id;
    if (noVerdict(t, "codex", events.some((e) => String(e.type).startsWith("item.")), r)) return;
    assert.ok(typeof threadId === "string", "the codex stream has no thread.started");
    const parent = parentRollout(codexHome, threadId);
    const spawns = parent ? codexSpawns(parse(readFileSync(parent, "utf8"))) : [];
    const children = childRollouts(codexHome, threadId);
    t.diagnostic(`spawn_agent calls: ${spawns.length}, with a JSON result: ${spawns.filter((x) => x.ok).length}; child rollouts: ${children}`);
    assert.ok(reads(events, "craft/hub.md"), `exit ${r.code}: the codex transcript does not read craft/hub.md`);
    assert.ok(spawns.length > 0, `exit ${r.code}: the codex parent rollout has no spawn_agent call`);
    assert.ok(spawns.some((x) => x.ok) || children > 0, `exit ${r.code}: every spawn_agent call failed and no child rollout exists`);
  });

  liveTest("cursor delegates with Task", async (t) => {
    const s = seeded(t, "cursor");
    const a = harnessArgv("cursor", `/craft ${BUG} ${TASK}`, { dir: s.dir, home: s.home });
    t.after(a.cleanup);
    const at = a.args.indexOf("--output-format");
    a.args.splice(at, 2, "--output-format", "stream-json");
    const r = await run({ ...a, bin: realBin(a.bin, a.env.PATH), timeoutMs: 600_000 });
    const events = parse(r.stdout);
    if (noVerdict(t, "cursor", events.some((e) => e.type === "assistant" || e.type === "tool_call"), r)) return;
    const names = cursorToolNames(events);
    const task = events.flatMap((e) => (e.subtype === "completed" && cursorCall(e)?.name === "taskToolCall" ? [Object.keys(cursorCall(e)?.call.result ?? {}).join("+") || "none"] : []));
    t.diagnostic(`cursor tool names: ${[...new Set(names)].join(", ")}; Task result keys: ${task.join(", ")}`);
    assertCursorMention(cursorGuard(r.stdout, { dir: s.dir, home: s.home }, t), "craft/hub.md");
    const outcome = cursorTaskOutcomes(events);
    assert.ok(outcome.completed > 0, `exit ${r.code}: no cursor Task call completed (completed ${outcome.completed}, failed ${outcome.failed}, started ${names.filter((n) => n === "taskToolCall").length})`);
  });
});
