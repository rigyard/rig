// The evidence ledger (docs/design/rig-v1-concept.md, "L0. Ledger"). `evidence.json` sits in the repo config root beside
// rig.json. Only rig doctor reads it, and the read takes a config root and a list of refs, so it needs no state root.

import { EVIDENCE_STATUSES, readEvidence } from "./world.ts";

export type EvidenceLine = {level: "error"|"info", topic: "evidence", text: string};

/**
 * The doctor lines for the ledger: an error for each row whose ref no listed pack contains, then the count per status,
 * in which a unit with no row is untested. A row that breaks the closed spec gives one error and no counts, because the
 * spec stops at the first break. A missing file and a blank one hold no rows and are no error.
 * @param root  the repo config root @param listed  every `<pack>/<unit>` that a listed pack contains, disabled ones too
 */
export function ledgerLines(root: string, listed: Iterable<string>): EvidenceLine[] {
  const ledger = readEvidence(root);
  if ("error" in ledger) return [{ level: "error", topic: "evidence", text: ledger.error }];
  const known = new Set(listed);
  const out: EvidenceLine[] = [];
  for (const ref of Object.keys(ledger.units)) {
    if (!known.has(ref)) out.push({ level: "error", topic: "evidence", text: `E_UNKNOWN_UNIT evidence.json: units[${JSON.stringify(ref)}]: no listed pack contains this unit` });
  }
  const count = new Map(EVIDENCE_STATUSES.map((s) => [s, 0]));
  for (const ref of known) {
    const status = ledger.units[ref]?.status ?? "untested";
    count.set(status, (count.get(status) ?? 0) + 1);
  }
  const from = { absent: "no evidence.json", empty: "evidence.json, empty", read: "evidence.json" }[ledger.file];
  out.push({ level: "info", topic: "evidence", text: `${[...count].map(([s, n]) => `${s} ${n}`).join(", ")} (${from})` });
  return out;
}
