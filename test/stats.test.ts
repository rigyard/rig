// Slice 5 done-checks for rig stats, --suggest and the session-end hook: the json-element primitive (S5.5, S5.8),
// the hook element through plan and apply (S5.5), the proposal (S5.6), the canary over the state root (S5.2), and
// the transcript roots of the target records. CLI cases run bin/rig.ts over a fixture HOME whose repo config root
// (RIG_ROOT) is a temp copy of this repo's data.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { propose } from "../lib/metrics/propose.ts";
import { renderReport } from "../lib/metrics/report.ts";
import { patch } from "../lib/targets.ts";
import { treeHash } from "../lib/tree.ts";
import { gitEnv } from "../lib/lock/git.ts";
import { makeFixtureHome } from "./helpers/fixture-home.ts";
import { CANARY } from "./metrics.helpers.ts";
import { stubPstack } from "./pstack.helpers.ts";
import { authoredEntry } from "./world.helpers.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BIN = join(ROOT, "bin/rig.ts");
const NOW = "2026-11-05T12:00:00.000Z";
const METRICS = join(ROOT, "test/fixtures/metrics");
const STATE = ".local/state/rig/";
const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b);
const canon = (v) => `${JSON.stringify(v, null, 2)}\n`;

// ---------------------------------------------------------------- the json-element primitive

const ID = "/usr/local/bin/node /opt/rig/bin/rig.ts stats --record";
const CLAUDE_ELEMENT = { hooks: [{ type: "command", command: ID }] };
const claudeEntry = (extra = {}) => ({ kind: "json-element", path: "/h/.claude/settings.json", pointer: "/hooks/SessionEnd", id: ID, value: CLAUDE_ELEMENT, unit: "core/session-end", ...extra });

/** A canonical settings.json with foreign hooks in two events, one foreign SessionEnd element, and other keys. */
const SETTINGS = canon({
  env: { DO_NOT_TRACK: "1" },
  hooks: {
    SessionStart: [{ matcher: "startup", hooks: [{ type: "command", command: "echo hello", timeout: 5 }] }],
    SessionEnd: [{ hooks: [{ type: "command", command: "my-logger --end" }] }],
    Stop: [{ hooks: [{ type: "command", command: "say done" }] }],
  },
  theme: "dark",
});

/** SETTINGS with rig's element appended after the foreign SessionEnd element: the snapshot of an insert. */
const SETTINGS_WITH_RIG = `{
  "env": {
    "DO_NOT_TRACK": "1"
  },
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": "echo hello",
            "timeout": 5
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "my-logger --end"
          }
        ]
      },
      {
        "hooks": [
          {
            "type": "command",
            "command": "${ID}"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "say done"
          }
        ]
      }
    ]
  },
  "theme": "dark"
}
`;

/** Lines of `after` that `before` lacks, in order, when `after` only inserts lines into `before`. Null otherwise. */
function insertedLines(before, after) {
  const a = before.split("\n");
  const b = after.split("\n");
  const added = [];
  let i = 0;
  for (const line of b) {
    if (i < a.length && line === a[i]) i++;
    else added.push(line);
  }
  return i === a.length ? added : null;
}

