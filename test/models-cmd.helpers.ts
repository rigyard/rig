// Fixtures for test/models-render.test.ts and test/live/models.test.ts: a fixture HOME (pstack.helpers setup) whose
// repo root holds the placeholder tiers.json and roles.json of test/models.helpers.ts, an overlay rig.json that
// declares the fleet rules file, and the real-shape model files of test/fixtures/models at their harness paths.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { encode } from "../lib/world.ts";
import { baseRoles, baseTiers, SURFACES } from "./models.helpers.ts";
import { json, ROOT, setup } from "./pstack.helpers.ts";

const FIXTURES = join(ROOT, "test/fixtures/models");
export const fixtureText = (name: string): string => readFileSync(join(FIXTURES, name), "utf8");

/** Home-relative path of each real-shape fixture file. */
export const FILES: Record<string, string> = {
  ".claude/agents/reviewer.md": "claude-agents/reviewer.md",
  ".claude/agents/quick-worker.md": "claude-agents/quick-worker.md",
  ".cursor/agents/reviewer.md": "cursor-agents/reviewer.md",
  ".cursor/agents/fast-worker.md": "cursor-agents/fast-worker.md",
  ".claude/rules/orchestration.md": "orchestration.md",
  ".claude/rules/pstack-models.md": "pstack-models.md",
  ".cursor/rules/pstack-models.mdc": "pstack-models.mdc",
  ".omp/agent/config.yml": "config.yml",
  ".codex/config.toml": "config.toml",
};

/** The overlay rig.json: the fleet rules file with its roster and effort tables as cells surfaces. */
export const OVERLAY = { schema: 2, model_surfaces: [SURFACES.roster, SURFACES.efforts] };

/**
 * A fixture HOME with the model fixtures in place. `files` overrides or drops (null) a fixture by home path;
 * `tiers` and `roles` replace the placeholder records.
 */
export function modelsHome(opts: {files?: Record<string, string | null>, tiers?: object, roles?: object} = {}) {
  const home: Record<string, string> = { ".config/rig/rig.json": json(OVERLAY) };
  for (const [rel, name] of Object.entries(FILES)) home[rel] = fixtureText(name);
  for (const [rel, body] of Object.entries(opts.files ?? {})) {
    if (body === null) delete home[rel];
    else home[rel] = body;
  }
  const s = setup({ home });
  // Canonical form, the form rig models set writes, so a set changes one line of it.
  writeFileSync(join(s.root, "models/tiers.json"), encode("tiers", opts.tiers ?? baseTiers()));
  writeFileSync(join(s.root, "models/roles.json"), json(opts.roles ?? baseRoles()));
  return s;
}

/** Model op lines of a plan report: [op, kind, path], for the paths of FILES and the Codex agent TOML files of the model table. */
export function modelOps(stdout: string): string[][] {
  const out: string[][] = [];
  for (const line of stdout.split("\n")) {
    const m = line.match(/^(\S+) +(owned|cells|block|json-element) +\S* +(~\/\S+) *(\S*)/);
    if (!m) continue;
    const rel = m[3].slice(2);
    if (rel in FILES || (/^\.codex\/agents\/[^/]+\.toml$/.test(rel) && m[4] === "models/codex")) out.push([m[1], m[2], m[3]]);
  }
  return out.sort((a, b) => a[2].localeCompare(b[2]));
}

/** Line pairs that differ between two texts with the same line count, as [line number, before, after]. */
export function lineDiff(before: string, after: string): [number, string, string][] {
  const a = before.split("\n");
  const b = after.split("\n");
  if (a.length !== b.length) throw new Error(`line count changed: ${a.length} -> ${b.length}`);
  return a.flatMap((l, i): [number, string, string][] => (l === b[i] ? [] : [[i + 1, l, b[i]]]));
}
