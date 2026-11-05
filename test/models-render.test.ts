// Model surfaces end to end through the CLI: render emits them, state adopts and patches them, rig models set
// changes exactly the expected cells. Each test runs bin/rig.ts on a fixture HOME that holds the real-shape model
// files of test/fixtures/models, with placeholder tiers. Done-checks of docs/plan/v0-slices.md: S3.1, S3.2, S3.3,
// S3.4, S3.5, S3.6, S3.7, S3.10 and the Codex half of S3.12.

import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { describe, test } from "node:test";
import type { TestContext } from "node:test";
import { applyThenWrite } from "../lib/commands/models.ts";
import { withCellMarkers } from "./models.helpers.ts";
import { FILES, fixtureText, lineDiff, modelOps, modelsHome } from "./models-cmd.helpers.ts";

const STATE = ".local/state/rig/";
const TIERS = "rig/models/tiers.json";

type Home = ReturnType<typeof modelsHome>;

/** A fixture HOME after one rig apply, removed after the test. */
function applied(t: TestContext, opts: Parameters<typeof modelsHome>[0] = {}): Home {
  const s = modelsHome(opts);
  t.after(() => s.fx.cleanup());
  const a = s.rig(["apply"]);
  assert.equal(a.code, 0, a.stdout + a.stderr);
  return s;
}

/** Home-relative paths whose bytes or mode differ between two snapshots, outside the state root. */
function changed(a: Map<string, {sha256: string, mode: number}>, b: Map<string, {sha256: string, mode: number}>): string[] {
  return [...new Set([...a.keys(), ...b.keys()])]
    .filter((p) => !p.startsWith(STATE) && (a.get(p)?.sha256 !== b.get(p)?.sha256 || a.get(p)?.mode !== b.get(p)?.mode))
    .sort();
}

/** Run models set and return the changed lines of every model file, keyed by home path. */
function swap(s: Home, args: string[]): {code: number | null, stdout: string, files: Record<string, [number, string, string][]>, others: string[]} {
  const before = new Map(Object.keys(FILES).map((rel) => [rel, s.read(rel)]));
  const tomls = [".codex/agents/reviewer.toml", ".codex/agents/quick-worker.toml"];
  for (const rel of tomls) before.set(rel, s.read(rel));
  const snap = s.fx.snapshot();
  const r = s.rig(["models", "set", ...args]);
  const files: Record<string, [number, string, string][]> = {};
  for (const [rel, text] of before) files[rel] = lineDiff(text, s.read(rel));
  const others = changed(snap, s.fx.snapshot()).filter((p) => !before.has(p) && p !== TIERS);
  return { code: r.code, stdout: r.stdout + r.stderr, files, others };
}

/** Only the files that changed, so an assertion names every changed file. */
const touched = (files: Record<string, [number, string, string][]>) => Object.fromEntries(Object.entries(files).filter(([, d]) => d.length));

