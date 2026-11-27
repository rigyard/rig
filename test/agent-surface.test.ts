// The `agent` model-surface kind end to end (lib/targets/models-render.ts, setAgentKeys in lib/targets.ts): the guard
// that refuses xhigh, max and fast models in agent definitions, the three schema errors, and the info and key-order
// behavior. Each test runs bin/rig.ts on a fixture HOME whose repo root holds this repo's real models and targets.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import type { TestContext } from "node:test";
import { json, setup } from "./pstack.helpers.ts";

type Home = ReturnType<typeof setup>;

/** A fixture HOME over the real models and targets; `edit` changes the repo files and the HOME before the first run. */
function home(t: TestContext, edit: (s: Home) => void = () => {}): Home {
  const s = setup();
  t.after(() => s.fx.cleanup());
  edit(s);
  return s;
}

function editJson(file: string, change: (v: any) => void) {
  const v = JSON.parse(readFileSync(file, "utf8"));
  change(v);
  writeFileSync(file, `${JSON.stringify(v, null, 2)}\n`);
}

const setRole = (role: string, form: unknown) => (s: Home) => editJson(join(s.root, "models/roles.json"), (r) => { r.consumers.agents[role] = form; });
const setTier = (tier: string, harness: string, slug: string) => (s: Home) => editJson(join(s.root, "models/tiers.json"), (r) => { r.tiers[tier][harness] = slug; });
const blocks = (out: string) => out.split("\n").filter((l) => l.startsWith("block "));
const overlayFile = (s: Home, rel: string, v: unknown) => {
  const p = s.fx.path(`.config/rig/${rel}`);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, json(v));
};

/** The one overlay surface that these tests add: an agent surface of the consumer `mine` on the Claude agent files. */
const OVERLAY_SURFACE = { path: "~/.claude/agents/{role}.md", consumer: "mine", kind: "agent", harness: "claude", keys: { model: "model", effort: "effort" } };
const withOverlay = (roles: unknown, surface: object = OVERLAY_SURFACE) => (s: Home) => {
  overlayFile(s, "rig.json", { schema: 2, model_surfaces: [surface] });
  overlayFile(s, "models/roles.json", { schema: 1, consumers: { mine: roles } });
};

