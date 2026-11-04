// lib/state.mjs — public: plan, apply, undo
// internals: lib/state/observe.mjs, journal.mjs, recover.mjs

/** @typedef {import("./world.mjs").World} World */
/** @typedef {import("./stack.mjs").RigError} RigError */
/** @typedef {import("./targets.mjs").Desired} Desired */
/** @typedef {import("./targets.mjs").DesiredEntry} DesiredEntry */
/** @typedef {import("./gate.mjs").Finding} Finding */

/** @typedef {"create"|"update"|"patch-cells"|"adopt"|"insert-markers"|"remove-to-backup"|"forget"|"block"} OpName */
/**
 * @typedef {object} Op
 * @property {OpName} op
 * @property {"owned"|"cells"|"block"|"json-element"} kind
 * @property {string} path
 * @property {string} harness
 * @property {string} unit
 * @property {string | null} before_sha
 * @property {string | null} after_sha
 * @property {Uint8Array | null} next        bytes to write; null for adopt, forget, block
 * @property {InstalledEntry | null} entry_before
 * @property {InstalledEntry | null} entry_after
 * @property {RigError} [error]              set when op is "block"
 * @property {string} [diff]                 per-cell or unified diff shown by plan
 */
/** @typedef {{ops: Op[], findings: Finding[], blocked: boolean, interrupted: string[]}} Plan */

/** // schema: installed.json
 * @typedef {{schema: 1, entries: Record<string, InstalledEntry>}} Installed
 */
/** @typedef {{kind: "owned"|"cells"|"block"|"json-element", sha256?: string, mode?: number, digest?: string, markers?: boolean,
 *             marker?: string, pointer?: string, id?: string, unit: string, run: string}} InstalledEntry */
/** // schema: journal/<run-id>.jsonl
 * @typedef {{type: "run", run: string, cmd: string, rig: string}
 *         | {type: "intent", seq: number, path: string, op: OpName, kind: string, before_sha: string | null, after_sha: string | null,
 *            backup: string | null, entry_before: InstalledEntry | null, entry_after: InstalledEntry | null}
 *         | {type: "commit", run: string, ops: number} | {type: "abort", seq: number, reason: string} | {type: "recovered", by: string}} JournalLine
 */

/**
 * Observe current bytes of every desired and installed path, then derive ops. Read-only: never recovers,
 * never logs. An interrupted journal is simulated (installed entries rebuilt in memory) and named in .interrupted.
 * @param {Desired} desired @param {{findings: Finding[], blocked: boolean}} gated @param {World} world
 * @param {{filter?: (e: DesiredEntry) => boolean}} [opts]   models set passes the model-bearing filter
 * @returns {Plan}
 */
export function plan(desired, gated, world, opts) {
  // TODO per path in union(desired, installed):
  //  owned:  keep_header -> desired bytes = targets.patch(current, entry).next first
  //          absent -> create | current sha == desired sha -> (no entry ? adopt : nothing)
  //          | no entry and differs -> block E_ADOPT_MISMATCH with a unified diff (rig never replaces an unmanaged file)
  //          | entry and current != entry.sha256 -> block E_DRIFT | else update
  //  cells of kind frontmatter on an absent file -> info line, no op (rig does not author agent files)
  //  cells/block/json-element: r = targets.patch(current, entry); r.error -> block
  //          | no entry and r.current == null (block or element absent) -> update that inserts it (r.next)
  //          | no entry: r.current == desired values ? adopt (+ insert-markers when r.markers == "inserted")
  //                                                 : block E_ADOPT_MISMATCH with per-cell diff
  //          | digest(r.current) != entry.digest -> block E_DRIFT (names path and cells)
  //          | digest(desired) != entry.digest -> patch-cells (or update for block and json-element)
  //  installed but not desired: owned -> current == entry.sha256 ? remove-to-backup : block E_DRIFT
  //          | cells -> forget (state only, no file write) | block, json-element -> update that removes the region
  //  blocked = gated.blocked || any op is block
  throw new Error("not implemented");
}

/**
 * Recover, re-plan, then write every op through the journal. The only caller of fs.writeHome.
 * @param {Plan} planned @param {World} world @returns {{run: string, changed: number, replan?: boolean, error?: RigError}}
 */
export function apply(planned, world) {
  // TODO
  //  0. take apply.lock (O_EXCL, holds pid and run id); held by a live pid -> E_LOCKED
  //  1. recover(): every journal without commit/abort/recovered (see recover.mjs below)
  //  2. if recovery changed installed.json, the given plan is stale: return {replan: true} and bin calls prepare() again
  //  3. planned.blocked -> return; nothing written, no journal created
  //  4. open journal/<run>.jsonl, write the run line, fsync
  //  5. for each op with bytes to write, in plan order:
  //     a. pre-image exists -> copy to backups/<run>/<home-relative path>, fsync file and dir
  //     b. append intent line, fsync journal                    // intent before mutation
  //     c. RIG_TEST=1 and RIG_TEST_ABORT_AFTER=n reached -> SIGKILL self (tests only)
  //     d. re-read current sha; != before_sha -> append abort line, write installed.json for done intents, return E_CHANGED_UNDER
  //     e. fs.writeHome(path, next, mode): temp file in the same dir, fsync, chmod to the preserved mode, rename, fsync dir
  //        remove-to-backup: the backup from (a) holds the bytes; then unlink. No byte is lost.
  //  6. apply entry_after of every op (adopt and forget too) to installed.json; replace it atomically
  //  7. append commit line, fsync; release apply.lock
  throw new Error("not implemented");
}

/** Restore one run's pre-images, newest op first. Journaled as a new run. No pack gate.
 *  Any conflicting path stops the undo before the first write; conflicts lists every such path.
 *  @param {string} runId @param {World} world @returns {{run: string, restored: number, conflicts: RigError[]}} */
export function undo(runId, world) { throw new Error("not implemented"); }
