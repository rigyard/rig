import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { patch, readSet, render } from "../lib/targets.ts";
import { loadWorld } from "../lib/world.ts";
import { compose } from "../lib/stack.ts";
import { makeFixtureHome } from "./helpers/fixture-home.ts";
import { HARNESSES, HOME, records, unit, world, fixtureStack, frameTemplate, rel, text, writable } from "./render.helpers.ts";

const byRel = (d) => new Map([...d.entries].map(([abs, e]) => [rel(abs), e]));

/** The harness whose record declares the write location of a home-relative path. */
function ownerOf(path, recs) {
  for (const [h, rec] of recs) if (writable(rec).some((w) => (w.endsWith("/") ? path.startsWith(w) : path === w))) return h;
  return null;
}

const EXPECTED = {
  claude: [
    "~/.claude/rules/rig-frame.md",
    "~/.claude/commands/brief.md",
    "~/.claude/skills/rig-notes/SKILL.md",
    "~/.claude/skills/explain/SKILL.md",
    "~/.claude/commands/review.md",
    "~/.claude/agents/helper.md",
    "~/.claude/rules/style.md",
    "~/.claude/commands/pm.md",
  ],
  // ~/.agents/skills belongs to the Codex record and also serves omp and Cursor
  codex: [
    "~/.codex/AGENTS.md",
    "~/.codex/prompts/brief.md",
    "~/.agents/skills/rig-notes/SKILL.md",
    "~/.agents/skills/explain/SKILL.md",
    "~/.agents/skills/explain/agents/openai.yaml",
    "~/.codex/prompts/review.md",
    "~/.codex/agents/helper.toml",
    "~/.codex/prompts/pm.md",
  ],
  omp: ["~/.omp/agent/AGENTS.md", "~/.omp/agent/commands/brief.md", "~/.omp/agent/commands/review.md", "~/.omp/agent/commands/pm.md"],
  cursor: [
    "~/.cursor/rules/rig-frame.mdc",
    "~/.cursor/plugins/local/rig/skills/brief/SKILL.md",
    "~/.cursor/plugins/local/rig/skills/review/SKILL.md",
    "~/.cursor/agents/helper.md",
    "~/.cursor/rules/style.mdc",
    "~/.cursor/plugins/local/rig/skills/pm/SKILL.md",
    "~/.cursor/plugins/local/rig/.cursor-plugin/plugin.json",
  ],
};

test("each harness gets exactly the expected file set for the fixture stack", () => {
  const recs = records();
  const d = render(fixtureStack(), world({ targets: recs }));
  assert.deepEqual(d.errors, []);
  const got = Object.fromEntries(HARNESSES.map((h) => [h, []]));
  for (const p of byRel(d).keys()) got[ownerOf(p, recs)].push(p);
  for (const h of HARNESSES) assert.deepEqual(got[h].sort(), [...EXPECTED[h]].sort(), h);
  // keys are absolute and equal entry.path
  for (const [abs, e] of d.entries) {
    assert.ok(abs.startsWith(`${HOME}/`), abs);
    assert.equal(e.path, abs);
  }
  // what each harness reads: both skills exactly once per read dir set, through the records' read-sets
  for (const h of HARNESSES) {
    const dirs = recs.get(h).reads.skills.map((e) => e.path);
    const seen = [...byRel(d).keys()].filter((p) => p.endsWith("/SKILL.md") && dirs.some((dir) => p.startsWith(`${dir}/`)));
    const names = new Set(seen.map((p) => p.split("/").at(-2)));
    for (const name of ["rig-notes", "explain"]) assert.ok(names.has(name), `${h} does not see ${name}`);
  }
  // absent formats are info lines, not silence
  assert.deepEqual(d.info.sort(), [
    "absent codex own/style: the harness has no rule format",
    "absent omp own/helper: the harness has no agent format",
    "absent omp own/style: the harness has no rule format",
  ]);
});

