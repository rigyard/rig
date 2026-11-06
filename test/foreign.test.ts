// E_FOREIGN_INSTALL of the pin check over a real fixture HOME: Claude Code plugin records with their scope and
// enabledPlugins, omp and Antigravity plugins, clones or links with an upstream name, and unmanaged skill dirs that a pack leaves out.

import assert from "node:assert/strict";
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { gate } from "../lib/gate.ts";
import { makeFixtureHome } from "./helpers/fixture-home.ts";
import { desired, pack, stack, world } from "./gate.helpers.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const targets = Object.fromEntries(["claude", "codex", "cursor", "omp"].map((h) => [h, JSON.parse(readFileSync(join(ROOT, `targets/${h}.json`), "utf8"))]));
const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;
const SKILL = "---\nname: x\ndescription: Not rig's.\n---\nMine.\n";

function pstack() {
  const p = pack("pstack", { "skills/poteto-mode/SKILL.md": "# Hub\n", "skills/how/SKILL.md": SKILL });
  Object.assign(p.manifest, { foreign_block: ["poteto-mode", "setup-pstack"], mode: { adopt: { "hub.md": { from: "skills/poteto-mode/SKILL.md" } } } });
  return p;
}
const ENTRIES = {
  pstack: { repo: "https://github.com/cursor/plugins", root: "pstack", exclude: ["skills/setup-pstack", "skills/statechart", "skills/poteto-mode/scripts"] },
  product: { repo: "https://github.com/garrytan/gstack", root: ".", exclude: [] },
};

/** E_FOREIGN_INSTALL findings of one gate run over a fixture HOME, as "severity path evidence". `late` files get the HOME path. */
function foreign(files: Record<string, string> = {}, o: {links?: Record<string, string>, owned?: string[], late?: (home: string) => Record<string, string>} = {}) {
  const fx = makeFixtureHome(files);
  try {
    for (const [rel, text] of Object.entries(o.late?.(fx.home) ?? {})) {
      mkdirSync(join(fx.home, rel, ".."), { recursive: true });
      writeFileSync(join(fx.home, rel), text);
    }
    for (const [rel, to] of Object.entries(o.links ?? {})) {
      mkdirSync(join(fx.home, rel, ".."), { recursive: true });
      symlinkSync(to, join(fx.home, rel));
    }
    const packs = [pstack(), pack("product", { "office-hours/SKILL.md": SKILL })];
    const w = world({ packs: packs as never[], targets });
    for (const [name, e] of Object.entries(ENTRIES)) Object.assign(w.locks.repo.packs[name], e);
    w.env = { ...w.env, home: fx.home, state: join(fx.home, ".local/state/rig") };
    const owned = Object.fromEntries((o.owned ?? []).map((p) => [join(fx.home, p), { unit: "pstack/x", text: SKILL }]));
    return gate(stack(), desired(owned), w as never).findings.filter((f) => f.evidence.startsWith("E_FOREIGN_INSTALL")).map((f) => `${f.severity} ${f.path} ${f.evidence}`);
  } finally {
    fx.cleanup();
  }
}

const installed = (id: string, installs: object[]) => json({ version: 2, plugins: { [id]: installs } });

