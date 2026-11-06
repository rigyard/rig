import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compose } from "../lib/stack.ts";
import { render } from "../lib/targets.ts";
import { gate } from "../lib/gate.ts";
import { insertAnchor, stripAnchor } from "../lib/mode.ts";
import { setFrontmatterKey } from "../lib/targets/formats.ts";
import { HARNESSES } from "./render.helpers.ts";
import { PACK, craftFiles, craftFixture, craftManifest, lockFor } from "./mode.helpers.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BIN = join(ROOT, "bin/rig.ts");
type TargetRec = {reads: {skills: {path: string, dedupe: string}[]}, hide: {method: string, key?: string, file?: string, value?: unknown}};
const RECORDS = new Map<string, TargetRec>(HARNESSES.map((h) => [h, JSON.parse(readFileSync(join(ROOT, `targets/${h}.json`), "utf8"))]));
const record = (h: string): TargetRec => RECORDS.get(h)!;
const dec = new TextDecoder();

type Spec = Parameters<typeof craftFixture>[0];
type Built = ReturnType<typeof built>;
type Finding = ReturnType<typeof gate>["findings"][number];

function built(o: Spec = {}) {
  const fx = craftFixture(o);
  try {
    const world = fx.load();
    const stack = compose(world);
    const desired = render(stack, world);
    const at = new Map([...desired.entries].map(([abs, e]) => [`~/${abs.slice(fx.home.length + 1)}`, "bytes" in e ? dec.decode(e.bytes) : ""]));
    const text = (p: string) => {
      const t = at.get(p);
      assert.ok(t !== undefined, `${p} is not planned`);
      return t;
    };
    return { stack, text, has: (p: string) => at.has(p), paths: [...at.keys()], findings: gate(stack, desired, world).findings, errors: [...stack.errors, ...desired.errors], info: desired.info };
  } finally {
    fx.cleanup();
  }
}

function plan(o: Spec = {}) {
  const fx = craftFixture(o);
  try {
    const r = spawnSync(process.execPath, [BIN, "plan"], { env: { PATH: process.env.PATH, ...fx.env }, encoding: "utf8" });
    return { code: r.status, out: r.stdout + r.stderr };
  } finally {
    fx.cleanup();
  }
}

const codes = (b: Built) => b.errors.map((e) => e.code);
const errorOf = (b: Built, code: string) => {
  const e = b.errors.find((x) => x.code === code);
  assert.ok(e, `no ${code} in ${JSON.stringify(b.errors)}`);
  return e;
};
const craftDirs = (b: Built) => b.paths.filter((p) => p.endsWith("/craft/SKILL.md")).map((p) => p.slice(0, -"/craft/SKILL.md".length));
const withManifest = (change: (m: any) => object) => ({ manifest: change(craftManifest()) });
const hub = (extra: string) => ({ files: { "skills/poteto-mode/SKILL.md": `${craftFiles()["skills/poteto-mode/SKILL.md"]}${extra}\n` } });
const modeFindings = (b: Built) => b.findings.filter((f: Finding) => f.check === "mode");

/** Each harness sees one craft after its dedupe rule. Its adapter and the adapter next to each leaf it reads hold its section. */
function assertOneCraft(b: Built, leafReaders: string[]) {
  for (const h of HARNESSES) {
    const reads = record(h).reads.skills;
    const copies = reads.filter((d) => b.has(`${d.path}/craft/SKILL.md`));
    const distinct = (dedupe: string) => dedupe === "by-name" ? Math.min(copies.length, 1)
      : dedupe === "identical-bytes" ? new Set(copies.map((d) => b.paths.filter((p) => p.startsWith(`${d.path}/craft/`)).map((p) => `${p.slice(d.path.length)}\0${b.text(p)}`).join("\n"))).size
      : copies.length;
    assert.equal(distinct(reads[0].dedupe), 1, `${h} sees ${copies.length} craft copies`);
    assert.match(b.text(`${copies[0].path}/craft/references/adapter.md`), new RegExp(`^## ${h}$`, "m"), h);
    if (!leafReaders.includes(h)) continue;
    for (const leaf of ["architect", "design-probe"]) {
      const dir = reads.find((d) => b.has(`${d.path}/${leaf}/SKILL.md`));
      assert.ok(dir, `${h} reads ${leaf}`);
      assert.match(b.text(`${dir.path}/craft/references/adapter.md`), new RegExp(`^## ${h}$`, "m"), `${h} ${leaf}`);
    }
  }
}

