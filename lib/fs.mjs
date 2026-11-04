// lib/fs.mjs — contained primitives. Each export has an import allowlist (boundary test).

/** Atomic write into HOME: realpath containment, no symlinked parent, no symlink target, temp + fsync + rename, mode kept.
 *  Allowed importer: lib/state.mjs (and lib/state/*). */
export function writeHome(path, bytes, mode) { throw new Error("not implemented"); }
/** Atomic write or O_APPEND under the state root. Refuses a path inside any read-set (section 2, Roots).
 *  Allowed importers: state, metrics, gate. */
export function writeState(rel, bytes) { throw new Error("not implemented"); }
export function appendState(rel, line) { throw new Error("not implemented"); }
/** Atomic write into a config root. Allowed importers: lock, models. */
export function writeConfig(root, rel, bytes) { throw new Error("not implemented"); }
/** The one logger: log/rig.log. Allowed importers: the apply, stats, pack, pin and models set paths. Never plan or doctor. */
export function log(event) { throw new Error("not implemented"); }
