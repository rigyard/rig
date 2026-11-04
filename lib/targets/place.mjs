// lib/targets/place.mjs — internal to targets

/** @typedef {import("../world.mjs").TargetRecord} TargetRecord */
/** @typedef {import("../stack.mjs").RigError} RigError */

/**
 * @typedef {object} PlacementUnit
 * @property {string} id
 * @property {string[]} harnesses        harnesses that must see the unit
 * @property {Record<string, "plugin">} channel
 * @property {Record<string, string>} digests   tree digest of the render, by format owner (target name)
 */
/**
 * The smallest set of writable dirs (plus declared channels) such that each harness in unit.harnesses sees the
 * unit exactly once after its own dedupe rule, and every other installed harness sees it at most once.
 * @param {PlacementUnit} unit @param {string[]} installed  rig.json harnesses @param {Map<string, TargetRecord>} targets
 * @returns {{dirs: {path: string, owner: string}[], leaks: string[]} | {error: RigError}}
 */
export function place(unit, installed, targets) {
  // TODO
  //  candidates = every reads.skills entry with writable: true (one owner each), plus channel targets:
  //    for h in unit.harnesses with unit.channel[h] == "plugin": the record's channels.plugin dir, read by h only
  //    (and that h drops its skill dirs from the candidate set for this unit).
  //  for size k = 1 .. candidates.length, subsets in record order (deterministic):
  //    for each installed harness h:
  //      seen = subset dirs that h reads (reads.skills paths, or the plugin channel for h)
  //      copies = collapse(seen, h): two copies merge when the weaker dedupe of their two dirs allows it:
  //        "by-name" -> always; "identical-bytes" -> only when digests[ownerA] == digests[ownerB]; "none" -> never
  //      need = unit.harnesses.includes(h) ? exactly 1 : at most 1
  //    first subset where every h meets need -> return {dirs, leaks: installed harnesses outside unit.harnesses with 1 copy}
  //  none -> E_READSET naming the first failing harness and the dirs it would see twice,
  //          plus both exits: narrow unit.harnesses, or set rig.json packs.<pack>.channel.<harness> = "plugin"
  throw new Error("not implemented");
}