test("no rendered path lies outside the declared writable dirs", () => {
  const recs = records();
  const d = render(fixtureStack(), world({ targets: recs }));
  for (const p of byRel(d).keys()) assert.ok(ownerOf(p, recs), `${p} is outside every declared write location`);
});

test("a hidden skill carries the hide control of every harness that reads its dir; a visible one carries none", () => {
  const d = byRel(render(fixtureStack(), world()));
  // ~/.claude/skills: read by Claude and Cursor -> one frontmatter key, no sidecar, no omp key
  const claudeCopy = text(d.get("~/.claude/skills/explain/SKILL.md"));
  assert.match(claudeCopy, /^disable-model-invocation: true$/m);
  assert.doesNotMatch(claudeCopy, /^hide:/m);
  assert.ok(!d.has("~/.claude/skills/explain/agents/openai.yaml"));
  // ~/.agents/skills: read by Codex, omp and Cursor -> the Codex sidecar plus both frontmatter keys
  const agentsCopy = text(d.get("~/.agents/skills/explain/SKILL.md"));
  assert.match(agentsCopy, /^hide: true$/m);
  assert.match(agentsCopy, /^disable-model-invocation: true$/m);
  assert.equal(text(d.get("~/.agents/skills/explain/agents/openai.yaml")), "policy:\n  allow_implicit_invocation: false\n");
  // the core skill is visible
  for (const p of ["~/.claude/skills/rig-notes/SKILL.md", "~/.agents/skills/rig-notes/SKILL.md"]) {
    assert.doesNotMatch(text(d.get(p)), /disable-model-invocation|^hide:/m, p);
  }
  assert.ok(!d.has("~/.agents/skills/rig-notes/agents/openai.yaml"));
});

test("a hidden skill keeps a sidecar it already ships and adds the policy key line-level", () => {
  const stack = {
    units: [
      unit({
        id: "own/fmt",
        type: "skill",
        harnesses: ["codex"],
        files: { "SKILL.md": "---\nname: fmt\ndescription: d\n---\nbody\n", "agents/openai.yaml": "interface:\n  display_name: Fmt\n" },
      }),
    ],
  };
  const d = byRel(render(stack, world({ aliases: {} })));
  assert.equal(text(d.get("~/.codex/skills/fmt/agents/openai.yaml")), "interface:\n  display_name: Fmt\npolicy:\n  allow_implicit_invocation: false\n");
});

test("/brief and the pm alias land at the per-harness paths; on Cursor as hidden skills in the local plugin", () => {
  const d = byRel(render(fixtureStack(), world()));
  for (const name of ["brief", "pm"]) {
    for (const p of [`~/.claude/commands/${name}.md`, `~/.codex/prompts/${name}.md`, `~/.omp/agent/commands/${name}.md`]) {
      assert.equal(d.get(p)?.kind, "owned", p);
    }
    const cursor = text(d.get(`~/.cursor/plugins/local/rig/skills/${name}/SKILL.md`));
    assert.match(cursor, new RegExp(`^name: ${name}$`, "m"));
    assert.match(cursor, /^disable-model-invocation: true$/m);
  }
  // the alias names its target through the harness's invocation term
  assert.equal(text(d.get("~/.codex/prompts/pm.md")), "Run /prompts:brief with the same arguments.\n");
  assert.equal(text(d.get("~/.claude/commands/pm.md")), "---\ndescription: Alias of /brief.\n---\nRun /brief with the same arguments.\n");
  // the local plugin gets its manifest once anything lands in it
  assert.deepEqual(JSON.parse(text(d.get("~/.cursor/plugins/local/rig/.cursor-plugin/plugin.json"))), { name: "rig", skills: "./skills/" });
});

test("no plugin manifest renders when nothing lands in the local plugin", () => {
  const stack = { units: [unit({ id: "own/style", type: "rule", files: { "style.md": "# s\n" } })] };
  const d = byRel(render(stack, world({ aliases: {} })));
  assert.ok(!d.has("~/.cursor/plugins/local/rig/.cursor-plugin/plugin.json"));
  assert.ok(d.has("~/.cursor/rules/style.mdc"));
});

