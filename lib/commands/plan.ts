// rig plan: the pipeline and the report. Writes nothing, logs nothing.

import { loadWorld } from "../world.ts";
import { findingLines, prepare } from "./shared.ts";
import type { ParsedArgs } from "../commands.ts";

const count = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const under = (dir, p) => p === dir || p.startsWith(`${dir}/`);

/**
 * The harness column of an op. Render entries carry no harness, so the column names the harness whose root holds
 * the path, else the one whose writable skill dir holds it (~/.agents/skills is Codex's). Empty when none does.
 * @param {object} world @param {{harness: string, path: string}} op @returns {string}
 */
function harnessOf(world, op) {
  if (op.harness) return op.harness;
  const records = [...world.targets.values()];
  const byRoot = records.find((t) => typeof t.root === "string" && under(t.root, op.path));
  if (byRoot) return byRoot.name;
  return records.find((t) => t.reads.skills.some((d) => d.writable && under(d.path, op.path)))?.name ?? "";
}

/**
 * The plan report shared by plan, apply and models set: findings with ack stanzas, compose and render errors,
 * render info, interrupted runs, one line per op, the diff of each block, and the summary line.
 */
export function report(p: ReturnType<typeof prepare>): string {
  const { planned } = p;
  const ops = planned.ops.map((o) => ({ ...o, harness: harnessOf(p.world, o) }));
  const lines = [...findingLines(p.findings)];
  for (const e of p.errors) lines.push(`block ${e.code} ${e.message}`);
  for (const i of p.stack.info ?? []) lines.push(`info ${i}`);
  for (const i of p.desired.info) lines.push(`info ${i}`);
  for (const run of planned.interrupted) lines.push(`info run ${run} was interrupted; rig apply recovers it first`);
  const width = Math.max(0, ...ops.map((o) => o.op.length));
  const kinds = Math.max(0, ...ops.map((o) => o.kind.length));
  const harnesses = Math.max(0, ...ops.map((o) => o.harness.length));
  const paths = Math.max(0, ...ops.map((o) => o.path.length));
  const diffs = [];
  for (const o of ops) {
    const detail = o.op === "block" ? `${o.error?.code ?? "E_INTERNAL"} ${o.error?.message ?? ""}${o.diff ? " (diff below)" : ""}` : o.unit;
    lines.push(`${o.op.padEnd(width)}  ${o.kind.padEnd(kinds)}  ${o.harness.padEnd(harnesses)}  ${o.path.padEnd(paths)}  ${detail}`.trimEnd());
    if (o.op === "block" && o.diff) diffs.push(o.diff.endsWith("\n") ? o.diff.slice(0, -1) : o.diff);
  }
  lines.push(...diffs);
  const changes = ops.filter((o) => o.op !== "block").length;
  const blocks = ops.length - changes + p.errors.length + p.findings.filter((f) => f.severity === "block" && !f.acked).length;
  lines.push(`${count(changes, "change")}, ${count(blocks, "block")}`);
  return `${lines.join("\n")}\n`;
}

/** rig plan. Exit 1 on an unacked block, drift, an adopt mismatch, or a compose or render error. */
export async function planCmd(a: ParsedArgs, env: NodeJS.ProcessEnv): Promise<0|1|2> {
  const p = prepare(loadWorld(env));
  process.stdout.write(report(p));
  return p.planned.blocked ? 1 : 0;
}
