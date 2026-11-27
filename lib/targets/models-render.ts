// lib/targets/models-render.ts — internal to targets. The model surfaces of render (section 8).
//
// Pure: the input carries every byte it reads (world.sources holds the text_from files). It returns entries at
// home-relative paths; lib/targets.ts emits them, so never_write and clash rules apply to them like to any unit.
//
//   frontmatter  one cells entry per {role} file: Claude model, effort and display token; Cursor <slug>[effort=<e>]
//   cells        one cells entry per path, every surface of that path in it (the user's fleet rules file)
//   keys         one cells entry: the omp modelRoles values
//   whole        a pack's model rules (owned, keep_header), or a Codex agent TOML per {role} from its text_from file
//   block        the Codex [agents] table between rig:models markers
//   agent        the model keys of an agent file that an agent unit renders; lib/targets.ts sets them in those bytes

import { cellValues } from "../models.ts";
import { codexAgent, mdc } from "./formats.ts";
import type { CellValue, DesiredEntry } from "../targets.ts";
import type { ModelSurface, Pack, TargetRecord, Tiers, World } from "../world.ts";
import type { RigError } from "../stack.ts";

/** A DesiredEntry before emit sets its absolute path. */
export type ModelEntry = DesiredEntry extends infer E ? (E extends DesiredEntry ? Omit<E, "path"> : never) : never;
export type ModelRenderInput = {
  installed: string[];
  targets: Map<string, TargetRecord>;
  /** the packs of the world; pack.json `model_surfaces` name their harness */
  packs: Pick<Pack, "name" | "manifest">[];
  tiers: Tiers | undefined;
  world: World;
};

const encoder = new TextEncoder();
const FILE_MODE = 0o644;
const ROLE = "{role}";
const CELL_KINDS = new Set(["frontmatter", "cells", "keys"]);

/** The model keys of one agent file, in key order: `key` is the file's key name, `value` the rendered token. */
export type AgentKeys = {rel: string, harness: string, unit: string, keys: {key: string, value: string}[]};
type Out = {entries: {rel: string, entry: ModelEntry}[], agents: AgentKeys[], errors: RigError[], info: string[]};
type Source = {surface: ModelSurface, harness: string | undefined, unit: string};
type Cells = {surfaces: ModelSurface[], values: CellValue[], unit: string};

/**
 * Every model surface on an installed harness: the target records' surfaces (harness: the record), the packs'
 * surfaces and the overlay rig.json `model_surfaces` (both name their harness). A harness that tiers.json
 * names in no tier renders no surface, with an info line. Any other cell error is a render error of that surface.
 */
export function renderModelSurfaces(input: ModelRenderInput): Out {
  const out: Out = { entries: [], agents: [], errors: [], info: [] };
  const sources: Source[] = [
    ...input.packs.flatMap((p) => (p.manifest.model_surfaces ?? []).map((s) => ({ surface: s, harness: s.harness, unit: `${p.name}/models` }))),
    ...input.installed.flatMap((h) =>
      (input.targets.get(h)?.model_surfaces ?? []).map((s) => ({ surface: s, harness: s.harness ?? h, unit: `models/${s.harness ?? h}` })),
    ),
    ...(input.world.config?.model_surfaces ?? []).map((s) => ({ surface: s, harness: s.harness, unit: `models/${s.harness ?? "overlay"}` })),
  ];
  // Cell surfaces of one path share one entry: a fleet rules file holds two tables, each its own surface.
  const cells = new Map<string, Cells>();
  for (const src of sources) renderSurface(input, src, out, cells);
  for (const [rel, c] of cells) out.entries.push({ rel, entry: { kind: "cells", surfaces: c.surfaces, values: c.values, unit: c.unit } });
  return out;
}

