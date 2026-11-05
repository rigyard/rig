// Ack ids, ack parsing and the printed stanza. The gate never writes an ack.
import { createHash } from "node:crypto";

const HEX16 = /^[0-9a-f]{16}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const KEYS = ["id", "check", "pack", "path", "reason", "expires"];

/**
 * First 16 hex chars of sha256 over check, pack, path and the evidence bytes, each part followed by one NUL.
 */
export function ackId(check: string, pack: string, path: string, evidence: Uint8Array | string) {
  const h = createHash("sha256");
  for (const part of [check, pack, path]) h.update(part).update("\0");
  h.update(typeof evidence === "string" ? Buffer.from(evidence, "utf8") : evidence);
  return h.digest("hex").slice(0, 16);
}

function schemaError(message) {
  const e = new Error(message);
  e.code = "E_SCHEMA";
  return e;
}

/**
 * Validate ack entries. Throws E_SCHEMA on an unknown or missing key, an empty reason, a missing or malformed
 * expiry, or a check that is unknown or never ackable. An expired ack parses and then counts as absent.
 * @param checks  registry rows by id
 */
export function parseAcks(acks: unknown, checks: Map<string, {ackable: boolean}>): {id: string, check: string, pack: string, path: string, reason: string, expires: string}[] {
  if (!Array.isArray(acks)) throw schemaError("audit.allow.json: acks must be an array");
  return acks.map((ack, i) => {
    const at = `audit.allow.json acks[${i}]`;
    if (ack === null || typeof ack !== "object" || Array.isArray(ack)) throw schemaError(`${at}: must be an object`);
    for (const k of Object.keys(ack)) if (!KEYS.includes(k)) throw schemaError(`${at}: unknown key ${k}`);
    for (const k of KEYS) if (typeof ack[k] !== "string") throw schemaError(`${at}: ${k} must be a string`);
    if (!HEX16.test(ack.id)) throw schemaError(`${at}: id must be 16 lowercase hex chars`);
    if (ack.reason.trim() === "") throw schemaError(`${at}: reason is empty`);
    if (!DATE.test(ack.expires) || Number.isNaN(Date.parse(`${ack.expires}T00:00:00Z`))) {
      throw schemaError(`${at}: expires must be a YYYY-MM-DD date`);
    }
    const row = checks.get(ack.check);
    if (!row) throw schemaError(`${at}: unknown check ${ack.check}`);
    if (!row.ackable) throw schemaError(`${at}: check ${ack.check} cannot be acked`);
    return { ...ack };
  });
}

/** An ack is valid through the end of its `expires` date (UTC). */
export function isExpired(ack: {expires: string}, now: Date) {
  return ack.expires < now.toISOString().slice(0, 10);
}

/**
 * The stanza the user pastes into audit.allow.json. `reason` and `expires` stay empty, so the pasted entry is an
 * E_SCHEMA error until the user fills both in.
 */
export function stanza(f: {id: string, check: string, pack: string, path: string}) {
  return JSON.stringify({ id: f.id, check: f.check, pack: f.pack, path: f.path, reason: "", expires: "" });
}