describe("adopted files", () => {
  test("hub.md, playbooks/ and references/bugbot-triage.md land at their craft/ paths with the pack bytes", () => {
    const b = built();
    assert.deepEqual(b.errors, []);
    const src = craftFiles();
    const dirs = craftDirs(b);
    assert.ok(dirs.length > 0);
    for (const dir of dirs) {
      assert.equal(b.text(`${dir}/craft/hub.md`), src["skills/poteto-mode/SKILL.md"], dir);
      assert.equal(b.text(`${dir}/craft/playbooks/bug-fix.md`), src["skills/poteto-mode/playbooks/bug-fix.md"], dir);
      assert.equal(b.text(`${dir}/craft/references/bugbot-triage.md`), src["skills/poteto-mode/references/bugbot-triage.md"], dir);
    }
    assert.ok(!b.stack.units.some((u) => u.name === "poteto-mode"), "the hub gives no unit");
  });

  test("with the fixture pack, rig plan plans the shell, the hub, the playbook, one file per domain and the adapter", () => {
    const r = plan();
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /^0 blocks|, 0 blocks$/m);
    for (const f of ["SKILL.md", "hub.md", "playbooks/bug-fix.md", "references/bugbot-triage.md", "references/adapter.md",
      "references/business.md", "references/product.md", "references/engineering.md", "references/upkeep.md"]) {
      assert.match(r.out, new RegExp(`^create\\s+owned\\s+claude\\s+~/\\.claude/skills/craft/${f.replaceAll(".", "\\.")}\\s+core/craft$`, "m"), f);
    }
  });

  test("an adopt clash across packs, a second hub, and an adopt onto a rendered path each give E_CLASH", () => {
    const other = (adopt: object) => ({
      "packs/other/pack.json": { schema: 2, name: "other", license: "MIT", mode: { adopt } },
      "packs/other/notes/hub.md": "# other hub\n",
      "packs/other/notes/plays/bug-fix.md": "# other bug fix\n",
    });
    const rig = { packs: { product: {}, [PACK]: {}, other: {} } };
    const clash = built({ rig, repo: other({ "playbooks/": { from: "notes/plays/" } }) });
    assert.match(errorOf(clash, "E_CLASH").message, /^craft\/playbooks\/bug-fix\.md: packs fixture and other both adopt it/);
    const hubs = built({ rig, repo: other({ "hub.md": { from: "notes/hub.md" } }) });
    assert.match(errorOf(hubs, "E_CLASH").message, /^craft\/hub\.md: packs fixture and other both adopt it/);
    const onto = built(withManifest((m: any) => ({ ...m, mode: { ...m.mode, adopt: { ...m.mode.adopt, "references/adapter.md": { from: "skills/poteto-mode/references/bugbot-triage.md" } } } })));
    assert.match(errorOf(onto, "E_CLASH").message, /^craft\/references\/adapter\.md: .* adopts a path that rig renders/);
  });
});

