// Live lanes of the first seed (docs/plan/v1-first-seed-prs.md, seed, lanes 1 to 10) and of the frame triggers. Opt-in: RIG_LIVE=1.
// RIG_LIVE_PLUGINS and RIG_LIVE_GSTACK override the upstream URLs, for example with file:// clones.
// A case reads a transcript only for tool names, file paths and the final reply. It copies no message text to disk.

import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe } from "node:test";
import type { TestContext } from "node:test";
import { makeFixtureHome } from "../helpers/fixture-home.ts";
import { liveTest, realHome, runHarness } from "../helpers/live.ts";
import { harnessArgv, mirrorProject, realBin, replyOf, scratchRepo } from "../helpers/mirror.ts";
import { configCopy, json, manifest, rig, ROOT, runId } from "../helpers/seed.ts";

const PLUGINS = process.env.RIG_LIVE_PLUGINS || "https://github.com/cursor/plugins";
const GSTACK = process.env.RIG_LIVE_GSTACK || "https://github.com/garrytan/gstack";
const PS = "2776ddd2355d6d6c8747d3964600f28daf62f049";
const GS = "b4068209809315ab1578c78e33e73512b29749ca";
const GB = "b244e6d11a6466650c5147cd7dc023859968c4b5";

type Harness = "claude" | "codex" | "cursor" | "omp";
type Run = {code: number | null, stdout: string, stderr: string, json: unknown};
const run = runHarness as unknown as (o: {bin: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv, timeoutMs: number, input?: string}) => Promise<Run>;

/** The typed skill form per harness, from `skill_prefix` in targets/<harness>.json, the form the frame names. */
const typed = (h: Harness, name: string) => `${json(join(ROOT, "targets", `${h}.json`)).skill_prefix}${name}`;
const LISTING = "List the name of every skill that is available to you in this session, one per line. Reply with the list and nothing else.";
const IDEA = "a CLI that turns meeting notes into tickets for a small team";

/** Apply the committed seed into a fresh HOME and mirror it into a scratch repo for the harnesses that need a project. */
function seeded(t: TestContext, mirrors: ("claude" | "codex" | "cursor")[], repoFiles: Record<string, string> = {}) {
  const root = configCopy(ROOT);
  const fx = makeFixtureHome();
  const repo = scratchRepo();
  t.after(() => (fx.cleanup(), repo.cleanup(), rmSync(root, { recursive: true, force: true })));
  const a = rig(root, fx.home, ["apply"]);
  assert.equal(a.code, 0, a.all);
  for (const h of mirrors) mirrorProject(fx.home, h, repo.dir);
  for (const [rel, body] of Object.entries(repoFiles)) {
    mkdirSync(join(repo.dir, rel, ".."), { recursive: true });
    writeFileSync(join(repo.dir, rel), body);
  }
  return { home: fx.home, dir: repo.dir };
}

const events = (stdout: string) => stdout.split("\n").flatMap((l) => {
  try {
    return [JSON.parse(l)];
  } catch {
    return [];
  }
});

const TOOL_KEYS = new Set(["input", "args", "arguments", "command", "tool_call", "toolCall", "parameters"]);

function toolText(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) for (const x of v) toolText(x, out);
  else if (v !== null && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      if (TOOL_KEYS.has(k)) out.push(JSON.stringify(x));
      else toolText(x, out);
    }
  }
  return out;
}

const reads = (r: Run, needle: string) => events(r.stdout).some((e) => toolText(e).some((t) => t.includes(needle)));

/** Claude stream-json tool_use names, in order. */
const claudeTools = (r: Run) => events(r.stdout).flatMap((e) => (e.type === "assistant" ? (e.message?.content ?? []) : []))
  .filter((c: {type?: string}) => c.type === "tool_use").map((c: {name: string, input?: unknown}) => c);

function reply(h: Harness, r: Run) {
  if (h === "codex" || h === "omp") return replyOf(h, r);
  const last = events(r.stdout).filter((e) => e.type === "result").at(-1);
  return r.code === 0 && last && last.is_error !== true && typeof last.result === "string" ? last.result : null;
}

