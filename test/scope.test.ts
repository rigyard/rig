// Slice 4 done-checks for per-pack scope (decision 0017, doc section 11): S4.7 (a project pack on Codex), S4.8 (the
// same pack on Claude Code as a local plugin in the rig-owned marketplace), S4.12 (the scope default and the parse
// errors). Plus two doctor fixes: compose and render errors exit 1 as in plan, and a session-hook element whose
// command differs only in the node path is an update, not drift. CLI cases run bin/rig.ts over a fixture HOME whose
// repo config root (RIG_ROOT) is a temp copy of this repo's data.

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { describe, test } from "node:test";
import { jsonDigest } from "../lib/state/observe.ts";
import { patch, render } from "../lib/targets.ts";
import { sameCommand } from "../lib/targets/json-element.ts";
import { unit, world } from "./render.helpers.ts";
import { APP, canon, MARKET, NOTES_SKILL, STATE, STYLE_RULE, TIDY_CMD, setup } from "./scope.helpers.ts";
import type { Stack } from "../lib/stack.ts";
import type { World } from "../lib/world.ts";

/** render over hand-built units and the helpers' World (both untyped shapes). */
const renderUnits = (units: unknown[]) => render({ units } as unknown as Stack, world({ aliases: {} as {pm: string} }) as unknown as World);

const under = (snap: Map<string, unknown>, prefix: string) => [...snap.keys()].filter((k) => k.startsWith(prefix)).sort();

// ---------------------------------------------------------------- render

describe("render of project and hybrid units", () => {
  const pack = (scope: string, harnesses = ["claude", "codex"]) => [
    unit({ id: "kit/notes", type: "skill", scope, harnesses, files: { "SKILL.md": NOTES_SKILL } }),
    unit({ id: "kit/tidy", type: "command", scope, harnesses, files: { "tidy.md": TIDY_CMD } }),
    unit({ id: "kit/style", type: "rule", scope, harnesses, files: { "style.md": STYLE_RULE } }),
  ];
  const paths = (d: ReturnType<typeof render>) => [...d.entries.keys()].map((p) => p.replace("/home/rig-fixture/", "~/")).sort();
  const M = "~/.local/share/rig/marketplace";

  test("project: the Claude plugin and its manifests under the data root, no machine copy, one info line per pack and harness", () => {
    const d = renderUnits(pack("project"));
    assert.deepEqual(d.errors, []);
    assert.deepEqual(paths(d), [
      `${M}/.claude-plugin/marketplace.json`,
      `${M}/plugins/kit/.claude-plugin/plugin.json`,
      `${M}/plugins/kit/commands/tidy.md`,
      `${M}/plugins/kit/skills/notes/SKILL.md`,
    ]);
    assert.deepEqual(d.info, [
      "scope codex kit: project part absent: commit its files (doctor --project)",
      "absent claude kit/style: a claude plugin has no rule component",
    ]);
    const skill = [...d.entries.values()].find((e) => e.path.endsWith("skills/notes/SKILL.md"));
    assert.equal(new TextDecoder().decode((skill as {bytes: Uint8Array}).bytes), NOTES_SKILL, "the plugin copy is visible: no hide key");
    const market = JSON.parse(new TextDecoder().decode((d.entries.get(`/home/rig-fixture/${M.slice(2)}/.claude-plugin/marketplace.json`) as {bytes: Uint8Array}).bytes));
    assert.deepEqual(market.plugins, [{ name: "kit", source: "./plugins/kit" }]);
    assert.equal(market.name, "rig-local");
    const plugin = JSON.parse(new TextDecoder().decode((d.entries.get(`/home/rig-fixture/${M.slice(2)}/plugins/kit/.claude-plugin/plugin.json`) as {bytes: Uint8Array}).bytes));
    assert.equal(plugin.name, "kit");
    assert.match(plugin.version, /^0\.0\.0-[0-9a-f]{12}$/);
  });

  test("the plugin version follows the plugin's bytes", () => {
    const v = (text: string) => {
      const d = renderUnits([unit({ id: "kit/notes", type: "skill", scope: "project", harnesses: ["claude"], files: { "SKILL.md": text } })]);
      const e = [...d.entries.values()].find((x) => x.path.endsWith("plugin.json")) as {bytes: Uint8Array};
      return JSON.parse(new TextDecoder().decode(e.bytes)).version;
    };
    assert.equal(v(NOTES_SKILL), v(NOTES_SKILL));
    assert.notEqual(v(NOTES_SKILL), v(`${NOTES_SKILL}More.\n`));
  });

  test("hybrid: the hidden machine copy plus the plugin copy", () => {
    const d = renderUnits(pack("hybrid", ["claude"]));
    assert.deepEqual(d.errors, []);
    const p = paths(d);
    assert.ok(p.includes("~/.claude/skills/notes/SKILL.md"));
    assert.ok(p.includes(`${M}/plugins/kit/skills/notes/SKILL.md`));
    const hidden = [...d.entries.values()].find((e) => e.path.endsWith(".claude/skills/notes/SKILL.md")) as {bytes: Uint8Array};
    assert.match(new TextDecoder().decode(hidden.bytes), /disable-model-invocation: true/);
  });

  test("no project pack: no marketplace entry", () => {
    const d = renderUnits(pack("machine-hidden", ["claude"]));
    assert.ok(paths(d).every((p) => !p.startsWith(M)));
  });
});