describe("first run: adopt (S3.1, S3.12)", () => {
  test("plan: adopt for each existing surface, insert-markers for the rules file only, one block append, one create per Codex agent", (t) => {
    const s = modelsHome();
    t.after(() => s.fx.cleanup());
    const p = s.rig(["plan"]);
    assert.equal(p.code, 0, p.stdout + p.stderr);
    assert.deepEqual(modelOps(p.stdout), [
      ["adopt", "cells", "~/.claude/agents/quick-worker.md"],
      ["adopt", "cells", "~/.claude/agents/reviewer.md"],
      ["insert-markers", "cells", "~/.claude/rules/orchestration.md"],
      ["adopt", "owned", "~/.claude/rules/pstack-models.md"],
      ["create", "owned", "~/.codex/agents/quick-worker.toml"],
      ["create", "owned", "~/.codex/agents/reviewer.toml"],
      ["update", "block", "~/.codex/config.toml"],
      ["adopt", "cells", "~/.cursor/agents/fast-worker.md"],
      ["adopt", "cells", "~/.cursor/agents/reviewer.md"],
      ["adopt", "owned", "~/.cursor/rules/pstack-models.mdc"],
      ["adopt", "cells", "~/.omp/agent/config.yml"],
    ]);
    // A fleet role with no Claude agent file renders no Codex agent, and says so (S3.12).
    for (const role of ["deep-reasoner", "senior-worker", "fast-worker", "web-researcher"]) {
      assert.match(p.stdout, new RegExp(`^info absent codex models/codex: ~/\\.claude/agents/${role}\\.md is absent, so ~/\\.codex/agents/${role}\\.toml does not render$`, "m"));
    }
  });

  test("apply: markers around each table, the appended block, the new Codex agents, and no other byte in any model file", (t) => {
    const s = applied(t);
    for (const [rel, name] of Object.entries(FILES)) {
      const before = fixtureText(name);
      if (rel === ".claude/rules/orchestration.md") assert.equal(s.read(rel), withCellMarkers(before), rel);
      else if (rel === ".codex/config.toml") {
        assert.equal(s.read(rel), `${before}\n# rig:models:start\n[agents]\ndefault_subagent_model = "codex-model-s"\ndefault_subagent_reasoning_effort = "medium"\n# rig:models:end\n`);
      } else assert.equal(s.read(rel), before, `${rel}: 0 bytes change`);
    }
    assert.equal(
      s.read(".codex/agents/reviewer.toml"),
      'name = "reviewer"\n' +
        'description = "(Read-only) independent adversarial reviewer (Bravo). Use after an editing agent reports a change complete (see rules)."\n' +
        'model = "codex-model-s"\nmodel_reasoning_effort = "high"\n' +
        'developer_instructions = """\n\nYou are a reviewer (Bravo). Keep this prose untouched.\n"""\n',
    );
    assert.match(s.read(".codex/agents/quick-worker.toml"), /^model = "codex-model-c"\nmodel_reasoning_effort = "low"$/m);
    // The render digest lives in installed.json, never in the file.
    const installed = JSON.parse(s.read(`${STATE}installed.json`)).entries;
    for (const rel of [".omp/agent/config.yml", ".claude/agents/reviewer.md", ".claude/rules/orchestration.md", ".cursor/agents/fast-worker.md"]) {
      assert.equal(installed[`~/${rel}`].kind, "cells", rel);
      assert.match(installed[`~/${rel}`].digest, /^sha256:[0-9a-f]{64}$/, rel);
      assert.doesNotMatch(s.read(rel), /sha256|[0-9a-f]{64}/, rel);
    }
    assert.equal(installed["~/.codex/config.toml"].kind, "block");
    const again = s.rig(["plan"]);
    assert.equal(again.code, 0, again.stdout);
    assert.deepEqual(modelOps(again.stdout), [], "a second run plans no model op");
  });

  test("one cell that differs from the render blocks with a per-cell diff, and apply keeps every byte (S3.2)", (t) => {
    const roster = fixtureText("orchestration.md").replace("| web-researcher | medium  |", "| web-researcher | high    |");
    const agent = fixtureText("claude-agents/reviewer.md").replace("effort: high", "effort: low");
    const s = modelsHome({ files: { ".claude/rules/orchestration.md": roster, ".claude/agents/reviewer.md": agent } });
    t.after(() => s.fx.cleanup());
    const p = s.rig(["plan"]);
    assert.equal(p.code, 1, p.stdout);
    assert.match(p.stdout, /^block +cells +claude +~\/\.claude\/rules\/orchestration\.md +E_ADOPT_MISMATCH /m);
    assert.match(p.stdout, /^~\/\.claude\/rules\/orchestration\.md 1\/web-researcher\/0\/effort: "high" -> "medium"$/m);
    // Three cells of one frontmatter role: only the differing one is in the diff, with its own current value.
    assert.match(p.stdout, /^~\/\.claude\/agents\/reviewer\.md 0\/reviewer\/0\/effort: "low" -> "high"$/m);
    assert.doesNotMatch(p.stdout, /reviewer\/0\/(model|display):/);
    const before = s.fx.snapshot();
    const a = s.rig(["apply"]);
    assert.equal(a.code, 1, a.stdout);
    assert.deepEqual(changed(before, s.fx.snapshot()), []);
  });

  test("an [agents] table outside the markers blocks with E_LOCATOR and the Codex config keeps its bytes (S3.10)", (t) => {
    const toml = `${fixtureText("config.toml")}\n[agents]\nmax_threads = 4\n`;
    const s = modelsHome({ files: { ".codex/config.toml": toml } });
    t.after(() => s.fx.cleanup());
    const p = s.rig(["plan"]);
    assert.equal(p.code, 1, p.stdout);
    assert.match(p.stdout, /^block +block +codex +~\/\.codex\/config\.toml +E_LOCATOR .*\[agents\] table exists outside the rig:models markers/m);
    assert.equal(s.rig(["apply"]).code, 1);
    assert.equal(s.read(".codex/config.toml"), toml);
  });
});

