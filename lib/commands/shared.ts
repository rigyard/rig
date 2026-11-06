// Helpers shared by the command handlers: usage errors, the pipeline, and the gate over one tree. No logger: doctor
// imports this.

import { gate } from "../gate.ts";
import { compose } from "../stack.ts";
import { plan } from "../state.ts";
import type { EntryFilter } from "../state.ts";
import { patch, render } from "../targets.ts";
import type { FetchFn, Finding } from "../gate.ts";

/** What the two network commands accept beyond argv and env. Tests inject both fields; production passes neither. */
export type Deps = {fetchFn?: FetchFn, out?: {write: (s: string) => unknown}};

export function usage(message: string): Error & {code: string} {
  const e = /** @type {Error & {code: string}} */ (new Error(`E_USAGE ${message}`));
  e.code = "E_USAGE";
  return e;
}

/**
 * The one pipeline of plan, apply, doctor and models set: compose, render, gate, then state.plan with targets.patch.
 * Reads disk (state.plan observes), writes nothing. A compose or render error blocks, like an unacked gate block or
 * a block op: `planned.blocked` is the single answer to "may apply write".
 * @param {object} world @param {{filter?: EntryFilter, repair?: boolean}} [opts]   models set passes its model-bearing filter;
 *   repair plans drifted managed entries as writes (rig plan --repair, rig apply --repair)
 * @returns {{world: object, stack: object, desired: object, findings: import("../gate.ts").Finding[],
 *   errors: object[], planned: import("../state.ts").Plan}}   errors: the compose errors, then the render errors
 */
export function prepare(world, { filter, repair }: {filter?: EntryFilter, repair?: boolean} = {}) {
  const stack = compose(world);
  const desired = render(stack, world);
  const gated = gate(stack, desired, world);
  const planned = plan(desired, gated, world, { patch, ...(filter ? { filter } : {}), ...(repair ? { repair } : {}) });
  const errors = [...stack.errors, ...desired.errors];
  return { world, stack, desired, findings: gated.findings, errors, planned: { ...planned, blocked: planned.blocked || errors.length > 0 } };
}

const EMPTY_STACK = Object.freeze({ units: [], errors: [] });
const EMPTY_DESIRED = Object.freeze({ entries: new Map(), errors: [], info: [] });

/**
 * Gate one tree as if it were the only pack: the vendored pack of `pack add`, or the candidate of `pin check`.
 * Keeps the findings of that pack only, minus the `skip` checks. Harness-wide rows (pack "*", the budget totals)
 * are about rendered output, which rig plan gates.
 * @param {object} world @param {{name: string, root: "repo"|"overlay", manifest: object,
 *   files: {path: string, mode: number, bytes: Uint8Array}[]}} tree @param {{skip?: string[]}} [opts]
 * @returns {{findings: import("../gate.ts").Finding[], blocked: boolean}}
 */
export function gateTree(world, tree, { skip = [] } = {}) {
  const files = new Map(tree.files.map((f) => [f.path, { bytes: f.bytes, mode: f.mode }]));
  const view = { ...world, packs: new Map([[tree.name, { name: tree.name, root: tree.root, manifest: tree.manifest, files }]]) };
  const r = gate(EMPTY_STACK, EMPTY_DESIRED, view);
  const findings = r.findings.filter((f) => f.pack === tree.name && !skip.includes(f.check));
  return { findings, blocked: findings.some((f) => f.severity === "block" && !f.acked) };
}

/** One line per finding, plus the ack stanza of each unacked one. */
export function findingLines(findings: Finding[]) {
  const out = [];
  for (const f of findings) {
    out.push(`${f.severity} ${f.check} ${f.pack}/${f.path}: ${f.evidence}${f.acked ? " (acked)" : ""}`);
    if (f.stanza) out.push(`  ack: ${f.stanza}`);
  }
  return out;
}
