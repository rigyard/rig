// Slice 5 done-checks for rig stats, --suggest and the session-end hook: the json-element primitive (S5.5, S5.8),
// the hook element through plan and apply (S5.5), the proposal (S5.6), the canary over the state root (S5.2), and
// the transcript roots of the target records. CLI cases run bin/rig.mjs over a fixture HOME whose repo config root
// (RIG_ROOT) is a temp copy of this repo's data.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { propose } from "../lib/metrics/propose.mjs";
import { renderReport } from "../lib/metrics/report.mjs";
import { patch } from "../lib/targets.mjs";
import { treeHash } from "../lib/tree.mjs";
import { makeFixtureHome } from "./helpers/fixture-home.mjs";
import { CANARY } from "./metrics.helpers.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BIN = join(ROOT, "bin/rig.mjs");
const NOW = "2026-11-05T12:00:00.000Z";
const METRICS = join(ROOT, "test/fixtures/metrics");
const STATE = ".local/state/rig/";
const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b);
const canon = (v) => `${JSON.stringify(v, null, 2)}\n`;

// ---------------------------------------------------------------- the json-element primitive

const ID = "/usr/local/bin/node /opt/rig/bin/rig.mjs stats --record";
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

  test("a non-object on the pointer path, a non-array target, and two rig elements are E_LOCATOR", () => {
    for (const v of [{ hooks: [] }, { hooks: { SessionEnd: {} } }, { hooks: { SessionEnd: [CLAUDE_ELEMENT, CLAUDE_ELEMENT] } }]) {
      const r = patch(enc(canon(v)), claudeEntry());
      assert.equal(r.error?.code, "E_LOCATOR", JSON.stringify(v));
    }
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
 * A fixture HOME with a sealed repo root at ~/rig: this repo's data, core and every pack its rig.json lists. `rig`
 * overrides keys of rig.json. `pack` replaces the packs with one repo pack `own` holding one skill `idle`, so a
 * proposal names only that skill. `transcripts` lists the harnesses whose fixture transcripts land at their record's root.
 */
function setup({ rig: rigCfg = {}, pack = false, transcripts = [], home = {} } = {}) {
  const cfg = JSON.parse(readFileSync(join(ROOT, "rig.json"), "utf8"));
  const final = { ...cfg, ...rigCfg, ...(pack ? { packs: { own: {} } } : {}) };
  const spec = { "rig/rig.json": canon(final) };
  const packs = Object.keys(final.packs).filter((name) => name !== "own").map((name) => `packs/${name}`);
  for (const dir of ["models", "providers", "targets", "packs/core", ...packs]) {
    for (const f of filesUnder(join(ROOT, dir))) spec[`rig/${dir}/${f.path}`] = { content: f.bytes, mode: f.mode };
  }
  if (pack) {
    spec["rig/packs/own/pack.json"] = canon({ schema: 1, name: "own", license: "MIT" });
    spec["rig/packs/own/skills/idle/SKILL.md"] = "---\nname: idle\ndescription: A skill that no session loads.\n---\nDo nothing.\n";
  }
  for (const h of transcripts) {
    const [to, from] = TRANSCRIPTS[h];
    for (const f of filesUnder(join(METRICS, from))) spec[`${to}/${f.path}`] = f.bytes;
  }
  const fx = makeFixtureHome({ ...spec, ...home });
  const root = fx.path("rig");
  const lock = { schema: 1, core: { tree: treeHash(filesUnder(join(root, "packs/core")), { core: true }), candidate: null }, packs: {}, pins: {} };
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
    assert.ok(command.includes(BIN), "the command runs this checkout's bin/rig.mjs");
    assert.equal(after, SETTINGS_WITH_RIG.replace(ID, command), "every other byte is the original");
    const diff = changed(before, s.fx.snapshot()).filter((x) => !x.startsWith(STATE));
    assert.ok(diff.includes(".claude/settings.json"));
    for (const f of Object.keys(OTHER_HOOK_FILES)) assert.ok(!diff.includes(f), `${f} keeps its bytes`);

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
    for (const h of ["claude", "codex", "cursor", "omp"]) assert.match(r.stdout, new RegExp(`^${h} {2}\\[[a-z-]+@1\\] {2}1 session$`, "m"), r.stdout);
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
    assert.match(r.stdout, /^ {2}skill own\/idle: no loads on claude in 1 sessions: disable$/m);
    assert.match(r.stdout, /^diff --git a\/rig\.json b\/rig\.json$/m);
    assert.match(r.stdout, /^-  "disable": \[\],$/m);
    assert.match(r.stdout, /^\+    "own\/idle"$/m);
    const diff = changed(before, s.fx.snapshot());
    assert.deepEqual(diff.filter((p) => !p.startsWith(STATE)), [], "no file outside the state root changed, config included");
    const saved = s.fx.read(`${STATE}proposals/2026-11-05.patch`);
    assert.ok(r.stdout.endsWith(saved), "the printed diff is the saved patch");

    const check = spawnSync("git", ["apply", "--check", "-v", s.fx.path(`${STATE}proposals/2026-11-05.patch`)], { cwd: s.root, encoding: "utf8" });
    assert.equal(check.status, 0, check.stderr);
    const applied = spawnSync("git", ["apply", s.fx.path(`${STATE}proposals/2026-11-05.patch`)], { cwd: s.root, encoding: "utf8" });
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