describe("json-element patch (targets.patch)", () => {
  test("insert into a settings.json with foreign hooks keeps every other byte", () => {
    const r = patch(enc(SETTINGS), claudeEntry());
    assert.equal(r.error, undefined);
    assert.equal(r.current, null, "absent before the insert");
    assert.equal(dec(r.next), SETTINGS_WITH_RIG);
    // Every original line survives in order; the only additions are the element lines and the comma that joins it.
    const added = insertedLines(SETTINGS.replace('      }\n    ],\n    "Stop"', '      },\n    ],\n    "Stop"'), dec(r.next));
    assert.ok(added, "the original lines are a subsequence of the result");
    assert.deepEqual(added.map((l) => l.trim()), ["{", '"hooks": [', "{", '"type": "command",', `"command": "${ID}"`, "}", "]", "}"]);
  });

  test("remove restores the original bytes; insert on the result is a no-op that returns the element", () => {
    const inserted = patch(enc(SETTINGS), claudeEntry()).next;
    const again = patch(inserted, claudeEntry());
    assert.deepEqual(again.current, CLAUDE_ELEMENT);
    assert.equal(dec(again.next), dec(inserted), "a second insert gives the same bytes");
    const removed = patch(inserted, { ...claudeEntry(), value: undefined, remove: true });
    assert.equal(removed.error, undefined);
    assert.deepEqual(removed.current, CLAUDE_ELEMENT);
    assert.equal(dec(removed.next), SETTINGS);
  });

  test("an element that differs only in key order is found and left as it is", () => {
    const reordered = SETTINGS_WITH_RIG.replace(`"type": "command",\n            "command": "${ID}"`, `"command": "${ID}",\n            "type": "command"`);
    assert.notEqual(reordered, SETTINGS_WITH_RIG);
    const r = patch(enc(reordered), claudeEntry());
    assert.equal(dec(r.next), reordered);
  });

  test("a file that does not round-trip blocks with E_JSON_ROUNDTRIP and a snippet, and keeps its bytes", () => {
    const fourSpaces = `${JSON.stringify(JSON.parse(SETTINGS), null, 4)}\n`;
    // An integer-like key would move to the front on parse: the precondition catches the reorder before any write.
    const intKey = '{\n  "theme": "dark",\n  "1": true\n}\n';
    for (const text of [fourSpaces, "{ not json", SETTINGS.trimEnd(), intKey]) {
      const r = patch(enc(text), claudeEntry());
      assert.equal(r.error?.code, "E_JSON_ROUNDTRIP", text.slice(0, 20));
      assert.ok(r.error.message.includes(JSON.stringify(CLAUDE_ELEMENT, null, 2)), "the message carries the element to paste");
      assert.match(r.error.message, /\/hooks\/SessionEnd/);
      assert.equal(dec(r.next), text, "next is the current bytes");
    }
  });

  test("an absent file gets a canonical document; missing containers are created", () => {
    const r = patch(null, claudeEntry());
    assert.equal(dec(r.next), canon({ hooks: { SessionEnd: [CLAUDE_ELEMENT] } }));
    const r2 = patch(enc(canon({ theme: "dark" })), claudeEntry());
    assert.equal(dec(r2.next), canon({ theme: "dark", hooks: { SessionEnd: [CLAUDE_ELEMENT] } }));
    assert.equal(patch(null, { ...claudeEntry(), remove: true }).current, null);
  });

  test("remove leaves an emptied array in place: rig cannot tell who created it", () => {
    const inserted = patch(enc(canon({ theme: "dark" })), claudeEntry()).next;
    const removed = patch(inserted, { ...claudeEntry(), remove: true });
    assert.equal(dec(removed.next), canon({ theme: "dark", hooks: { SessionEnd: [] } }));
  });

  test("a non-object on the pointer path and a non-array target are E_LOCATOR", () => {
    for (const v of [{ hooks: [] }, { hooks: { SessionEnd: {} } }]) {
      const r = patch(enc(canon(v)), claudeEntry());
      assert.equal(r.error?.code, "E_LOCATOR", JSON.stringify(v));
    }
  });

  test("several rig elements converge to one: the exact match stays, the others go, foreign entries keep their order", () => {
    const foreign = { hooks: [{ type: "command", command: "my-logger --end" }] };
    const stale = { hooks: [{ type: "command", command: "/usr/local/bin/node /old/checkout/bin/rig.ts stats --record" }] };
    for (const list of [[foreign, stale, CLAUDE_ELEMENT], [stale, foreign, CLAUDE_ELEMENT, stale], [foreign, CLAUDE_ELEMENT, CLAUDE_ELEMENT]]) {
      const text = canon({ hooks: { SessionEnd: list } });
      const r = patch(enc(text), claudeEntry());
      assert.equal(r.error, undefined, JSON.stringify(list));
      assert.deepEqual(r.current, CLAUDE_ELEMENT, "current is the kept element");
      assert.deepEqual(JSON.parse(dec(r.next)).hooks.SessionEnd, [foreign, CLAUDE_ELEMENT].sort((a, b) => list.indexOf(a) - list.indexOf(b)), JSON.stringify(list));
      assert.equal(dec(patch(r.next, claudeEntry()).next), dec(r.next), "run twice, same bytes");
      const removed = patch(enc(text), { ...claudeEntry(), remove: true });
      assert.deepEqual(JSON.parse(dec(removed.next)).hooks.SessionEnd, [foreign], "remove takes every rig element");
    }
  });

  test("with no exact match, several stale rig elements converge to the last one (what old --repair recorded), rewritten in place", () => {
    const stale = (path: string) => ({ hooks: [{ type: "command", command: `/usr/local/bin/node ${path} stats --record` }] });
    const foreign = { hooks: [{ type: "command", command: "my-logger --end" }] };
    const text = canon({ hooks: { SessionEnd: [stale("/a/bin/rig.ts"), foreign, stale("/b/bin/rig.ts")] } });
    const r = patch(enc(text), claudeEntry());
    assert.deepEqual(r.current, stale("/b/bin/rig.ts"));
    assert.deepEqual(JSON.parse(dec(r.next)).hooks.SessionEnd, [foreign, CLAUDE_ELEMENT]);
  });

  test("a foreign group that also runs rig's command is not rig's element: it stays, rig adds its own", () => {
    const group = { hooks: [{ type: "command", command: ID }, { type: "command", command: "my-logger --end" }] };
    const text = canon({ hooks: { SessionEnd: [group] } });
    const r = patch(enc(text), claudeEntry());
    assert.equal(r.current, null);
    assert.deepEqual(JSON.parse(dec(r.next)).hooks.SessionEnd, [group, CLAUDE_ELEMENT]);
    assert.equal(dec(patch(enc(text), { ...claudeEntry(), remove: true }).next), text, "remove leaves the foreign group");
  });

  test("the same primitive on a Cursor hooks.json keeps every foreign entry's value and order (S5.8)", () => {
    const hooksJson = canon({
      version: 1,
      hooks: {
        afterFileEdit: [{ command: "./hooks/format.sh" }],
        sessionEnd: [{ command: "./hooks/audit.sh" }, { command: "./hooks/notify.sh" }],
        stop: [{ command: "./hooks/stop.sh" }],
      },
    });
    const entry = { kind: "json-element", path: "/h/.cursor/hooks.json", pointer: "/hooks/sessionEnd", id: ID, value: { command: ID }, unit: "core/session-end" };
    const once = patch(enc(hooksJson), entry);
    assert.equal(once.error, undefined);
    const v = JSON.parse(dec(once.next));
    const before = JSON.parse(hooksJson);
    assert.deepEqual(v.hooks.sessionEnd, [...before.hooks.sessionEnd, { command: ID }]);
    assert.deepEqual(Object.keys(v.hooks), Object.keys(before.hooks), "key order kept");
    assert.deepEqual({ ...v, hooks: { ...v.hooks, sessionEnd: before.hooks.sessionEnd } }, before, "every foreign entry keeps its value");
    assert.equal(v.hooks.sessionEnd.filter((e) => e.command === ID).length, 1, "exactly one rig element");
    assert.ok(insertedLines(hooksJson.replace('"./hooks/notify.sh"\n      }', '"./hooks/notify.sh"\n      },'), dec(once.next)));
    assert.equal(dec(patch(once.next, entry).next), dec(once.next), "run twice, same bytes");
  });

  test("a Cursor hooks.json with a stale and a current rig element converges to the current one", () => {
    const stale = { command: "/usr/local/bin/node /old/checkout/bin/rig.ts stats --record" };
    const text = canon({ version: 1, hooks: { sessionEnd: [{ command: "./hooks/audit.sh" }, stale, { command: ID }] } });
    const entry: any = { kind: "json-element", path: "/h/.cursor/hooks.json", pointer: "/hooks/sessionEnd", id: ID, value: { command: ID }, unit: "core/session-end" };
    const r = patch(enc(text), entry);
    assert.equal(r.error, undefined);
    assert.deepEqual(JSON.parse(dec(r.next)).hooks.sessionEnd, [{ command: "./hooks/audit.sh" }, { command: ID }]);
    assert.deepEqual(JSON.parse(dec(patch(enc(text), { ...entry, remove: true }).next)).hooks.sessionEnd, [{ command: "./hooks/audit.sh" }]);
  });
});