describe("agent surface guard: no xhigh, max or fast model in an agent definition (E_AGENT_MODEL)", () => {
  for (const effort of ["xhigh", "max"]) {
    test(`effort ${effort}: plan and apply block, the message names role, harness and value, apply writes no agent file`, (t) => {
      const s = home(t, setRole("rig-agent", ["strong", effort]));
      const p = s.rig(["plan"]);
      assert.equal(p.code, 1, p.stdout + p.stderr);
      const claude = blocks(p.stdout).find((l) => l.includes("unit models/claude"));
      assert.match(claude ?? "", new RegExp(`^block E_AGENT_MODEL unit models/claude: .*role rig-agent on claude resolves to effort "${effort}" \\(effort\\)`));
      assert.match(claude ?? "", /Lower the effort of rig-agent in models\/roles\.json consumer agents, or choose a non-fast model for its tier in models\/tiers\.json/);
      // Codex has no `max` rung, so it clamps to xhigh, which the guard refuses as well.
      assert.match(blocks(p.stdout).find((l) => l.includes("unit models/codex")) ?? "", /on codex resolves to effort "xhigh"/);
      const a = s.rig(["apply"]);
      assert.notEqual(a.code, 0, a.stdout + a.stderr);
      for (const rel of [".claude/agents/rig-agent.md", ".claude/agents/rig-janitor.md", ".codex/agents/rig-agent.toml"]) assert.equal(existsSync(s.fx.path(rel)), false, rel);
    });
  }

  test("effort high passes: 0 blocks, and the files carry high", (t) => {
    const s = home(t, setRole("rig-agent", ["strong", "high"]));
    const a = s.rig(["apply"]);
    assert.equal(a.code, 0, a.stdout + a.stderr);
    assert.match(s.read(".claude/agents/rig-agent.md"), /^effort: "high"$/m);
    assert.match(s.read(".codex/agents/rig-agent.toml"), /^model_reasoning_effort = "high"$/m);
  });

  for (const slug of ["opus-fast", "opus-fast[1m]", "opus-fast:high", "opus-fast-high"]) {
    test(`a fast model slug ${slug} on the strong tier blocks`, (t) => {
      const s = home(t, setTier("strong", "claude", slug));
      const p = s.rig(["plan"]);
      assert.equal(p.code, 1, p.stdout + p.stderr);
      assert.match(blocks(p.stdout).join("\n"), new RegExp(`^block E_AGENT_MODEL unit models/claude: .*role rig-agent on claude resolves to model "${slug.replace(/[[\]]/g, "\\$&")}" \\(model\\)`, "m"));
      assert.equal(blocks(p.stdout).length, 1, "only the surface of the harness that holds the slug blocks");
    });
  }

  for (const slug of ["opus-faster", "fastopus", "opus-4-7"]) {
    test(`a slug that merely resembles fast (${slug}) passes`, (t) => {
      const s = home(t, setTier("strong", "claude", slug));
      const p = s.rig(["plan"]);
      assert.equal(p.code, 0, p.stdout + p.stderr);
      assert.equal(blocks(p.stdout).length, 0);
    });
  }

  test("a fast slug on the codex harness blocks the Codex agent surface only", (t) => {
    const s = home(t, setTier("strong", "codex", "codex-fast"));
    const p = s.rig(["plan"]);
    assert.equal(p.code, 1, p.stdout + p.stderr);
    assert.deepEqual(blocks(p.stdout).map((l) => l.match(/unit (\S+):/)?.[1]), ["models/codex"]);
  });

  test("rig models set with a fast slug blocks, exits non-zero, writes no agent file and keeps tiers.json", (t) => {
    const s = home(t);
    const before = readFileSync(join(s.root, "models/tiers.json"), "utf8");
    const r = s.rig(["models", "set", "strong", "opus-fast", "--harness", "claude"]);
    assert.notEqual(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /E_AGENT_MODEL/);
    assert.equal(readFileSync(join(s.root, "models/tiers.json"), "utf8"), before);
    assert.equal(existsSync(s.fx.path(".claude/agents/rig-agent.md")), false);
  });

  test("rig models set with a non-fast slug applies and rewrites the model line of rig-agent", (t) => {
    const s = home(t);
    const r = s.rig(["models", "set", "strong", "opus-next", "--harness", "claude"]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(s.read(".claude/agents/rig-agent.md"), /^model: "opus-next"$/m);
  });

  test("an overlay agent surface meets the guard: xhigh blocks, high renders", (t) => {
    const bad = home(t, withOverlay({ "rig-agent": ["strong", "xhigh"] }));
    const p = bad.rig(["plan"]);
    assert.equal(p.code, 1, p.stdout + p.stderr);
    assert.match(blocks(p.stdout).join("\n"), /^block E_AGENT_MODEL unit models\/claude: .*role rig-agent on claude resolves to effort "xhigh"/m);
    const ok = home(t, withOverlay({ "rig-agent": ["strong", "high"] }));
    const a = ok.rig(["apply"]);
    assert.equal(a.code, 0, a.stdout + a.stderr);
    assert.match(ok.read(".claude/agents/rig-agent.md"), /^effort: "high"$/m);
  });

  test("a grammar token is checked whole: Cursor's <slug>[effort=xhigh] blocks", (t) => {
    const surface = { ...OVERLAY_SURFACE, path: "~/.cursor/agents/{role}.md", harness: "cursor", keys: { model: "model" }, grammar: "{model}[effort=xhigh]" };
    const s = home(t, withOverlay({ "rig-agent": ["strong", "high"] }, surface));
    const p = s.rig(["plan"]);
    assert.equal(p.code, 1, p.stdout + p.stderr);
    assert.match(blocks(p.stdout).join("\n"), /^block E_AGENT_MODEL unit models\/cursor: .*role rig-agent on cursor resolves to model ".*\[effort=xhigh\]"/m);
  });
});

describe("agent surface: schema errors and key placement", () => {
  test("a literal role value is not one [tier, effort] pair: E_SCHEMA", (t) => {
    const s = home(t, setRole("rig-agent", { literal: "inherit" }));
    const p = s.rig(["plan"]);
    assert.equal(p.code, 1, p.stdout + p.stderr);
    assert.match(blocks(p.stdout).join("\n"), /^block E_SCHEMA unit models\/claude: .*role rig-agent must be one \[tier, effort\] pair$/m);
  });

  test("an agent surface without {role} in its path: E_SCHEMA", (t) => {
    const s = home(t, withOverlay({ "rig-agent": ["strong", "high"] }, { ...OVERLAY_SURFACE, path: "~/.claude/agents/one.md" }));
    const p = s.rig(["plan"]);
    assert.equal(p.code, 1, p.stdout + p.stderr);
    assert.match(blocks(p.stdout).join("\n"), /^block E_SCHEMA unit models\/claude: an agent surface needs \{role\} in its path$/m);
  });

  test("a grammar without keys.model: E_SCHEMA", (t) => {
    const surface = { ...OVERLAY_SURFACE, path: "~/.cursor/agents/{role}.md", harness: "cursor", keys: {}, grammar: "{model_effort}" };
    const s = home(t, withOverlay({ "rig-agent": ["strong", "high"] }, surface));
    const p = s.rig(["plan"]);
    assert.equal(p.code, 1, p.stdout + p.stderr);
    assert.match(blocks(p.stdout).join("\n"), /^block E_SCHEMA unit models\/cursor: .*an agent surface with a grammar needs keys\.model$/m);
  });

  test("a role that no agent unit renders gets an info line, no block and no file", (t) => {
    const s = home(t, withOverlay({ ghost: ["strong", "high"] }));
    const p = s.rig(["plan"]);
    assert.equal(p.code, 0, p.stdout + p.stderr);
    assert.match(p.stdout, /^info absent claude models\/claude: no agent unit renders ~\/\.claude\/agents\/ghost\.md, so its model keys do not render$/m);
    assert.equal(s.rig(["apply"]).code, 0);
    assert.equal(existsSync(s.fx.path(".claude/agents/ghost.md")), false);
  });

  test("Codex agent TOML: the model keys follow name and description, before the instructions", (t) => {
    const s = home(t);
    const a = s.rig(["apply"]);
    assert.equal(a.code, 0, a.stdout + a.stderr);
    const lines = s.read(".codex/agents/rig-agent.toml").split("\n");
    assert.match(lines[0], /^name = "rig-agent"$/);
    assert.match(lines[1], /^description = /);
    assert.match(lines[2], /^model = "[^"]+"$/);
    assert.equal(lines[3], 'model_reasoning_effort = "medium"');
    assert.equal(lines.filter((l) => /^model(_reasoning_effort)? = /.test(l)).length, 2, "each key once");
  });

  test("Claude agent file: model and effort replace the keys in the frontmatter, once", (t) => {
    const s = home(t);
    assert.equal(s.rig(["apply"]).code, 0);
    const text = s.read(".claude/agents/rig-agent.md");
    assert.equal(text.split("\n").filter((l) => /^(model|effort):/.test(l)).length, 2);
    assert.match(text, /^effort: "medium"$/m);
  });

  test("a roles.json without the consumer `agents`: 0 blocks, an info line per harness, and no model key in the agent files", (t) => {
    const s = home(t, (h) => editJson(join(h.root, "models/roles.json"), (r) => { delete r.consumers.agents; }));
    const a = s.rig(["apply"]);
    assert.equal(a.code, 0, a.stdout + a.stderr);
    const plan = s.rig(["plan"]);
    assert.equal(blocks(plan.stdout).length, 0);
    for (const h of ["claude", "codex", "cursor", "antigravity"]) {
      assert.match(plan.stdout, new RegExp(`^info absent ${h} models/${h}: roles\\.json has no consumer agents, so \\S+ gets no model keys$`, "m"), h);
    }
    assert.doesNotMatch(s.read(".claude/agents/rig-agent.md"), /^(model|effort):/m);
    assert.doesNotMatch(s.read(".codex/agents/rig-agent.toml"), /^model/m);
  });
});