describe("E_FOREIGN_INSTALL for Claude Code plugin records", () => {
  test("an enabled user install blocks and names the user scope", () => {
    const f = foreign({ ".claude/plugins/installed_plugins.json": installed("pstack@cursor-plugins", [{ scope: "user" }]), ".claude/settings.json": json({ enabledPlugins: { "pstack@cursor-plugins": true } }) });
    assert.deepEqual(f, ["block harness:claude E_FOREIGN_INSTALL pstack: Claude Code has the plugin pstack@cursor-plugins installed (scope user), and pack pstack seeds the same upstream; rig never deletes what it does not own, so run claude plugin uninstall pstack@cursor-plugins --scope user"]);
  });

  test("an install that enabledPlugins sets to false warns instead of blocking", () => {
    const f = foreign({ ".claude/plugins/installed_plugins.json": installed("pstack@cursor-plugins", [{ scope: "user" }]), ".claude/settings.json": json({ enabledPlugins: { "pstack@cursor-plugins": false } }) });
    assert.equal(f.length, 1);
    assert.match(f[0], /^warn harness:claude E_FOREIGN_INSTALL pstack: Claude Code has the plugin pstack@cursor-plugins installed \(scope user\) but not enabled, /);
  });

  test("an install with no enabledPlugins value blocks, because rig cannot tell that Claude Code skips it", () => {
    const f = foreign({ ".claude/plugins/installed_plugins.json": installed("pstack@cursor-plugins", [{ scope: "user" }]) });
    assert.match(f[0], /^block harness:claude /);
  });

  test("an empty install list gives no finding", () => {
    assert.deepEqual(foreign({ ".claude/plugins/installed_plugins.json": installed("pstack@cursor-plugins", []) }), []);
  });

  test("each install entry gives its own finding; a project install names the project path, and its project settings decide", () => {
    const f = foreign({ ".claude/settings.json": json({ enabledPlugins: { "pstack@cursor-plugins": false } }) }, {
      late: (home) => ({
        ".claude/plugins/installed_plugins.json": installed("pstack@cursor-plugins", [{ scope: "user" }, { scope: "project", projectPath: join(home, "app") }, { scope: "local", projectPath: join(home, "lab") }]),
        "app/.claude/settings.json": json({ enabledPlugins: { "pstack@cursor-plugins": true } }),
        "lab/.claude/settings.json": json({ enabledPlugins: { "pstack@cursor-plugins": true } }),
        "lab/.claude/settings.local.json": json({ enabledPlugins: { "pstack@cursor-plugins": false } }),
      }),
    }).map((l) => l.replace(/\/\S*\/(app|lab)\b/g, "<HOME>/$1"));
    assert.deepEqual(f.map((l) => l.replace(/, and pack .*, so /, " ... ")), [
      "block harness:claude E_FOREIGN_INSTALL pstack: Claude Code has the plugin pstack@cursor-plugins installed (scope project in <HOME>/app) ... run claude plugin uninstall pstack@cursor-plugins --scope project in <HOME>/app",
      "warn harness:claude E_FOREIGN_INSTALL pstack: Claude Code has the plugin pstack@cursor-plugins installed (scope local in <HOME>/lab) but not enabled ... run claude plugin uninstall pstack@cursor-plugins --scope local in <HOME>/lab",
      "warn harness:claude E_FOREIGN_INSTALL pstack: Claude Code has the plugin pstack@cursor-plugins installed (scope user) but not enabled ... run claude plugin uninstall pstack@cursor-plugins --scope user",
    ]);
  });
});

describe("E_FOREIGN_INSTALL for omp plugins", () => {
  const lock = (enabled: boolean) => json({ plugins: { "pi-herdr-agents": { version: "3.7.2", enabled: true }, "@casualjim/pi-pstack": { version: "0.1.24", enabled } }, settings: {} });

  test("an enabled package that ships pstack blocks with the omp uninstall command; another package gives nothing", () => {
    assert.deepEqual(foreign({ ".omp/plugins/omp-plugins.lock.json": lock(true) }), [
      "block harness:omp E_FOREIGN_INSTALL pstack: omp has the plugin @casualjim/pi-pstack in ~/.omp/plugins/omp-plugins.lock.json, and pack pstack seeds the same upstream; rig never deletes what it does not own, so run omp plugin uninstall @casualjim/pi-pstack",
    ]);
  });

  test("a disabled package warns", () => {
    const f = foreign({ ".omp/plugins/omp-plugins.lock.json": lock(false) });
    assert.match(f[0], /^warn harness:omp E_FOREIGN_INSTALL pstack: omp has the plugin @casualjim\/pi-pstack in ~\/\.omp\/plugins\/omp-plugins\.lock\.json but not enabled, /);
  });
});