describe("rig models set changes exactly the expected cells (S3.3, S3.4, S3.7)", () => {
  test("omp: one line of config.yml, one value of tiers.json, no other file", (t) => {
    const s = applied(t);
    const tiersBefore = s.read(TIERS);
    const r = swap(s, ["strong", "prov/model-z", "--harness", "omp"]);
    assert.equal(r.code, 0, r.stdout);
    assert.match(r.stdout, /^patch-cells +cells +omp +~\/\.omp\/agent\/config\.yml +models\/omp$/m);
    assert.deepEqual(touched(r.files), { ".omp/agent/config.yml": [[5, "  advisor: prov/model-a:medium", "  advisor: prov/model-z:medium"]] });
    assert.deepEqual(r.others, []);
    assert.deepEqual(lineDiff(tiersBefore, s.read(TIERS)).map(([, , after]) => after.trim()), ['"omp": "prov/model-z"']);
    const p = s.rig(["plan"]);
    assert.equal(p.code, 0, p.stdout);
    assert.deepEqual(modelOps(p.stdout), []);
  });

  test("claude: the roster rows, the agent model line and display token, and the pstack lines of that tier", (t) => {
    const s = applied(t);
    const r = swap(s, ["strong", "echo", "--harness", "claude"]);
    assert.equal(r.code, 0, r.stdout);
    assert.deepEqual(touched(r.files), {
      ".claude/rules/orchestration.md": [
        [12, "| reviewer                   | Bravo, high, read-only  | independent adversarial pass over a diff       |", "| reviewer                   | Echo, high, read-only  | independent adversarial pass over a diff       |"],
        [13, "| senior-worker              | Bravo, high             | implementation that needs judgment             |", "| senior-worker              | Echo, high             | implementation that needs judgment             |"],
      ],
      ".claude/agents/reviewer.md": [
        [3, "description: (Read-only) independent adversarial reviewer (Bravo). Use after an editing agent reports a change complete (see rules).", "description: (Read-only) independent adversarial reviewer (Echo). Use after an editing agent reports a change complete (see rules)."],
        [4, "model: bravo", "model: echo"],
      ],
      ".claude/rules/pstack-models.md": [
        [6, "hardest tasks: bravo xhigh", "hardest tasks: echo xhigh"],
        [9, "reflect judgment, divergent, synthesizer: bravo high", "reflect judgment, divergent, synthesizer: echo high"],
        [10, "arena runners: bravo high, charlie high", "arena runners: echo high, charlie high"],
        [11, "arena cross-judge pool: bravo high, charlie low", "arena cross-judge pool: echo high, charlie low"],
      ],
    });
    assert.deepEqual(r.others, []);
  });

  test("claude, a pinned id: only the model line of the agent that maps to the tier (S3.7)", (t) => {
    const s = applied(t);
    const r = swap(s, ["cheap", "pinned-model-e", "--harness", "claude"]);
    assert.equal(r.code, 0, r.stdout);
    assert.deepEqual(touched(r.files), { ".claude/agents/quick-worker.md": [[4, "model: pinned-model-d", "model: pinned-model-e"]] });
    assert.deepEqual(r.others, []);
  });

  test("cursor: the fused agent model line and the dash-fused pstack tokens of that tier", (t) => {
    const s = applied(t);
    const r = swap(s, ["fast", "slug-z", "--harness", "cursor"]);
    assert.equal(r.code, 0, r.stdout);
    assert.deepEqual(touched(r.files), {
      ".cursor/agents/fast-worker.md": [[4, "model: slug-f-high[effort=low]", "model: slug-z[effort=low]"]],
      ".cursor/rules/pstack-models.mdc": [
        [8, "feature, refactoring: slug-f-high-high", "feature, refactoring: slug-z-high"],
        [9, "bug-fix: slug-f-high-high", "bug-fix: slug-z-high"],
        [14, "arena runners: slug-s-high, slug-f-high-high", "arena runners: slug-s-high, slug-z-high"],
        [15, "arena cross-judge pool: slug-s-high, slug-f-high-low", "arena cross-judge pool: slug-s-high, slug-z-low"],
      ],
    });
    assert.deepEqual(r.others, []);
  });

  test("codex: the block line and the agent TOML line of that tier", (t) => {
    const s = applied(t);
    const r = swap(s, ["strong", "codex-model-z", "--harness", "codex"]);
    assert.equal(r.code, 0, r.stdout);
    assert.deepEqual(touched(r.files), {
      ".codex/config.toml": [[22, 'default_subagent_model = "codex-model-s"', 'default_subagent_model = "codex-model-z"']],
      ".codex/agents/reviewer.toml": [[3, 'model = "codex-model-s"', 'model = "codex-model-z"']],
    });
    assert.deepEqual(r.others, []);
  });

  test("a set whose plan blocks writes nothing, tiers.json included", (t) => {
    const s = applied(t);
    // A hand edit of the cell that the swap targets: drift, so the restricted plan blocks.
    writeFileSync(s.fx.path(".omp/agent/config.yml"), s.read(".omp/agent/config.yml").replace("advisor: prov/model-a:medium", "advisor: prov/model-a:high"));
    const before = s.fx.snapshot();
    const r = s.rig(["models", "set", "strong", "prov/model-z", "--harness", "omp"]);
    assert.equal(r.code, 1, r.stdout);
    assert.match(r.stdout, /^block +cells +omp +~\/\.omp\/agent\/config\.yml +E_DRIFT /m);
    assert.deepEqual(changed(before, s.fx.snapshot()), []);
  });

  test("set without --harness exits 2 (S3.5)", (t) => {
    const s = modelsHome();
    t.after(() => s.fx.cleanup());
    const r = s.rig(["models", "set", "strong", "prov/model-z"]);
    assert.equal(r.code, 2, r.stdout + r.stderr);
  });
});