describe("fills, hooks, triggers and artifacts", () => {
  test("{{skill:...}} resolves to a link relative to each craft copy, per harness dir", () => {
    const b = built();
    for (const dir of craftDirs(b)) {
      const adapter = b.text(`${dir}/craft/references/adapter.md`);
      if (!adapter.includes("## claude") && !adapter.includes("## codex")) continue;
      assert.match(adapter, /\[architect\]\(\.\.\/\.\.\/architect\/SKILL\.md\)/, dir);
      assert.ok(b.has(`${dir}/architect/SKILL.md`), `${dir}: the link target is planned`);
    }
  });

  test("a fill at a pack hook address replaces the pack list", () => {
    const pack = built({ rig: { fill: {} } });
    assert.match(pack.text("~/.claude/skills/craft/references/engineering.md"), /^- `eng:review`\. Before: \[architect\]/m);
    const team = built({ rig: { fill: { "eng:review.before": [`${PACK}/design-probe`] } } });
    assert.match(team.text("~/.claude/skills/craft/references/engineering.md"), /^- `eng:review`\. Before: \[design-probe\]\(\.\.\/\.\.\/design-probe\/SKILL\.md\)\. Slot: none\. After: none\.$/m);
  });

  test("a pack hook that names an absent unit gives no E_MODE_REF when a fill replaces its list", () => {
    const hooks = withManifest((m: any) => ({ ...m, mode: { ...m.mode, hooks: { "eng:review.before": ["cursor-team-kit/deslop"] } } }));
    const replaced = built({ ...hooks, rig: { fill: { "eng:review.before": [`${PACK}/design-probe`] } } });
    assert.deepEqual(replaced.errors, []);
    assert.match(replaced.text("~/.claude/skills/craft/references/engineering.md"), /^- `eng:review`\. Before: \[design-probe\]/m);
    const emptied = built({ ...hooks, rig: { fill: { "eng:review.before": [] } } });
    assert.deepEqual(emptied.errors, []);
    assert.match(emptied.text("~/.claude/skills/craft/references/engineering.md"), /^- `eng:review`\. Before: none\./m);
    const kept = built({ ...hooks, rig: { fill: {} } });
    assert.match(errorOf(kept, "E_MODE_REF").message, /^cursor-team-kit\/deslop: packs\/fixture\/pack\.json mode\.hooks\.eng:review\.before names no kept unit/);
  });

  test("every fill address form lands in its domain file; a fill trigger with no domain goes in the frame, a pack trigger with no domain in the shell", () => {
    const b = built({
      ...withManifest((m: any) => ({ ...m, mode: { ...m.mode, triggers: [{ when: "A boundary moves", then: "Use {{skill:fixture/architect}}." }] } })),
      rig: {
        fill: {
          "eng:design": `${PACK}/design-probe`,
          "eng:ship.before": [`${PACK}/architect`],
          "upk:retire.after": [`${PACK}/design-probe`],
          triggers: [
            { when: "Building or changing a CLI", use: `${PACK}/architect`, domain: "engineering" },
            { when: "Any task names a boundary", use: `${PACK}/design-probe` },
          ],
        },
      },
    });
    assert.deepEqual(b.errors, []);
    const eng = b.text("~/.claude/skills/craft/references/engineering.md");
    assert.match(eng, /^- `eng:design`\. Before: none\. Slot: \[design-probe\]/m);
    assert.match(eng, /^- `eng:ship`\. Before: \[architect\]/m);
    assert.match(eng, /^- When Building or changing a CLI: Use \[architect\]\(\.\.\/\.\.\/architect\/SKILL\.md\)\.$/m);
    assert.match(b.text("~/.claude/skills/craft/references/upkeep.md"), /^- `upk:retire`\. Before: none\. Slot: none\. After: \[design-probe\]/m);
    const shell = b.text("~/.claude/skills/craft/SKILL.md");
    assert.match(shell, /^- When A boundary moves: Use \[architect\]\(\.\.\/architect\/SKILL\.md\)\.$/m);
    assert.doesNotMatch(shell, /Building or changing a CLI|Any task names a boundary/);
    assert.match(shell, /^The rig frame lists the triggers of rig\.json `fill` that name no domain\. Every session loads it\. The pack triggers with no domain follow\.$/m);
    assert.deepEqual(b.stack.mode!.triggers, [{ when: "A boundary moves", then: "Use {{skill:fixture/architect}}." }, { when: "Any task names a boundary", use: `${PACK}/design-probe` }]);
  });

  test("a step that holds the unit of a frame trigger quotes that trigger under the step, so the model runs the step and not the frame line", () => {
    const text = (b: Built) => b.text("~/.claude/skills/craft/references/engineering.md");
    const probe = `${PACK}/design-probe`;
    const triggers = [{ when: "Before commit", use: probe }, { when: "Any task names a boundary", use: `${PACK}/architect` }];
    const b = built({ rig: { fill: { "eng:ship.before": [probe], triggers } } });
    assert.deepEqual(b.errors, []);
    assert.ok(text(b).includes("- `eng:ship`. Before: [design-probe](../../design-probe/SKILL.md). Slot: none. After: none.\n  Replaces the frame trigger: \"Before commit\"\n"), text(b));
    assert.ok(text(b).includes("- `eng:review`. Before: [architect](../../architect/SKILL.md). Slot: none. After: none.\n  Replaces the frame trigger: \"Any task names a boundary\"\n"), "a pack hook counts too");
    assert.equal(text(b).match(/^  Replaces the frame trigger:/gm)?.length, 2);
    const slot = built({ rig: { fill: { "eng:design": probe, triggers: [{ when: "Before commit", use: probe }] } } });
    assert.match(text(slot), /^- `eng:design`\. Before: none\. Slot: \[design-probe\].*\n(?:  Replaces the hub trigger: .*\n)?  Replaces the frame trigger: "Before commit"$/m);
    const apart = built({ rig: { fill: { "eng:ship.before": [`${PACK}/architect`], triggers: [{ when: "Before commit", use: probe }] } } });
    assert.doesNotMatch(text(apart), /^  Replaces the frame trigger/m);
    const domain = built({ rig: { fill: { "eng:ship.before": [probe], triggers: [{ when: "Before commit", use: probe, domain: "engineering" }] } } });
    assert.doesNotMatch(text(domain), /^  Replaces the frame trigger/m);
  });

  test("a fill trigger that names no kept unit is E_MODE_REF; one that names a disabled unit is dropped with no error", () => {
    const missing = built({ rig: { fill: { triggers: [{ when: "Before review", use: "fixture/nope" }] } } });
    assert.match(errorOf(missing, "E_MODE_REF").message, /^fixture\/nope: rig\.json fill\.triggers\[0\]\.use names no kept unit$/);
    const disabled = built({ rig: { fill: { triggers: [{ when: "Before review", use: `${PACK}/architect` }] }, disable: [`${PACK}/architect`] } });
    assert.deepEqual(disabled.errors, []);
    assert.deepEqual(disabled.stack.mode!.triggers, []);
  });

  test("disable removes a unit from every step, and auto cannot name it", () => {
    const b = built({ rig: { disable: [`${PACK}/architect`], auto: [`${PACK}/architect`] } });
    assert.deepEqual(codes(b), ["E_MODE_REF"]);
    assert.match(errorOf(b, "E_MODE_REF").message, /^fixture\/architect: rig\.json auto\[0\] names no kept unit/);
    assert.match(b.text("~/.claude/skills/craft/references/engineering.md"), /^- `eng:review`\. Before: none\./m);
  });

  test("an unknown step address prints E_FILL_UNKNOWN with the address", () => {
    const r = plan({ rig: { fill: { "eng:shipit": `${PACK}/architect` } } });
    assert.equal(r.code, 1);
    assert.match(r.out, /^block E_FILL_UNKNOWN eng:shipit: /m);
  });

  test("a slot address with a list and a hook address with one unit are E_FILL_UNKNOWN", () => {
    const b = built({ rig: { fill: { "eng:design": [`${PACK}/architect`], "eng:ship.before": `${PACK}/architect` } } });
    assert.deepEqual(codes(b).sort(), ["E_FILL_UNKNOWN", "E_FILL_UNKNOWN"]);
  });

  test("a fill that names no kept unit is E_MODE_REF", () => {
    const b = built({ rig: { fill: { "eng:design": "fixture/nope" } } });
    assert.match(errorOf(b, "E_MODE_REF").message, /^fixture\/nope: rig\.json fill\.eng:design names no kept unit/);
  });

  test("an artifact that requires prd with no writer prints E_ARTIFACT_DANGLING prd", () => {
    const brief = { generates: "docs/designs/<slug>.md", write_at: "prod:discover", instruction: "Write the brief.", requires: ["prd"] };
    const o = withManifest((m: any) => ({ ...m, mode: { ...m.mode, artifacts: { sketch: brief } } }));
    const r = plan(o);
    assert.equal(r.code, 1);
    assert.match(r.out, /^block E_ARTIFACT_DANGLING prd: /m);
    const ok = built(withManifest((m: any) => ({ ...m, mode: { ...m.mode, artifacts: { sketch: { ...brief, requires: [] } } } })));
    assert.deepEqual(ok.errors, []);
    assert.match(ok.text("~/.claude/skills/craft/references/product.md"), /^- `sketch` writes `docs\/designs\/<slug>\.md` at `prod:discover`\. Requires: none\. Write the brief\.$/m);
  });

  test("an adopted playbook with no label prints E_PLAYBOOK_UNLABELED and its path", () => {
    const r = plan({ files: { "skills/poteto-mode/playbooks/feature.md": "# Feature\n\n1. Name the data shape.\n" } });
    assert.equal(r.code, 1);
    assert.match(r.out, /^block E_PLAYBOOK_UNLABELED fixture\/skills\/poteto-mode\/playbooks\/feature\.md: /m);
  });
});