describe("E_FOREIGN_INSTALL for Antigravity plugins", () => {
  const dir = ".gemini/config/plugins";

  test("a plugin dir named after a seeded upstream blocks with the agy uninstall command; another plugin gives nothing", () => {
    assert.deepEqual(foreign({ [`${dir}/pstack/plugin.json`]: json({ name: "pstack" }), [`${dir}/science/plugin.json`]: json({ name: "science" }) }), [
      "block harness:antigravity E_FOREIGN_INSTALL pstack: Antigravity has the plugin pstack in ~/.gemini/config/plugins/pstack, and pack pstack seeds the same upstream; rig never deletes what it does not own, so run agy plugin uninstall pstack",
    ]);
  });

  test("an imported Claude Code plugin whose manifest names the upstream blocks too", () => {
    const f = foreign({ [`${dir}/cursor-pstack/.claude-plugin/plugin.json`]: json({ name: "pstack" }) });
    assert.match(f[0], /^block harness:antigravity E_FOREIGN_INSTALL pstack: Antigravity has the plugin cursor-pstack in ~\/\.gemini\/config\/plugins\/cursor-pstack, .* run agy plugin uninstall cursor-pstack$/);
  });

  test("config.json plugins.<dir>.enabled false warns, and it wins over the manifest", () => {
    const off = foreign({ [`${dir}/pstack/plugin.json`]: json({ name: "pstack" }), ".gemini/config/config.json": json({ plugins: { pstack: { enabled: false } } }) });
    assert.match(off[0], /^warn harness:antigravity E_FOREIGN_INSTALL pstack: Antigravity has the plugin pstack in ~\/\.gemini\/config\/plugins\/pstack but not enabled, /);
    const on = foreign({ [`${dir}/pstack/plugin.json`]: json({ name: "pstack", disabled: true }), ".gemini/config/config.json": json({ plugins: { pstack: { enabled: true } } }) });
    assert.match(on[0], /^block harness:antigravity /);
  });

  test("a manifest that ships disabled warns; a dir with no manifest is no plugin", () => {
    assert.match(foreign({ [`${dir}/pstack/plugin.json`]: json({ disabled: true }) })[0], /^warn harness:antigravity .* but not enabled, /);
    assert.deepEqual(foreign({ [`${dir}/pstack/README.md`]: "x\n" }), []);
  });
});

describe("E_FOREIGN_INSTALL for Codex plugins", () => {
  const cached = { ".codex/plugins/cache/cursor-plugins/pstack/local/.codex-plugin/plugin.json": "{}\n" };
  const config = (enabled: boolean) => `[plugins."pstack@cursor-plugins"]\nenabled = ${enabled}\n\n[plugins."github@openai-curated"]\nenabled = true\n`;

  test("a cached plugin with an enabled table blocks and names the Codex path and the remove command", () => {
    assert.deepEqual(foreign({ ...cached, ".codex/plugins/cache/openai-curated/github/1.0.0/.codex-plugin/plugin.json": "{}\n", ".codex/config.toml": config(true) }), [
      "block harness:codex E_FOREIGN_INSTALL pstack: Codex has the plugin pstack@cursor-plugins in ~/.codex/plugins/cache/cursor-plugins/pstack, and pack pstack seeds the same upstream; rig never deletes what it does not own, so run codex plugin remove pstack@cursor-plugins",
    ]);
  });

  test("a table without `enabled` counts as enabled and blocks", () => {
    assert.match(foreign({ ...cached, ".codex/config.toml": '[plugins."pstack@cursor-plugins"]\n' })[0], /^block harness:codex /);
  });

  test("a plugin that config.toml disables warns", () => {
    const f = foreign({ ...cached, ".codex/config.toml": config(false) });
    assert.equal(f.length, 1);
    assert.match(f[0], /^warn harness:codex E_FOREIGN_INSTALL pstack: Codex has the plugin pstack@cursor-plugins in ~\/\.codex\/plugins\/cache\/cursor-plugins\/pstack but not enabled, /);
  });

  test("a cache dir with no config.toml, or no table for it, is not installed and gives nothing", () => {
    assert.deepEqual(foreign(cached), []);
    assert.deepEqual(foreign({ ...cached, ".codex/config.toml": '[plugins."github@openai-curated"]\nenabled = true\n' }), []);
  });

  test("a commented header before the real table does not hide enabled = false", () => {
    const f = foreign({ ...cached, ".codex/config.toml": '# [plugins."pstack@cursor-plugins"]\n#enabled = true\n\n[plugins."pstack@cursor-plugins"]\nenabled = false\n' });
    assert.equal(f.length, 1);
    assert.match(f[0], /^warn harness:codex /);
  });

  test("a commented header alone is not a table", () => {
    assert.deepEqual(foreign({ ...cached, ".codex/config.toml": '# [plugins."pstack@cursor-plugins"]\nenabled = true\n' }), []);
  });

  test("spaces inside the brackets, and an indented header, still match the table", () => {
    const f = foreign({ ...cached, ".codex/config.toml": '[ plugins."pstack@cursor-plugins" ]\nenabled = false\n' });
    assert.equal(f.length, 1);
    assert.match(f[0], /^warn harness:codex /);
    assert.match(foreign({ ...cached, ".codex/config.toml": '  [ plugins."pstack@cursor-plugins" ]\n  enabled = true\n' })[0], /^block harness:codex /);
  });

  test("no Codex plugin cache, or only other plugins, gives nothing", () => {
    assert.deepEqual(foreign(), []);
    assert.deepEqual(foreign({ ".codex/plugins/cache/openai-curated/github/1.0.0/.codex-plugin/plugin.json": "{}\n", ".codex/config.toml": config(false) }), []);
  });
});

