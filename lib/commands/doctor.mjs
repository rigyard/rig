// rig doctor [--project <dir>]: read-only diagnosis. Writes nothing, logs nothing.

import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { gate } from "../gate.mjs";
import { effective } from "../models.mjs";
import { compose } from "../stack.mjs";
import { readSet } from "../targets.mjs";
import { loadWorld, projectDeclaration } from "../world.mjs";
import { EMPTY_DESIRED, usage } from "./shared.mjs";

/** @typedef {{level: "error"|"warn"|"info", topic: string, text: string}} Line */

/**
 * Effective duplicates per harness from targets.readSet: a name listed twice or more. An error when any copy is
 * managed (a placement bug), else info (section 7, "doctor duplicates").
 * @param {object} world @returns {Line[]}
 */
function duplicates(world) {
  // No installed record here: state does not export it yet, so `managed` stays false until plan wiring threads it.
  const out = [];
  for (const [harness, entries] of readSet(world)) {
    const byName = new Map();
    for (const e of entries) byName.set(e.name, [...(byName.get(e.name) ?? []), e]);
    for (const [name, group] of [...byName].sort(([a], [b]) => a.localeCompare(b))) {
      if (group.length < 2) continue;
      const managed = group.some((e) => e.managed);
      out.push({ level: managed ? "error" : "info", topic: "duplicates", text: `${harness} lists ${name} ${group.length} times: ${group.map((e) => e.path).join(", ")}${managed ? " (one is managed: a placement bug)" : ""}` });
    }
  }
  return out;
}

/** Pin facts (lock tree, core seal, installed plugins, auto-update) and telemetry env, from the gate. @returns {Line[]} */
function gateLines(world) {
  const { findings } = gate(compose(world), EMPTY_DESIRED, world);
  return findings
    .filter((f) => f.check === "pin" || f.check === "telemetry")
    // Neither check is ackable, so a block is always an error.
    .map((f) => ({ level: f.severity === "block" ? "error" : f.severity, topic: f.check, text: `${f.pack}/${f.path}: ${f.evidence}` }));
}

/** @returns {Line[]} */
function modelLines(world) {
  return effective(world)
    .filter((r) => r.source === "env override")
    .map((r) => ({ level: "warn", topic: "models", text: `${r.harness} ${r.tier}: ${r.env} overrides the alias, the harness runs ${r.model}` }));
}

/** @returns {Line[]} */
function aliasLines(world) {
  return Object.entries(world.config.aliases).map(([alias, target]) => ({
    level: "info", topic: "alias",
    text: `/${alias} is an alias of /${target} (rig.json aliases). A hand-written ${alias} command at a rendered path blocks rig plan with E_ADOPT_MISMATCH.`,
  }));
}

/** @param {object} world @param {string} dir @returns {Line[]} */
function projectLines(world, dir) {
  const abs = resolve(dir);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) throw usage(`--project ${dir} is not a directory`);
  const d = projectDeclaration(world, abs);
  const out = [{ level: "info", topic: "project", text: `provider ${d.provider} source ${d.source}${d.line ? ` (${d.line})` : ""}` }];
  if (!world.providers.has(d.provider)) out.push({ level: "error", topic: "project", text: `provider ${d.provider} is not in rig.json providers` });
  if (d.overlay !== null) {
    out.push(d.agrees
      ? { level: "info", topic: "project", text: `the overlay projects map agrees: ${d.overlay}` }
      : { level: "error", topic: "project", text: `the overlay projects map says ${d.overlay}, the project declares ${d.provider} (${d.source})` });
  }
  for (const fp of d.footprints) out.push({ level: "info", topic: "footprint", text: `${fp} (info only: footprints never select a provider)` });
  const market = world.targets.get("claude")?.channels?.plugin?.marketplace ?? null;
  for (const p of d.packs) {
    if (p.enabled) out.push({ level: "info", topic: "scope", text: `pack ${p.name} is enabled here (${p.source})` });
    else {
      const snippet = market ? `: paste {"enabledPlugins": {"${p.name}@${market}": true}} into .claude/settings.local.json` : "";
      out.push({ level: "warn", topic: "scope", text: `pack ${p.name} is declared for this project but not enabled${snippet}` });
    }
  }
  return out;
}

/** rig doctor [--project <dir>]. Exit 1 when a line is an error, else 0. @param {import("../commands.mjs").ParsedArgs} a @param {NodeJS.ProcessEnv} env @returns {Promise<0|1|2>} */
export async function doctorCmd(a, env) {
  const world = loadWorld(env);
  /** @type {Line[]} */
  const lines = [
    { level: "info", topic: "drift", text: "not checked: drift and adopt state come with the rig plan wiring" },
    ...duplicates(world),
    ...gateLines(world),
    ...modelLines(world),
    ...aliasLines(world),
  ];
  if (typeof a.flags.project === "string") lines.push(...projectLines(world, a.flags.project));
  const width = Math.max(...lines.map((l) => l.topic.length));
  let errors = 0;
  let warnings = 0;
  const text = lines.map((l) => {
    if (l.level === "error") errors++;
    if (l.level === "warn") warnings++;
    return `${l.level.padEnd(5)} ${l.topic.padEnd(width)} ${l.text}`;
  });
  process.stdout.write(`${text.join("\n")}\n${errors} errors, ${warnings} warnings\n`);
  return errors ? 1 : 0;
}