// ---------------------------------------------------------------- CLI fixtures

/** @param {string} dir @returns {{path: string, mode: number, bytes: Buffer}[]} */
function filesUnder(dir, rel = "") {
  const out = [];
  for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...filesUnder(dir, r));
    else out.push({ path: r, mode: statSync(join(dir, r)).mode & 0o777, bytes: readFileSync(join(dir, r)) });
  }
  return out;
}

/** The fixture transcripts of each harness, placed at the transcript root its target record names. */
const TRANSCRIPTS = { claude: [".claude/projects", "claude/projects"], codex: [".codex/sessions", "codex/sessions"], omp: [".omp/agent/sessions", "omp/sessions"], cursor: [".cursor/projects", "cursor/projects"] };

/**
 * A fixture HOME with a sealed repo root at ~/rig: this repo's models, targets and core, and the stub pstack pack. `rig`
 * overrides keys of rig.json. `pack` replaces the packs with one repo pack `own` holding one skill `idle`, so a
 * proposal names only that skill; `skills` adds more skills to that pack. `transcripts` lists the harnesses whose fixture transcripts land at their record's root.
 */
function setup({ rig: rigCfg = {}, pack = false, transcripts = [] as string[], home = {}, skills = [] as string[] } = {}) {
  const stub = stubPstack();
  const final = { ...stub.rig, ...rigCfg, ...(pack ? { packs: { own: {} } } : {}) };
  const spec: Record<string, any> = { "rig/rig.json": canon(final), ...(pack ? {} : stub.spec) };
  for (const dir of ["models", "targets", "packs/core"]) {
    for (const f of filesUnder(join(ROOT, dir))) spec[`rig/${dir}/${f.path}`] = { content: f.bytes, mode: f.mode };
  }
  const own: Record<string, string> = { "skills/idle/SKILL.md": "---\nname: idle\ndescription: A skill that no session loads.\n---\nDo nothing.\n" };
  for (const name of skills) own[`skills/${name}/SKILL.md`] = `---\nname: ${name}\ndescription: A skill that a hub reads by path.\n---\nDo something.\n`;
  if (pack) {
    spec["rig/packs/own/pack.json"] = canon({ schema: 2, name: "own", license: "MIT" });
    for (const [rel, text] of Object.entries(own)) spec[`rig/packs/own/${rel}`] = text;
  }
  for (const h of transcripts) {
    const [to, from] = TRANSCRIPTS[h];
    for (const f of filesUnder(join(METRICS, from))) spec[`${to}/${f.path}`] = f.bytes;
  }
  const fx = makeFixtureHome({ ...spec, ...home });
  const root = fx.path("rig");
  const lock = { schema: 2, core: { tree: treeHash(filesUnder(join(root, "packs/core")), { core: true }), candidate: null }, packs: pack ? { own: authoredEntry("own", own) } : stub.lock };
  writeFileSync(join(root, "rig.lock.json"), canon(lock));
  const env = { PATH: process.env.PATH, HOME: fx.home, RIG_ROOT: root, RIG_NOW: NOW };
  const rig = (args, input = "") => {
    const r = spawnSync(process.execPath, [BIN, ...args], { env, cwd: fx.home, encoding: "utf8", input });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr, all: r.stdout + r.stderr };
  };
  return { fx, root, env, rig };
}

function changed(a, b) {
  const out = [];
  for (const k of new Set([...a.keys(), ...b.keys()])) if (JSON.stringify(a.get(k)) !== JSON.stringify(b.get(k))) out.push(k);
  return out.sort();
}

// ---------------------------------------------------------------- the session hook through plan and apply

/** Foreign hook files of the other harnesses: the hook must leave each byte-identical. */
const OTHER_HOOK_FILES = {
  ".cursor/hooks.json": canon({ version: 1, hooks: { stop: [{ command: "./hooks/stop.sh" }] } }),
  ".codex/config.toml": "[notify]\ncommand = \"say\"\n",
  ".omp/agent/config.yml": "symbolPreset: ascii\n",
};