test("command, agent and rule formats per harness", () => {
  const d = byRel(render(fixtureStack(), world()));
  // md-frontmatter keeps the source, md-body drops the frontmatter
  assert.match(text(d.get("~/.claude/commands/review.md")), /^---\ndescription: Review the current diff\.\n/);
  assert.equal(text(d.get("~/.codex/prompts/review.md")), "Review the diff at $ARGUMENTS.\n");
  // codex-toml: name, description, developer_instructions; TOML escapes; no model keys
  assert.equal(
    text(d.get("~/.codex/agents/helper.toml")),
    'name = "helper"\ndescription = "Helper agent: answers \\"why\\" questions."\n' +
      'developer_instructions = """\nYou answer why questions. Quote \\"evidence\\" and keep \\\\ paths verbatim.\n"""\n',
  );
  // cursor-md: name and description only; the Claude model and tools keys stay out
  const cursorAgent = text(d.get("~/.cursor/agents/helper.md"));
  assert.doesNotMatch(cursorAgent, /^(model|tools):/m);
  assert.match(cursorAgent, /^name: helper$/m);
  // claude-md is the source byte for byte
  assert.match(text(d.get("~/.claude/agents/helper.md")), /^model: placeholder-model$/m);
  // rules: md as-is on Claude, mdc with alwaysApply on Cursor
  assert.equal(text(d.get("~/.claude/rules/style.md")), "# Style\nUse short sentences.\n");
  assert.equal(text(d.get("~/.cursor/rules/style.mdc")), "---\nalwaysApply: true\n---\n# Style\nUse short sentences.\n");
});

test("the frame: whole file or managed block per record, differing only in the declared per-harness lines", () => {
  const d = byRel(render(fixtureStack(), world()));
  const claude = d.get("~/.claude/rules/rig-frame.md");
  const codex = d.get("~/.codex/AGENTS.md");
  const omp = d.get("~/.omp/agent/AGENTS.md");
  const cursor = d.get("~/.cursor/rules/rig-frame.mdc");
  assert.equal(claude.kind, "owned");
  assert.equal(omp.kind, "owned");
  assert.equal(cursor.kind, "owned");
  assert.equal(codex.kind, "block");
  assert.equal(codex.marker, "rig:frame");
  assert.doesNotMatch(text(codex), /rig:frame/, "block bytes exclude the marker lines");
  const cursorText = text(cursor);
  assert.ok(cursorText.startsWith("---\nalwaysApply: true\n---\n"));
  const bodies = [text(claude), text(codex), text(omp), cursorText.slice("---\nalwaysApply: true\n---\n".length)].map((t) => t.split("\n"));
  const template = frameTemplate().split("\n");
  const declared = new Set(template.flatMap((l, i) => (l.includes("{{rig:") ? [i] : [])));
  assert.ok(declared.size >= 2);
  for (const b of bodies) assert.equal(b.length, template.length);
  for (let i = 0; i < template.length; i++) {
    const distinct = new Set(bodies.map((b) => b[i])).size;
    if (declared.has(i)) assert.equal(distinct, 4, `declared line ${i} should differ per harness`);
    else assert.equal(distinct, 1, `line ${i} differs across harnesses but is not a declared per-harness line`);
  }
});

test("an unknown {{rig:x}} is E_TERM_UNKNOWN and renders nothing for that unit", () => {
  const stack = { units: [unit({ id: "own/bad", type: "command", files: { "bad.md": "Use {{rig:nope}} here.\n" } })] };
  const d = render(stack, world({ aliases: {} }));
  assert.ok(d.errors.length >= 1);
  assert.ok(d.errors.every((e) => e.code === "E_TERM_UNKNOWN"));
  assert.match(d.errors[0].message, /own\/bad/);
  assert.match(d.errors[0].message, /\{\{rig:nope\}\}/);
  assert.equal(d.entries.size, 0);
  // the same in a skill: nothing lands in any dir
  const skill = { units: [unit({ id: "own/bad", type: "skill", files: { "SKILL.md": "---\nname: bad\n---\n{{rig:nope}}\n" } })] };
  const s = render(skill, world({ aliases: {} }));
  assert.equal(s.entries.size, 0);
  assert.ok(s.errors.some((e) => e.code === "E_TERM_UNKNOWN"));
});

