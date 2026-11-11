// lib/stack.ts — public: compose

import { adopted, compileMode } from "./mode.ts";
import type { Mode, UnitRef } from "./mode.ts";
import type { World } from "./world.ts";
import type { Scope } from "./world.ts";

export type Unit = {
  /** "<pack>/<name>" */
  id: string;
  /** mode: the core skill dir skills/craft/, rendered by renderMode around the compiled mode */
  type: "skill"|"command"|"agent"|"rule"|"frame"|"mode";
  /** installed name */
  name: string;
  scope: Scope;
  projects: string[];
  /** after pack, unit and rig.json narrowing */
  harnesses: string[];
  channel: Record<string, "plugin">;
  /** source files, relative to the unit */
  files: Map<string, {bytes: Uint8Array, mode: number}>;
};
/**
 * `mode` is absent only on a stack that compose did not build (gateTree, hand-built test stacks).
 * `disabled` holds the ids that rig.json `disable` removed, so the `mode` check can tell a known absence from a rename.
 * `info` holds the compose notes that rig plan prints.
 * `listed` holds the id of every unit that a listed repo pack contains, before disable and replaces drop any, so a check
 * can tell a unit that left the stack from a ref that no pack has (rig doctor, the evidence ledger). Overlay packs are
 * left out: a file in the repo cannot rely on a pack that only its author has.
 */
export type Stack = {units: Unit[], errors: RigError[], mode?: Mode, disabled?: string[], info?: string[], listed?: string[]};
export type RigError = {code: string, message: string, path?: string, harness?: string, absent?: true};

/** Core seal, packs, scope, disable, replace, clash rules, then the mode compile. Pure. */
export function compose(world: World): Stack {
  /** @type {RigError[]} */
  const errors = [];
  const err = (code, message, path, harness) => errors.push({ code, message, ...(path ? { path } : {}), ...(harness ? { harness } : {}) });
  const H = world.config.harnesses;
  const narrow = (...lists) => H.filter((h) => lists.every((l) => !l || l.includes(h)));

  const core = world.packs.get("core");
  const coreUnits = [];
  for (const d of discover(core, true)) {
    if (d.type === "command" && d.name === "alias") continue; // the alias template, rendered once per alias below
    coreUnits.push(makeUnit("core", d, { scope: "machine-hidden", projects: [], harnesses: [...H], channel: {} }));
  }
  const aliasTemplate = core.files.get("commands/alias.md");
  for (const alias of Object.keys(world.config.aliases)) {
    if (!aliasTemplate) {
      err("E_UNKNOWN_UNIT", "packs/core/commands/alias.md is missing, so no alias can render", `aliases.${alias}`);
      break;
    }
    const files = new Map([[`${alias}.md`, aliasTemplate]]);
    coreUnits.push(makeUnit("core", { type: "command", name: alias, files }, { scope: "machine-hidden", projects: [], harnesses: [...H], channel: {} }));
  }

  // Packs, in config order (repo packs by name, then overlay packs by name). Units come from the directory layout; pack.json narrows them.
  const packUnits = [];
  /** @type {Map<string, string>} unit id -> the unit id it replaces */
  const replaces = new Map();
  for (const [name, entry] of Object.entries(world.config.packs)) {
    const pack = world.packs.get(name);
    const found = discover(pack, false);
    const known = new Set(found.map((d) => d.name));
    for (const u of Object.keys(pack.manifest.units ?? {})) {
      if (!known.has(u)) err("E_UNKNOWN_UNIT", `pack.json names unit ${u}, which pack ${name} does not contain`, `packs/${name}/pack.json units.${u}`);
    }
    for (const d of found) {
      const meta = pack.manifest.units?.[d.name] ?? {};
      const u = makeUnit(name, d, {
        scope: entry.scope ?? "machine-hidden",
        projects: [...(entry.projects ?? [])],
        harnesses: narrow(entry.harnesses, meta.harnesses),
        channel: { ...(entry.channel ?? {}) },
      });
      packUnits.push(u);
      if (meta.replaces) replaces.set(u.id, meta.replaces);
    }
  }

  // Disable a default unit, then replace a non-sealed unit. Core refs never get here: world rejects them.
  const ids = new Set(packUnits.map((u) => u.id));
  const dropped = new Set();
  const disabled: string[] = [];
  world.config.disable.forEach((ref, i) => {
    if (!ids.has(ref)) err("E_UNKNOWN_UNIT", `disable names ${ref}, which no listed pack contains`, `disable[${i}]`);
    else disabled.push(ref);
    dropped.add(ref);
  });
  /** @type {Map<string, string[]>} replaced id -> replacer ids */
  const replacers = new Map();
  for (const [by, target] of replaces) {
    if (dropped.has(by)) continue;
    if (!ids.has(target)) {
      err("E_UNKNOWN_UNIT", `${by} replaces ${target}, which no listed pack contains`, `packs/${by.split("/")[0]}/pack.json units.${by.split("/")[1]}.replaces`);
      continue;
    }
    replacers.set(target, [...(replacers.get(target) ?? []), by]);
  }
  for (const [target, by] of replacers) {
    if (by.length > 1) err("E_CLASH", `${by.join(" and ")} all replace ${target}; one unit may replace it`, target);
    dropped.add(target);
  }
  const kept = packUnits.filter((u) => !dropped.has(u.id));

  // Clash rules: one installed name per namespace. No precedence order exists.
  const units = [...coreUnits, ...kept];
  const byName = new Map();
  for (const u of units) {
    const key = `${NAMESPACE[u.type]}:${u.name}`;
    byName.set(key, [...(byName.get(key) ?? []), u]);
  }
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    const coreOnes = group.filter((u) => u.id.startsWith("core/"));
    const others = group.filter((u) => !u.id.startsWith("core/"));
    if (coreOnes.length > 0) {
      for (const u of others) err("E_CORE_SHADOW", `${u.id} uses the core name ${u.name} (${coreOnes[0].id})`, u.id);
      if (coreOnes.length > 1) err("E_CLASH", `${coreOnes.map((u) => u.id).join(" and ")} install the same name ${group[0].name}`, coreOnes[1].id);
    } else {
      err("E_CLASH", `${others.map((u) => u.id).join(" and ")} install the same name ${group[0].name}; declare replaces in one of them, or disable one`, others[1].id);
    }
  }

  // Aliases point at a command.
  for (const [alias, target] of Object.entries(world.config.aliases)) {
    if (!units.some((u) => u.type === "command" && u.name === target && u.name !== alias)) {
      err("E_UNKNOWN_UNIT", `alias ${alias} points at ${target}, which is no command in the stack`, `aliases.${alias}`);
    }
  }

  const compiled = compileMode(units, world.packs, world.domains, world.config.fill ?? {}, (world.config.auto ?? []) as UnitRef[], dropped);
  errors.push(...compiled.errors);
  return { units, errors, mode: compiled.mode, disabled, info: compiled.info, listed: packUnits.filter((u) => world.packs.get(u.id.split("/")[0])?.root === "repo").map((u) => u.id) };
}

