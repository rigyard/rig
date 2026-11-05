// Live seed cases for pstack, rig's default workflow provider. Opt-in: RIG_LIVE=1. omp needs RIG_LIVE_OMP_MODEL.
// Each case runs `rig apply` on a fixture HOME whose lock pins the pstack version that is installed on this machine,
// read from the real installed_plugins.json (read-only). Claude Code then reads the units as project units in a
// scratch repo (mirrorProject), with the normal login; omp runs with its agent dir inside the fixture HOME.
// A case reads a Claude transcript only for tool names, file paths and usage fields.

import assert from "node:assert/strict";
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe } from "node:test";
import { pinCheck } from "../../lib/lock.mjs";
import { treeHash } from "../../lib/tree.mjs";
import { loadWorld } from "../../lib/world.mjs";
import { liveTest, realHome, runHarness } from "../helpers/live.mjs";
import { harnessArgv, mirrorProject, realBin, runSeed, scratchRepo } from "../helpers/mirror.mjs";
import { filesUnder, PLUGIN, setup } from "../pstack.helpers.mjs";

const BIN = join(import.meta.dirname, "../../bin/rig.mjs");
const INSTALLED = ".claude/plugins/installed_plugins.json";
const MARKETS = ".claude/plugins/known_marketplaces.json";
const SKILL = "skills/poteto-mode/SKILL.md";

/** The installed pstack record of this machine. Read-only. */
function installed() {
  const records = JSON.parse(readFileSync(join(realHome(), INSTALLED), "utf8")).plugins?.[PLUGIN];
  const r = Array.isArray(records) ? records[0] : null;
  if (!r?.version || !r?.gitCommitSha || !r?.installPath) throw new Error(`live: ${PLUGIN} is not installed for Claude Code on this machine`);
  return { version: r.version, sha: r.gitCommitSha, dir: r.installPath };
}

/** The locked SKILL.md path with the real home, as Claude's Read tool receives it. */
const lockedSkill = (pin) => join(realHome(), ".claude/plugins/cache/cursor-plugins/pstack", pin.version, SKILL);

/**
 * Did a successful tool call reach the locked SKILL.md? A Read of its absolute path, or a shell command that names it
 * (the model sometimes greps the file instead of reading it). Either way the path came from the rendered /craft.
 */
function reached(r, pin) {
  const abs = lockedSkill(pin);
  const tilde = `~/${abs.slice(realHome().length + 1)}`;
  return r.tools.some((c) => c.ok && ((c.name === "Read" && c.path === abs) || (c.name === "Bash" && (c.command?.includes(abs) || c.command?.includes(tilde)))));
}

/** A fixture HOME with rig applied, plus a scratch repo, both removed after the test. */
function seeded(t, opts = {}) {
  const pin = installed();
  const s = setup({ pin: { version: pin.version, sha: pin.sha }, ...opts });
  const repo = scratchRepo();
  t.after(() => (s.fx.cleanup(), repo.cleanup()));
  const a = s.rig(["apply"]);
  assert.equal(a.code, 0, a.stdout + a.stderr);
  return { s, pin, dir: repo.dir };
}

/** The tree hash of a plugin cache dir, without the `.in_use/<pid>` markers that Claude Code writes there. */
const dirTree = (dir) => treeHash(filesUnder(dir).filter((f) => !f.path.startsWith(".in_use/")), { core: true });

/** Run claude headless with a stream-json transcript. Returns the result event and every tool call. */
async function claude(dir, prompt, { maxTurns = 8, readDir } = {}) {
  const a = harnessArgv("claude", prompt, { dir, maxTurns });
  const at = a.args.indexOf("json");
  a.args.splice(at, 1, "stream-json", "--verbose");
  // Headless Claude Code denies a Read outside the project unless the dir is added. --add-dir takes several values,
  // so it goes first, before a flag ends its list.
  if (readDir) a.args.unshift("--add-dir", readDir);
  // The added dir lies outside REAL_CONFIG_PATHS, so this run checks it: its tree, without Claude Code's own
  // `.in_use/<pid>` markers, must not change.
  const before = readDir ? dirTree(readDir) : null;
  const r = await runHarness({ ...a, bin: realBin(a.bin, a.env.PATH), timeoutMs: 300_000 });
  if (readDir) assert.equal(dirTree(readDir), before, `the run changed ${readDir}`);
  const events = r.stdout.split("\n").flatMap((l) => {
    try {
      return [JSON.parse(l)];
    } catch {
      return [];
    }
  });
  const content = (type) => events.filter((e) => e.type === type).flatMap((e) => e.message?.content ?? []);
  const failed = new Set(content("user").filter((c) => c.type === "tool_result" && c.is_error === true).map((c) => c.tool_use_id));
  const tools = content("assistant")
    .filter((c) => c.type === "tool_use")
    .map((c) => ({ name: c.name, path: c.input?.file_path ?? null, command: c.input?.command ?? null, ok: !failed.has(c.id) }));
  const result = events.findLast((e) => e.type === "result") ?? null;
  const reply = r.code === 0 && result?.is_error === false ? result.result : null;
  return { code: r.code, reply, tools, usage: result?.usage ?? null, cost: result?.total_cost_usd ?? null };
}

