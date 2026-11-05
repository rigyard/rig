// pstack, rig's default workflow provider: /craft at the locked plugin-cache path, the frame line, the pstack model
// rules as `whole` files, and pin check, pin set and doctor against installed_plugins.json.
// Done-checks of docs/plan/v0-slices.md: S2.11 (the lock path), S3.3 (the header lines), S4.3 and S4.11.
// Each test runs bin/rig.mjs on a fixture HOME whose repo root (~/rig) is a temp copy of this repo's data.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { compose } from "../lib/stack.mjs";
import { patch, render } from "../lib/targets.mjs";
import { loadWorld } from "../lib/world.mjs";
import { cleanup as rmScratch, makeRepo, scratch } from "./lock.helpers.mjs";
import { filesUnder, json, PLUGIN, repoJson, ROOT, setup, SHA, VERSION } from "./pstack.helpers.mjs";

const FIXTURES = join(ROOT, "test/fixtures/pstack");
const LOCKED = `~/.claude/plugins/cache/cursor-plugins/pstack/${VERSION}/skills/poteto-mode/SKILL.md`;
const RULES = ".claude/rules/pstack-models.md";
const INSTALLED = ".claude/plugins/installed_plugins.json";
const MARKETS = ".claude/plugins/known_marketplaces.json";
const HEADER = readFileSync(join(FIXTURES, "pstack-models-header.md"), "utf8");
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

/** The Claude pstack model rules that roles.json and tiers.json describe, computed here without lib/models.mjs. */
function expectedRules() {
  const { tiers } = repoJson("models/tiers.json");
  const lines = Object.entries(repoJson("models/roles.json").consumers.pstack).map(([key, form]) => {
    if (form.literal) return `# budget: ${form.literal}`;
    const elements = Array.isArray(form[0]) ? form : [form];
    return `${key}: ${elements.map(([tier, effort]) => `${tiers[tier].claude} ${effort}`).join(", ")}`;
  });
  return `${lines.join("\n")}\n`;
}

/** Changed lines between two texts of equal line count, as [before, after]. */
function changedLines(a, b) {
  const x = a.split("\n");
  const y = b.split("\n");
  assert.equal(x.length, y.length);
  return x.flatMap((l, i) => (l === y[i] ? [] : [[l, y[i]]]));
}

describe("pstack /craft and the frame (S2.11)", () => {
  test("plan creates /craft and the model rules; /craft names the locked cache path with no sort or tail", (t) => {
    const s = setup();
    t.after(() => s.fx.cleanup());
    const p = s.rig(["plan"]);
    assert.equal(p.code, 0, p.stdout + p.stderr);
    assert.match(p.stdout, /^create +owned +claude +~\/\.claude\/commands\/craft\.md +core\/craft$/m);
    assert.match(p.stdout, /^create +owned +claude +~\/\.claude\/rules\/pstack-models\.md +pstack\/models$/m);
    const a = s.rig(["apply"]);
    assert.equal(a.code, 0, a.stdout + a.stderr);

    const craft = s.read(".claude/commands/craft.md");
    assert.ok(craft.includes(`If it names pstack: read ${LOCKED} and follow it.`), craft);
    assert.doesNotMatch(craft, /\b(sort|tail)\b/);
    assert.match(craft, /^If no line exists: act as if it names pstack\.$/m);
    assert.match(s.read(".claude/commands/pm.md"), /^Run \/craft with the same arguments\.$/m);
    assert.ok(s.read(".cursor/plugins/local/rig/skills/craft/SKILL.md").includes("If it names pstack: read ~/.cursor/plugins/local/pstack/skills/poteto-mode/SKILL.md and follow it."));
  });

  test("Codex and omp have a null pstack entry: /craft says it is not available there, and their frames omit it", (t) => {
    const s = setup();
    t.after(() => s.fx.cleanup());
    assert.equal(s.rig(["apply"]).code, 0);
    for (const [craft, frame] of [[".codex/prompts/craft.md", ".codex/AGENTS.md"], [".omp/agent/commands/craft.md", ".omp/agent/AGENTS.md"]]) {
      assert.match(s.read(craft), /^If it names pstack: pstack is not available on this harness\. Say so in your first message, then follow the frame\.$/m, craft);
      assert.doesNotMatch(s.read(frame), /^- pstack:/m, frame);
    }
  });

  test("the frame names pstack as the default provider and states the rig-project rule", (t) => {
    const s = setup();
    t.after(() => s.fx.cleanup());
    assert.equal(s.rig(["apply"]).code, 0);
    const frame = s.read(".claude/rules/rig-frame.md");
    assert.match(frame, /^Active workflow provider: the one that a "rig-project: <provider>" line in the project instructions names\.$/m);
    assert.match(frame, /^No such line: pstack\. Files, directories and plugins in the project never select a provider\.$/m);
    assert.match(frame, /^- pstack: enter with \/craft\. Phases: plan, build, verify, review\.$/m);
  });
});