describe("E_FOREIGN_INSTALL for skill dirs in a read-set", () => {
  test("a gstack clone dir or a gstack link in ~/.claude/skills blocks", () => {
    assert.deepEqual(foreign({ ".claude/skills/gstack/README.md": "# gstack\n" }), [
      "block ~/.claude/skills/gstack E_FOREIGN_INSTALL gstack: ~/.claude/skills/gstack is a clone or link of the upstream, read by claude, cursor, and pack product seeds the same upstream; rig never deletes what it does not own, so move or delete ~/.claude/skills/gstack by hand",
    ]);
    assert.match(foreign({}, { links: { ".claude/skills/gstack": "/nowhere/gstack" } })[0], /^block ~\/\.claude\/skills\/gstack E_FOREIGN_INSTALL gstack: /);
  });

  test("a left-out name blocks when the pack lists it in foreign_block, and warns otherwise", () => {
    const f = foreign({ ".agents/skills/poteto-mode/SKILL.md": SKILL, ".agents/skills/setup-pstack/SKILL.md": SKILL, ".agents/skills/statechart/SKILL.md": SKILL, ".agents/skills/scripts/SKILL.md": SKILL });
    assert.deepEqual(f.map((l) => l.split(" ").slice(0, 2).join(" ")), ["block ~/.agents/skills/poteto-mode", "block ~/.agents/skills/setup-pstack", "warn ~/.agents/skills/statechart"]);
    assert.match(f[0], /: ~\/\.agents\/skills\/poteto-mode is a skill dir that rig does not manage, read by codex, cursor, omp, and pack pstack leaves skills\/poteto-mode out and lists it in foreign_block, because a second copy competes with the seed; rig never deletes what it does not own, so move or delete ~\/\.agents\/skills\/poteto-mode by hand$/);
    assert.match(f[2], /, and pack pstack leaves skills\/statechart out of the seed; /);
  });

  test("a skill dir that rig renders this run or recorded as owned gives no finding", () => {
    assert.deepEqual(foreign({ ".agents/skills/statechart/SKILL.md": SKILL }, { owned: [".agents/skills/statechart/SKILL.md"] }), []);
    const state = json({ schema: 1, entries: { "~/.claude/skills/setup-pstack/SKILL.md": { kind: "owned", sha256: "0", mode: 420, unit: "pstack/setup-pstack", run: null } } });
    assert.deepEqual(foreign({ ".claude/skills/setup-pstack/SKILL.md": SKILL, ".local/state/rig/installed.json": state }), []);
  });
});