describe("E_MODE_NAME", () => {
  for (const [spelling, line] of [
    ["**x** skill", "Then run the **nope** skill."],
    ["`/x`", "Then type `/nope`."],
    ["bare /x", "Then type /nope now."],
    ["bare `x`", "Then use `control-ui`."],
    ["bold **/x**", "Then type **/nope** now."],
    ["parenthesized (/x)", "Then run it (/nope)."],
    ["double-quoted \"/x\"", "Then say \"/nope\"."],
    ["single-quoted '/x'", "Then say '/nope'."],
    ["italic _/x_", "Then type _/nope_ now."],
  ]) {
    test(`the ${spelling} spelling of a unit that no pack keeps blocks`, () => {
      const b = built(hub(line));
      const [f] = modeFindings(b);
      const name = spelling === "bare `x`" ? "control-ui" : "nope";
      assert.equal(f?.severity, "block");
      assert.equal(f.path, "skills/poteto-mode/SKILL.md");
      assert.match(f.evidence, new RegExp(`^E_MODE_NAME ${name} at line \\d+: `));
      assert.equal(modeFindings(b).length, 1);
    });
  }

  test("rig plan prints E_MODE_NAME nope for a hub line with `/nope`", () => {
    const r = plan(hub("Then type `/nope`."));
    assert.equal(r.code, 1);
    assert.match(r.out, /^block mode fixture\/skills\/poteto-mode\/SKILL\.md: E_MODE_NAME nope at line /m);
  });

  test("no finding for the allowlist names or a kept unit", () => {
    const b = built(hub("Use `/loop 1h`, `/poteto-mode,`, /setup-pstack and the **create-skill** skill. Then the **design-probe** skill and `/architect`."));
    assert.deepEqual(modeFindings(b), []);
  });

  test("no name continues across a slash", () => {
    const b = built(hub("Notes: `/tmp/<slug>-resume.md` and `/tmp/swarm-<pr-id>/worker-<n>/<slug>.png`, and/or /a/b, **/tmp/x**, (/usr/bin)."));
    assert.deepEqual(modeFindings(b), []);
  });

  test("a bare root dir such as /tmp, /etc or /usr is a path, not a name", () => {
    const b = built(hub("Write to /tmp now. Then `cd /etc && ls /usr`, and (/var)."));
    assert.deepEqual(modeFindings(b), []);
  });

  test("a playbook is screened too", () => {
    const b = built({ files: { "skills/poteto-mode/playbooks/bug-fix.md": `${craftFiles()["skills/poteto-mode/playbooks/bug-fix.md"]}4. Run the **nope** skill.\n` } });
    assert.equal(modeFindings(b)[0]?.path, "skills/poteto-mode/playbooks/bug-fix.md");
  });

  test("an ack clears the finding of its name only", () => {
    const first = modeFindings(built(hub("Then type `/nope`.")))[0];
    const ack = { schema: 1, acks: [{ id: first.id, check: "mode", pack: PACK, path: first.path, reason: "fixture", expires: "2099-01-01" }] };
    const acked = built({ ...hub("Then type `/nope`."), repo: { "audit.allow.json": ack } });
    assert.deepEqual(modeFindings(acked).map((f: Finding) => f.acked), [true]);
    const moved = built({ ...hub("Then type `/nope` and `/other`."), repo: { "audit.allow.json": ack } });
    assert.deepEqual(modeFindings(moved).map((f: Finding) => [f.evidence.split(" ")[1], f.acked]), [["nope", true], ["other", false]]);
  });
});