describe("pstack model rules, a whole file with keep_header (S3.3)", () => {
  test("on an empty HOME the Claude file is the budget line and one line per roles.json label, in order", (t) => {
    const s = setup();
    t.after(() => s.fx.cleanup());
    assert.equal(s.rig(["apply"]).code, 0);
    assert.equal(s.read(RULES), expectedRules());
  });

  test("an equal file adopts, and apply leaves its bytes", (t) => {
    const s = setup({ home: { [RULES]: expectedRules() } });
    t.after(() => s.fx.cleanup());
    const before = sha256(readFileSync(s.fx.path(RULES)));
    assert.match(s.rig(["plan"]).stdout, /^adopt +owned +claude +~\/\.claude\/rules\/pstack-models\.md +pstack\/models$/m);
    assert.equal(s.rig(["apply"]).code, 0);
    assert.equal(sha256(readFileSync(s.fx.path(RULES))), before);
    assert.match(s.rig(["plan"]).stdout, /^0 changes, 0 blocks$/m);
  });

  test("pstack's own header lines adopt; a tier change then rewrites only cell lines, and the header stays byte-exact", (t) => {
    const s = setup({ home: { [RULES]: HEADER + expectedRules() } });
    t.after(() => s.fx.cleanup());
    assert.match(s.rig(["plan"]).stdout, /^adopt +owned +claude +~\/\.claude\/rules\/pstack-models\.md/m);
    assert.equal(s.rig(["apply"]).code, 0);
    const before = s.read(RULES);
    const r = s.rig(["models", "set", "strong", "model-z", "--harness", "claude"]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const after = s.read(RULES);
    assert.ok(after.startsWith(HEADER), "the header lines are byte-exact");
    const changed = changedLines(before, after);
    assert.ok(changed.length > 0);
    for (const [was, now] of changed) assert.equal(now, was.replaceAll("opus ", "model-z "), "only cell tokens change");
  });

  test("an unmanaged file with another budget value blocks with E_ADOPT_MISMATCH and keeps its bytes", (t) => {
    const s = setup({ home: { [RULES]: HEADER + expectedRules().replace(/^# budget: .*$/m, "# budget: low (low)") } });
    t.after(() => s.fx.cleanup());
    const before = readFileSync(s.fx.path(RULES));
    const p = s.rig(["plan"]);
    assert.equal(p.code, 1, p.stdout);
    assert.match(p.stdout, /E_ADOPT_MISMATCH.*pstack-models\.md/);
    assert.equal(s.rig(["apply"]).code, 1);
    assert.deepEqual(readFileSync(s.fx.path(RULES)), before);
  });

  test("Cursor: no Cursor tier renders no .mdc and says so; Cursor tiers render dash-fused tokens with alwaysApply", (t) => {
    const s = setup();
    t.after(() => s.fx.cleanup());
    assert.match(s.rig(["plan"]).stdout, /^info absent cursor pstack\/models: tiers\.json names no cursor model, so ~\/\.cursor\/rules\/pstack-models\.mdc does not render$/m);

    const tiers = repoJson("models/tiers.json");
    for (const [name, row] of Object.entries(tiers.tiers)) row.cursor = `slug-${name}`;
    writeFileSync(join(s.root, "models/tiers.json"), json(tiers));
    const w = loadWorld(s.env);
    const desired = render(compose(w), w);
    assert.deepEqual(desired.errors, []);
    const entry = desired.entries.get(s.fx.path(".cursor/rules/pstack-models.mdc"));
    assert.equal(entry.keep_header, true);
    const body = new TextDecoder().decode(entry.bytes);
    assert.ok(body.startsWith("---\nalwaysApply: true\n---\n# budget: medium (high)\nfeature, refactoring: slug-fast-high\n"), body);
    assert.match(body, /^hardest tasks: slug-strong-high$/m, "xhigh clamps to the top of the Cursor ladder");

    // A Cursor model for some tiers only is a render error for that file, not a silent gap.
    const partial = repoJson("models/tiers.json");
    partial.tiers.strong.cursor = "slug-strong";
    writeFileSync(join(s.root, "models/tiers.json"), json(partial));
    const pw = loadWorld(s.env);
    const pd = render(compose(pw), pw);
    assert.deepEqual(pd.errors.map((e) => [e.code, e.path]), [["E_SCHEMA", "~/.cursor/rules/pstack-models.mdc"]]);
    assert.equal(pd.entries.has(s.fx.path(".cursor/rules/pstack-models.mdc")), false);

    // A current file with frontmatter and no "#" line keeps its own frontmatter, once.
    const current = "---\ndescription: pstack model roles\nalwaysApply: true\n---\nfeature, refactoring: old\n";
    const next = new TextDecoder().decode(patch(new TextEncoder().encode(current), entry).next);
    assert.ok(next.startsWith("---\ndescription: pstack model roles\nalwaysApply: true\n---\n# budget: medium (high)\n"), next);
    assert.equal(next.match(/^---$/gm).length, 2);
  });
});

/** A local marketplace repo with the fixture pstack plugin; `edit` changes its files first. */
function marketplace(t, edit = (files) => files) {
  const base = scratch();
  t.after(() => rmScratch(base));
  const dir = join(FIXTURES, "marketplace");
  const files = edit(Object.fromEntries(filesUnder(dir).map((f) => [f.path, f.bytes.toString("utf8")])));
  return makeRepo(base, [files]);
}

const installedAt = (sha, version = VERSION) => json({ version: 2, plugins: { [PLUGIN]: [{ scope: "user", version, gitCommitSha: sha }] } });
const marketsAt = (url, extra = {}) => json({ "cursor-plugins": { source: { source: "git", url }, ...extra } });

describe("rig pin for pstack (S4.3)", () => {
  test("pin check prints the candidate version, commit and tree; pin set promotes it when the installed commit is equal", (t) => {
    const repo = marketplace(t);
    const [commit] = repo.shas;
    const s = setup({ pin: null, home: { [MARKETS]: marketsAt(repo.url), [INSTALLED]: installedAt(commit) } });
    t.after(() => s.fx.cleanup());
    const c = s.rig(["pin", "check", "pstack", "--sha", commit]);
    assert.equal(c.code, 0, c.stdout + c.stderr);
    const m = new RegExp(`^recorded pstack candidate ${VERSION} \\(${commit}\\) (sha256:[0-9a-f]{64}); run rig pin set pstack$`, "m").exec(c.stdout);
    assert.ok(m, c.stdout);
    assert.match(c.stdout, /, 0 blocks$/m);
    const p = s.rig(["pin", "set", "pstack"]);
    assert.equal(p.code, 0, p.stdout + p.stderr);
    const pin = JSON.parse(s.read("rig/rig.lock.json")).pins.pstack;
    assert.deepEqual(pin, { plugin: PLUGIN, current: { version: VERSION, sha: commit, tree: m[1] }, candidate: null });
  });

  test("pin set refuses another installed commit: exit 1, and rig.lock.json keeps its bytes", (t) => {
    const repo = marketplace(t);
    const [commit] = repo.shas;
    const s = setup({ pin: null, home: { [MARKETS]: marketsAt(repo.url), [INSTALLED]: installedAt(SHA) } });
    t.after(() => s.fx.cleanup());
    assert.equal(s.rig(["pin", "check", "pstack", "--sha", commit]).code, 0);
    const before = readFileSync(join(s.root, "rig.lock.json"));
    const p = s.rig(["pin", "set", "pstack"]);
    assert.equal(p.code, 1);
    assert.match(p.stderr, new RegExp(`E_PIN_UNCHECKED installed ${PLUGIN} is at ${SHA}, not the checked ${commit}`));
    assert.deepEqual(readFileSync(join(s.root, "rig.lock.json")), before);
  });

  test("a plugin manifest with no license blocks the candidate, and the lock records nothing", (t) => {
    const repo = marketplace(t, (files) => ({ ...files, "pstack/.claude-plugin/plugin.json": json({ name: "pstack", version: VERSION }) }));
    const s = setup({ pin: null, home: { [MARKETS]: marketsAt(repo.url), [INSTALLED]: installedAt(repo.shas[0]) } });
    t.after(() => s.fx.cleanup());
    const before = readFileSync(join(s.root, "rig.lock.json"));
    const c = s.rig(["pin", "check", "pstack", "--sha", repo.shas[0]]);
    assert.equal(c.code, 1, c.stdout);
    assert.match(c.stdout, /^block license pstack\/pack\.json: license missing$/m);
    assert.deepEqual(readFileSync(join(s.root, "rig.lock.json")), before);
  });
});

describe("rig doctor for the pstack pin (S4.11)", () => {
  test("an installed commit equal to the lock: exit 0 and an info line with both versions", (t) => {
    const s = setup({ pins: ["pstack"], home: { [INSTALLED]: installedAt(SHA) } });
    t.after(() => s.fx.cleanup());
    const d = s.rig(["doctor"]);
    assert.equal(d.code, 0, d.stdout + d.stderr);
    assert.match(d.stdout, new RegExp(`^info +pin +pstack ${PLUGIN}: locked ${VERSION} \\(0123456\\); installed ${VERSION} \\(0123456, user\\)$`, "m"));
  });

  test("another installed commit: exit 1, names pstack, both commits and both versions", (t) => {
    const other = "fedcba9876543210fedcba9876543210fedcba98";
    const s = setup({ pins: ["pstack"], home: { [INSTALLED]: installedAt(other, "9.9.0") } });
    t.after(() => s.fx.cleanup());
    const d = s.rig(["doctor"]);
    assert.equal(d.code, 1, d.stdout + d.stderr);
    assert.match(d.stdout, new RegExp(`^error +pin +pstack/~/\\.claude/plugins/installed_plugins\\.json: installed ${PLUGIN} ${other} differs from locked ${SHA}$`, "m"));
    assert.match(d.stdout, new RegExp(`^info +pin +pstack ${PLUGIN}: locked ${VERSION} \\(0123456\\); installed 9\\.9\\.0 \\(fedcba9, user\\)$`, "m"));
  });

  test("a marketplace with autoUpdate on that serves pstack is named", (t) => {
    const s = setup({ pins: ["pstack"], home: { [INSTALLED]: installedAt(SHA), [MARKETS]: marketsAt("https://example.invalid/m.git", { autoUpdate: true }) } });
    t.after(() => s.fx.cleanup());
    const d = s.rig(["doctor"]);
    assert.match(d.stdout, new RegExp(`^warn +pin +pstack/~/\\.claude/plugins/known_marketplaces\\.json: marketplace cursor-plugins has auto-update on and serves pinned plugin ${PLUGIN}$`, "m"));
  });

  test("with no installed record, the info line says so", (t) => {
    const s = setup({ pins: ["pstack"] });
    t.after(() => s.fx.cleanup());
    assert.match(s.rig(["doctor"]).stdout, new RegExp(`^info +pin +pstack ${PLUGIN}: locked ${VERSION} \\(0123456\\); not installed$`, "m"));
  });
});