describe("rig apply with metrics.session_hook (S5.5)", () => {
  test("adds exactly one element to hooks.SessionEnd; the diff shows only it; a second apply is a no-op", (t) => {
    const s = setup({ rig: { metrics: { session_hook: true } }, home: { ".claude/settings.json": SETTINGS, ...OTHER_HOOK_FILES } });
    t.after(() => s.fx.cleanup());
    const before = s.fx.snapshot();
    const p = s.rig(["plan"]);
    assert.equal(p.code, 0, p.all);
    assert.match(p.stdout, /^update +json-element +claude +~\/\.claude\/settings\.json +core\/session-end$/m);
    const a = s.rig(["apply"]);
    assert.equal(a.code, 0, a.all);

    const after = s.fx.read(".claude/settings.json");
    const v = JSON.parse(after);
    const ends = v.hooks.SessionEnd;
    assert.equal(ends.length, 2);
    assert.deepEqual(ends[0], JSON.parse(SETTINGS).hooks.SessionEnd[0], "the foreign element stays first");
    const command = ends[1].hooks[0].command;
    assert.match(command, / stats --record$/);
    assert.ok(command.includes(BIN), "the command runs this checkout's bin/rig.ts");
    assert.equal(after, SETTINGS_WITH_RIG.replace(ID, command), "every other byte is the original");
    const diff = changed(before, s.fx.snapshot()).filter((x) => !x.startsWith(STATE));
    assert.ok(diff.includes(".claude/settings.json"));
    for (const [f, text] of Object.entries(OTHER_HOOK_FILES)) {
      if (f === ".codex/config.toml") assert.ok(s.fx.read(f).startsWith(text), "the Codex models block goes after the foreign bytes");
      else assert.ok(!diff.includes(f), `${f} keeps its bytes`);
    }

    const again = s.rig(["apply"]);
    assert.equal(again.code, 0, again.all);
    assert.match(again.stdout, /^0 changes, 0 blocks$/m);
    assert.equal(s.fx.read(".claude/settings.json"), after);
  });

  test("the rendered hook command prints 0 bytes, exits 0, and records the session", (t) => {
    const s = setup({ rig: { metrics: { session_hook: true } }, transcripts: ["claude"] });
    t.after(() => s.fx.cleanup());
    assert.equal(s.rig(["apply"]).code, 0);
    const command = JSON.parse(s.fx.read(".claude/settings.json")).hooks.SessionEnd[0].hooks[0].command;
    const transcript = s.fx.path(".claude/projects/-placeholder-proj/sess-0001.jsonl");
    const payload = JSON.stringify({ session_id: "sess-0001", transcript_path: transcript, cwd: s.fx.home, hook_event_name: "SessionEnd", reason: "other", prompt_id: "p1" });
    for (const input of [payload, "not json"]) {
      const r = spawnSync("/bin/sh", ["-c", command], { env: s.env, cwd: s.fx.home, encoding: "utf8", input });
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, "", "the hook prints nothing");
    }
    const store = s.fx.read(`${STATE}metrics.jsonl`).split("\n").filter(Boolean).map((l) => JSON.parse(l));
    assert.deepEqual(store.map((l) => [l.harness, l.session_id, l.source]), [["claude", "sess-0001", "record"]]);
    assert.match(s.fx.read(`${STATE}log/rig.log`), /"code":"E_HOOK_PAYLOAD"/);
  });

  test("off by default: no element, settings.json keeps its bytes", (t) => {
    const s = setup({ home: { ".claude/settings.json": SETTINGS } });
    t.after(() => s.fx.cleanup());
    const a = s.rig(["apply"]);
    assert.equal(a.code, 0, a.all);
    assert.doesNotMatch(a.stdout, /json-element/);
    assert.equal(s.fx.read(".claude/settings.json"), SETTINGS);
  });

  test("a non-canonical settings.json: plan exits 1 with E_JSON_ROUNDTRIP and the snippet; apply writes nothing", (t) => {
    const fourSpaces = `${JSON.stringify(JSON.parse(SETTINGS), null, 4)}\n`;
    const s = setup({ rig: { metrics: { session_hook: true } }, home: { ".claude/settings.json": fourSpaces } });
    t.after(() => s.fx.cleanup());
    const p = s.rig(["plan"]);
    assert.equal(p.code, 1, p.all);
    assert.match(p.stdout, /^block +json-element +claude +~\/\.claude\/settings\.json +E_JSON_ROUNDTRIP /m);
    assert.match(p.stdout, / stats --record"/, "the snippet holds the command");
    const before = s.fx.snapshot();
    assert.equal(s.rig(["apply"]).code, 1);
    assert.deepEqual(changed(before, s.fx.snapshot()), []);
    assert.equal(s.fx.read(".claude/settings.json"), fourSpaces);
  });

  test("an overlay true over the team's false renders the hook into the fixture HOME and writes nothing else outside it", (t) => {
    const s = setup({ home: { ".claude/settings.json": SETTINGS, ".config/rig/rig.json": canon({ schema: 2, metrics: { session_hook: true } }) } });
    t.after(() => s.fx.cleanup());
    const before = s.fx.snapshot();
    const p = s.rig(["plan"]);
    assert.equal(p.code, 0, p.all);
    assert.match(p.stdout, /^update +json-element +claude +~\/\.claude\/settings\.json +core\/session-end$/m);
    const a = s.rig(["apply"]);
    assert.equal(a.code, 0, a.all);
    const ends = JSON.parse(s.fx.read(".claude/settings.json")).hooks.SessionEnd;
    assert.equal(ends.length, 2);
    assert.match(ends[1].hooks[0].command, / stats --record$/);
    const diff = changed(before, s.fx.snapshot()).filter((x) => !x.startsWith(STATE));
    assert.ok(diff.includes(".claude/settings.json"));
    assert.deepEqual(diff.filter((x) => x.startsWith("rig/") || x.startsWith(".config/")), [], "the checkout and the overlay keep their bytes");
  });

  test("an overlay false over the team's true removes rig's element and keeps the foreign one", (t) => {
    const s = setup({ rig: { metrics: { session_hook: true } }, home: { ".claude/settings.json": SETTINGS } });
    t.after(() => s.fx.cleanup());
    assert.equal(s.rig(["apply"]).code, 0);
    mkdirSync(s.fx.path(".config/rig"), { recursive: true });
    writeFileSync(s.fx.path(".config/rig/rig.json"), canon({ schema: 2, metrics: { session_hook: false } }));
    const off = s.rig(["apply"]);
    assert.equal(off.code, 0, off.all);
    assert.equal(s.fx.read(".claude/settings.json"), SETTINGS);
  });

  test("turning the hook off removes rig's element and keeps the foreign one", (t) => {
    const s = setup({ rig: { metrics: { session_hook: true } }, home: { ".claude/settings.json": SETTINGS } });
    t.after(() => s.fx.cleanup());
    assert.equal(s.rig(["apply"]).code, 0);
    const cfg = JSON.parse(readFileSync(join(s.root, "rig.json"), "utf8"));
    writeFileSync(join(s.root, "rig.json"), canon({ ...cfg, metrics: { session_hook: false } }));
    const off = s.rig(["apply"]);
    assert.equal(off.code, 0, off.all);
    assert.equal(s.fx.read(".claude/settings.json"), SETTINGS);
  });
});