async function ask(h: Harness, prompt: string, s: {home: string, dir: string}, o: {maxTurns?: number, allowedTools?: string} = {}) {
  const a = harnessArgv(h, prompt, { dir: s.dir, home: s.home, maxTurns: o.maxTurns ?? 10 });
  if (h === "claude" || h === "cursor") {
    const at = a.args.indexOf("--output-format");
    a.args.splice(at, 2, "--output-format", "stream-json", ...(h === "claude" ? ["--verbose"] : []));
  }
  // --allowedTools takes a variadic list, so it goes before -p: after it, the list would take the prompt too.
  if (o.allowedTools) a.args.unshift("--allowedTools", o.allowedTools);
  try {
    const r = await run({ ...a, bin: realBin(a.bin, a.env.PATH), timeoutMs: 600_000 });
    return { r, text: reply(h, r) };
  } finally {
    a.cleanup();
  }
}

function acted(h: Harness, r: Run) {
  return events(r.stdout).some((e) => h === "codex" ? String(e.type).startsWith("item.")
    : h === "omp" ? e.type === "message_end" && e.message?.role === "assistant" && e.message.content?.length > 0
    : (e.type === "assistant" && e.message?.content?.length > 0) || e.type === "tool_call");
}

/** A run with no tool call and no assistant turn, such as a login or quota failure, gives no verdict. */
function noVerdict(t: TestContext, h: Harness, r: Run) {
  if (acted(h, r)) return false;
  t.skip(`no verdict: ${h} made no tool call and no assistant turn (exit ${r.code}): ${r.stderr.trim().split("\n").at(-1) ?? ""}`);
  return true;
}

/** omp records a skill load as a custom message {customType: "skill-prompt", details: {name}}. */
function loads(r: Run, name: string) {
  const ids = new Set<string>();
  const walk = (v: any) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v !== null && typeof v === "object") {
      if (v.customType === "skill-prompt" && v.details?.name === name) ids.add(String(v.id ?? JSON.stringify(v)));
      Object.values(v).forEach(walk);
    }
  };
  events(r.stdout).forEach(walk);
  return ids.size;
}