function renderSurface(input: ModelRenderInput, src: Source, out: Out, cells: Map<string, Cells>) {
  const { surface: s, unit } = src;
  const fail = (code: string, message: string) => out.errors.push({ code, ...(src.harness ? { harness: src.harness } : {}), path: s.path, message: `unit ${unit}: ${message}` });
  if (!src.harness) return fail("E_SCHEMA", `model surface ${s.path} names no harness`);
  const h = src.harness;
  if (!input.installed.includes(h)) return;
  // An agent surface sets keys for the agents its consumer lists, so an absent consumer lists none. The core agents
  // then keep the source bytes, which name no model, so the file inherits its parent's: say so, do not skip silently.
  if (s.kind === "agent" && !Object.hasOwn(input.world.roles?.consumers ?? {}, s.consumer)) {
    out.info.push(`absent ${h} ${unit}: roles.json has no consumer ${s.consumer}, so ${s.path} gets no model keys`);
    return;
  }
  if (!Object.values(input.tiers?.tiers ?? {}).some((row) => Object.hasOwn(row, h))) {
    out.info.push(`absent ${h} ${unit}: tiers.json names no ${h} model, so ${s.path} does not render`);
    return;
  }
  let values: CellValue[];
  try {
    values = cellValues(input.world, s, h);
  } catch (e) {
    const code = (e as {code?: unknown})?.code;
    if (typeof code !== "string") throw e;
    const message = (e as Error).message;
    return fail(code, message.startsWith(`${code}: `) ? message.slice(code.length + 2) : message);
  }
  const roles = Object.keys(input.world.roles?.consumers?.[s.consumer] ?? {});

  if (CELL_KINDS.has(s.kind)) {
    const files = s.path.includes(ROLE) ? roles.map((r) => ({ rel: s.path.replaceAll(ROLE, r), vals: values.filter((v) => v.key === r) })) : [{ rel: s.path, vals: values }];
    for (const { rel, vals } of files) {
      const c = cells.get(rel) ?? { surfaces: [], values: [], unit };
      const index = c.surfaces.push(s) - 1;
      for (const v of vals) c.values.push({ ...v, surface: index });
      cells.set(rel, c);
    }
    return;
  }
  if (s.kind === "block") {
    if (s.path.includes(ROLE)) return fail("E_SCHEMA", `a block surface has one path, not ${ROLE}`);
    const body = tomlTable(s, values, roles, fail);
    if (body === null) return;
    out.entries.push({ rel: s.path, entry: { kind: "block", marker: s.marker ?? "rig:models", bytes: encoder.encode(body), unit, ...(s.table ? { table: s.table } : {}) } });
    return;
  }
  if (s.kind === "agent") {
    if (!s.path.includes(ROLE)) return fail("E_SCHEMA", `an agent surface needs ${ROLE} in its path`);
    for (const role of roles) {
      const keys = agentKeys(s, values.filter((v) => v.key === role), role, fail);
      if (keys !== null && agentForbidden(s, h, role, keys, fail)) continue;
      if (keys !== null) out.agents.push({ rel: s.path.replaceAll(ROLE, role), harness: h, unit, keys });
    }
    return;
  }
  if (s.kind === "whole" && s.text_from) {
    for (const role of roles) {
      const rel = s.path.replaceAll(ROLE, role);
      const from = s.text_from.replaceAll(ROLE, role);
      const text = input.world.sources?.get(from);
      if (!text) {
        out.info.push(`absent ${h} ${unit}: ${from} is absent, so ${rel} does not render`);
        continue;
      }
      const keys = keyLines(s, values.filter((v) => v.key === role), role, fail);
      if (keys === null) continue;
      const lines = codexAgent(new TextDecoder().decode(text), role).split("\n");
      lines.splice(2, 0, ...keys); // after name and description, the two one-line keys codexAgent writes first
      out.entries.push({ rel, entry: { kind: "owned", bytes: encoder.encode(lines.join("\n")), mode: FILE_MODE, unit } });
    }
    return;
  }
  if (s.kind === "whole") {
    const body = roleLines(s, values);
    const bytes = encoder.encode(s.path.endsWith(".mdc") ? mdc(body) : body);
    out.entries.push({ rel: s.path, entry: { kind: "owned", bytes, mode: FILE_MODE, unit, ...(s.keep_header ? { keep_header: true } : {}) } });
    return;
  }
  fail("E_SCHEMA", `unknown model surface kind ${s.kind}`);
}

/** `<key> = "<value>"` lines of one role from surface.keys. A literal or a panel has no key line, so it fails. */
function keyLines(s: ModelSurface, values: CellValue[], role: string, fail: (code: string, message: string) => void): string[] | null {
  if (values.some((v) => v.field === "literal" || v.element > 0)) {
    fail("E_SCHEMA", `${s.path}: role ${role} must be one [tier, effort] pair`);
    return null;
  }
  const lines: string[] = [];
  for (const field of ["model", "effort"] as const) {
    const key = s.keys?.[field];
    const v = values.find((x) => x.field === field);
    // JSON.stringify output is a valid TOML basic string: every JSON escape is a TOML escape.
    if (key && v) lines.push(`${key} = ${JSON.stringify(v.value)}`);
  }
  return lines;
}