test("a term with no row for a target harness is E_TERM_MISSING naming the harness; other harnesses still render", () => {
  const terms = { only: { claude: "c-text" } };
  const stack = { units: [unit({ id: "own/x", type: "command", harnesses: ["claude", "codex"], files: { "x.md": "{{rig:only}}\n" } })] };
  const d = render(stack, world({ terms, aliases: {} }));
  assert.deepEqual(d.errors.map((e) => [e.code, e.harness]), [["E_TERM_MISSING", "codex"]]);
  assert.deepEqual([...byRel(d).keys()], ["~/.claude/commands/x.md"]);
  assert.equal(text(byRel(d).get("~/.claude/commands/x.md")), "c-text\n");
});

test("non-UTF-8 files pass byte-exact; placeholders in them are not touched", () => {
  const bin = new Uint8Array([0xff, 0xfe, 0x7b, 0x7b, 0x72, 0x69, 0x67, 0x3a, 0x78, 0x7d, 0x7d]); // invalid UTF-8 plus "{{rig:x}}"
  const stack = { units: [unit({ id: "own/b", type: "skill", harnesses: ["claude"], files: { "SKILL.md": "---\nname: b\n---\n", "blob.bin": bin } })] };
  const d = render(stack, world({ aliases: {} }));
  assert.deepEqual(d.errors, []);
  assert.deepEqual(byRel(d).get("~/.claude/skills/b/blob.bin").bytes, bin);
});

test("nothing renders under a never_write glob; the error names the glob", () => {
  const recs = records();
  recs.get("claude").reads.never_write.push("~/.claude/commands/**");
  const d = render(fixtureStack(), world({ targets: recs }));
  assert.ok(![...byRel(d).keys()].some((p) => p.startsWith("~/.claude/commands/")));
  const errs = d.errors.filter((e) => e.code === "E_CONTAINMENT");
  assert.deepEqual(errs.map((e) => e.path).sort(), ["~/.claude/commands/brief.md", "~/.claude/commands/pm.md", "~/.claude/commands/review.md"]);
  for (const e of errs) assert.match(e.message, /~\/\.claude\/commands\/\*\*/);
  // every rendered path of every record stays clear of every never_write glob
  for (const p of byRel(d).keys()) assert.ok(!p.startsWith("~/.claude/plugins/") && !p.startsWith("~/.cursor/skills-cursor/"), p);
});

test("render twice gives identical entries, bytes, key order, errors and info", () => {
  const a = render(fixtureStack(), world());
  const b = render(fixtureStack(), world());
  assert.deepEqual([...a.entries.keys()], [...b.entries.keys()]);
  assert.deepEqual([...a.entries], [...b.entries]);
  assert.deepEqual(a.errors, b.errors);
  assert.deepEqual(a.info, b.info);
});

test("render does not mutate its inputs", () => {
  const stack = fixtureStack();
  const w = world();
  const before = structuredClone({ units: stack.units, targets: w.targets, terms: w.terms, config: w.config });
  render(stack, w);
  assert.deepEqual({ units: stack.units, targets: w.targets, terms: w.terms, config: w.config }, before);
});

test("two units on one path are E_CLASH, and the first claim stays", () => {
  const stack = {
    units: [
      unit({ id: "own/review", type: "command", harnesses: ["cursor"], files: { "review.md": "cmd\n" } }),
      unit({ id: "kit/review", type: "skill", harnesses: ["cursor"], files: { "SKILL.md": "---\nname: review\n---\nskill\n" } }),
    ],
  };
  const d = render(stack, world({ aliases: {} }));
  assert.deepEqual(d.errors.map((e) => e.code), ["E_CLASH"]);
  assert.match(d.errors[0].message, /own\/review and kit\/review/);
  assert.equal(byRel(d).get("~/.cursor/plugins/local/rig/skills/review/SKILL.md").unit, "own/review");
});