// ---------------------------------------------------------------- rig stats over the record roots

describe("rig stats over the transcript roots of the target records", () => {
  test("counts one fixture session per harness with no record edit", (t) => {
    const s = setup({ transcripts: ["claude", "codex", "omp", "cursor"] });
    t.after(() => s.fx.cleanup());
    const r = s.rig(["stats", "--since", "30d"]);
    assert.equal(r.code, 0, r.all);
    for (const h of ["claude", "codex", "cursor", "omp"]) assert.match(r.stdout, new RegExp(`^${h} {2}\\[[a-z-]+@2\\] {2}1 session$`, "m"), r.stdout);
    const store = s.fx.read(`${STATE}metrics.jsonl`).split("\n").filter(Boolean);
    assert.equal(store.length, 4);
  });
});

// ---------------------------------------------------------------- --suggest (S5.6, S5.2)

describe("rig stats --suggest", () => {
  test("an unused skill gets a rig.json disable diff that git apply accepts; only the state root changes", (t) => {
    const s = setup({ pack: true, transcripts: ["claude"] });
    t.after(() => s.fx.cleanup());
    assert.equal(s.rig(["stats", "--since", "30d"]).code, 0);
    assert.equal(existsSync(s.fx.path(`${STATE}proposals`)), false, "plain stats writes no proposal");

    const before = s.fx.snapshot();
    const r = s.rig(["stats", "--since", "30d", "--suggest"]);
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /^ {2}skill own\/idle: no use on claude in 1 sessions: disable$/m);
    assert.match(r.stdout, /^diff --git a\/rig\.json b\/rig\.json$/m);
    assert.match(r.stdout, /^-  "disable": \[\],$/m);
    assert.match(r.stdout, /^\+    "own\/idle"$/m);
    const diff = changed(before, s.fx.snapshot());
    assert.deepEqual(diff.filter((p) => !p.startsWith(STATE)), [], "no file outside the state root changed, config included");
    const saved = s.fx.read(`${STATE}proposals/2026-11-05.patch`);
    assert.ok(r.stdout.endsWith(saved), "the printed diff is the saved patch");

    const check = spawnSync("git", ["apply", "--check", "-v", s.fx.path(`${STATE}proposals/2026-11-05.patch`)], { cwd: s.root, env: gitEnv(), encoding: "utf8" });
    assert.equal(check.status, 0, check.stderr);
    const applied = spawnSync("git", ["apply", s.fx.path(`${STATE}proposals/2026-11-05.patch`)], { cwd: s.root, env: gitEnv(), encoding: "utf8" });
    assert.equal(applied.status, 0, applied.stderr);
    assert.deepEqual(JSON.parse(readFileSync(join(s.root, "rig.json"), "utf8")).disable, ["own/idle"]);
    const p = s.rig(["plan"]);
    assert.notEqual(p.code, 2, `the applied rig.json loads: ${p.all}`);
    assert.doesNotMatch(p.stdout, /own\/idle/, "the disabled skill no longer renders");
  });

  test("the canary has zero hits in metrics.jsonl, proposals/ and log/ after --suggest and --record", (t) => {
    const s = setup({ pack: true, transcripts: ["claude", "codex", "omp", "cursor"] });
    t.after(() => s.fx.cleanup());
    assert.equal(s.rig(["stats", "--since", "30d", "--suggest"]).code, 0);
    const transcript = s.fx.path(".claude/projects/-placeholder-proj/sess-0001.jsonl");
    assert.ok(readFileSync(transcript, "utf8").includes(CANARY), "the fixture carries the canary");
    assert.equal(s.rig(["stats", "--record"], JSON.stringify({ session_id: "sess-0001", transcript_path: transcript })).stdout, "");
    assert.equal(s.rig(["stats", "--record"], "not json").stdout, "");
    const files = filesUnder(s.fx.path(STATE.slice(0, -1)));
    assert.ok(files.some((f) => f.path === "metrics.jsonl") && files.some((f) => f.path.startsWith("proposals/")) && files.some((f) => f.path.startsWith("log/")));
    for (const f of files) assert.equal(f.bytes.toString("utf8").includes(CANARY), false, f.path);
  });
});