// ---------------------------------------------------------------- S4.7, S4.8

describe("S4.7 a project pack on Codex", () => {
  test("plan: exit 0, one info line naming the pack and codex; nothing for the pack under ~/.codex or ~/.agents; doctor --project prints the Codex paths", (t) => {
    const s = setup({ entry: { scope: "project", projects: [`~/${APP}`], harnesses: ["codex"] } });
    t.after(() => s.fx.cleanup());
    const tree = s.projectTree();
    const p = s.rig(["plan"]);
    assert.equal(p.code, 0, p.all);
    assert.equal(p.stdout.match(/^info scope codex notes: project part absent: commit its files \(doctor --project\)$/gm)?.length, 1, p.stdout);
    const a = s.rig(["apply"]);
    assert.equal(a.code, 0, a.all);
    const snap = s.fx.snapshot();
    assert.deepEqual([...under(snap, ".codex/"), ...under(snap, ".agents/")].filter((k) => /notes|tidy|style/.test(k)), []);
    assert.deepEqual(under(snap, MARKET), [], "no Claude in the pack's harnesses: no plugin");
    assert.doesNotMatch(a.stdout, /^register claude/m);
    const d = s.rig(["doctor", "--project", s.fx.path(APP)]);
    assert.match(d.stdout, new RegExp(`^info +scope +codex pack notes: commit \\.agents/skills/notes/ \\(a copy of ${s.root.replaceAll("/", "\\/")}\\/packs\\/notes\\/skills\\/notes\\/\\)$`, "m"), d.stdout);
    assert.match(d.stdout, /^info +scope +codex pack notes: notes\/tidy has no known project path on codex$/m);
    assert.doesNotMatch(d.stdout, /claude pack notes/, "no Claude line for a pack without Claude");
    assert.equal(s.projectTree(), tree, "rig writes nothing into the project");
  });
});