test("placement failures and unbuilt channels are errors, never silent drops", () => {
  // Cursor with dedupe none sees ~/.claude/skills and ~/.codex/skills twice: E_READSET from place()
  const recs = records();
  for (const e of recs.get("cursor").reads.skills) e.dedupe = "none";
  const both = { units: [unit({ id: "own/s", type: "skill", harnesses: ["claude", "codex"], files: { "SKILL.md": "---\nname: s\n---\n" } })] };
  const r = render(both, world({ targets: recs, aliases: {} }));
  assert.equal(r.errors[0].code, "E_READSET");
  assert.equal(r.entries.size, 0);
  // the Claude plugin channel is slice 4
  const chan = { units: [unit({ id: "own/s", type: "skill", harnesses: ["claude"], channel: { claude: "plugin" }, files: { "SKILL.md": "---\nname: s\n---\n" } })] };
  const c = render(chan, world({ aliases: {} }));
  assert.equal(c.errors[0].code, "E_INTERNAL");
  assert.match(c.errors[0].message, /plugin channel render is not implemented/);
});

test("leaks are info lines naming the harness", () => {
  const stack = { units: [unit({ id: "own/s", type: "skill", harnesses: ["claude"], files: { "SKILL.md": "---\nname: s\n---\n" } })] };
  const d = render(stack, world({ aliases: {} }));
  assert.deepEqual(d.info, ["leak cursor own/s: sees one copy, not a target"]);
});

test("a project-scope pack renders no machine copy and says so per harness", () => {
  const stack = { units: [unit({ id: "kit/p", type: "skill", scope: "project", harnesses: ["codex", "omp"], files: { "SKILL.md": "---\nname: p\n---\n" } })] };
  const d = render(stack, world({ aliases: {} }));
  assert.equal(d.entries.size, 0);
  assert.deepEqual(d.info, [
    "scope codex kit: project part absent: commit its files (doctor --project)",
    "scope omp kit: project part absent: commit its files (doctor --project)",
  ]);
});

test("the alias unit fills {{target}} from rig.json aliases; without an aliases entry the text stays as written", () => {
  const stack = { units: [unit({ id: "core/go", type: "command", harnesses: ["claude"], files: { "go.md": "Run /{{target}}.\n" } })] };
  assert.equal(text(byRel(render(stack, world({ aliases: { go: "brief" } }))).get("~/.claude/commands/go.md")), "Run /brief.\n");
  assert.equal(text(byRel(render(stack, world({ aliases: {} }))).get("~/.claude/commands/go.md")), "Run /{{target}}.\n");
  // a pack command with an alias name is not the alias template
  const pack = { units: [unit({ id: "own/go", type: "command", harnesses: ["claude"], files: { "go.md": "Run /{{target}}.\n" } })] };
  assert.equal(text(byRel(render(pack, world({ aliases: { go: "brief" } }))).get("~/.claude/commands/go.md")), "Run /{{target}}.\n");
});

test("a frame unit with no frame.md is E_INTERNAL", () => {
  const noFrame = { units: [unit({ id: "core/rig-frame", type: "frame", files: { "notes.md": "x\n" } })] };
  assert.equal(render(noFrame, world({ aliases: {} })).errors[0].code, "E_INTERNAL");
});

test("the repo's own data: loadWorld, compose and render agree on the frame", () => {
  const fx = makeFixtureHome({});
  try {
    const w = loadWorld({ HOME: fx.home });
    const stack = compose(w);
    assert.deepEqual(stack.errors, []);
    const d = render(stack, w);
    assert.deepEqual(d.errors, []);
    const at = new Map([...d.entries].map(([abs, e]) => [`~/${abs.slice(fx.home.length + 1)}`, e]));
    for (const p of ["~/.claude/rules/rig-frame.md", "~/.omp/agent/AGENTS.md", "~/.cursor/rules/rig-frame.mdc"]) assert.equal(at.get(p)?.kind, "owned", p);
    assert.equal(at.get("~/.codex/AGENTS.md")?.kind, "block");
  } finally {
    fx.cleanup();
  }
});

