import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe } from "node:test";
import type { TestContext } from "node:test";
import { liveOmpTest, liveTest, runHarness } from "../helpers/live.ts";
import { harnessArgv, mirrorProject, realBin, replyOf, scratchRepo } from "../helpers/mirror.ts";
import { craftFiles, craftFixture } from "../mode.helpers.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const BIN = join(ROOT, "bin/rig.ts");

type Harness = "claude" | "codex" | "cursor" | "omp";
type Run = {code: number | null, stdout: string, stderr: string, json: unknown};
const run = runHarness as unknown as (o: {bin: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv, timeoutMs: number, input?: string}) => Promise<Run>;

const typed = (h: Harness, name: string) => `${h === "codex" ? "$" : "/"}${name}`;
const ROUTE = "which playbook fits a failing test report?";
const LISTING = "List the name of every skill that is available to you in this session, one per line. Reply with the list and nothing else.";

function seeded(t: TestContext, mirrors: ("claude" | "codex" | "cursor")[]) {
  const fx = craftFixture();
  const repo = scratchRepo();
  t.after(() => (fx.cleanup(), repo.cleanup()));
  const r = spawnSync(process.execPath, [BIN, "apply"], { env: { PATH: process.env.PATH, ...fx.env }, cwd: fx.home, encoding: "utf8", input: "" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  for (const h of mirrors) mirrorProject(fx.home, h, repo.dir);
  return { home: fx.home, dir: repo.dir };
}

const events = (stdout: string) => stdout.split("\n").flatMap((l) => {
  try {
    return [JSON.parse(l)];
  } catch {
    return [];
  }
});

/** Keys whose values are tool calls or their arguments in the four JSON streams. Message text is never read. */
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

/**
 * A tool call reads dir/file when it names the path, or when it changes into dir and names the file, as in
 * `cd .claude/skills/craft && cat hub.md`. A call that only names the file there (`wc -l hub.md`) counts too.
 */
function readsPath(t: string, needle: string) {
  if (t.includes(needle)) return true;
  const at = needle.lastIndexOf("/");
  const dir = needle.slice(0, at).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\bcd [^;&|]*/${dir}(?=[\\s"';&|])`).test(t) && t.includes(needle.slice(at + 1));
}

const reads = (r: Run, needle: string) => events(r.stdout).some((e) => toolText(e).some((t) => readsPath(t, needle)));

/** Claude stream-json: an assistant tool_use block named Agent or Task spawns a subagent. */
const spawns = (r: Run) => events(r.stdout).some((e) => e.type === "assistant" && e.message?.content?.some?.((c: {type?: string, name?: string}) => c.type === "tool_use" && (c.name === "Agent" || c.name === "Task")));

/** The final reply. Claude and Cursor run with stream-json here, so their reply is the last result event. */
function reply(h: Harness, r: Run) {
  if (h === "codex" || h === "omp") return replyOf(h, r);
  const last = events(r.stdout).filter((e) => e.type === "result").at(-1);
  return r.code === 0 && last && last.is_error !== true && typeof last.result === "string" ? last.result : null;
}

async function ask(h: Harness, prompt: string, s: {home: string, dir: string}, maxTurns = 10) {
  const a = harnessArgv(h, prompt, { dir: s.dir, home: s.home, maxTurns });
  if (h === "claude" || h === "cursor") {
    const at = a.args.indexOf("--output-format");
    a.args.splice(at, 2, "--output-format", "stream-json", ...(h === "claude" ? ["--verbose"] : []));
  }
  try {
    const r = await run({ ...a, bin: realBin(a.bin, a.env.PATH), timeoutMs: 300_000 });
    return { r, text: reply(h, r) };
  } finally {
    a.cleanup();
  }
}

/** The run made a tool call or an assistant turn. A run with neither, such as an omp provider 402, gives no verdict. */
function acted(h: Harness, r: Run) {
  return events(r.stdout).some((e) => h === "codex" ? String(e.type).startsWith("item.")
    : h === "omp" ? e.type === "message_end" && e.message?.role === "assistant" && e.message.content?.length > 0
    : (e.type === "assistant" && e.message?.content?.length > 0) || e.type === "tool_call");
}

function noVerdict(t: TestContext, h: Harness, r: Run) {
  if (acted(h, r)) return false;
  const why = r.stdout.match(/"errorMessage":"([^"]{0,200})/)?.[1] ?? r.stderr.trim().split("\n").at(-1) ?? "";
  t.skip(`no verdict: ${h} made no tool call and no assistant turn (exit ${r.code}): ${why}`);
  return true;
}

/** omp records a skill load as a custom message {customType: "skill-prompt", details: {name}}, at any depth of an event. */
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

const HIDDEN = /\b(craft|architect|design-probe)\b/i;
const squash = (s: string) => s.replace(/`/g, "").replace(/\s+/g, " ").trim();

async function typedAndHidden(t: TestContext, h: "codex" | "cursor" | "omp") {
  const s = seeded(t, h === "codex" ? ["codex"] : h === "cursor" ? ["claude", "codex", "cursor"] : []);
  t.diagnostic(`typed form: ${typed(h, "craft")}`);
  const first = await ask(h, `${typed(h, "craft")} ${ROUTE}`, s);
  if (noVerdict(t, h, first.r)) return null;
  assert.ok(reads(first.r, "craft/hub.md"), `exit ${first.r.code}: the ${h} transcript does not read craft/hub.md`);
  const listing = await ask(h, LISTING, s, 3);
  if (noVerdict(t, h, listing.r)) return null;
  assert.ok(listing.text !== null, `exit ${listing.r.code}: ${h} gave no listing`);
  assert.doesNotMatch(listing.text, HIDDEN, `the ${h} listing names a hidden skill`);
  return first;
}

describe("mode", () => {
  liveTest("claude invokes craft", async (t) => {
    const s = seeded(t, ["claude"]);
    t.diagnostic("typed form: /craft");
    const { r, text } = await ask("claude", `/craft ${ROUTE}`, s);
    if (noVerdict(t, "claude", r)) return;
    assert.ok(reads(r, "craft/hub.md"), `exit ${r.code}: the transcript does not read craft/hub.md`);
    assert.match(text ?? "", /bug[- ]fix/i, "the reply does not name the fixture bug-fix playbook");
  });

  liveTest("claude reads an adopted playbook", async (t) => {
    const s = seeded(t, ["claude"]);
    const step1 = craftFiles()["skills/poteto-mode/playbooks/bug-fix.md"].split("\n").find((l) => l.startsWith("1. "))!.slice(3);
    const { r, text } = await ask("claude", "/craft quote step 1 of the Bug fix playbook verbatim. Reply with that step and nothing else.", s);
    if (noVerdict(t, "claude", r)) return;
    assert.ok(text !== null, `exit ${r.code}: no reply`);
    assert.ok(squash(text).includes(squash(step1)), "the quote does not match the fixture bytes");
  });

  liveTest("codex runs typed craft and hides the leaf", (t) => typedAndHidden(t, "codex"));

  liveTest("cursor runs typed craft and hides the leaf", (t) => typedAndHidden(t, "cursor"));

  liveOmpTest("omp runs typed craft and hides the leaf", async (t) => {
    const first = await typedAndHidden(t, "omp");
    if (first === null) return;
    assert.equal(loads(first.r, "craft"), 1, "omp does not load craft exactly once");
  });

  liveTest("claude follows the domain file over the hub", async (t) => {
    const s = seeded(t, ["claude"]);
    const { r, text } = await ask("claude", "/craft eng: design the boundary between two fixture modules", s, 12);
    if (noVerdict(t, "claude", r)) return;
    assert.ok(reads(r, "design-probe/SKILL.md"), `exit ${r.code}: the transcript does not read design-probe/SKILL.md`);
    // Opening architect/SKILL.md to compare it is not following it. The architect leaf asks for a second model.
    assert.match(text ?? "", /`?DESIGN-PROBE-USED`?\s*$/, "the reply does not end with the design-probe line");
    assert.ok(!spawns(r), "the transcript spawns a subagent, as the architect leaf asks");
  });

  liveTest("codex architect reads the adapter", async (t) => {
    const s = seeded(t, ["codex"]);
    t.diagnostic("typed form: $architect");
    const { r } = await ask("codex", "$architect sketch the boundary between a parser and a renderer in two sentences.", s);
    if (noVerdict(t, "codex", r)) return;
    assert.ok(reads(r, "craft/references/adapter.md"), `exit ${r.code}: the transcript does not read craft/references/adapter.md`);
  });
});