/** Tool names and paths of one run, for an assertion message. */
const toolList = (r) => r.tools.map((c) => `${c.name}${c.path ? ` ${c.path}` : ""}${c.command ? ` $ ${c.command}` : ""}${c.ok ? "" : " (failed)"}`).join("; ");

/** Log the cost of one run: tokens and dollars when the JSON shows them. */
function cost(t, r) {
  const u = r.usage;
  if (u) t.diagnostic(`tokens in ${u.input_tokens ?? 0} (+cache ${(u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)}), out ${u.output_tokens ?? 0}, usd ${r.cost ?? "n/a"}`);
}

/** The first line of a markdown file that starts with the given heading marker. */
const heading = (text, marker) => text.split("\n").find((l) => l.startsWith(`${marker} `));

/** Mirror the Claude units into the scratch repo, with a CLAUDE.md that declares pstack. */
function mirrorClaude(s, dir) {
  writeFileSync(join(dir, "CLAUDE.md"), "rig-project: pstack\n");
  const written = mirrorProject(s.fx.home, "claude", dir);
  assert.ok(written.includes(".claude/commands/craft.md") && written.includes(".claude/rules/pstack-models.md"), written.join(", "));
}

describe("pstack", () => {
  liveTest("craft reads poteto-mode at the locked path", async (t) => {
    const { s, pin, dir } = seeded(t);
    mirrorClaude(s, dir);
    const path = lockedSkill(pin);
    assert.ok(existsSync(path), "the locked SKILL.md exists");
    const r = await claude(dir, "/craft Read the file you were told to read, then reply with its path only and stop.", { readDir: pin.dir });
    cost(t, r);
    assert.ok(r.reply, `exit ${r.code}: no reply`);
    assert.ok(r.tools.some((c) => c.name === "Read" && c.path === path && c.ok), `no successful Read of the locked path; tools: ${toolList(r)}`);
  });

  liveTest("craft loads the poteto-mode text", async (t) => {
    const { s, pin, dir } = seeded(t);
    mirrorClaude(s, dir);
    const text = readFileSync(lockedSkill(pin), "utf8");
    const h1 = heading(text, "#").slice(2);
    const h2 = heading(text, "##").slice(3);
    const r = await claude(dir, "/craft Reply only with the H1 heading and then the first H2 heading of the skill file you were told to read, one per line, without the # marks. Do nothing else.", { readDir: pin.dir });
    cost(t, r);
    assert.ok(reached(r, pin), `the reply comes from a successful tool call on the locked path; tools: ${toolList(r)}`);
    if (process.env.RIG_LIVE_DEBUG) t.diagnostic(`reply: ${JSON.stringify(r.reply)}`);
    assert.ok(r.reply?.includes(h1), `exit ${r.code}: no H1 "${h1}" in the reply`);
    assert.ok(r.reply.includes(h2), `no first H2 "${h2}" in the reply`);
  });

  liveTest("pm is the alias of craft", async (t) => {
    // A user-level command of the same name wins over the mirrored project command, so the mirror cannot show rig's
    // /pm on a machine that has its own ~/.claude/commands/pm.md.
    if (existsSync(join(realHome(), ".claude/commands/pm.md"))) {
      t.skip("a user-level ~/.claude/commands/pm.md shadows the project /pm on this machine");
      return;
    }
    const { s, pin, dir } = seeded(t);
    mirrorClaude(s, dir);
    const r = await claude(dir, "/pm Read the file you were told to read, then reply with its path only and stop.", { readDir: pin.dir });
    cost(t, r);
    assert.ok(r.reply, `exit ${r.code}: no reply`);
    assert.ok(reached(r, pin), `no successful tool call on the locked path; tools: ${toolList(r)}`);
    // A user-level /pm on this machine finds the skill with `ls | sort -V | tail -1`. rig's /pm reads the locked path.
    assert.ok(!r.tools.some((c) => /sort|tail/.test(c.command ?? "")), "the user-level /pm ran, not rig's alias");
  });

  liveTest("doctor flags a version mismatch", async (t) => {
    // rig doctor with the real HOME and a fixture repo root whose lock pins another commit and version. Read-only.
    const pin = installed();
    const other = { version: "0.0.1", sha: "0000000000000000000000000000000000000001" };
    const s = setup({ pin: other, pins: ["pstack"] });
    t.after(() => s.fx.cleanup());
    const state = join(realHome(), ".local/state/rig");
    const hadState = existsSync(state);
    const r = await runHarness({ bin: process.execPath, args: [BIN, "doctor"], env: { PATH: process.env.PATH, HOME: realHome(), RIG_ROOT: s.root }, cwd: s.fx.home });
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.match(r.stdout, new RegExp(`^error +pin +pstack/~/\\.claude/plugins/installed_plugins\\.json: installed ${PLUGIN} ${pin.sha} differs from locked ${other.sha}$`, "m"));
    assert.ok(r.stdout.split("\n").some((l) => l.startsWith("info") && l.includes(`pstack ${PLUGIN}: locked ${other.version} (0000000); installed ${pin.version} (${pin.sha.slice(0, 7)}`)), "names both versions");
    assert.equal(existsSync(state), hadState, "doctor creates no state root");
  });

  liveTest("pin check against the real marketplace repo", async (t) => {
    // pinCheck without the CLI gate (the gate blocks this tree, so the CLI records nothing), into a fixture root.
    const pin = installed();
    const s = setup({ pin: null, home: { [MARKETS]: readFileSync(join(realHome(), MARKETS)) } });
    t.after(() => s.fx.cleanup());
    const r = await pinCheck(loadWorld(s.env), "pstack", pin.sha);
    assert.equal(r.candidate.version, pin.version);
    assert.equal(r.candidate.sha, pin.sha);
    // Claude Code writes `.in_use/<pid>` markers into the cache dir; every other file is the candidate's.
    assert.equal(dirTree(pin.dir), r.candidate.tree);
    t.diagnostic(`candidate ${r.candidate.version} ${r.candidate.tree}, ${r.files.length} files`);
  });

  liveTest("adopt keeps an equal pstack-models file", async (t) => {
    const pin = installed();
    const first = setup({ pin: { version: pin.version, sha: pin.sha } });
    t.after(() => first.fx.cleanup());
    assert.equal(first.rig(["apply"]).code, 0);
    const rendered = readFileSync(first.fx.path(".claude/rules/pstack-models.md"));
    const { s, dir } = (() => {
      const s = setup({ pin: { version: pin.version, sha: pin.sha }, home: { ".claude/rules/pstack-models.md": rendered } });
      const repo = scratchRepo();
      t.after(() => (s.fx.cleanup(), repo.cleanup()));
      return { s, dir: repo.dir };
    })();
    assert.match(s.rig(["plan"]).stdout, /^adopt +owned +claude +~\/\.claude\/rules\/pstack-models\.md +pstack\/models$/m);
    assert.equal(s.rig(["apply"]).code, 0);
    assert.deepEqual(readFileSync(s.fx.path(".claude/rules/pstack-models.md")), rendered, "apply leaves the bytes");
    mirrorClaude(s, dir);
    const budget = rendered.toString("utf8").split("\n").find((l) => l.startsWith("# budget: "));
    const r = await claude(dir, "Quote verbatim the line that starts with \"# budget:\" in the pstack model rules of this project. Reply with that line only. Do not read files.", { maxTurns: 2 });
    cost(t, r);
    assert.equal(r.reply?.trim().replace(/^`+|`+$/g, ""), budget, `exit ${r.code}`);
  });

  liveTest("omp craft says pstack is not available", async (t) => {
    const { s, dir } = seeded(t);
    const r = await runSeed("omp", "/craft", { dir, home: s.fx.home });
    assert.ok(r.reply?.includes("not available on this harness"), `exit ${r.code}: the reply does not say so`);
  });

  liveTest("omp frame names the default provider", async (t) => {
    const { s, dir } = seeded(t);
    const line = s.read(".omp/agent/AGENTS.md").split("\n").find((l) => l.startsWith("No such line: "));
    assert.equal(line, "No such line: pstack. Files, directories and plugins in the project never select a provider.");
    const prompt = "Quote verbatim, with nothing else, the line of your instructions that starts with \"No such line:\". Do not run tools.";
    const r = await runSeed("omp", prompt, { dir, home: s.fx.home });
    assert.equal(r.reply?.trim().replace(/^`+|`+$/g, ""), line, `exit ${r.code}`);
  });

  liveTest("cursor craft resolves the local plugin path", async (t) => {
    const { s, dir } = seeded(t);
    const local = join(realHome(), ".cursor/plugins/local/pstack", SKILL);
    if (!existsSync(local)) {
      t.diagnostic("pstack is not installed as a Cursor local plugin on this machine");
      return;
    }
    // cursor-agent with --plugin-dir gave no output within 180 s on this machine, so the rendered skill goes into
    // the workspace's .cursor/skills instead. The skill text is the one rig writes into its local plugin.
    cpSync(s.fx.path(".cursor/plugins/local/rig/skills/craft"), join(dir, ".cursor/skills/craft"), { recursive: true });
    const prompt = "Use the craft skill. Which file does it tell you to read for pstack? Reply with that path only. Do not read files.";
    const r = await runSeed("cursor", prompt, { dir });
    assert.ok(r.reply?.includes("~/.cursor/plugins/local/pstack/skills/poteto-mode/SKILL.md"), `exit ${r.code}: no plugin-local path in the reply`);
  });
});
