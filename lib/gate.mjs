// lib/gate.mjs — public: gate, refreshOsv (plus the registry, see NEW NAMES in the module report)
import { isExpired, ackId, parseAcks, stanza } from "./gate/ack.mjs";
import { makeCtx } from "./gate/ctx.mjs";
import { REGISTRY, checkTable } from "./gate/registry.mjs";

export { REGISTRY as registry, checkTable };

/** @typedef {import("./world.mjs").World} World */
/** @typedef {import("./stack.mjs").Stack} Stack */
/** @typedef {import("./targets.mjs").Desired} Desired */

/** @typedef {"pin"|"exec"|"secret"|"unicode"|"license"|"cve"|"telemetry"|"budget"} CheckId */
/** @typedef {{check: CheckId, severity: "block"|"warn"|"info", pack: string, path: string, evidence: string, id: string, acked: boolean, stanza: string | null}} Finding */

const RANK = { block: 0, warn: 1, info: 2 };
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Run every registered check over sources and rendered bytes. Pure over its inputs; reads the OSV cache from world.
 * Throws E_SCHEMA when world.acks holds an invalid ack or an ack for a check that is never ackable.
 * @param {Stack} stack @param {Desired} desired @param {World} world @returns {{findings: Finding[], blocked: boolean}}
 */
export function gate(stack, desired, world) {
  const checks = new Map(REGISTRY.map((r) => [r.id, r]));
  const acks = parseAcks(world.acks ?? [], checks);
  const now = world.now; // the World clock (RIG_NOW in tests), so ack expiry is reproducible
  const live = new Map();
  for (const a of acks) if (!isExpired(a, now)) live.set(a.id, a);

  const ctx = makeCtx(stack, desired, world);
  const findings = [];
  for (const row of REGISTRY) {
    for (const raw of row.run(ctx)) {
      const id = ackId(row.id, raw.pack, raw.path, raw.idBytes ?? raw.evidence);
      const ack = row.ackable ? live.get(id) : undefined;
      const acked = ack !== undefined && ack.check === row.id && ack.pack === raw.pack && ack.path === raw.path;
      const f = { check: row.id, severity: raw.severity, pack: raw.pack, path: raw.path, evidence: raw.evidence, id, acked, stanza: null };
      if (row.ackable && !acked && f.severity !== "info") f.stanza = stanza(f);
      findings.push(f);
    }
  }
  const order = new Map(REGISTRY.map((r, i) => [r.id, i]));
  findings.sort((a, b) =>
    order.get(a.check) - order.get(b.check) || RANK[a.severity] - RANK[b.severity] ||
    byText(a.pack, b.pack) || byText(a.path, b.path) || byText(a.evidence, b.evidence));
  return { findings, blocked: findings.some((f) => f.severity === "block" && !f.acked) };
}

/**
 * Refresh cache/osv for the manifests in the stack. Called only by lib/lock.mjs, which passes its fetch.
 * @param {Stack} stack @param {(url: string, body: string) => Promise<string>} fetchFn @returns {Promise<void>}
 */
export async function refreshOsv(stack, fetchFn) {
  throw new Error("not implemented");
}
