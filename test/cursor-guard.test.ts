import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { assertCursorMention, assertCursorRead, cursorGuard, cursorResult, readsPath } from "./helpers/cursor-guard.ts";

const REAL = "/home/operator";
const DIR = "/tmp/rig-seed-abc";
const HOME = "/tmp/rig-fixture-xyz/home";
const scope = { dir: DIR, home: HOME, realHome: REAL };

const started = (tool: string, args: object) => ({ type: "tool_call", subtype: "started", call_id: "1", tool_call: { [tool]: { args } } });
const init = (extra: object = {}) => ({ type: "system", subtype: "init", apiKeySource: "login", cwd: DIR, model: "m", permissionMode: "default", ...extra });
const stream = (...events: object[]) => events.map((e) => JSON.stringify(e)).join("\n");

describe("cursor guard: reads that satisfy a pass condition", () => {
  test("a read of a fixture workspace path passes", () => {
    const g = cursorGuard(stream(init(), started("readToolCall", { path: `${DIR}/.cursor/skills/craft/hub.md` })), scope);
    assertCursorMention(g, "craft/hub.md");
    assert.deepEqual(g.userPaths, []);
  });

  test("a read of a fixture HOME mirror path passes", () => {
    const g = cursorGuard(stream(started("readToolCall", { path: `${HOME}/.cursor/skills/craft/hub.md` })), scope);
    assertCursorMention(g, "craft/hub.md");
  });

  test("a relative path resolves against the workspace and passes", () => {
    const g = cursorGuard(stream(started("readToolCall", { path: ".cursor/skills/craft/hub.md" })), scope);
    assertCursorMention(g, "craft/hub.md");
  });

  test("a shell command that changes into a fixture dir passes", () => {
    const g = cursorGuard(stream(started("shellToolCall", { command: `cd ${DIR}/.cursor/skills/craft && cat hub.md` })), scope);
    assertCursorMention(g, (text) => text.includes("hub.md"));
  });

  test("a Task prompt that names a fixture path passes", () => {
    const g = cursorGuard(stream(started("taskToolCall", { prompt: `Read ${DIR}/.cursor/skills/craft/hub.md first, and/or the notes.` })), scope);
    assertCursorMention(g, "craft/hub.md");
  });

  test("a real ~/.cursor/rules/x.mdc read that satisfies the condition fails and names the path", () => {
    const g = cursorGuard(stream(started("readToolCall", { path: `${REAL}/.cursor/rules/x.mdc` })), scope);
    assert.throws(() => assertCursorMention(g, "rules/x.mdc"), (err: Error) => err.message.includes(`${REAL}/.cursor/rules/x.mdc`) && /user scope/.test(err.message));
    assert.deepEqual(g.userPaths, [`${REAL}/.cursor/rules/x.mdc`]);
  });

  test("a ~/ path in a shell command is the real home", () => {
    const g = cursorGuard(stream(started("shellToolCall", { command: "cat ~/.agents/skills/craft/hub.md" })), scope);
    assert.throws(() => assertCursorMention(g, "craft/hub.md"), new RegExp(`${REAL}/\\.agents/skills/craft/hub\\.md`));
  });

  test("$HOME and ${HOME} in a shell command are the real home", () => {
    const g = cursorGuard(stream(started("shellToolCall", { command: 'cat "$HOME/.cursor/rules/a.mdc" "${HOME}/.cursor/rules/b.mdc"' })), scope);
    assert.deepEqual(g.userPaths, [`${REAL}/.cursor/rules/a.mdc`, `${REAL}/.cursor/rules/b.mdc`]);
  });

  test("a path under .. that leaves the workspace into the real home is the real home", () => {
    const g = cursorGuard(stream(started("readToolCall", { path: `${DIR}/../../..${REAL}/.cursor/rules/x.mdc` })), scope);
    assert.deepEqual(g.userPaths, [`${REAL}/.cursor/rules/x.mdc`]);
  });

  test("a read in the real home outside the dot-dirs is the real home too", () => {
    const g = cursorGuard(stream(started("readToolCall", { path: `${REAL}/rnd/rig/skills/craft/hub.md` })), scope);
    assert.throws(() => assertCursorMention(g, "craft/hub.md"), /user scope/);
  });

  test("a glob on the real ~/.cursor names its targetDirectory", () => {
    const g = cursorGuard(stream(started("globToolCall", { targetDirectory: `${REAL}/.cursor/rules`, globPattern: "*" })), scope);
    assert.deepEqual(g.userPaths, [`${REAL}/.cursor/rules`]);
  });

  test("a fixture read and a user-scope read together: the fixture read satisfies the condition", () => {
    const g = cursorGuard(stream(
      started("readToolCall", { path: `${REAL}/.cursor/skills/craft/hub.md` }),
      started("readToolCall", { path: `${DIR}/.cursor/skills/craft/hub.md` }),
    ), scope);
    assertCursorMention(g, "craft/hub.md");
    assert.deepEqual(g.userPaths, [`${REAL}/.cursor/skills/craft/hub.md`]);
  });

  test("one call that names a fixture path and a user-scope path does not count", () => {
    const g = cursorGuard(stream(started("shellToolCall", { command: `diff ${DIR}/.cursor/rules/a.mdc ${REAL}/.cursor/rules/a.mdc` })), scope);
    assert.throws(() => assertCursorMention(g, "rules/a.mdc"), /user scope/);
  });

  test("a prefix of the real home that is not inside it is not the real home", () => {
    const g = cursorGuard(stream(started("readToolCall", { path: `${REAL}-other/.cursor/rules/x.mdc` })), scope);
    assert.deepEqual(g.userPaths, []);
  });

  test("a path outside the real home and the fixture is ignored", () => {
    const g = cursorGuard(stream(started("taskToolCall", { prompt: "Run /craft on https://example.com/a/b and read /etc/hosts" })), scope);
    assert.deepEqual(g.userPaths, []);
  });

  test("a stream with no call that names the needle fails without blaming user scope", () => {
    const g = cursorGuard(stream(started("readToolCall", { path: `${DIR}/notes/answer.txt` })), scope);
    assert.throws(() => assertCursorMention(g, "craft/hub.md"), (err: Error) => /no tool call names/.test(err.message) && !/user scope/.test(err.message));
  });

  test("only started events count: a completed event does not satisfy the condition", () => {
    const completed = { type: "tool_call", subtype: "completed", call_id: "1", tool_call: { readToolCall: { args: { path: `${DIR}/craft/hub.md` }, result: { success: {} } } } };
    assert.throws(() => assertCursorMention(cursorGuard(stream(completed), scope), "craft/hub.md"), /no tool call names/);
  });

  test("message text is never read as a tool path", () => {
    const g = cursorGuard(stream({ type: "assistant", message: { content: [{ type: "text", text: `see ${REAL}/.cursor/rules/x.mdc` }] } }), scope);
    assert.deepEqual(g.userPaths, []);
  });

  test("a real-home path that no call names for the needle is only reported", () => {
    const g = cursorGuard(stream(started("readToolCall", { path: `${REAL}/.cursor/rules/user.mdc` }), started("readToolCall", { path: `${DIR}/craft/hub.md` })), scope);
    assertCursorMention(g, "craft/hub.md");
    assert.deepEqual(g.userPaths, [`${REAL}/.cursor/rules/user.mdc`]);
  });
});