describe("S4.8 the same pack on Claude Code", () => {
  const entry = { scope: "project", projects: [`~/${APP}`], harnesses: ["claude", "codex"] };

  test("apply renders the plugin under the marketplace dir, prints the commands and the snippet, keeps settings.json and the project", (t) => {
    const settings = canon({ theme: "dark", enabledPlugins: { "other@market": true } });
    const s = setup({ entry, home: { ".claude/settings.json": settings } });
    t.after(() => s.fx.cleanup());
    const tree = s.projectTree();
    const a = s.rig(["apply"]);
    assert.equal(a.code, 0, a.all);
    const snap = s.fx.snapshot();
    assert.deepEqual(under(snap, `${MARKET}/`), [
      `${MARKET}/.claude-plugin/marketplace.json`,
      `${MARKET}/plugins/notes/.claude-plugin/plugin.json`,
      `${MARKET}/plugins/notes/commands/tidy.md`,
      `${MARKET}/plugins/notes/skills/notes/SKILL.md`,
    ]);
    assert.deepEqual(under(snap, ".claude/skills/notes"), [], "a project pack has no machine copy");
    assert.match(a.stdout, /^create +owned +claude +~\/\.local\/share\/rig\/marketplace\/plugins\/notes\/skills\/notes\/SKILL\.md +notes\/notes$/m, "the plan report names claude");
    const market = s.fx.path(MARKET);
    const lines = a.stdout.slice(a.stdout.indexOf("register claude")).trimEnd().split("\n");
    assert.deepEqual(lines, [
      "register claude: run once; it installs each project pack and disables it at user scope:",
      `  claude plugin marketplace add ${market}`,
      "  claude plugin install notes@rig-local",
      "  claude plugin disable --scope user notes@rig-local",
      `enable in ${s.fx.path(APP)}: paste into ${s.fx.path(APP)}/.claude/settings.local.json (uncommitted)`,
      '  {"enabledPlugins": {"notes@rig-local": true}}',
    ]);
    assert.equal(s.fx.read(".claude/settings.json"), settings, "rig writes no enabledPlugins entry");
    assert.equal(s.projectTree(), tree);
    const again = s.rig(["apply"]);
    assert.match(again.stdout, /^0 changes, 0 blocks$/m);
  });

  test("doctor --project: not enabled without the snippet (warn, with the snippet); enabled with source local once it is in place; local beats user", (t) => {
    const s = setup({ entry, home: { ".claude/settings.json": canon({ enabledPlugins: { "notes@rig-local": false } }) } });
    t.after(() => s.fx.cleanup());
    assert.equal(s.rig(["apply"]).code, 0);
    const tree = s.projectTree();
    const before = s.fx.snapshot();
    const off = s.rig(["doctor", "--project", s.fx.path(APP)]);
    assert.equal(off.code, 0, off.all);
    assert.match(off.stdout, new RegExp(`^warn +scope +claude pack notes is declared for this project but not enabled \\(false in user\\): paste \\{"enabledPlugins": \\{"notes@rig-local": true\\}\\} into ${s.fx.path(APP).replaceAll("/", "\\/")}\\/\\.claude\\/settings\\.local\\.json$`, "m"), off.stdout);
    assert.match(off.stdout, /^info +scope +codex pack notes: commit \.agents\/skills\/notes\/ /m);
    assert.deepEqual(s.fx.snapshot(), before, "doctor writes nothing");
    assert.equal(s.projectTree(), tree);

    mkdirSync(s.fx.path(`${APP}/.claude`));
    writeFileSync(s.fx.path(`${APP}/.claude/settings.local.json`), canon({ enabledPlugins: { "notes@rig-local": true } }));
    const on = s.rig(["doctor", "--project", s.fx.path(APP)]);
    assert.equal(on.code, 0, on.all);
    assert.match(on.stdout, /^info +scope +claude pack notes is enabled here \(local\)$/m, on.stdout);
    assert.doesNotMatch(on.stdout, /not enabled/);
  });
});

// ---------------------------------------------------------------- S4.12