describe("E_MODE_NAME and a disabled unit", () => {
  const DISABLE = { disable: [`${PACK}/architect`] };
  const note = (where: string) => `${where} names ${PACK}/architect, which disable or replaces removes; the domain file has no entry for it`;

  test("a hub name of a disabled unit is an info finding that names the unit and the line, not a block", () => {
    const b = built({ rig: DISABLE });
    const found = modeFindings(b);
    assert.deepEqual(found.map((f: Finding) => f.severity), ["info"]);
    assert.equal(found[0].path, "skills/poteto-mode/SKILL.md");
    assert.match(found[0].evidence, /^architect at line \d+: fixture\/architect is disabled by rig\.json disable, so the craft shell tells the model to skip that skill and write one line that names it$/);
    assert.deepEqual(b.errors, []);
  });

  test("rig plan with the unit disabled prints the info line and 0 blocks", () => {
    const r = plan({ rig: DISABLE });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /^info mode fixture\/skills\/poteto-mode\/SKILL\.md: architect at line \d+: fixture\/architect is disabled/m);
    assert.match(r.out, /, 0 blocks$/m);
    assert.doesNotMatch(r.out, /E_MODE_NAME/);
  });

  test("the overlay disable does the same", () => {
    const r = plan({ overlay: { "rig.json": { schema: 2, disable: [`${PACK}/architect`] } } });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /^info mode .*architect at line \d+/m);
  });

  test("a name that matches no unit and is not disabled still blocks, next to a disabled one", () => {
    const b = built({ rig: DISABLE, ...hub("Then run the **architekt** skill.") });
    const found = modeFindings(b);
    assert.deepEqual(found.map((f: Finding) => f.severity), ["block", "info"]);
    assert.match(found[0].evidence, /^E_MODE_NAME architekt at line \d+: no kept unit has this name/);
    const r = plan({ rig: DISABLE, ...hub("Then run the **architekt** skill.") });
    assert.equal(r.code, 1);
    assert.match(r.out, /^block mode .*E_MODE_NAME architekt at line /m);
    assert.match(r.out, /, 1 block$/m);
  });

  const otherSkill = (name: string) => ({
    "packs/other/pack.json": { schema: 2, name: "other", license: "MIT" },
    [`packs/other/skills/${name}/SKILL.md`]: `---\nname: ${name}\ndescription: d\n---\n\n# ${name}\n`,
  });
  const WITH_OTHER = { packs: { product: {}, [PACK]: {}, other: {} } };

  test("a disabled unit of another pack does not excuse a stale hub name: a renamed upstream unit still blocks", () => {
    const spec = { rig: { ...WITH_OTHER, disable: ["other/review"] }, repo: otherSkill("review"), ...hub("Then run the **review** skill.") };
    const found = modeFindings(built(spec));
    assert.deepEqual(found.map((f: Finding) => [f.severity, f.evidence.replace(/ at line \d+/, "")]),
      [["block", "E_MODE_NAME review: no kept unit has this name; vendor the unit, or ack the name"]]);
    const r = plan(spec);
    assert.equal(r.code, 1);
    assert.match(r.out, /^block mode fixture\/skills\/poteto-mode\/SKILL\.md: E_MODE_NAME review at line /m);
    assert.doesNotMatch(r.out, /^info mode .*review/m);
  });

  test("two disabled ids with the same tail do not overwrite each other: the info line names the id of the pack that owns the file", () => {
    const spec = { rig: { ...WITH_OTHER, disable: [`${PACK}/architect`, "other/architect"] }, repo: otherSkill("architect") };
    const found = modeFindings(built(spec));
    assert.deepEqual(found.map((f: Finding) => f.severity), ["info"]);
    assert.match(found[0].evidence, /^architect at line \d+: fixture\/architect is disabled by rig\.json disable/);
    const reversed = modeFindings(built({ ...spec, rig: { ...WITH_OTHER, disable: ["other/architect", `${PACK}/architect`] } }));
    assert.match(reversed[0].evidence, /^architect at line \d+: fixture\/architect is disabled by rig\.json disable/);
  });

  test("a fill that names the disabled unit is dropped with an info line that names the fill", () => {
    const b = built({ rig: { ...DISABLE, fill: { "eng:design": `${PACK}/architect`, "eng:ship.before": [`${PACK}/architect`], triggers: [{ when: "A boundary moves", use: `${PACK}/architect` }] } } });
    assert.deepEqual(b.errors, []);
    assert.deepEqual([...b.stack.info!].sort(), [
      note("rig.json fill.eng:design"),
      note("rig.json fill.eng:ship.before"),
      note("rig.json fill.triggers[0].use"),
      note(`packs/${PACK}/pack.json mode.hooks.eng:review.before`),
    ].sort());
    assert.match(b.text("~/.claude/skills/craft/references/engineering.md"), /^- `eng:design`\. Before: none\. Slot: none/m);
  });

  test("rig plan prints the fill info line", () => {
    const r = plan({ rig: { ...DISABLE, fill: { "eng:design": `${PACK}/architect` } } });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, new RegExp(`^info ${note("rig.json fill.eng:design").replaceAll(".", "\\.")}$`, "m"));
  });

  test("a fill naming a unit that is not disabled and not kept is still E_MODE_REF", () => {
    const b = built({ rig: { ...DISABLE, fill: { "eng:design": `${PACK}/nope` } } });
    assert.match(errorOf(b, "E_MODE_REF").message, /^fixture\/nope: rig\.json fill\.eng:design names no kept unit$/);
    assert.deepEqual(b.stack.info, [note(`packs/${PACK}/pack.json mode.hooks.eng:review.before`)]);
  });
});

