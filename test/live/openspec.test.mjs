// Live seed cases for the OpenSpec provider path. Opt-in: RIG_LIVE=1.
// Each case renders the repo data into a fixture HOME through targets.render and copies the Claude units into a
// scratch repo with mirrorProject, so no case writes rig units into the real ~/.claude (live.mjs guards it).
// OpenSpec's own init then runs in that repo, after the mirror, because the mirror replaces .claude/commands and
// .claude/skills.
// A case reads a Claude transcript only for slash command names, tool names and their skill or command input.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe } from "node:test";
import { liveTest, runHarness } from "../helpers/live.mjs";
import { harnessArgv, mirrorProject, realBin, runSeed, scratchRepo } from "../helpers/mirror.mjs";
import { doctorTopic, editProvider, filesUnder, INIT_CLAUDE, setup } from "../openspec.helpers.mjs";

const OPTOUT = { DO_NOT_TRACK: "1", OPENSPEC_TELEMETRY: "0" };
const NAME_IT = "/craft Name the exact slash command you would run first for this request, and nothing else.";

/** An empty temp dir outside the real home, removed after the test. */
function tempDir(t, prefix) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Every file and dir under root, sorted, as root-relative paths with a trailing "/" on dirs. .git is skipped. */
function listTree(root, rel = "") {
  const out = [];
  for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (r === ".git") continue;
    if (e.isDirectory()) out.push(`${r}/`, ...listTree(root, r));
    else out.push(r);
  }
  return out.sort();
}

/**
 * `openspec init --tools <tools> .` in dir, with HOME at an empty temp dir and both opt-outs set. Any write outside
 * the project lands in that HOME, so the caller can prove there was none. @returns {string} the temp HOME
 */
function openspecInit(t, dir, tools) {
  const home = tempDir(t, "rig-openspec-home-");
  const r = spawnSync(realBin("openspec"), ["init", "--tools", tools, "."], { cwd: dir, env: { PATH: process.env.PATH, HOME: home, ...OPTOUT }, encoding: "utf8" });
  assert.equal(r.status, 0, `openspec init --tools ${tools}: ${r.stderr}`);
  return home;
}

/**
 * The seeded Claude repo: rig's render in a fixture HOME, mirrored into a scratch repo, then OpenSpec's init, then
 * the declaration line. @param {{file?: string | null, edit?: (root: string) => void, overlay?: (dir: string) => object}} [o]
 */
function seedClaude(t, { file = "CLAUDE.md", edit, overlay } = {}) {
  const repo = scratchRepo();
  t.after(() => repo.cleanup());
  const home = overlay ? { ".config/rig/rig.json": JSON.stringify({ schema: 1, projects: overlay(repo.dir) }) } : {};
  const s = setup({ edit, home });
  t.after(() => s.fx.cleanup());
  s.renderHome();
  const mirrored = mirrorProject(s.fx.home, "claude", repo.dir);
  assert.ok(mirrored.includes(".claude/commands/craft.md"), JSON.stringify(mirrored));
  const craft = readFileSync(join(repo.dir, ".claude/commands/craft.md"));
  const osHome = openspecInit(t, repo.dir, "claude");
  assert.deepEqual(listTree(osHome), [], "openspec init wrote outside the scratch repo");
  assert.ok(craft.equals(readFileSync(join(repo.dir, ".claude/commands/craft.md"))), "openspec init changed rig's /craft");
  writeFileSync(join(repo.dir, "CLAUDE.md"), "# App\n");
  if (file) appendFileSync(join(repo.dir, file), "\nrig-project: openspec\n");
  return { s, dir: repo.dir };
}

/** Claude headless with stream-json, so the tool calls are visible. No session is persisted in the real HOME. */
async function claudeStream(dir, prompt, maxTurns = 2) {
  const a = harnessArgv("claude", prompt, { dir, maxTurns });
  const args = [...a.args];
  args[args.indexOf("--output-format") + 1] = "stream-json";
  args.splice(args.length - 1, 0, "--verbose", "--no-session-persistence");
  const r = await runHarness({ ...a, args, env: { ...a.env, ...OPTOUT }, bin: realBin(a.bin, a.env.PATH), timeoutMs: 240_000 });
  const events = r.stdout.split("\n").flatMap((l) => {
    try {
      return [JSON.parse(l)];
    } catch {
      return [];
    }
  });
  const init = events.find((e) => e.type === "system" && e.subtype === "init");
  const result = events.find((e) => e.type === "result");
  const tools = events
    .filter((e) => e.type === "assistant" && Array.isArray(e.message?.content))
    .flatMap((e) => e.message.content.filter((c) => c.type === "tool_use"))
    .map((c) => ({ name: c.name, target: c.input?.skill ?? c.input?.command ?? null }));
  const reply = result && result.is_error === false && typeof result.result === "string" ? result.result : null;
  return { code: r.code, slash: init?.slash_commands ?? [], tools, result: result?.subtype ?? null, reply };
}

