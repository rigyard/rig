// Test helpers for test/models.test.mjs. Placeholder values only.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { cellValues } from "../lib/models.mjs";

const FIXTURES = new URL("./fixtures/models/", import.meta.url);
export const fixture = (name) => new Uint8Array(readFileSync(new URL(name, FIXTURES)));
export const text = (bytes) => new TextDecoder().decode(bytes);
export const bytesOf = (s) => new TextEncoder().encode(s);

export function baseTiers() {
  return {
    schema: 1,
    ladders: {
      claude: ["low", "medium", "high", "xhigh", "max"],
      codex: ["low", "medium", "high", "xhigh"],
      omp: ["low", "medium", "high"],
      cursor: ["low", "medium", "high"],
    },
    passthrough: { omp: ["auto"], cursor: ["auto"] },
    tiers: {
      reason: { claude: "alpha", codex: "codex-model-r", omp: "prov/model-r", cursor: "slug-r" },
      strong: { claude: "bravo", codex: "codex-model-s", omp: "prov/model-a", cursor: "slug-s" },
      // omp and cursor ids that end in an effort word
      fast: { claude: "charlie", codex: "codex-model-f", omp: "prov/model-f-high", cursor: "slug-f-high" },
      cheap: { claude: { id: "pinned-model-d", display: "Delta" }, codex: "codex-model-c", omp: "prov/model-c", cursor: "slug-c" },
    },
  };
}

export function baseRoles() {
  return {
    schema: 1,
    consumers: {
      fleet: {
        "deep-reasoner": ["reason", "high"],
        reviewer: ["strong", "high"],
        "senior-worker": ["strong", "high"],
        "fast-worker": ["fast", "low"],
        "quick-worker": ["cheap", "low"],
        "web-researcher": ["fast", "medium"],
      },
      pstack: {
        budget: { literal: "medium (high)" },
        "feature, refactoring": ["fast", "high"],
        "bug-fix": ["fast", "high"],
        "hardest tasks": ["strong", "xhigh"],
        "deep dives": ["reason", "max"],
        "how explorer": { all: ["fast", "high"], cursor: "auto" },
        "reflect judgment, divergent, synthesizer": ["strong", "high"],
        "arena runners": [["strong", "high"], ["fast", "high"]],
        "arena cross-judge pool": [["strong", "high"], ["fast", "low"]],
      },
      omp: {
        task: ["fast", "auto"],
        advisor: ["strong", "medium"],
        judge: { literal: "other/model-j:medium" },
        plan: ["reason", "high"],
        default: ["cheap", "medium"],
      },
      codex: { default: ["strong", "medium"] },
    },
  };
}

// Surfaces in the shapes of the architecture doc, sections 2.1, 2.4 and 2.5.
export const SURFACES = {
  claudeAgent: { path: "~/.claude/agents/{role}.md", consumer: "fleet", kind: "frontmatter", keys: { model: "model", effort: "effort" }, display_in: "description" },
  cursorAgent: { path: "~/.cursor/agents/{role}.md", consumer: "fleet", kind: "frontmatter", keys: { model: "model" }, grammar: "{model_effort}" },
  roster: { path: "~/.claude/rules/orchestration.md", harness: "claude", consumer: "fleet", markers: true, kind: "cells", header: "| Role | Model, effort | Use for |", key_column: "Role", column: "Model, effort", grammar: "{display}, {effort}[, {rest}]" },
  efforts: { path: "~/.claude/rules/orchestration.md", harness: "claude", consumer: "fleet", markers: true, kind: "cells", header: "| Role | Default | Lower to | Raise to |", key_column: "Role", column: "Default", grammar: "{effort}" },
  pstackMd: { path: "~/.claude/rules/pstack-models.md", harness: "claude", consumer: "pstack", kind: "whole", keep_header: true, grammar: "{model} {effort}" },
  pstackMdc: { path: "~/.cursor/rules/pstack-models.mdc", harness: "cursor", consumer: "pstack", kind: "whole", keep_header: true, grammar: "{model_effort}", effort_syntax: "dash-fused" },
  omp: { path: "~/.omp/agent/config.yml", consumer: "omp", kind: "keys", map: "modelRoles", grammar: "{model_effort}", harness_rewrites: true },
  codexBlock: { path: "~/.codex/config.toml", consumer: "codex", kind: "block", marker: "rig:models", table: "agents", keys: { model: "default_subagent_model", effort: "default_subagent_reasoning_effort" } },
};

export function makeWorld({ tiers = baseTiers(), roles = baseRoles(), vars = {} } = {}) {
  const targets = new Map([
    ["claude", { name: "claude", effort_syntax: "separate-key" }],
    ["codex", { name: "codex", effort_syntax: "separate-key" }],
    ["omp", { name: "omp", effort_syntax: "colon-suffix" }],
    ["cursor", { name: "cursor", effort_syntax: "bracket" }],
  ]);
  return Object.freeze({ tiers, roles, targets, vars });
}

