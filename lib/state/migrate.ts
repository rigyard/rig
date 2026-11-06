// lib/state/migrate.ts: a recorded entry whose placement kind changed since rig wrote it.

type Sig = {sha: string | null, mode: number | null};
type Recorded = {kind: string, sha256?: string, mode?: number};

/**
 * What plan does with an installed entry whose kind differs from the desired kind.
 *   "convert": owned entry, block desired, and the file still has the recorded hash and mode, so rig wrote every byte
 *              and nobody changed it. The whole file is rig's to replace with the block.
 *   "drift":   every other mismatch, including an owned file a person edited.
 * @param {Recorded} ent the installed entry @param {string} desiredKind @param {Sig} cur sigOf the observed file
 */
export function kindChange(ent: Recorded, desiredKind: string, cur: Sig): "convert" | "drift" {
  if (ent.kind !== "owned" || desiredKind !== "block") return "drift";
  return cur.sha !== null && cur.sha === `sha256:${ent.sha256}` && cur.mode === ent.mode ? "convert" : "drift";
}
