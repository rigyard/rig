// Path guard for live lanes that run with the operator's real HOME. cursor-agent has no settings-source flag and agy has no
// config-dir flag (a temp HOME loses the login), so such a lane sees the real user scope (rules, agents, skills, MCP servers)
// next to the fixture units. A pass must not come from there. Each harness supplies a dialect that reads its stream-json.

import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { TestContext } from "node:test";
import { cursorCall, parseJsonl } from "./delegation.ts";
import { realHome as operatorHome, runHarness } from "./live.ts";
import { harnessArgv, realBin, scrubEnv } from "./mirror.ts";

export type GuardScope = {
  /** The scratch project: the harness's workspace, and the base of every relative path in a tool call. */
  dir: string;
  /** The fixture HOME whose units the lane mirrored into dir. */
  home?: string;
  /** The operator's real home. Defaults to the account database's home; injectable for tests. */
  realHome?: string;
};

/** One started tool call: its name and its arguments as the stream gives them. */
export type ToolCall = { name: string; args: unknown };

/** How one harness's stream-json names its tool calls and its user scope. */
export type Dialect = {
  harness: string;
  /** Every started tool call, in order, each once. */
  calls: (events: any[]) => ToolCall[];
  /** The tool names that open one file for reading. */
  readTools: string[];
  /** What the stream reports about the user scope, for the TAP line. Names only, never contents. */
  scope: (events: any[]) => string;
};

type Run = { code: number | null; stdout: string; stderr: string };
const run = runHarness as unknown as (o: { bin: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number; input: string }) => Promise<Run>;

export type PathGuard = {
  harness: string;
  events: any[];
  /** Real-home paths named by started tool calls, sorted and unique. */
  userPaths: string[];
  /** Whether a started call that names no real-home path matches. A string matches when the call's arguments contain it. */
  mentions: (match: string | ((argsText: string) => boolean)) => boolean;
  /** The real-home paths of the calls that match and name one: the user-scope reads that would have satisfied the condition. */
  userMentions: (match: string | ((argsText: string) => boolean)) => string[];
  /** The tool name of every started call, in order. */
  toolNames: string[];
  /** Whether a started read call opens `rel` under the workspace or the fixture HOME. */
  fixtureRead: (rel: string) => boolean;
  /** The real-home paths of read calls that open `rel` there: the user-scope reads that would have satisfied the condition. */
  userReads: (rel: string) => string[];
  /** One line for the TAP: what the stream reports about the user scope, and the real-home paths tool calls named. */
  diagnostic: string;
};

type Counted = { name: string; text: string; paths: string[]; user: string[] };

const strings = (v: unknown, out: string[] = []): string[] => {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v !== null && typeof v === "object") for (const x of Object.values(v)) strings(x, out);
  return out;
};

const isUnder = (p: string, root: string) => {
  const rel = relative(root, p);
  return rel === "" || !(rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel));
};

/** The path with symlinks resolved, through its longest existing ancestor, so /var and /private/var name the same place. */
function canon(p: string): string {
  const rest: string[] = [];
  let cur = resolve(p);
  while (!existsSync(cur) && dirname(cur) !== cur) {
    rest.unshift(cur.slice(dirname(cur).length + 1));
    cur = dirname(cur);
  }
  try {
    return join(realpathSync(cur), ...rest);
  } catch {
    return resolve(p);
  }
}

const HOME_WORD = /^(~[A-Za-z_][\w.-]*|~|\$HOME|\$\{HOME\})(?=\/|$)/;

/** `~`, `$HOME` and `~user` all name a real home: another user's home is never a fixture path. */
const expandHome = (token: string, home: string) => token.replace(HOME_WORD, home);