// ---------------------------------------------------------------- a read of a unit dir is a use

const STAMP = "2026-11-04T10:00:00.000Z";
const jsonl = (...lines: object[]) => `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`;
/** Per harness: its skill root, its session path, and builders for a call that points into a unit dir, in the shape that harness writes. */
type Reader = {skills: string, file: string, calls: Record<string, (home: string, name: string) => any>, session: (content: any, call: string) => string};
const READERS: Record<string, Reader> = {
  claude: {
    skills: ".claude/skills",
    file: ".claude/projects/-proj/sess-read.jsonl",
    calls: {
      Read: (home, name) => [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: `${home}/.claude/skills/${name}/SKILL.md` } }],
      Bash: (home, name) => [{ type: "tool_use", id: "t1", name: "Bash", input: { command: `sed -n '1,200p' ~/.claude/skills/${name}/SKILL.md # CANARY ${CANARY}` } }],
    },
    session: (block) => jsonl({ type: "assistant", timestamp: STAMP, uuid: "u1", message: { id: "m1", model: "model-alpha", role: "assistant", usage: { input_tokens: 1, output_tokens: 1 }, content: block } }),
  },
  codex: {
    skills: ".agents/skills",
    file: ".codex/sessions/2026/11/04/rollout-2026-11-04T10-00-00-cdx-read.jsonl",
    calls: {
      "exec custom tool": (home, name) => ({ type: "custom_tool_call", call_id: "c1", name: "exec", input: `const r = await tools.exec_command({"cmd":"sed -n '1,260p' ${home}/.agents/skills/${name}/SKILL.md","workdir":"${home}"});` }),
      "exec_command": (home, name) => ({ type: "function_call", call_id: "c1", name: "exec_command", arguments: JSON.stringify({ cmd: `cat ~/.agents/skills/${name}/SKILL.md` }) }),
      "$name injection": (home, name) => ({ type: "message", id: "msg1", role: "user", content: [{ type: "input_text", text: `<skill>\n<name>${name}</name>\n<path>${home}/.agents/skills/${name}/SKILL.md</path>\n---\nname: ${name}\n---\n` }] }),
    },
    session: (payload) => jsonl({ timestamp: STAMP, type: "session_meta", payload: { id: "cdx-read" } }, { timestamp: STAMP, type: "response_item", payload }),
  },
  omp: {
    skills: ".omp/agent/skills",
    file: ".omp/agent/sessions/-proj/omp-read.jsonl",
    calls: {
      read: (home, name) => [{ type: "toolCall", id: "c1", name: "read", arguments: { path: `${home}/.omp/agent/skills/${name}/SKILL.md` } }],
      bash: (home, name) => [{ type: "toolCall", id: "c1", name: "bash", arguments: { command: `cat ~/.omp/agent/skills/${name}/SKILL.md` } }],
    },
    session: (content) => jsonl({ type: "message", id: "a1", timestamp: STAMP, message: { role: "assistant", model: "model-alpha", usage: { input: 1, output: 1 }, content } }),
  },
  cursor: {
    skills: ".cursor/skills",
    file: ".cursor/projects/proj/agent-transcripts/cur-read.jsonl",
    calls: {
      Read: (home, name) => [{ type: "tool_use", name: "Read", input: { path: `${home}/.cursor/skills/${name}/SKILL.md` } }],
      ReadFile: (home, name) => [{ type: "tool_use", name: "ReadFile", input: { path: `${home}/.cursor/skills/${name}/references/x.md` } }],
      Shell: (home, name) => [{ type: "tool_use", name: "Shell", input: { command: `cat ~/.cursor/skills/${name}/SKILL.md` } }],
      attached: (home, name) => [{ type: "text", text: `<manually_attached_skills>\nThe user attached these.\n\nSkill Name: ${name}\nPath: ${home}/.cursor/skills/${name}/SKILL.md\n---\nbody\n` }],
    },
    session: (content, call) => jsonl({ role: call === "attached" ? "user" : "assistant", timestamp: STAMP, message: { role: call === "attached" ? "user" : "assistant", model: "model-alpha", content } }),
  },
};