describe("anchors", () => {
  const LINK = "../craft/references/adapter.md";
  for (const [name, text] of [
    ["frontmatter and a body", "---\nname: a\ndescription: d\n---\n\n# A\nbody\n"],
    ["no trailing newline", "---\nname: a\n---\nbody"],
    ["a close at the end", "---\nname: a\n---"],
    ["CRLF lines", "---\r\nname: a\r\n---\r\nbody\r\n"],
  ]) {
    test(`insertAnchor then stripAnchor gives the input bytes: ${name}`, () => {
      const r = insertAnchor(text, LINK);
      assert.equal(r.error, null);
      assert.notEqual(r.text, text);
      assert.equal(stripAnchor(r.text), text);
    });
  }

  test("a CRLF leaf gets a CRLF anchor block", () => {
    const r = insertAnchor("---\r\nname: a\r\n---\r\nbody\r\n", LINK);
    assert.equal(r.text, `---\r\nname: a\r\n---\r\nRead the section for your harness in [the rig adapter](${LINK}) once per session before you follow this skill.\r\n\r\nbody\r\n`);
    assert.doesNotMatch(r.text, /[^\r]\n/);
  });

  test("a leaf with no frontmatter close gives E_ANCHOR_MISSING and blocks rig plan", () => {
    assert.equal(insertAnchor("---\nname: a\nbody\n", LINK).error?.code, "E_ANCHOR_MISSING");
    assert.equal(insertAnchor("# no frontmatter\n", LINK).error?.code, "E_ANCHOR_MISSING");
    const r = plan({ files: { "skills/architect/SKILL.md": "---\nname: architect\ndescription: d\n# Architect\n" } });
    assert.equal(r.code, 1);
    assert.match(r.out, /^block E_ANCHOR_MISSING unit fixture\/architect: /m);
  });

  test("a vendored leaf copy is the pack file plus the hide keys of its readers plus the anchor", () => {
    const b = built();
    const src = craftFiles()["skills/architect/SKILL.md"];
    for (const dir of ["~/.claude/skills", "~/.agents/skills"]) {
      const copy = b.text(`${dir}/architect/SKILL.md`);
      assert.match(copy, /^---\n[\s\S]*?\n---\nRead the section for your harness in \[the rig adapter\]\(\.\.\/craft\/references\/adapter\.md\) once per session before you follow this skill\.\n\n/);
      let expected = src;
      for (const h of HARNESSES) {
        const rec = record(h);
        if (rec.reads.skills.some((d) => d.path === dir) && rec.hide.method === "frontmatter-key") expected = setFrontmatterKey(expected, rec.hide.key!, rec.hide.value);
      }
      assert.equal(stripAnchor(copy), expected, dir);
    }
  });

  test("an authored pack gets no anchor", () => {
    const b = built({ vendored: false });
    assert.doesNotMatch(b.text("~/.claude/skills/architect/SKILL.md"), /rig adapter/);
  });
});