describe("S4.12 the scope default and its parse errors", () => {
  test("no scope key renders hidden (machine-hidden) and no plugin", (t) => {
    const s = setup({ entry: { harnesses: ["claude"] } });
    t.after(() => s.fx.cleanup());
    assert.equal(s.rig(["apply"]).code, 0);
    assert.match(s.fx.read(".claude/skills/notes/SKILL.md"), /^disable-model-invocation: true$/m);
    assert.deepEqual(under(s.fx.snapshot(), MARKET), []);
  });

  test("a scope that pack.json does not list: plan exits 2 with E_SCOPE_MODE before any write", (t) => {
    const s = setup({ entry: { scope: "project", projects: [`~/${APP}`] }, scopes: ["machine-hidden"] });
    t.after(() => s.fx.cleanup());
    const before = s.fx.snapshot();
    for (const cmd of ["plan", "apply"]) {
      const r = s.rig([cmd]);
      assert.equal(r.code, 2, r.all);
      assert.match(r.stderr, /E_SCOPE_MODE/);
    }
    assert.deepEqual(s.fx.snapshot(), before);
  });

  test("no scope value machine parses, in rig.json or in pack.json", (t) => {
    for (const opts of [{ entry: { scope: "machine" } }, { scopes: ["machine"] }]) {
      const s = setup(opts);
      t.after(() => s.fx.cleanup());
      const r = s.rig(["plan"]);
      assert.equal(r.code, 2, r.all);
      assert.match(r.stderr, /E_SCHEMA/);
    }
  });
});

// ---------------------------------------------------------------- doctor fixes

describe("rig doctor shows compose and render errors", () => {
  test("a render error: plan exits 1 and doctor exits 1 with the error line", (t) => {
    const s = setup({ entry: { harnesses: ["claude"] }, skill: "---\nname: notes\ndescription: x\n---\nSee {{rig:no-such-term}}.\n" });
    t.after(() => s.fx.cleanup());
    const p = s.rig(["plan"]);
    assert.equal(p.code, 1, p.all);
    assert.match(p.stdout, /^block E_TERM_UNKNOWN /m);
    const d = s.rig(["doctor"]);
    assert.equal(d.code, 1, d.all);
    assert.match(d.stdout, /^error +render +E_TERM_UNKNOWN unit notes\/notes \(SKILL\.md\): /m, d.stdout);
  });

  test("a compose error: doctor exits 1 with a compose line", (t) => {
    const s = setup({ entry: { harnesses: ["claude"] }, rig: { disable: ["notes/missing"] } });
    t.after(() => s.fx.cleanup());
    assert.equal(s.rig(["plan"]).code, 1);
    const d = s.rig(["doctor"]);
    assert.equal(d.code, 1, d.all);
    assert.match(d.stdout, /^error +compose +E_UNKNOWN_UNIT disable names notes\/missing/m, d.stdout);
  });
});