for (const [harness, h] of Object.entries(READERS)) {
  for (const [call, build] of Object.entries(h.calls)) {
    test(`${harness} ${call}: a path into the unit dir counts the skill as used; an unread skill is still proposed`, (t) => {
      const s = setup({ pack: true, skills: ["how"] });
      t.after(() => s.fx.cleanup());
      for (const name of ["how", "idle"]) mkdirSync(s.fx.path(`${h.skills}/${name}`), { recursive: true });
      mkdirSync(join(s.fx.path(h.file), ".."), { recursive: true });
      writeFileSync(s.fx.path(h.file), h.session(build(s.fx.home, "how"), call));
      const r = s.rig(["stats", "--since", "30d", "--suggest"]);
      assert.equal(r.code, 0, r.all);
      assert.match(r.stdout, new RegExp(`^ {2}skill own/idle: no use on ${harness} in 1 sessions: disable$`, "m"), r.stdout);
      assert.doesNotMatch(r.stdout, /own\/how/, "the skill the model read is not proposed");
      assert.match(r.stdout, /^\+ {4}"own\/idle"$/m);
      const store = JSON.parse(s.fx.read(`${STATE}metrics.jsonl`).trim());
      assert.deepEqual(store.skills, { how: 1 });
      for (const f of filesUnder(s.fx.path(STATE.slice(0, -1)))) {
        const text = f.bytes.toString("utf8");
        assert.equal(text.includes(CANARY) || text.includes("SKILL.md") || text.includes(s.fx.home), false, `${f.path} holds no path and no command text`);
      }
    });
  }

  test(`${harness}: a session with no read and no invocation proposes both skills`, (t) => {
    const s = setup({ pack: true, skills: ["how"] });
    t.after(() => s.fx.cleanup());
    for (const name of ["how", "idle"]) mkdirSync(s.fx.path(`${h.skills}/${name}`), { recursive: true });
    const [call, build] = Object.entries(h.calls)[0];
    mkdirSync(join(s.fx.path(h.file), ".."), { recursive: true });
    writeFileSync(s.fx.path(h.file), h.session(build(s.fx.home, "ghost"), call));
    const r = s.rig(["stats", "--since", "30d", "--suggest"]);
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, new RegExp(`^ {2}skill own/how: no use on ${harness} in 1 sessions: disable$`, "m"), r.stdout);
    assert.match(r.stdout, new RegExp(`^ {2}skill own/idle: no use on ${harness} in 1 sessions: disable$`, "m"));
    assert.deepEqual(JSON.parse(s.fx.read(`${STATE}metrics.jsonl`).trim()).skills, {}, "a path to a dir that is not installed is no use");
  });
}

test("cursor: a read inside the dir rig writes for Cursor counts the skill as used; an unread skill is still proposed", (t) => {
  const s = setup({ rig: { harnesses: ["cursor"] }, pack: true, skills: ["how"] });
  t.after(() => s.fx.cleanup());
  const dir = ".cursor/plugins/local/rig/skills";
  for (const name of ["how", "idle"]) mkdirSync(s.fx.path(`${dir}/${name}`), { recursive: true });
  const h = READERS.cursor;
  mkdirSync(join(s.fx.path(h.file), ".."), { recursive: true });
  writeFileSync(s.fx.path(h.file), h.session([{ type: "tool_use", name: "Read", input: { path: `${s.fx.home}/${dir}/how/SKILL.md` } }], "Read"));
  const r = s.rig(["stats", "--since", "30d", "--suggest"]);
  assert.equal(r.code, 0, r.all);
  assert.deepEqual(JSON.parse(s.fx.read(`${STATE}metrics.jsonl`).trim()).skills, { how: 1 });
  assert.match(r.stdout, /^ {2}skill own\/idle: no use on cursor in 1 sessions: disable$/m, r.stdout);
  assert.doesNotMatch(r.stdout, /own\/how/, "the skill the model read is not proposed");
});

test("claude: a read inside the plugin cache, which rig does not write, is no use of the skill", (t) => {
  const s = setup({ pack: true, skills: ["how"] });
  t.after(() => s.fx.cleanup());
  const dir = ".claude/plugins/cache";
  mkdirSync(s.fx.path(`${dir}/how`), { recursive: true });
  const h = READERS.claude;
  mkdirSync(join(s.fx.path(h.file), ".."), { recursive: true });
  writeFileSync(s.fx.path(h.file), h.session([{ type: "tool_use", id: "t1", name: "Read", input: { file_path: `${s.fx.home}/${dir}/how/SKILL.md` } }], "Read"));
  const r = s.rig(["stats", "--since", "30d", "--suggest"]);
  assert.equal(r.code, 0, r.all);
  assert.deepEqual(JSON.parse(s.fx.read(`${STATE}metrics.jsonl`).trim()).skills, {});
});

test("a hub file inside the unit dir counts for the hub: craft/hub.md and craft/playbooks/*.md", (t) => {
  const s = setup({ pack: true, skills: ["craft"] });
  t.after(() => s.fx.cleanup());
  mkdirSync(s.fx.path(".claude/skills/craft/playbooks"), { recursive: true });
  const h = READERS.claude;
  const file = h.file;
  mkdirSync(join(s.fx.path(file), ".."), { recursive: true });
  const reads = ["hub.md", "playbooks/feature.md"].map((rel, i) => ({ type: "tool_use", id: `t${i}`, name: "Read", input: { file_path: `${s.fx.home}/.claude/skills/craft/${rel}` } }));
  writeFileSync(s.fx.path(file), h.session(reads, "Read"));
  const r = s.rig(["stats", "--since", "30d", "--suggest"]);
  assert.equal(r.code, 0, r.all);
  assert.deepEqual(JSON.parse(s.fx.read(`${STATE}metrics.jsonl`).trim()).skills, { craft: 2 });
  assert.doesNotMatch(r.stdout, /own\/craft/);
});

test("--suggest without --record writes nothing outside the state root, and nothing for the rig config", (t) => {
  const s = setup({ pack: true, skills: ["how"], transcripts: ["claude"] });
  t.after(() => s.fx.cleanup());
  mkdirSync(s.fx.path(".claude/skills/how"), { recursive: true });
  const before = s.fx.snapshot();
  assert.equal(s.rig(["stats", "--since", "30d", "--suggest"]).code, 0);
  assert.deepEqual(changed(before, s.fx.snapshot()).filter((p) => !p.startsWith(STATE)), []);
});

// ---------------------------------------------------------------- propose rules on store lines