test("the target schema accepts every record field render uses, and plugin_manifest stays closed", async () => {
  const { check } = await import("../lib/world/schema.ts");
  const { TARGET } = await import("../lib/world/schemas.ts");
  for (const [h, rec] of records()) assert.doesNotThrow(() => check(TARGET, rec, `targets/${h}.json`), h);
  const cursor = records().get("cursor");
  const bad = (pm) => () => check(TARGET, { ...cursor, plugin_manifest: pm }, "targets/cursor.json");
  assert.throws(bad({ path: cursor.plugin_manifest.path }), { code: "E_SCHEMA" });
  assert.throws(bad({ ...cursor.plugin_manifest, extra: 1 }), { code: "E_SCHEMA" });
});

test("targets.readSet: the public export reads each harness's dirs with the probe-driven read-sets", () => {
  const home = mkdtempSync(join(tmpdir(), "rig-render-readset-"));
  try {
    const body = "---\nname: shared\n---\nsame bytes\n";
    for (const dir of [".agents/skills/shared", ".omp/agent/skills/shared", ".codex/skills/codex-only"]) {
      mkdirSync(join(home, dir), { recursive: true });
      writeFileSync(join(home, dir, "SKILL.md"), body);
    }
    const installed = { schema: 1, entries: { "~/.agents/skills/shared/SKILL.md": { kind: "owned", sha256: "x", mode: 420, unit: "own/shared", run: "r" } } };
    const set = readSet({ env: { home }, targets: records() }, installed);
    assert.deepEqual([...set.keys()], HARNESSES);
    // omp reads ~/.omp/agent/skills and ~/.agents/skills, collapses the identical pair, and does not read ~/.codex/skills
    assert.deepEqual(set.get("omp").map((e) => e.name), ["shared"]);
    // Codex reads ~/.codex/skills and ~/.agents/skills; the managed mark comes from installed
    const codex = set.get("codex");
    assert.deepEqual(codex.map((e) => e.name).sort(), ["codex-only", "shared"]);
    assert.equal(codex.find((e) => e.name === "shared").managed, true);
    assert.equal(set.get("claude").length, 0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("targets.patch: the rendered frame block appends, then converges; a locator failure returns error instead of throwing", () => {
  const block = render(fixtureStack(), world()).entries.get(`${HOME}/.codex/AGENTS.md`);
  const user = new TextEncoder().encode("# My notes\nKeep this line.\n");
  const first = patch(user, block);
  assert.equal(first.error, undefined);
  assert.equal(first.markers, "inserted");
  assert.equal(first.current, null);
  const once = new TextDecoder().decode(first.next);
  assert.ok(once.startsWith("# My notes\nKeep this line.\n\n"), "user bytes stay first and byte-exact");
  assert.match(once, /rig:frame:start/);
  assert.ok(once.includes(text(block)));
  // a second pass finds the markers and changes nothing
  const second = patch(first.next, block);
  assert.equal(second.markers, "present");
  assert.deepEqual(second.next, first.next);
  assert.deepEqual(second.current, block.bytes);
  // two marker pairs: E_LOCATOR in the return shape, current bytes untouched
  const twice = new TextEncoder().encode(once + "\n" + once);
  const bad = patch(twice, block);
  assert.equal(bad.error.code, "E_LOCATOR");
  assert.doesNotMatch(bad.error.message, /^E_LOCATOR: /);
  assert.deepEqual(bad.next, twice);
  assert.equal(bad.markers, "n/a");
  // an error without a code is a bug and still throws
  assert.throws(() => patch(user, null), TypeError);
});