describe("cursor guard: reads of one fixture file", () => {
  test("fixtureRead is true for a read under the workspace and false for the same file in the real home", () => {
    const rel = ".cursor/rules/rig-frame.mdc";
    assert.equal(cursorGuard(stream(started("readToolCall", { path: `${DIR}/${rel}` })), scope).fixtureRead(rel), true);
    assert.equal(cursorGuard(stream(started("readToolCall", { path: rel })), scope).fixtureRead(rel), true);
    assert.equal(cursorGuard(stream(started("readToolCall", { path: `${REAL}/${rel}` })), scope).fixtureRead(rel), false);
  });

  test("assertCursorRead passes on a fixture read and fails on the real-home copy, naming it", () => {
    const rel = ".cursor/rules/rig-frame.mdc";
    assertCursorRead(cursorGuard(stream(started("readToolCall", { path: `${DIR}/${rel}` })), scope), rel);
    const g = cursorGuard(stream(started("readToolCall", { path: `${REAL}/${rel}` })), scope);
    assert.throws(() => assertCursorRead(g, rel), (err: Error) => err.message.includes(`${REAL}/${rel}`) && /user scope/.test(err.message));
  });

  test("assertCursorRead fails without blaming user scope when no read opens the file", () => {
    const g = cursorGuard(stream(started("readToolCall", { path: `${DIR}/notes/a.txt` })), scope);
    assert.throws(() => assertCursorRead(g, ".cursor/rules/rig-frame.mdc"), (err: Error) => /no read call opens/.test(err.message) && !/depends on the user scope/.test(err.message));
  });

  test("a read of the fixture file plus the real-home copy still passes", () => {
    const rel = ".cursor/rules/rig-frame.mdc";
    const g = cursorGuard(stream(started("readToolCall", { path: `${REAL}/${rel}` }), started("readToolCall", { path: `${DIR}/${rel}` })), scope);
    assertCursorRead(g, rel);
    assert.deepEqual(g.userPaths, [`${REAL}/${rel}`]);
  });

  test("fixtureRead ignores a call that is not a read", () => {
    assert.equal(cursorGuard(stream(started("globToolCall", { targetDirectory: `${DIR}/.cursor/rules`, globPattern: "*" })), scope).fixtureRead(".cursor/rules/rig-frame.mdc"), false);
  });
});