/** The names a listing reply gives, one per line, with bullets and code marks removed. */
const listed = (text: string) => text.split("\n").map((l) => l.replace(/^[\s*\-\d.)]+/, "").replace(/[`*]/g, "").trim().toLowerCase()).filter(Boolean);

async function typedAndHidden(t: TestContext, h: "codex" | "cursor" | "omp") {
  const s = seeded(t, h === "codex" ? ["codex"] : h === "cursor" ? ["claude", "codex", "cursor"] : []);
  t.diagnostic(`typed form: ${typed(h, "craft")}`);
  const first = await ask(h, `${typed(h, "craft")} a test fails after the last merge, what do I do?`, s);
  if (noVerdict(t, h, first.r)) return null;
  assert.ok(reads(first.r, "craft/hub.md"), `exit ${first.r.code}: the ${h} transcript does not read craft/hub.md`);
  const listing = await ask(h, LISTING, s, { maxTurns: 3 });
  if (noVerdict(t, h, listing.r)) return null;
  assert.ok(listing.text !== null, `exit ${listing.r.code}: ${h} gave no listing`);
  for (const name of ["craft", "how"]) assert.ok(!listed(listing.text).includes(name), `the ${h} listing names ${name}`);
  return first;
}

/** Names and sizes of every entry under a dir, to see that a run wrote nothing there. */
function snapshot(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true }).map(String).sort().map((p) => `${p}\t${statSync(join(dir, p)).size}`);
}

describe("first seed", () => {
  liveTest("claude routes a bug report", async (t) => {
    const s = seeded(t, ["claude"]);
    const { r, text } = await ask("claude", "/craft a test fails after the last merge, what do I do?", s);
    if (noVerdict(t, "claude", r)) return;
    assert.match(text ?? "", /bug[- ]fix/i, "the reply does not name the Bug fix playbook");
  });

  liveTest("re-vendor reproduces the lock", async (t) => {
    const committed = json(join(ROOT, "rig.lock.json"));
    const root = configCopy(ROOT);
    const fx = makeFixtureHome();
    t.after(() => (fx.cleanup(), rmSync(root, { recursive: true, force: true })));
    for (const p of ["pstack", "cursor-team-kit", "cli-for-agent"]) rmSync(join(root, "packs", p), { recursive: true });
    writeFileSync(join(root, "rig.lock.json"), `${JSON.stringify({ ...committed, packs: {} }, null, 2)}\n`);
    writeFileSync(join(root, "rig.json"), `${JSON.stringify({ ...json(join(ROOT, "rig.json")), packs: {}, fill: {} }, null, 2)}\n`);
    const r = (...args: string[]) => {
      const x = rig(root, fx.home, args);
      assert.equal(x.code, 0, `rig ${args.join(" ")}: ${x.all}`);
      return x;
    };
    r("pack", "add", PLUGINS, "--sha", PS, "--root", "pstack", "--path", ".",
      ...["assets", "automations", "docs/guide", "README.md", "plugin.json", "skills/poteto-mode/scripts", "skills/statechart", "skills/create-formal-verification-skill",
        "skills/show-me-your-work/scripts", "skills/make-bot-ui", "skills/setup-pstack", "skills/poteto-help"].flatMap((x) => ["--exclude", x]),
      "--port", "docs/harness/claude-code.md");
    r("pack", "add", PLUGINS, "--sha", PS, "--root", "cursor-team-kit", "--path", "skills/deslop", "--path", "skills/control-cli", "--path", "skills/control-ui", "--path", "LICENSE");
    r("pack", "add", PLUGINS, "--sha", PS, "--root", "cli-for-agent", "--path", "skills/cli-for-agents", "--path", "LICENSE");
    r("pack", "add", GSTACK, "--sha", GB, "--name", "product", "--port", "office-hours/SKILL.md", "--port", "office-hours/sections", "--port", "LICENSE");
    r("pin", "set", "product", "--ported");
    r("pin", "check", "product", "--sha", GS);
    r("pin", "set", "product");
    for (const p of ["pstack", "cursor-team-kit", "cli-for-agent"]) cpSync(join(ROOT, "packs", p, "pack.json"), join(root, "packs", p, "pack.json"));
    r("pin", "set", "pstack", "--ported");
    const lock = json(join(root, "rig.lock.json"));
    for (const [name, entry] of Object.entries(committed.packs) as [string, any][]) {
      assert.deepEqual([lock.packs[name].sha, lock.packs[name].tree, lock.packs[name].port?.tree ?? null], [entry.sha, entry.tree, entry.port?.tree ?? null], name);
    }
    cpSync(join(ROOT, "rig.json"), join(root, "rig.json"));
    const plan = rig(root, fx.home, ["plan"]);
    assert.equal(plan.code, 0, plan.all);
    assert.match(plan.stdout, /^\d+ changes, 0 blocks$/m);
  });

  liveTest("claude reads the adapter and calls no Task", async (t) => {
    const s = seeded(t, ["claude"]);
    const { r } = await ask("claude", "/craft a test fails after the last merge in this repo. Follow the Bug fix playbook and delegate the root-cause search to a subagent.", s, { maxTurns: 15 });
    if (noVerdict(t, "claude", r)) return;
    const tools = claudeTools(r);
    const names = tools.map((c: {name: string}) => c.name).join(", ");
    assert.ok(reads(r, "craft/references/adapter.md"), `the transcript does not read craft/references/adapter.md: ${names}`);
    assert.ok(!tools.some((c: {name: string}) => c.name === "Task"), `the transcript calls a tool named Task: ${names}`);
    const agent = tools.find((c: {name: string}) => c.name === "Agent");
    t.diagnostic(agent ? `Agent call; its prompt names craft/hub.md: ${JSON.stringify(agent.input ?? {}).includes("craft/hub.md")}` : `no Agent call: ${names}`);
  });

  liveTest("claude runs office-hours into a repo artifact", async (t) => {
    const gstack = join(realHome(), ".gstack");
    const before = snapshot(gstack);
    const allowedTools = "Read Write Edit Bash(ls:*) Bash(mkdir:*) Bash(test:*) Bash(grep:*) Bash(git:*)";
    const fresh = seeded(t, ["claude"]);
    const first = await ask("claude", `/craft prod: ${IDEA}. Answer your own questions with plain assumptions, then write the design doc.`, fresh, { maxTurns: 40, allowedTools });
    if (noVerdict(t, "claude", first.r)) return;
    const designs = join(fresh.dir, "docs/designs");
    assert.ok(existsSync(designs) && readdirSync(designs).some((f) => f.endsWith(".md")), "no docs/designs/<slug>.md in the scratch repo");
    assert.deepEqual(snapshot(gstack), before, "the run wrote under ~/.gstack");

    const existing = { "docs/designs/meeting-notes-cli.md": `# Design: ${IDEA}\n\nGenerated by the office-hours skill on 2026-11-05.\n\n## Problem\n\nTeams lose action items from meetings.\n\n## Approach\n\nParse notes, file one ticket per action item.\n` };
    const known = seeded(t, ["claude"], existing);
    const second = await ask("claude", `/craft prod: ${IDEA}.`, known, { maxTurns: 20, allowedTools });
    if (noVerdict(t, "claude", second.r)) return;
    assert.ok(!reads(second.r, "startup-diagnostic.md"), "office-hours started the forcing questions although the brief exists");
    assert.doesNotMatch(second.text ?? "", /\bQ1\b|Demand reality/, "the reply asks the first forcing question");
    assert.match(second.text ?? "", /\bprod:shape\b|\bshape (step|stage)\b/i, "the reply does not start at prod:shape, the first step left after the brief");
  });

  liveTest("claude applies the ship hook", async (t) => {
    const s = seeded(t, ["claude"]);
    const { r, text } = await ask("claude", "/craft what runs before a commit in this rig? Reply in one sentence.", s);
    if (noVerdict(t, "claude", r)) return;
    assert.match(text ?? "", /deslop/i, "the reply does not name deslop");
  });

  for (const h of ["claude", "codex"] as const) {
    liveTest(`${h} applies a frame trigger with no craft`, async (t) => {
      const s = seeded(t, [h]);
      const { r } = await ask(h, "Write a short README for this repo.", s, { maxTurns: 15 });
      if (noVerdict(t, h, r)) return;
      assert.ok(reads(r, "unslop/SKILL.md") || reads(r, "technical-writing/SKILL.md"), `exit ${r.code}: the ${h} transcript reads neither unslop/SKILL.md nor technical-writing/SKILL.md`);
    });
  }

  liveTest("codex runs typed craft and hides leaves", (t) => typedAndHidden(t, "codex"));

  liveTest("cursor runs typed craft and hides leaves", (t) => typedAndHidden(t, "cursor"));

  liveTest("omp runs typed craft once", async (t) => {
    const first = await typedAndHidden(t, "omp");
    if (first === null) return;
    assert.equal(loads(first.r, "craft"), 1, "omp does not load craft exactly once");
  });

  liveTest("undo clears the seed", (t) => {
    const root = configCopy(ROOT);
    const fx = makeFixtureHome();
    t.after(() => (fx.cleanup(), rmSync(root, { recursive: true, force: true })));
    const before = manifest(fx.home);
    const a = rig(root, fx.home, ["apply"]);
    assert.equal(a.code, 0, a.all);
    assert.notDeepEqual(manifest(fx.home), before);
    const u = rig(root, fx.home, ["apply", "--undo", runId(a.stdout)]);
    assert.equal(u.code, 0, u.all);
    assert.deepEqual(manifest(fx.home), before);
  });

  liveTest("pin check is fresh", (t) => {
    const root = configCopy(ROOT);
    const fx = makeFixtureHome();
    t.after(() => (fx.cleanup(), rmSync(root, { recursive: true, force: true })));
    for (const [pack, sha] of [["pstack", PS], ["product", GS]]) {
      const c = rig(root, fx.home, ["pin", "check", pack, "--sha", sha]);
      assert.equal(c.code, 0, c.all);
      assert.match(c.stdout, /^0 files changed$/m, `${pack}: files changed`);
      assert.match(c.stdout, /^port fresh: /m, `${pack}: the port is not fresh`);
    }
  });
});
