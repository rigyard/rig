// lib/stack.mjs — public: compose

/** @typedef {import("./world.mjs").World} World */
/** @typedef {import("./world.mjs").Scope} Scope */
/** @typedef {import("./world.mjs").ProviderRecord} ProviderRecord */

/**
 * @typedef {object} Unit
 * @property {string} id           "<pack>/<name>"
 * @property {"skill"|"command"|"agent"|"rule"|"frame"|"slot-stub"} type
 * @property {string} name         installed name
 * @property {Scope} scope
 * @property {string[]} projects
 * @property {string[]} harnesses  after pack, unit and rig.json narrowing
 * @property {Record<string, "plugin">} channel
 * @property {Map<string, {bytes: Uint8Array, mode: number}>} files   source files, relative to the unit
 */
/** @typedef {{units: Unit[], slots: Record<string, ProviderRecord | null>, providers: ProviderRecord[], errors: RigError[]}} Stack */
/** @typedef {{code: string, message: string, path?: string, harness?: string}} RigError */

/** Core seal, packs, scope, disable, replace, slots, clash rules. Pure. @param {World} world @returns {Stack} */
export function compose(world) {
  /** @type {RigError[]} */
  const errors = [];
  const err = (code, message, path, harness) => errors.push({ code, message, ...(path ? { path } : {}), ...(harness ? { harness } : {}) });
  const H = world.config.harnesses;
  const narrow = (...lists) => H.filter((h) => lists.every((l) => !l || l.includes(h)));

  // Core: always in the stack, never listed in packs. Slot stubs render where their filler's harnesses say.
  const core = world.packs.get("core");
  const coreUnits = [];
  for (const d of discover(core, true)) {
    if (d.type === "command" && d.name === "alias") continue; // the alias template, rendered once per alias below
    const harnesses = d.type === "slot-stub" ? narrow(world.config.slots[slotOf(d.name)]?.harnesses) : [...H];
    coreUnits.push(makeUnit("core", d, { scope: "machine-hidden", projects: [], harnesses, channel: {} }));
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
  world.config.disable.forEach((ref, i) => {
    if (!ids.has(ref)) err("E_UNKNOWN_UNIT", `disable names ${ref}, which no listed pack contains`, `disable[${i}]`);
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

  // Slots: one filler each (world rejects a second). A headless filler that forbids its own family must
  // leave its own harness out of the slot's harnesses.
  const slots = {};
  for (const u of coreUnits.filter((x) => x.type === "slot-stub")) {
    const slot = slotOf(u.name);
    const filler = world.config.slots[slot] ?? null;
    const p = filler ? world.providers.get(filler.provider) ?? null : null;
    slots[slot] = p;
    if (p?.forbid_same_family && p.model_harness && u.harnesses.includes(p.model_harness)) {
      err("E_SAME_FAMILY", `${p.name} runs the ${p.model_harness} family; leave ${p.model_harness} out of slots.${slot}.harnesses`, `slots.${slot}`, p.model_harness);
    }
  }

  const providers = world.config.providers.map((n) => world.providers.get(n));
  return { units, slots, providers, errors };
}

/** Installed-name namespaces. Skills and commands share one: Claude Code invokes both as /name, Cursor renders commands as skills. */
const NAMESPACE = { skill: "slash", command: "slash", "slot-stub": "slash", agent: "agent", rule: "rule", frame: "frame" };

const slotOf = (name) => name.slice("rig-".length);

/**
 * Units by directory layout: skills/<name>/SKILL.md (the whole dir), commands/<name>.md, agents/<name>.md,
 * rules/<name>.md. In core also frame.md (with principles.md) as the frame, and skills/rig-<slot>/ as slot stubs.
 * @param {import("./world.mjs").Pack} pack @param {boolean} isCore
 * @returns {{type: Unit["type"], name: string, files: Map<string, {bytes: Uint8Array, mode: number}>}[]}
 */
function discover(pack, isCore) {
  const out = [];
  const skills = new Map();
  for (const [path, f] of pack.files) {
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
    out.push({ type: isCore && name.startsWith("rig-") ? "slot-stub" : "skill", name, files });
  }
  if (isCore && pack.files.has("frame.md")) {
    const files = new Map([["frame.md", pack.files.get("frame.md")]]);
    if (pack.files.has("principles.md")) files.set("principles.md", pack.files.get("principles.md"));
    out.push({ type: "frame", name: "rig-frame", files });
  }
  const rank = { frame: 0, "slot-stub": 1, skill: 2, command: 3, agent: 4, rule: 5 };
  return out.sort((a, b) => rank[a.type] - rank[b.type] || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** @returns {Unit} */
function makeUnit(pack, d, rest) {
  return { id: `${pack}/${d.name}`, type: d.type, name: d.name, ...rest, files: new Map(d.files) };
}