const opsx = (name) => (tool) => ["Skill", "SlashCommand"].includes(tool.name) && tool.target?.replace(/^\//, "").startsWith(`opsx:${name}`);

describe("openspec", () => {
  liveTest("craft routes to opsx:propose", async (t) => {
    const { dir } = seedClaude(t);
    const named = await claudeStream(dir, NAME_IT);
    assert.ok(named.slash.includes("craft") && named.slash.includes("opsx:propose"), `slash commands: ${named.slash.filter((c) => /craft|opsx/.test(c))}`);
    assert.match(named.reply ?? "", /\/opsx:propose\b/, `exit ${named.code}, result ${named.result}`);
    t.diagnostic(`named: ${named.reply?.match(/\/opsx:[a-z]+/)?.[0]}`);

    // The run reaches OpenSpec's command: the first tool call launches opsx:propose.
    const reached = await claudeStream(dir, "/craft propose a change that adds a hello command");
    assert.ok(reached.tools.length > 0 && opsx("propose")(reached.tools[0]), `tools: ${JSON.stringify(reached.tools)}`);
    t.diagnostic(`reached: ${reached.tools[0].name} ${reached.tools[0].target}`);

    // Control: the same repo with rig's record swapped to /opsx:explore. The reply tracks the record, so the route
    // comes from rig's rendered /craft, not from what the model knows about OpenSpec.
    const swapped = seedClaude(t, { edit: (root) => editProvider(root, "openspec", (r) => ({ ...r, entry: { ...r.entry, claude: { command: "/opsx:explore" } } })) });
    const control = await claudeStream(swapped.dir, NAME_IT);
    assert.match(control.reply ?? "", /\/opsx:explore\b/, `exit ${control.code}, result ${control.result}`);
    assert.doesNotMatch(control.reply ?? "", /opsx:propose/);
    t.diagnostic(`swap control: ${control.reply?.match(/\/opsx:[a-z]+/)?.[0]}`);
  });

  liveTest("no line falls back to pstack", async (t) => {
    // Trunk's lock holds no pstack pin, so /craft renders the "rig pin check pstack" line, not a poteto-mode path.
    const { dir } = seedClaude(t, { file: null });
    const r = await claudeStream(dir, NAME_IT);
    assert.ok(r.reply !== null, `exit ${r.code}, result ${r.result}`);
    assert.doesNotMatch(r.reply, /opsx/);
    assert.match(r.reply, /rig pin check pstack/);
    assert.deepEqual(r.tools.filter((x) => x.target?.includes("opsx")), []);
  });

  liveTest("a footprint alone selects nothing", async (t) => {
    // The /craft half is the "no line" case above: the same tree, with openspec/ and no line.
    const { s, dir } = seedClaude(t, { file: null });
    const r = s.rig(["doctor", "--project", dir]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.deepEqual(doctorTopic(r.stdout, "project"), ["info  project   provider pstack source default"]);
    assert.deepEqual(doctorTopic(r.stdout, "footprint"), ["info  footprint openspec: dir:openspec/ (info only: footprints never select a provider)"]);
  });

  liveTest("the CLAUDE.local.md twin selects", async (t) => {
    const { s, dir } = seedClaude(t, { file: "CLAUDE.local.md" });
    const d = s.rig(["doctor", "--project", dir]);
    assert.match(d.stdout, /^info +project +provider openspec source local-instructions \(rig-project: openspec\)$/m, d.stdout);
    const r = await claudeStream(dir, NAME_IT);
    assert.match(r.reply ?? "", /\/opsx:propose\b/, `exit ${r.code}, result ${r.result}`);
  });

  liveTest("doctor --project writes nothing", async (t) => {
    const { s, dir } = seedClaude(t);
    const status = () => spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: dir, encoding: "utf8" }).stdout;
    // .git is left out: git status itself may refresh .git/index.
    const files = () => filesUnder(dir).filter((f) => !f.path.startsWith(".git/"));
    const tree = () => createHash("sha256").update(JSON.stringify(files().map((f) => [f.path, f.mode, createHash("sha256").update(f.bytes).digest("hex")]))).digest("hex");
    const before = { status: status(), tree: tree(), home: [...s.fx.snapshot()] };
    assert.equal(s.rig(["doctor", "--project", dir]).code, 0);
    assert.deepEqual({ status: status(), tree: tree(), home: [...s.fx.snapshot()] }, before);
  });

  liveTest("overlay map disagrees", async (t) => {
    const { s, dir } = seedClaude(t, { overlay: (d) => ({ [d]: { provider: "pstack" } }) });
    const d = s.rig(["doctor", "--project", dir]);
    assert.equal(d.code, 0, d.stdout + d.stderr);
    assert.match(d.stdout, /^warn +project +the overlay projects map says pstack, the project declares openspec \(instructions\)$/m);
    const r = await claudeStream(dir, NAME_IT);
    assert.match(r.reply ?? "", /\/opsx:propose\b/, `exit ${r.code}, result ${r.result}`);
  });

  liveTest("telemetry warns until an opt-out is set", async (t) => {
    const s = setup();
    t.after(() => s.fx.cleanup());
    const verdict = (env) => {
      const r = s.rig(["plan"], { env });
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assert.match(r.stdout, /^\d+ changes, 0 blocks$/m);
      return /^warn telemetry openspec\//m.test(r.stdout);
    };
    // The installed OpenSpec's own switch, read from its dist with the same env. CI is left unset on purpose.
    const dist = join(dirname(realBin("openspec")), "../dist/telemetry/index.js");
    const tool = (env) => {
      const code = `import(${JSON.stringify(dist)}).then((m) => process.stdout.write(String(m.isTelemetryEnabled())))`;
      const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], { env: { PATH: process.env.PATH, HOME: s.fx.home, ...env }, encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
      return r.stdout === "true";
    };
    for (const env of [{}, { DO_NOT_TRACK: "1" }, { OPENSPEC_TELEMETRY: "0" }, { DO_NOT_TRACK: "0" }]) {
      const want = Object.keys(env).length === 0 || env.DO_NOT_TRACK === "0";
      assert.equal(verdict(env), want, `rig warns: ${JSON.stringify(env)}`);
      assert.equal(tool(env), want, `openspec sends: ${JSON.stringify(env)}`);
    }
  });

  liveTest("what openspec init generates", async (t) => {
    const repo = scratchRepo();
    t.after(() => repo.cleanup());
    const osHome = openspecInit(t, repo.dir, "claude");
    assert.deepEqual(listTree(osHome), [], "openspec init wrote outside the scratch repo");
    const files = listTree(repo.dir).filter((p) => !p.endsWith("/"));
    assert.deepEqual(files, [...INIT_CLAUDE.files].sort(), "test/fixtures/openspec/init-claude.json is stale");
    for (const d of INIT_CLAUDE.dirs) assert.ok(listTree(repo.dir).includes(`${d}/`), d);
    const status = spawnSync("git", ["status", "--porcelain"], { cwd: repo.dir, encoding: "utf8" }).stdout.trim().split("\n");
    assert.deepEqual(status, ["?? .claude/", "?? openspec/"]);
    // Outside .claude/, every generated path lies under the one footprint that doctor reports.
    const s = setup();
    t.after(() => s.fx.cleanup());
    const r = s.rig(["doctor", "--project", repo.dir]);
    assert.deepEqual(doctorTopic(r.stdout, "footprint"), ["info  footprint openspec: dir:openspec/ (info only: footprints never select a provider)"]);
    assert.deepEqual(files.filter((p) => !p.startsWith(".claude/") && !p.startsWith("openspec/")), []);
    t.diagnostic(`A8: .claude/skills/ ${files.some((p) => p.startsWith(".claude/skills/")) ? "appears" : "does not appear"}`);
  });

  liveTest("codex reads the route from the frame", async (t) => {
    // The record's Codex command names the prompt file that OpenSpec writes for Codex, in a temp HOME.
    const probe = scratchRepo();
    t.after(() => probe.cleanup());
    const osHome = openspecInit(t, probe.dir, "codex");
    assert.ok(listTree(osHome).includes(".codex/prompts/opsx-propose.md"), JSON.stringify(listTree(osHome)));

    const s = setup();
    t.after(() => s.fx.cleanup());
    s.renderHome();
    const repo = scratchRepo();
    t.after(() => repo.cleanup());
    assert.ok(mirrorProject(s.fx.home, "codex", repo.dir).includes("AGENTS.md"));
    appendFileSync(join(repo.dir, "AGENTS.md"), "\nrig-project: openspec\n");
    const prompt = "Your project instructions hold a rig frame and a rig-project line. Which exact command does the frame say to enter the active workflow provider with? Reply with the command only. Do not run commands or read files.";
    const r = await runSeed("codex", prompt, { dir: repo.dir, env: { ...process.env, ...OPTOUT } });
    assert.match(r.reply ?? "", /\/prompts:opsx-propose\b/, `exit ${r.code}`);
  });

  liveTest("omp says openspec is not available", async (t) => {
    const s = setup();
    t.after(() => s.fx.cleanup());
    assert.ok(s.renderHome().includes(".omp/agent/AGENTS.md"));
    const repo = scratchRepo();
    t.after(() => repo.cleanup());
    writeFileSync(join(repo.dir, "AGENTS.md"), "# App\n\nrig-project: openspec\n");
    const r = await runSeed("omp", "/craft Which workflow provider do you use here? Answer in one sentence.", { dir: repo.dir, home: s.fx.home, env: { ...process.env, ...OPTOUT } });
    assert.match(r.reply ?? "", /not available on this harness/i, `exit ${r.code}`);
    assert.match(r.reply ?? "", /pstack/);
  });
});
