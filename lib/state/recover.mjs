// lib/state/recover.mjs — internal to state

/** @typedef {import("../world.mjs").World} World */
/** @typedef {import("../stack.mjs").RigError} RigError */

/** @param {World} world @param {string} runId @returns {{done: number, notDone: number, conflicts: RigError[]}} */
export function recover(world, runId) {
  // TODO
  //  for each intent line of the open journal, in order:
  //    re-validate path: realpath of parent inside HOME, not in never_write, no symlink at path; else E_CONTAINMENT
  //    re-derive the backup path from run id and path; a journal value that differs is ignored and reported
  //    cur = sha256(current bytes) or null
  //    cur == after_sha  -> done: apply entry_after to installed.json
  //    cur == before_sha -> not done: keep entry_before
  //    else              -> E_RECOVERY_CONFLICT naming the path; stop, write nothing more
  //  replace installed.json atomically; append {"type": "recovered", "by": <new run id>}
  //  journal text is data only: no field is executed, spawned or used as a format string
  throw new Error("not implemented");
}