/** Installed-name namespaces. Skills and commands share one: Claude Code invokes both as /name, Cursor renders commands as skills. */
const NAMESPACE = { skill: "slash", mode: "slash", command: "slash", agent: "agent", rule: "rule", frame: "frame" };

/**
 * Units by directory layout: skills/<name>/SKILL.md (the whole dir), commands/<name>.md, agents/<name>.md,
 * rules/<name>.md. In core also frame.md as the frame, and skills/craft/ as the mode skill. A path that the pack's
 * mode.adopt claims gives no unit.
 * @param {import("./world.ts").Pack} pack @param {boolean} isCore
 * @returns {{type: Unit["type"], name: string, files: Map<string, {bytes: Uint8Array, mode: number}>}[]}
 */
function discover(pack, isCore) {
  const out = [];
  const skills = new Map();
  const claimed = new Set(adopted(pack).map((c) => c.from));
  for (const [path, f] of pack.files) {
    if (claimed.has(path)) continue;
    let m;
    if ((m = path.match(/^skills\/([^/]+)\/(.+)$/))) {
      if (!skills.has(m[1])) skills.set(m[1], new Map());
      skills.get(m[1]).set(m[2], f);
    } else if ((m = path.match(/^(commands|agents|rules)\/([^/]+)\.md$/))) {
      out.push({ type: /** @type {const} */ ({ commands: "command", agents: "agent", rules: "rule" })[m[1]], name: m[2], files: new Map([[`${m[2]}.md`, f]]) });
    }
  }
  for (const [name, files] of skills) {
    if (!files.has("SKILL.md")) continue;
    out.push({ type: isCore && name === "craft" ? "mode" : "skill", name, files });
  }
  if (isCore && pack.files.has("frame.md")) {
    out.push({ type: "frame", name: "rig-frame", files: new Map([["frame.md", pack.files.get("frame.md")]]) });
  }
  const rank = { frame: 0, skill: 1, mode: 1, command: 2, agent: 3, rule: 4 };
  return out.sort((a, b) => rank[a.type] - rank[b.type] || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** @returns {Unit} */
function makeUnit(pack, d, rest) {
  return { id: `${pack}/${d.name}`, type: d.type, name: d.name, ...rest, files: new Map(d.files) };
}