/** A world view for propose(): a temp repo root with this repo's rig.json and roles.json, and the tiers ladders. */
function proposeWorld(t) {
  const fx = makeFixtureHome({ "rig/rig.json": readFileSync(join(ROOT, "rig.json")), "rig/models/roles.json": readFileSync(join(ROOT, "models/roles.json")) });
  t.after(() => fx.cleanup());
  const tiers = JSON.parse(readFileSync(join(ROOT, "models/tiers.json"), "utf8"));
  return { fx, world: { roots: { repo: fx.path("rig"), overlay: null }, tiers, packs: new Map([["own", { root: "repo" }], ["mine", { root: "overlay" }]]) } };
}
const line = (over) => ({ schema: 1, harness: "claude", session_id: "s", start: "2026-11-04T10:00:00Z", end: "2026-11-04T11:00:00Z", models: {}, skills: {}, agents: null, hook_bytes: null, ...over });

describe("propose", () => {
  test("a role escalated in two sessions gets one effort rung more in roles.json; one session is not enough", (t) => {
    const { world } = proposeWorld(t);
    const escalated = { reviewer: { dispatches: 2, effort: { high: 1, xhigh: 1 } } };
    const one = propose({ lines: [line({ agents: escalated })], units: [], world });
    assert.equal(one.patch, null);
    const two = propose({ lines: [line({ agents: escalated }), line({ session_id: "s2", agents: escalated })], units: [], world });
    assert.deepEqual(two.notes, ["role reviewer: escalated in 2 sessions: effort high -> xhigh"]);
    assert.match(two.patch, /^diff --git a\/models\/roles\.json b\/models\/roles\.json$/m);
    assert.match(two.patch, /^-        "high"\n\+        "xhigh"$/m);
    assert.equal((two.patch.match(/^[-+] /gm) ?? []).length, 2, "exactly one value changes");
  });

  test("a single dispatch, or repeats at or below the configured effort, are not escalations", (t) => {
    const { world } = proposeWorld(t);
    for (const agents of [{ reviewer: { dispatches: 1, effort: { max: 1 } } }, { reviewer: { dispatches: 3, effort: { high: 2, low: 1 } } }]) {
      const r = propose({ lines: [line({ agents }), line({ session_id: "s2", agents })], units: [], world });
      assert.equal(r.patch, null, JSON.stringify(agents));
    }
  });

  test("no skill data means no disable: a harness that records no loads never proves a skill unused", (t) => {
    const { world } = proposeWorld(t);
    const units = [{ id: "own/idle", type: "skill", name: "idle", harnesses: ["codex"] }];
    assert.equal(propose({ lines: [line({ harness: "codex", skills: null })], units, world }).patch, null);
    assert.equal(propose({ lines: [line({ skills: { "own:idle": 1 } })], units: [{ ...units[0], harnesses: ["claude"] }], world }).patch, null, "a plugin-qualified load counts");
    const overlay = propose({ lines: [line({})], units: [{ id: "mine/idle", type: "skill", name: "idle", harnesses: ["claude"] }], world });
    assert.equal(overlay.patch, null);
    assert.match(overlay.notes[0], /overlay/);
  });

  test("a hook over budget is a report line, never a diff", (t) => {
    const { world } = proposeWorld(t);
    const r = propose({ lines: [line({ hook_bytes: { SessionStart: 9000 } })], units: [], world });
    assert.equal(r.patch, null);
    assert.match(r.notes[0], /^hook SessionStart: 9000 bytes per session over 1 sessions, above 4096; rig did not write it, so no diff/);
  });

  test("a repo config file that is not canonical gets a note, not a diff", (t) => {
    const { fx, world } = proposeWorld(t);
    writeFileSync(fx.path("rig/rig.json"), JSON.stringify(JSON.parse(readFileSync(join(ROOT, "rig.json"), "utf8")), null, 4));
    const r = propose({ lines: [line({})], units: [{ id: "own/idle", type: "skill", name: "idle", harnesses: ["claude"] }], world });
    assert.equal(r.patch, null);
    assert.match(r.notes.at(-1), /E_JSON_ROUNDTRIP/);
  });
});

// ---------------------------------------------------------------- alias resolution history

test("the report shows each alias family's model ids in the order they first ran", () => {
  const lines = [
    line({ session_id: "a", start: "2026-10-01T09:00:00Z", end: "2026-10-01T10:00:00Z", models: { "claude-opus-4-5": { requests: 1 }, "claude-haiku-4-5": { requests: 1 } } }),
    line({ session_id: "b", start: "2026-10-20T09:00:00Z", end: "2026-10-20T10:00:00Z", models: { "claude-opus-4-5": { requests: 1 } } }),
    line({ session_id: "c", start: "2026-11-02T09:00:00Z", end: "2026-11-03T10:00:00Z", models: { "claude-opus-5-5": { requests: 1 } } }),
    line({ harness: "codex", session_id: "d", models: { "gpt-5-codex": { requests: 1 } } }),
  ];
  const text = renderReport({ since: "60d", cutoff: "2026-09-06T00:00:00Z", lines, dropped: new Map(), costSource: () => null });
  assert.match(text, /^ {2}alias history: haiku claude-haiku-4-5 \(2026-10-01\); opus claude-opus-4-5 \(2026-10-01 to 2026-10-20\) -> claude-opus-5-5 \(2026-11-02 to 2026-11-03\)$/m);
  assert.match(text, /^codex .*\n(?:.*\n)*? {2}alias history: n\/a$/m);
});