describe("cursor guard: path spellings of the same location", () => {
  test("a read through a symlink of the fixture root still counts as a fixture read", () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "rig-guard-")));
    const real = join(base, "real");
    mkdirSync(join(real, ".cursor/rules"), { recursive: true });
    symlinkSync(real, join(base, "link"));
    const rel = ".cursor/rules/rig-frame.mdc";
    const g = cursorGuard(stream(started("readToolCall", { path: join(base, "link", rel) })), { dir: real, realHome: REAL });
    assert.equal(g.fixtureRead(rel), true);
    const h = cursorGuard(stream(started("readToolCall", { path: join(real, rel) })), { dir: join(base, "link"), realHome: REAL });
    assert.equal(h.fixtureRead(rel), true);
  });

  test("a /var path matches a fixture root spelled /private/var", () => {
    const rel = ".cursor/rules/rig-frame.mdc";
    const g = cursorGuard(stream(started("readToolCall", { path: `/var/rig-nonexistent/dir/${rel}` })), { dir: "/private/var/rig-nonexistent/dir", realHome: REAL });
    if (realpathSync("/var") === "/private/var") assert.equal(g.fixtureRead(rel), true);
  });

  test("~user is another user's home, never a fixture path", () => {
    const g = cursorGuard(stream(started("shellToolCall", { command: "cat ~op/.agents/skills/craft/hub.md" })), scope);
    assert.equal(g.mentions("hub.md"), false);
    assert.deepEqual(g.userPaths, [`${REAL}/.agents/skills/craft/hub.md`]);
    assert.throws(() => assertCursorMention(g, "craft/hub.md"), /user scope/);
  });

  test("a bare cd moves into the real home for the rest of the command", () => {
    const g = cursorGuard(stream(started("shellToolCall", { command: "cd && cat .agents/skills/craft/hub.md" })), scope);
    assert.deepEqual(g.userPaths, [`${REAL}/.agents/skills/craft/hub.md`]);
    assert.equal(g.mentions("hub.md"), false);
  });

  test("cd ~, cd $HOME and cd ~user move into a real home", () => {
    for (const cd of ["cd ~", "cd $HOME", "cd ${HOME}", "cd; ", "cd ~op"]) {
      const g = cursorGuard(stream(started("shellToolCall", { command: `${cd.replace(/;\s*$/, "")} && cat .cursor/rules/a.mdc` })), scope);
      assert.ok(g.userPaths.includes(`${REAL}/.cursor/rules/a.mdc`), cd);
      assert.equal(g.mentions("a.mdc"), false, cd);
    }
  });

  test("a cd into the real home does not leak into the next command", () => {
    const g = cursorGuard(stream(started("shellToolCall", { command: "cd ~; cat .cursor/rules/a.mdc" }), started("shellToolCall", { command: "cat .cursor/rules/b.mdc" })), scope);
    assert.ok(g.userPaths.includes(`${REAL}/.cursor/rules/a.mdc`));
    assert.ok(!g.userPaths.some((p) => p.endsWith("b.mdc")));
    assert.equal(g.mentions("b.mdc"), true);
  });

  test("cd into a fixture dir then a relative read stays a fixture read", () => {
    const g = cursorGuard(stream(started("shellToolCall", { command: `cd ${DIR} && cat .cursor/rules/a.mdc` })), scope);
    assert.deepEqual(g.userPaths, []);
    assert.equal(g.mentions("a.mdc"), true);
  });
});