describe("drift by cell digest (S3.6)", () => {
  test("an omp-style rewrite of other keys is not drift; a hand edit of one cell is, and names the cell", (t) => {
    const s = applied(t);
    writeFileSync(s.fx.path(".omp/agent/config.yml"), fixtureText("config.rewritten.yml"));
    const p = s.rig(["plan"]);
    assert.equal(p.code, 0, p.stdout);
    assert.deepEqual(modelOps(p.stdout), []);
    writeFileSync(s.fx.path(".omp/agent/config.yml"), fixtureText("config.rewritten.yml").replace("plan: prov/model-r:high", "plan: prov/model-r:low"));
    const d = s.rig(["plan"]);
    assert.equal(d.code, 1, d.stdout);
    assert.match(d.stdout, /^block +cells +omp +~\/\.omp\/agent\/config\.yml +E_DRIFT /m);
    assert.match(d.stdout, /^~\/\.omp\/agent\/config\.yml 0\/plan\/0\/model_effort: "prov\/model-r:low" -> "prov\/model-r:high"$/m);
  });
});

describe("models set writes tiers.json only after the plan that state.apply ran", () => {
  type Res = ReturnType<typeof applyThenWrite>;
  const world = { targets: new Map(), packs: new Map(), config: {}, roles: { consumers: {} }, env: { home: "/h" } };
  const cases: [string, Res["r"], boolean][] = [
    ["a fresh plan blocks after a stale one", null, false],
    ["the run did not start", { run: null, changed: 0, error: { code: "E_LOCKED", message: "held" } }, false],
    ["nothing to change", { run: null, changed: 0 }, true],
    ["the run committed", { run: "r1", changed: 2 }, true],
    ["the run stopped part way", { run: "r1", changed: 1, error: { code: "E_CHANGED_UNDER", message: "x" } }, true],
  ];
  for (const [name, r, writes] of cases) {
    test(`${name}: tiers.json is ${writes ? "" : "not "}written`, () => {
      let wrote = 0;
      const res = applyThenWrite(world, () => wrote++, () => ({ p: {} as Res["p"], r }));
      assert.equal(wrote, writes ? 1 : 0);
      assert.equal(res.r, r);
    });
  }
});