describe("a session-hook element whose rig checkout path moved", () => {
  const MOVED = "/old/checkout/bin/rig.ts";

  test("sameCommand: the rig bin path and the node path may both differ, nothing else may", () => {
    const id = "/usr/local/bin/node /opt/rig/bin/rig.ts stats --record";
    assert.ok(sameCommand(`/usr/local/bin/node ${MOVED} stats --record`, id), "another checkout");
    assert.ok(sameCommand(`/opt/node/v20.0.0/bin/node '/home/a b/rig/.worktrees/live/bin/rig.ts' stats --record`, id), "node and checkout both moved, quoted path");
    assert.ok(!sameCommand("my-logger --end", id), "a user's own SessionEnd hook");
    assert.ok(!sameCommand("/usr/local/bin/node /home/me/hooks/log.ts stats --record", id), "another script with the same arguments");
    assert.ok(!sameCommand("/usr/local/bin/node /opt/rig/bin/other.ts stats --record", id), "another file in a bin directory");
    assert.ok(!sameCommand("/usr/local/bin/node /opt/rig/lib/rig.ts stats --record", id), "rig.ts outside a bin directory");
    assert.ok(!sameCommand("/usr/bin/python /opt/rig/bin/rig.ts stats --record", id), "not a node executable");
    assert.ok(!sameCommand(`/usr/local/bin/node ${MOVED} stats`, id), "another argument list");
  });

  /** The state a move leaves: the old checkout applied, so settings.json and installed.json both carry its path. */
  const moved = (t: any) => {
    const foreign = { hooks: [{ type: "command", command: "my-logger --end" }] };
    const s = setup({ entry: { harnesses: ["claude"] }, rig: { metrics: { session_hook: true } }, home: { ".claude/settings.json": canon({ hooks: { SessionEnd: [foreign] } }) } });
    t.after(() => s.fx.cleanup());
    assert.equal(s.rig(["apply"]).code, 0);
    const settings = JSON.parse(s.fx.read(".claude/settings.json"));
    const current = settings.hooks.SessionEnd[1].hooks[0].command;
    const stale = `${current.slice(0, current.indexOf(" "))} ${MOVED} stats --record`;
    settings.hooks.SessionEnd[1].hooks[0].command = stale;
    writeFileSync(s.fx.path(".claude/settings.json"), canon(settings));
    const inst = JSON.parse(s.fx.read(`${STATE}installed.json`));
    const ent = inst.entries["~/.claude/settings.json"];
    ent.id = stale;
    ent.digest = jsonDigest({ hooks: [{ type: "command", command: stale }] });
    writeFileSync(s.fx.path(`${STATE}installed.json`), canon(inst));
    return { s, foreign, current };
  };

  test("plan shows an update, not E_DRIFT, and apply rewrites the one rig element in place", (t) => {
    const { s, foreign, current } = moved(t);
    const p = s.rig(["plan"]);
    assert.equal(p.code, 0, p.all);
    assert.doesNotMatch(p.stdout, /E_DRIFT/);
    assert.match(p.stdout, /^update +json-element +claude +~\/\.claude\/settings\.json +core\/session-end$/m, p.stdout);
    const a = s.rig(["apply"]);
    assert.equal(a.code, 0, a.all);
    assert.deepEqual(JSON.parse(s.fx.read(".claude/settings.json")).hooks.SessionEnd, [foreign, { hooks: [{ type: "command", command: current }] }]);
    assert.match(s.rig(["plan"]).stdout, /^0 changes, 0 blocks$/m);
  });

  test("apply --repair leaves no orphaned rig element", (t) => {
    const { s, foreign, current } = moved(t);
    assert.equal(s.rig(["apply", "--repair"]).code, 0);
    assert.deepEqual(JSON.parse(s.fx.read(".claude/settings.json")).hooks.SessionEnd, [foreign, { hooks: [{ type: "command", command: current }] }]);
    assert.match(s.rig(["plan"]).stdout, /^0 changes, 0 blocks$/m);
  });
});