describe("readsPath", () => {
  test("it accepts the path, the cd form and a bare file name after a cd", () => {
    assert.equal(readsPath("cat .claude/skills/craft/hub.md", "craft/hub.md"), true);
    assert.equal(readsPath("cd .claude/skills/craft && cat hub.md", "craft/hub.md"), true);
    assert.equal(readsPath("cd .claude/skills/other && cat hub.md", "craft/hub.md"), false);
  });
});

describe("cursor guard: the diagnostic line", () => {
  test("it says so when the stream exposes no user-scope names, and names the init keys", () => {
    const g = cursorGuard(stream(init()), scope);
    assert.match(g.diagnostic, /exposes no rules, agents or MCP servers/);
    assert.match(g.diagnostic, /apiKeySource/);
    assert.match(g.diagnostic, /user-scope paths named by tool calls: none/);
  });

  test("it lists the names, not the contents, that the init event reports", () => {
    const g = cursorGuard(stream(init({
      rules: [{ name: "user.mdc", content: "SECRET BODY" }, "rig-frame.mdc"],
      agents: [{ name: "poteto-agent", prompt: "SECRET BODY" }],
      mcp_servers: [{ name: "alpha", command: "SECRET BODY" }, { name: "beta" }],
    })), scope);
    assert.match(g.diagnostic, /rules: user\.mdc, rig-frame\.mdc/);
    assert.match(g.diagnostic, /agents: poteto-agent/);
    assert.match(g.diagnostic, /mcp_servers: alpha, beta/);
    assert.doesNotMatch(g.diagnostic, /SECRET BODY/);
  });

  test("an object keyed by name reports its keys", () => {
    const g = cursorGuard(stream(init({ mcpServers: { alpha: { command: "SECRET BODY" }, beta: {} } })), scope);
    assert.match(g.diagnostic, /mcpServers: alpha, beta/);
    assert.doesNotMatch(g.diagnostic, /SECRET BODY/);
  });

  test("it lists the user-scope paths that tool calls named", () => {
    const g = cursorGuard(stream(init(), started("readToolCall", { path: `${REAL}/.cursor/rules/x.mdc` })), scope);
    assert.match(g.diagnostic, new RegExp(`user-scope paths named by tool calls: ${REAL}/\\.cursor/rules/x\\.mdc`));
  });

  test("a stream with no init event is reported as such", () => {
    assert.match(cursorGuard(stream(), scope).diagnostic, /no init event/);
  });
});

describe("cursorResult", () => {
  test("it returns the last successful result event", () => {
    assert.equal(cursorResult(stream({ type: "result", is_error: false, result: "a" }, { type: "result", is_error: false, result: "b" }), 0), "b");
  });

  test("it returns null for an error result or a failed exit", () => {
    assert.equal(cursorResult(stream({ type: "result", is_error: true, result: "a" }), 0), null);
    assert.equal(cursorResult(stream({ type: "result", is_error: false, result: "a" }), 1), null);
    assert.equal(cursorResult(stream(init()), 0), null);
  });
});