function pathsIn(s: string, dir: string, home: string): string[] {
  const out: string[] = [];
  let cwd = dir;
  for (const segment of s.split(/&&|\|\||[;|\n]/)) {
    const cd = segment.replace(/["'`]/g, "").trim().match(/^cd(?:\s+(\S+))?$/);
    if (cd) cwd = cd[1] === undefined ? home : resolve(cwd, expandHome(cd[1], home));
    for (const token of segment.split(/[\s"'`&()<>=,:]+/)) {
      if (!token.includes("/") && !(token === "~" || /^~[A-Za-z_][\w.-]*$/.test(token) || ["$HOME", "${HOME}"].includes(token))) continue;
      out.push(resolve(cwd, expandHome(token, home)));
    }
  }
  return out;
}

/**
 * A tool call reads dir/file when it names the path, or when it changes into dir and names the file, as in
 * `cd .claude/skills/craft && cat hub.md`. A call that only names the file there (`wc -l hub.md`) counts too.
 */
export function readsPath(t: string, needle: string) {
  if (t.includes(needle)) return true;
  const at = needle.lastIndexOf("/");
  const dir = needle.slice(0, at).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\bcd [^;&|]*/${dir}(?=[\\s"';&|])`).test(t) && t.includes(needle.slice(at + 1));
}

const nameOf = (item: any): string => (typeof item === "string" ? item : typeof item?.name === "string" ? item.name : typeof item?.id === "string" ? item.id : "?");

const CURSOR_NAME_KEYS = ["rules", "agents", "subagents", "skills", "commands", "slash_commands", "plugins", "mcp_servers", "mcpServers", "mcp"];

/** cursor-agent stream-json: a `tool_call` event with subtype `started` per call; the init event may list user-scope names. */
export const CURSOR: Dialect = {
  harness: "cursor",
  calls: (events) => events.flatMap((e) => {
    const c = e?.subtype === "started" ? cursorCall(e) : undefined;
    return c ? [{ name: c.name, args: c.call.args ?? null }] : [];
  }),
  readTools: ["readToolCall"],
  scope: (events) => {
    const init = events.find((e) => e?.type === "system" && e.subtype === "init");
    if (!init) return "no init event in the stream";
    const names = CURSOR_NAME_KEYS.filter((k) => k in init).map((k) => {
      const v = init[k];
      const listed = Array.isArray(v) ? v.map(nameOf) : v !== null && typeof v === "object" ? Object.keys(v) : [];
      return `${k}: ${listed.length ? listed.join(", ") : "none"}`;
    });
    return names.length ? `init reports ${names.join("; ")}` : `init exposes no rules, agents or MCP servers (init keys: ${Object.keys(init).join(", ")})`;
  },
};

/**
 * agy stream-json (https://antigravity.google/docs/cli/headless/): a `step_update` event per step transition. A tool step has
 * `step_type: "tool"`, `tool_name` and `tool_info.parameters`; a step that spawns a subagent carries `subagent_info`. A step
 * arrives as ACTIVE and as DONE, so each `step_index` counts once.
 */
export const ANTIGRAVITY: Dialect = {
  harness: "antigravity",
  calls: (events) => {
    const seen = new Set<number>();
    return events.flatMap((e) => {
      const s = e?.event === "step_update" ? e.step_update : undefined;
      if (!s || seen.has(s.step_index)) return [];
      if (s.subagent_info !== undefined) {
        seen.add(s.step_index);
        return [{ name: s.tool_name ?? "invoke_subagent", args: s.subagent_info }];
      }
      if (s.step_type !== "tool") return [];
      seen.add(s.step_index);
      return [{ name: s.tool_name ?? s.tool_info?.name ?? "?", args: s.tool_info?.parameters ?? null }];
    });
  },
  readTools: ["view_file"],
  scope: (events) => {
    const init = events.find((e) => e?.event === "init")?.init;
    if (!init) return "no init event in the stream";
    return `init lists ${Array.isArray(init.tools) ? init.tools.length : 0} tools and no rules, skills or agents (init keys: ${Object.keys(init).join(", ")})`;
  },
};

/**
 * Read a stream-json stdout for the real-home paths its tool calls name. A call that names one never counts toward a pass
 * condition (mentions, fixtureRead), whatever else it names. With t, the diagnostic line goes into the TAP.
 */
export function pathGuard(dialect: Dialect, stdout: string, scope: GuardScope, t?: Pick<TestContext, "diagnostic">): PathGuard {
  const real = scope.realHome ?? operatorHome();
  const realCanon = canon(real);
  const fixtureRoots = [scope.dir, scope.home].filter((x): x is string => typeof x === "string").map(canon);
  const events = parseJsonl(stdout);
  const calls: Counted[] = dialect.calls(events).map((c) => {
    const paths = strings(c.args).flatMap((s) => pathsIn(s, scope.dir, real));
    const user = paths.filter((p) => isUnder(canon(p), realCanon) && !fixtureRoots.some((r) => isUnder(canon(p), r)));
    return { name: c.name, text: JSON.stringify(c.args ?? null), paths, user };
  });
  const userPaths = [...new Set(calls.flatMap((c) => c.user))].sort();
  const counted = calls.filter((c) => c.user.length === 0);
  const reads = (c: Counted) => dialect.readTools.includes(c.name);
  const matches = (match: string | ((argsText: string) => boolean)) => (c: Counted) => (typeof match === "string" ? c.text.includes(match) : match(c.text));
  const diagnostic = `${dialect.harness} user scope: ${dialect.scope(events)}; user-scope paths named by tool calls: ${userPaths.length ? userPaths.join(", ") : "none"}`;
  t?.diagnostic(diagnostic);
  return {
    harness: dialect.harness,
    events,
    userPaths,
    mentions: (match) => counted.some(matches(match)),
    userMentions: (match) => [...new Set(calls.filter((c) => c.user.length > 0 && matches(match)(c)).flatMap((c) => c.user))].sort(),
    toolNames: calls.map((c) => c.name),
    fixtureRead: (rel) => counted.some((c) => reads(c) && c.paths.some((p) => fixtureRoots.some((r) => resolve(r, rel) === canon(p)))),
    userReads: (rel) => [...new Set(calls.filter(reads).flatMap((c) => c.user.filter((p) => canon(p) === canon(resolve(real, rel)))))].sort(),
    diagnostic,
  };
}

/**
 * Fail unless a tool call that names no real-home path matches. When only calls that name a real-home path match, the pass
 * would come from the user scope, and the message names those paths. @param what names the condition in the failure message
 */
export function assertMention(g: PathGuard, match: string | ((argsText: string) => boolean), what: string = typeof match === "string" ? match : "the condition") {
  if (g.mentions(match)) return;
  const paths = g.userMentions(match);
  if (paths.length) throw new Error(`${g.harness}: the pass depends on the user scope: a tool call names ${what} only through the real-home path ${paths.join(", ")}`);
  throw new Error(`${g.harness}: no tool call names ${what} (tool calls: ${[...new Set(g.toolNames)].join(", ") || "none"})`);
}

/** Fail unless a started read call that names no real-home path opens `rel` under the workspace or the fixture HOME. */
export function assertRead(g: PathGuard, rel: string) {
  if (g.fixtureRead(rel)) return;
  const paths = g.userReads(rel);
  if (paths.length) throw new Error(`${g.harness}: the pass depends on the user scope: the session read the real-home path ${paths.join(", ")} and never opened ${rel} in the fixture`);
  throw new Error(`${g.harness}: no read call opens ${rel} in the fixture (tool calls: ${[...new Set(g.toolNames)].join(", ") || "none"}; user-scope paths named: ${g.userPaths.join(", ") || "none"})`);
}

/** The last successful result event of a Cursor stream-json run, or null on a failed exit or an error result. */
export function cursorResult(stdout: string, code: number | null): string | null {
  const last = parseJsonl(stdout).filter((e) => e?.type === "result").at(-1);
  return code === 0 && last && last.is_error !== true && typeof last.result === "string" ? last.result : null;
}

/** Run one headless cursor-agent turn with stream-json output, so the stream shows its tool calls. The binary must not be a stub. */
export async function runCursor(prompt: string, scope: GuardScope, timeoutMs = 300_000) {
  const a = harnessArgv("cursor", prompt, { dir: scope.dir, home: scope.home });
  const at = a.args.indexOf("--output-format");
  a.args.splice(at, 2, "--output-format", "stream-json");
  try {
    const r = await run({ ...a, bin: realBin(a.bin, a.env.PATH), timeoutMs });
    return { ...r, reply: cursorResult(r.stdout, r.code) };
  } finally {
    a.cleanup();
  }
}

/** The agy result event: its status, its response on success, and its error text on failure. */
export function agyResult(stdout: string): { status: string; response: string | null; error: string | null } | null {
  const r = parseJsonl(stdout).filter((e) => e?.event === "result").at(-1)?.result;
  if (!r || typeof r.status !== "string") return null;
  return { status: r.status, response: r.status === "ERROR" ? null : typeof r.response === "string" ? r.response : null, error: typeof r.error === "string" ? r.error : null };
}

/**
 * Run one headless agy turn in scope.dir with stream-json output and terminal restrictions (`--sandbox`). agy has no
 * workspace flag, so the cwd is the workspace, and it has no config-dir flag, so it reads the real HOME. The binary must not be a stub.
 */
export async function runAgy(prompt: string, scope: GuardScope, timeoutMs = 300_000) {
  const env = scrubEnv(process.env);
  const args = ["-p", prompt, "--output-format", "stream-json", "--sandbox", "--print-timeout", `${Math.floor(timeoutMs / 1000) - 10}s`];
  const r = await run({ bin: realBin("agy", env.PATH), args, cwd: scope.dir, env, timeoutMs, input: "" });
  return { ...r, result: agyResult(r.stdout) };
}