describe("an orphaned rig session-hook element left beside the current one by an old apply --repair", () => {
  /** The state old --repair left: the ledger records the current element, and a stale-path rig element sits before it. */
  const orphaned = (t: any) => {
    const foreign = { hooks: [{ type: "command", command: "my-logger --end" }] };
    const s = setup({ entry: { harnesses: ["claude"] }, rig: { metrics: { session_hook: true } }, home: { ".claude/settings.json": canon({ hooks: { SessionEnd: [foreign] } }) } });
    t.after(() => s.fx.cleanup());
    assert.equal(s.rig(["apply"]).code, 0);
    const settings = JSON.parse(s.fx.read(".claude/settings.json"));
    const current = settings.hooks.SessionEnd[1].hooks[0].command;
    const stale = { hooks: [{ type: "command", command: `${current.slice(0, current.indexOf(" "))} /old/checkout/bin/rig.ts stats --record` }] };
    settings.hooks.SessionEnd.splice(1, 0, stale);
    writeFileSync(s.fx.path(".claude/settings.json"), canon(settings));
    return { s, foreign, current: { hooks: [{ type: "command", command: current }] }, stale };
  };

  test("plan shows an update, apply leaves [foreign, current], and a second plan has no changes", (t) => {
    const { s, foreign, current } = orphaned(t);
    for (const args of [["plan"], ["doctor"]]) {
      const r = s.rig(args);
      assert.equal(r.code, 0, r.all);
      assert.doesNotMatch(r.all, /E_LOCATOR|E_DRIFT/);
    }
    assert.match(s.rig(["plan"]).stdout, /^update +json-element +claude +~\/\.claude\/settings\.json +core\/session-end$/m);
    const a = s.rig(["apply"]);
    assert.equal(a.code, 0, a.all);
    assert.deepEqual(JSON.parse(s.fx.read(".claude/settings.json")).hooks.SessionEnd, [foreign, current]);
    assert.match(s.rig(["plan"]).stdout, /^0 changes, 0 blocks$/m);
  });

  test("apply --repair converges the same way", (t) => {
    const { s, foreign, current } = orphaned(t);
    assert.equal(s.rig(["apply", "--repair"]).code, 0);
    assert.deepEqual(JSON.parse(s.fx.read(".claude/settings.json")).hooks.SessionEnd, [foreign, current]);
    assert.match(s.rig(["plan"]).stdout, /^0 changes, 0 blocks$/m);
  });

  test("with no exact match (node and rig path changed), the ledger's element is the last one: plan shows an update, not E_DRIFT", (t) => {
    const { s, foreign } = orphaned(t);
    const settings = JSON.parse(s.fx.read(".claude/settings.json"));
    const node = settings.hooks.SessionEnd[2].hooks[0].command.split(" ")[0];
    const el = (path: string) => ({ hooks: [{ type: "command", command: `${node} ${path}/bin/rig.ts stats --record` }] });
    const [a, b] = [el("/A"), el("/B")];
    settings.hooks.SessionEnd = [foreign, a, b];
    writeFileSync(s.fx.path(".claude/settings.json"), canon(settings));
    const inst = JSON.parse(s.fx.read(`${STATE}installed.json`));
    const ent = inst.entries["~/.claude/settings.json"];
    ent.id = b.hooks[0].command;
    ent.digest = jsonDigest(b);
    writeFileSync(s.fx.path(`${STATE}installed.json`), canon(inst));
    const p = s.rig(["plan"]);
    assert.equal(p.code, 0, p.all);
    assert.doesNotMatch(p.all, /E_DRIFT|E_LOCATOR/);
    assert.match(p.stdout, /^update +json-element +claude +~\/\.claude\/settings\.json +core\/session-end$/m, p.stdout);
    const r = s.rig(["apply"]);
    assert.equal(r.code, 0, r.all);
    const list = JSON.parse(s.fx.read(".claude/settings.json")).hooks.SessionEnd;
    assert.equal(list.length, 2, JSON.stringify(list));
    assert.deepEqual(list[0], foreign);
    assert.doesNotMatch(list[1].hooks[0].command, /\/[AB]\/bin\/rig\.ts/);
    assert.match(s.rig(["plan"]).stdout, /^0 changes, 0 blocks$/m);
  });

  test("with no ledger entry, the plan labels the removal of the extra element an update, not insert-markers", (t) => {
    const { s, foreign, current } = orphaned(t);
    const inst = JSON.parse(s.fx.read(`${STATE}installed.json`));
    delete inst.entries["~/.claude/settings.json"];
    writeFileSync(s.fx.path(`${STATE}installed.json`), canon(inst));
    const p = s.rig(["plan"]);
    assert.equal(p.code, 0, p.all);
    assert.match(p.stdout, /^update +json-element +claude +~\/\.claude\/settings\.json +core\/session-end$/m, p.stdout);
    assert.equal(s.rig(["apply"]).code, 0);
    assert.deepEqual(JSON.parse(s.fx.read(".claude/settings.json")).hooks.SessionEnd, [foreign, current]);
  });

  test("turning the hook off removes both rig elements and keeps the foreign one", (t) => {
    const { s, foreign } = orphaned(t);
    const cfg = JSON.parse(s.fx.read("rig/rig.json"));
    writeFileSync(s.fx.path("rig/rig.json"), canon({ ...cfg, metrics: { session_hook: false } }));
    const a = s.rig(["apply"]);
    assert.equal(a.code, 0, a.all);
    assert.deepEqual(JSON.parse(s.fx.read(".claude/settings.json")).hooks.SessionEnd, [foreign]);
    assert.match(s.rig(["plan"]).stdout, /^0 changes, 0 blocks$/m);
  });
});

