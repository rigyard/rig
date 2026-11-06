// rig doctor [--project <dir>]: read-only diagnosis. Writes nothing, logs nothing.

import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { effective } from "../models.ts";
import { projectDelivery, readSet } from "../targets.ts";
import { loadWorld, projectDeclaration } from "../world.ts";
import { prepare, usage } from "./shared.ts";
import type { ParsedArgs } from "../commands.ts";
import type { RigError } from "../stack.ts";
import type { Delivery } from "../targets.ts";

export type Line = {level: "error"|"warn"|"info", topic: string, text: string};

/**
 * Effective duplicates per harness from targets.readSet: a name listed twice or more. An error when any copy is
 * managed (a placement bug), else info (section 7, "doctor duplicates"). A warning when an unmanaged copy that the harness
 * reads first shadows a rig copy: a user skill of the same name, or a harness builtin.
 * @param {object} world @param {Record<string, object>} installed   the plan's installed.json entries @returns {Line[]}
 */
function duplicates(world, installed) {
  const out = [];
  for (const [harness, entries] of readSet(world, installed)) {
    const byName = new Map();
    for (const e of entries) byName.set(e.name, [...(byName.get(e.name) ?? []), e]);
    for (const [name, group] of [...byName].sort(([a], [b]) => a.localeCompare(b))) {
      if (group.length < 2) continue;
      const managed = group.some((e) => e.managed);
      out.push({ level: managed ? "error" : "info", topic: "duplicates", text: `${harness} lists ${name} ${group.length} times: ${group.map((e) => e.path).join(", ")}${managed ? " (one is managed: a placement bug)" : ""}` });
    }
    for (const e of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.shadows) out.push({ level: "warn", topic: "duplicates", text: `${harness} loads ${e.name} from ${e.path}, which shadows the rig copy at ${e.shadows.join(", ")}` });
    }
  }
  return out;
}

/**
 * Drift and adopt state from the plan's ops. Drift and every other block is an error; an unmanaged file that
 * differs from the render is a warning (rig plan blocks on it, and nothing managed changed). With nothing pending and
 * no other block, the summary line says only what holds: after an interrupted run it speaks of the entries rig apply
 * rebuilds from the journal, and each unmanaged path that blocks rig plan is counted.
 * @param {import("../state.ts").Plan} planned @returns {Line[]}
 */
function stateLines(planned) {
  const out = [];
  let blocked = false;
  const unmanaged = new Set<string>();
  for (const o of planned.ops) {
    const code = o.error?.code ?? "E_INTERNAL";
    if (o.op === "block") {
      if (code !== "E_ADOPT_MISMATCH") blocked = true;
      else unmanaged.add(o.path);
      const level = code === "E_ADOPT_MISMATCH" ? "warn" : "error";
      const topic = code === "E_DRIFT" ? "drift" : code === "E_ADOPT_MISMATCH" ? "adopt" : "state";
      out.push({ level, topic, text: `${o.path}: ${code} ${o.error?.message ?? ""}`.trimEnd() });
    } else if (o.op === "adopt") {
      out.push({ level: "info", topic: "adopt", text: `${o.path} equals the render; rig apply records it` });
    }
  }
  const pending = planned.ops.filter((o) => o.op !== "block").length;
  for (const run of planned.interrupted) out.push({ level: "warn", topic: "drift", text: `run ${run} was interrupted; rig apply recovers it first` });
  if (pending) out.push({ level: "info", topic: "drift", text: `${pending} changes pending; rig plan lists them` });
  else if (!blocked) {
    const base = planned.interrupted.length
      ? "no changes pending against installed.json as rig apply rebuilds it from the journal"
      : "managed files match installed.json and the render";
    const n = unmanaged.size;
    out.push({ level: "info", topic: "drift", text: n ? `${base}; ${n} unmanaged ${n === 1 ? "path blocks" : "paths block"} rig plan` : base });
  }
  return out;
}

/** Compose and render errors: each blocks rig plan, so each is an error here too. */
function errorLines(composeErrors: RigError[], renderErrors: RigError[]): Line[] {
  const line = (topic: string) => (e: RigError): Line => ({ level: "error", topic, text: `${e.harness ? `${e.harness} ` : ""}${e.code} ${e.message}` });
  return [...composeErrors.map(line("compose")), ...renderErrors.map(line("render"))];
}

/** @returns {Line[]} */
function gateLines(findings) {
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

/**
 * The --project lines: per scope pack declared for this dir whether its Claude plugin is enabled here (local beats
 * project beats user) or the repository paths that would deliver it on a harness with no project channel. Read only.
 */
function projectLines(world, dir: string, deliveries: Delivery[]): Line[] {
  const abs = resolve(dir);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) throw usage(`--project ${dir} is not a directory`);
  const d = projectDeclaration(world, abs);
  const out: Line[] = [];
  const here = deliveries.filter((x) => x.projects.includes(abs));
  for (const p of d.packs) {
    const plugin = here.find((x) => x.pack === p.name && x.plugin)?.plugin;
    if (!plugin) continue;
    if (p.enabled) out.push({ level: "info", topic: "scope", text: `claude pack ${p.name} is enabled here (${p.source})` });
    else {
      const file = `${abs}/${plugin.enable_file}`;
      out.push({ level: "warn", topic: "scope", text: `claude pack ${p.name} is declared for this project but not enabled${p.source ? ` (false in ${p.source})` : ""}: paste {"enabledPlugins": {"${plugin.id}": true}} into ${file}` });
    }
  }
  for (const x of here.filter((y) => !y.plugin || y.absent.length)) {
    for (const c of x.commit) out.push({ level: "info", topic: "scope", text: `${x.harness} pack ${x.pack}: commit ${c.path} (a copy of ${c.from})` });
    for (const u of x.absent) out.push({ level: "info", topic: "scope", text: `${x.harness} pack ${x.pack}: ${u} has no known project path on ${x.harness}` });
  }
  return out;
}

/** rig doctor [--project <dir>]. Exit 1 when a line is an error, else 0. */
export async function doctorCmd(a: ParsedArgs, env: NodeJS.ProcessEnv): Promise<0|1|2> {
  const world = loadWorld(env);
  const p = prepare(world);
  /** @type {Line[]} */
  const lines = [
    ...errorLines(p.stack.errors, p.desired.errors),
    ...stateLines(p.planned),
    ...duplicates(world, p.planned.installed),
    ...gateLines(p.findings),
    ...modelLines(world),
    ...aliasLines(world),
  ];
  if (typeof a.flags.project === "string") lines.push(...projectLines(world, a.flags.project, projectDelivery(p.stack, world)));
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