/**
 * The key-value pairs of one agent role. With a grammar, its filled token is the value of keys.model, as Cursor's
 * `<slug>[effort=<e>]`. Without one, each of model and effort goes to its key in surface.keys.
 */
function agentKeys(s: ModelSurface, values: CellValue[], role: string, fail: (code: string, message: string) => void): {key: string, value: string}[] | null {
  if (values.some((v) => v.field === "literal" || v.element > 0)) {
    fail("E_SCHEMA", `${s.path}: role ${role} must be one [tier, effort] pair`);
    return null;
  }
  const field = (f: string) => values.find((v) => v.field === f)?.value;
  if (s.grammar) {
    if (!s.keys?.model) {
      fail("E_SCHEMA", `${s.path}: an agent surface with a grammar needs keys.model`);
      return null;
    }
    return [{ key: s.keys.model, value: s.grammar.replace(/\{(\w+)\}/g, (_, name: string) => field(name) ?? "") }];
  }
  return (["model", "effort"] as const).flatMap((f) => {
    const key = s.keys?.[f];
    const value = field(f);
    return key && value ? [{ key, value }] : [];
  });
}

/** The effort values that no agent definition carries, and a model token that names a fast mode in any fused form. */
const AGENT_EFFORT = /^(xhigh|max)$/;
const AGENT_FAST = /-fast(?![A-Za-z0-9])/;
const AGENT_FUSED_EFFORT = /(?:effort=|[:-])(xhigh|max)\]?$/;

/**
 * Boundary guard: rig never writes an agent definition with effort xhigh or max, or with a fast model. It checks the
 * rendered key values, so a roles.json effort, a tiers.json model (also through `rig models set` and an overlay) and a
 * fused grammar token all meet it. Returns true after it reports E_AGENT_MODEL for the first offending value.
 */
function agentForbidden(s: ModelSurface, h: string, role: string, keys: {key: string, value: string}[], fail: (code: string, message: string) => void): boolean {
  for (const { key, value } of keys) {
    const isEffort = key === s.keys?.effort;
    const bad = isEffort ? AGENT_EFFORT.test(value) : AGENT_FAST.test(value) || (!!s.grammar && AGENT_FUSED_EFFORT.test(value));
    if (!bad) continue;
    const what = isEffort ? "effort" : "model";
    fail("E_AGENT_MODEL", `${s.path}: role ${role} on ${h} resolves to ${what} ${JSON.stringify(value)} (${key}), and rig never writes an agent definition with effort xhigh or max or a fast model. Lower the effort of ${role} in models/roles.json consumer ${s.consumer}, or choose a non-fast model for its tier in models/tiers.json`);
    return true;
  }
  return false;
}

/** The block body: `[<table>]` and the key lines of the consumer's one role. */
function tomlTable(s: ModelSurface, values: CellValue[], roles: string[], fail: (code: string, message: string) => void): string | null {
  if (!s.table) {
    fail("E_SCHEMA", `${s.path}: a block surface needs a table`);
    return null;
  }
  if (roles.length !== 1) {
    fail("E_SCHEMA", `${s.path}: consumer ${s.consumer} must hold exactly one role, found ${roles.length}`);
    return null;
  }
  const keys = keyLines(s, values, roles[0], fail);
  return keys === null ? null : `[${s.table}]\n${keys.map((l) => `${l}\n`).join("")}`;
}

/** The role lines of one whole surface from its cell values. The `budget` key is the `# budget:` line. */
function roleLines(surface: ModelSurface, values: CellValue[]): string {
  const byKey = new Map<string, Record<string, string>[]>();
  for (const v of values) {
    if (!byKey.has(v.key)) byKey.set(v.key, []);
    ((byKey.get(v.key) as Record<string, string>[])[v.element] ??= {})[v.field] = v.value;
  }
  const grammar = surface.grammar ?? "{model}";
  const lines = [...byKey].map(([key, elements]) => {
    const tokens = elements.map((f) => f.literal ?? grammar.replace(/\{(\w+)\}/g, (_, name: string) => f[name]));
    return `${key === "budget" ? "# budget" : key}: ${tokens.join(", ")}`;
  });
  return `${lines.join("\n")}\n`;
}