describe("a session-hook element whose command differs only in the node path", () => {
  const OLD = "/opt/node/v20.0.0/bin/node";

  test("sameCommand: only the node path may differ when the rig bin path is the same", () => {
    const id = "/usr/local/bin/node /opt/rig/bin/rig.ts stats --record";
    assert.ok(sameCommand(id, id));
    assert.ok(sameCommand(`${OLD} /opt/rig/bin/rig.ts stats --record`, id));
    assert.ok(sameCommand("'/home/a b/.nvm/versions/node/v22.1.0/bin/node' /opt/rig/bin/rig.ts stats --record", id));
    assert.ok(!sameCommand("/usr/bin/python /opt/rig/bin/rig.ts stats --record", id), "not a node executable");
    assert.ok(!sameCommand(`${OLD} /opt/rig/bin/rig.ts stats`, id), "another argument list");
    assert.ok(!sameCommand(undefined, id));
  });

  test("patch finds the old element and replaces it in place", () => {
    const id = "/usr/local/bin/node /opt/rig/bin/rig.ts stats --record";
    const old = { hooks: [{ type: "command", command: `${OLD} /opt/rig/bin/rig.ts stats --record` }] };
    const value = { hooks: [{ type: "command", command: id }] };
    const text = canon({ hooks: { SessionEnd: [{ hooks: [{ type: "command", command: "my-logger" }] }, old] } });
    const r = patch(new TextEncoder().encode(text), { kind: "json-element", path: "/h/.claude/settings.json", pointer: "/hooks/SessionEnd", id, value, unit: "core/session-end" });
    assert.equal(r.error, undefined);
    assert.deepEqual(r.current, old);
    assert.deepEqual(JSON.parse(new TextDecoder().decode(r.next)).hooks.SessionEnd, [{ hooks: [{ type: "command", command: "my-logger" }] }, value]);
  });

  test("plan shows an update, doctor exits 0 with no drift, and apply leaves exactly one rig element", (t) => {
    const s = setup({ entry: { harnesses: ["claude"] }, rig: { metrics: { session_hook: true } }, home: { ".claude/settings.json": canon({ theme: "dark" }) } });
    t.after(() => s.fx.cleanup());
    assert.equal(s.rig(["apply"]).code, 0);
    const settings = JSON.parse(s.fx.read(".claude/settings.json"));
    const current = settings.hooks.SessionEnd[0].hooks[0].command;
    const rest = current.slice(current.indexOf(" ") + 1);
    const stale = `${OLD} ${rest}`;
    // The state a node upgrade leaves: settings.json and installed.json both carry the old node path.
    settings.hooks.SessionEnd[0].hooks[0].command = stale;
    writeFileSync(s.fx.path(".claude/settings.json"), canon(settings));
    const inst = JSON.parse(s.fx.read(`${STATE}installed.json`));
    const ent = inst.entries["~/.claude/settings.json"];
    ent.id = stale;
    ent.digest = jsonDigest({ hooks: [{ type: "command", command: stale }] });
    writeFileSync(s.fx.path(`${STATE}installed.json`), canon(inst));

    const p = s.rig(["plan"]);
    assert.equal(p.code, 0, p.all);
    assert.match(p.stdout, /^update +json-element +claude +~\/\.claude\/settings\.json +core\/session-end$/m, p.stdout);
    const d = s.rig(["doctor"]);
    assert.equal(d.code, 0, d.all);
    assert.doesNotMatch(d.stdout, /E_DRIFT/);
    assert.equal(s.rig(["apply"]).code, 0);
    const ends = JSON.parse(s.fx.read(".claude/settings.json")).hooks.SessionEnd;
    assert.deepEqual(ends, [{ hooks: [{ type: "command", command: current }] }]);
    assert.match(s.rig(["plan"]).stdout, /^0 changes, 0 blocks$/m);
  });
});