describe("adapter, hide switch and placement", () => {
  test("adapter.md exists in every craft copy, with one section per reader; no adapter text gives the default section", () => {
    const b = built();
    for (const dir of craftDirs(b)) {
      const adapter = b.text(`${dir}/craft/references/adapter.md`);
      const readers = HARNESSES.filter((h) => record(h).reads.skills.some((d) => d.path === dir));
      assert.deepEqual([...adapter.matchAll(/^## (\S+)$/gm)].map((m) => m[1]), readers, dir);
      for (const h of readers.filter((h) => !["claude", "codex"].includes(h))) {
        const section = adapter.split(`## ${h}\n`)[1].split("\n## ")[0];
        assert.match(section, /The skills use the names of this harness\. No name mapping applies\./, `${dir} ${h}`);
        assert.doesNotMatch(section, /Task|Agent|\]\(/, `${dir} ${h}`);
      }
    }
  });

  test("craft and a leaf carry the hide switch of every harness; auto with one unit drops it for that unit only", () => {
    const hiddenIn = (b: Built, dir: string, name: string) => {
      const out: [string, boolean][] = [];
      for (const h of HARNESSES) {
        const rec = record(h);
        if (!rec.reads.skills.some((d) => d.path === dir)) continue;
        const hide = rec.hide;
        const text = hide.method === "sidecar" ? (b.has(`${dir}/${name}/${hide.file}`) ? b.text(`${dir}/${name}/${hide.file}`) : "") : b.text(`${dir}/${name}/SKILL.md`);
        const on = hide.method === "sidecar" ? /allow_implicit_invocation: false/.test(text) : new RegExp(`^${hide.key}: ${hide.value}$`, "m").test(text);
        out.push([h, on]);
      }
      return out;
    };
    const b = built();
    const seen = new Set();
    for (const dir of craftDirs(b)) {
      for (const name of ["craft", "architect"]) {
        for (const [h, on] of hiddenIn(b, dir, name)) {
          assert.ok(on, `${dir}/${name} on ${h}`);
          seen.add(h);
        }
      }
    }
    assert.deepEqual([...seen].sort(), [...HARNESSES].sort());
    const auto = built({ rig: { auto: [`${PACK}/design-probe`] } });
    for (const dir of craftDirs(auto)) {
      for (const [h, on] of hiddenIn(auto, dir, "design-probe")) assert.ok(!on, `${dir}/design-probe on ${h}`);
      for (const [h, on] of hiddenIn(auto, dir, "architect")) assert.ok(on, `${dir}/architect on ${h}`);
    }
  });

  test("an overlay auto adds to the repo auto", () => {
    const b = built({ rig: { auto: [`${PACK}/architect`] }, overlay: { "rig.json": { schema: 2, auto: [`${PACK}/design-probe`] } } });
    assert.deepEqual(b.errors, []);
    assert.deepEqual([...b.stack.mode!.auto].sort(), [`${PACK}/architect`, `${PACK}/design-probe`]);
    for (const leaf of ["architect", "design-probe"]) assert.doesNotMatch(b.text(`~/.claude/skills/${leaf}/SKILL.md`), /^disable-model-invocation:/m, leaf);
    assert.match(b.text("~/.claude/skills/craft/SKILL.md"), /^disable-model-invocation: true$/m);
  });

  test("an auto unit whose source sets a reader's hide key stays hidden on that reader, with an info line", () => {
    const b = built({ rig: { auto: [`${PACK}/sealed`] } });
    assert.deepEqual(b.errors, []);
    assert.deepEqual(b.info.filter((l: string) => l.includes("sealed")), [
      "fixture/sealed stays hidden on claude: its source sets disable-model-invocation",
      "fixture/sealed stays hidden on cursor: its source sets disable-model-invocation",
    ]);
    assert.match(b.text("~/.claude/skills/sealed/SKILL.md"), /^disable-model-invocation: true$/m);
    assert.doesNotMatch(b.text("~/.agents/skills/sealed/SKILL.md"), /^hide:/m);
    assert.ok(!b.has("~/.agents/skills/sealed/agents/openai.yaml"));
    assert.deepEqual(built().info.filter((l: string) => l.includes("stays hidden")), []);
    const sidecar = built({ rig: { auto: [`${PACK}/sealed`] }, files: { "skills/sealed/agents/openai.yaml": "policy:\n  allow_implicit_invocation: false\n" } });
    assert.ok(sidecar.info.includes("fixture/sealed stays hidden on codex: its source sets policy.allow_implicit_invocation in agents/openai.yaml"), JSON.stringify(sidecar.info));
  });

  test("an auto entry with no kept unit gives E_MODE_REF", () => {
    assert.match(errorOf(built({ rig: { auto: ["fixture/nope"] } }), "E_MODE_REF").message, /^fixture\/nope: rig\.json auto\[0\] names no kept unit/);
  });

  test("render twice gives identical bytes", () => {
    const fx = craftFixture();
    try {
      const w = fx.load();
      const flat = (d: ReturnType<typeof render>) => [...d.entries].map(([p, e]) => [p, "bytes" in e ? dec.decode(e.bytes) : ""]);
      assert.deepEqual(flat(render(compose(w), w)), flat(render(compose(w), w)));
    } finally {
      fx.cleanup();
    }
  });

  test("each harness reads exactly one craft, and its adapter and each leaf anchor hold a section for that harness", () => {
    assertOneCraft(built(), HARNESSES);
  });

  for (const h of HARNESSES) {
    test(`a vendored pack limited to ${h}: craft sits next to its leaves, no anchor dangles, one craft per harness`, () => {
      const b = built({ rig: { packs: { product: {}, [PACK]: { harnesses: [h] } }, fill: {} } });
      assert.deepEqual(b.errors, []);
      assert.deepEqual(b.findings.filter((f: Finding) => f.check === "links"), []);
      assertOneCraft(b, [h]);
    });
  }

  test("a layout where craft next to every anchored leaf gives a harness two crafts is E_READSET with the packs to align", () => {
    const solo = { "pack.json": `${JSON.stringify({ schema: 2, name: "solo", license: "MIT" })}\n`, LICENSE: "MIT\n", "skills/solo/SKILL.md": "---\nname: solo\ndescription: d\n---\n\n# Solo\n" };
    const b = built({
      rig: { packs: { product: {}, [PACK]: {}, solo: { harnesses: ["codex"] } } },
      repo: { ...Object.fromEntries(Object.entries(solo).map(([k, v]) => [`packs/solo/${k}`, v])), "rig.lock.json": lockFor({ [PACK]: craftFiles(), solo }) },
    });
    const e = errorOf(b, "E_READSET");
    assert.equal(e.harness, "codex");
    assert.match(e.message, /^codex would see unit core\/craft 2 times, via ~\/\.codex\/skills and ~\/\.agents\/skills: unit core\/craft must sit in /);
    assert.match(e.message, /rig\.json packs\.fixture\.harnesses and rig\.json packs\.solo\.harnesses one harness list/);
  });

  test("the shell names the precedence rule and each domain file, and drops the hub step with no hub", () => {
    const b = built();
    const shell = b.text("~/.claude/skills/craft/SKILL.md");
    assert.match(shell, /^1\. Read \[hub\.md\]\(hub\.md\) in full\.$/m);
    assert.match(shell, /^1\. Hub triggers are keyed by situation, not by step\. A step of the domain file can have a `Replaces the hub trigger:` line or a `Replaces the frame trigger:` line\. Run that step in place of the line it quotes, inside `\/craft`\. Every other hub and frame trigger still applies\.$/m);
    assert.match(shell, /^1\. An optional first argument names a domain, for example `eng: \.\.\.`\./m);
    assert.doesNotMatch(shell, /\/craft eng:/);
    for (const d of ["business", "product", "engineering", "upkeep"]) assert.match(shell, new RegExp(`\\[${d}\\]\\(references/${d}\\.md\\)`));
    const bare = built(withManifest((m: any) => ({ ...m, mode: { ...m.mode, adopt: { "playbooks/": m.mode.adopt["playbooks/"] } } })));
    const noHub = bare.text("~/.claude/skills/craft/SKILL.md");
    assert.doesNotMatch(noHub, /hub\.md\)/);
    assert.doesNotMatch(noHub, /\{\{/);
  });

  test("a domain with a playbook or an artifact gets the playbook start rule; a domain with neither starts at the first step", () => {
    const b = built();
    const precedence = "Read this file after `hub\\.md`\\. A step below with a `Replaces the hub trigger:` line runs in place of the hub trigger that it quotes\\. A step with a `Replaces the frame trigger:` line runs in place of the line of the rig frame for that trigger\\. Every other hub trigger still applies\\.";
    const playbook = "Follow the playbook that the hub selects\\. If the hub selects no playbook, skip each step whose artifact for this task already exists, and start at the first step left\\.";
    for (const [d, rule] of [["engineering", playbook], ["product", playbook], ["business", "Start at the first step\\."], ["upkeep", "Start at the first step\\."]]) {
      assert.match(b.text(`~/.claude/skills/craft/references/${d}.md`), new RegExp(`^${precedence}\\n\\n${rule}$`, "m"), d);
    }
  });

  test("a filled address with a hub_triggers entry quotes the hub trigger under its step; an unfilled one quotes nothing", () => {
    const line = "Code crossing a function boundary → the **architect** skill.";
    const b = built(withManifest((m: any) => ({ ...m, mode: { ...m.mode, hub_triggers: { "eng:design": line, "eng:ground": line } } })));
    assert.deepEqual(b.errors, []);
    const eng = b.text("~/.claude/skills/craft/references/engineering.md");
    assert.ok(eng.includes(`- \`eng:design\`. Before: none. Slot: [design-probe](../../design-probe/SKILL.md). After: none.\n  Replaces the hub trigger: "${line}"\n`), eng);
    assert.match(eng, /^- `eng:ground`\. Before: none\. Slot: none\. After: none\.$/m);
    assert.equal(eng.match(/^  Replaces the hub trigger:/gm)?.length, 1);
  });

  test("the default fixture manifest's hub line is a line of its hub, and the rendered engineering.md quotes it under eng:design", () => {
    const line = "Code crossing a function boundary → the **architect** skill.";
    assert.ok(craftFiles()["skills/poteto-mode/SKILL.md"].split("\n").includes(`- ${line}`), "the fixture hub has no such line");
    const b = built();
    assert.deepEqual(b.errors, []);
    assert.ok(b.text("~/.claude/skills/craft/references/engineering.md").includes(`- \`eng:design\`. Before: none. Slot: [design-probe](../../design-probe/SKILL.md). After: none.\n  Replaces the hub trigger: "${line}"\n`));
  });

  test("a hub_triggers entry that is no line of hub.md is E_MODE_REF; one at no step address is E_FILL_UNKNOWN", () => {
    const b = built(withManifest((m: any) => ({ ...m, mode: { ...m.mode, hub_triggers: { "eng:design": "Code crossing a function boundary", "eng:nope": "x" } } })));
    assert.match(errorOf(b, "E_MODE_REF").message, /^eng:design: packs\/fixture\/pack\.json mode\.hub_triggers\.eng:design is no "- " line of craft\/hub\.md$/);
    assert.match(errorOf(b, "E_FILL_UNKNOWN").message, /^eng:nope: /);
  });

  test("a mode block with a bad inner shape is E_SCHEMA with its key path", () => {
    const fx = craftFixture(withManifest((m: any) => ({ ...m, mode: { ...m.mode, playbooks: { "bug-fix": { domain: "engineering" } } } })));
    try {
      assert.throws(() => fx.load(), (e: any) => e.code === "E_SCHEMA" && /mode\.playbooks\.bug-fix\.file/.test(`${e.path ?? ""} ${e.message}`));
    } finally {
      fx.cleanup();
    }
  });
});