/** What targets.render would build for one file: the cells entry over one or more surfaces. */
export function cellsEntry(world, path, parts) {
  const surfaces = [];
  const values = [];
  for (const { surface, harness, role } of parts) {
    const index = surfaces.push(surface) - 1;
    for (const v of cellValues(world, surface, harness)) {
      if (role === undefined || v.key === role) values.push({ ...v, surface: index });
    }
  }
  return { kind: "cells", path, surfaces, values, unit: "models/test" };
}

/** Every cells fixture of the suite, with the entry that renders it. */
export function cellFixtures(world) {
  return [
    { file: "orchestration.md", entry: cellsEntry(world, SURFACES.roster.path, [
      { surface: SURFACES.roster, harness: "claude" },
      { surface: SURFACES.efforts, harness: "claude" },
    ]) },
    { file: "claude-agents/reviewer.md", entry: cellsEntry(world, "~/.claude/agents/reviewer.md", [{ surface: SURFACES.claudeAgent, harness: "claude", role: "reviewer" }]) },
    { file: "claude-agents/quick-worker.md", entry: cellsEntry(world, "~/.claude/agents/quick-worker.md", [{ surface: SURFACES.claudeAgent, harness: "claude", role: "quick-worker" }]) },
    { file: "cursor-agents/reviewer.md", entry: cellsEntry(world, "~/.cursor/agents/reviewer.md", [{ surface: SURFACES.cursorAgent, harness: "cursor", role: "reviewer" }]) },
    { file: "cursor-agents/fast-worker.md", entry: cellsEntry(world, "~/.cursor/agents/fast-worker.md", [{ surface: SURFACES.cursorAgent, harness: "cursor", role: "fast-worker" }]) },
    { file: "pstack-models.md", entry: cellsEntry(world, SURFACES.pstackMd.path, [{ surface: SURFACES.pstackMd, harness: "claude" }]) },
    { file: "pstack-models.mdc", entry: cellsEntry(world, SURFACES.pstackMdc.path, [{ surface: SURFACES.pstackMdc, harness: "cursor" }]) },
    { file: "config.yml", entry: cellsEntry(world, SURFACES.omp.path, [{ surface: SURFACES.omp, harness: "omp" }]) },
  ];
}

/** What targets.render would build for the Codex [agents] block. */
export function codexBlockEntry(world) {
  const vals = cellValues(world, SURFACES.codexBlock, "codex");
  const get = (f) => vals.find((v) => v.key === "default" && v.field === f).value;
  const body = `[agents]\ndefault_subagent_model = "${get("model")}"\ndefault_subagent_reasoning_effort = "${get("effort")}"\n`;
  return { kind: "block", path: SURFACES.codexBlock.path, marker: "rig:models", table: "agents", bytes: bytesOf(body), unit: "models/codex" };
}

/** The installed.json cell digest: sha256 over the canonical list of cell tuples. */
export function digest(values) {
  const list = values.map((v) => [v.surface, v.key, v.element, v.field, v.value]);
  return "sha256:" + createHash("sha256").update(JSON.stringify(list)).digest("hex");
}

/** Per-cell diff of located values against rendered values, by (surface, key, element, field). */
export function cellDiff(current, desired) {
  const id = (v) => JSON.stringify([v.surface, v.key, v.element, v.field]);
  const cur = new Map(current.map((v) => [id(v), v.value]));
  const want = new Map(desired.map((v) => [id(v), v.value]));
  const out = [];
  for (const k of new Set([...cur.keys(), ...want.keys()])) {
    if (cur.get(k) !== want.get(k)) out.push({ cell: JSON.parse(k), from: cur.get(k) ?? null, to: want.get(k) ?? null });
  }
  return out;
}

/** Line pairs that differ between two texts with the same line count. */
export function changedLines(before, after) {
  const a = before.split("\n");
  const b = after.split("\n");
  if (a.length !== b.length) throw new Error(`line count changed: ${a.length} -> ${b.length}`);
  return a.flatMap((line, i) => (line === b[i] ? [] : [{ n: i + 1, before: line, after: b[i] }]));
}

/** Insert the cell markers the way adopt does, for a whole-file expectation. */
export function withCellMarkers(src) {
  const lines = src.split("\n");
  const out = [];
  let inTable = false;
  for (let i = 0; i < lines.length; i++) {
    const isHeader = lines[i].startsWith("| Role ") && lines[i + 1]?.startsWith("|---");
    if (isHeader) {
      out.push("<!-- rig:models:start -->");
      inTable = true;
    }
    out.push(lines[i]);
    if (inTable && !lines[i + 1]?.startsWith("|")) {
      out.push("<!-- rig:models:end -->");
      inTable = false;
    }
  }
  return out.join("\n");
}
