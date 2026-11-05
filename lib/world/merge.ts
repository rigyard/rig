// Overlay merge: the overlay adds keys and entries. It never changes a value that the repo sets.
// Records and maps merge key by key. A `union` array appends. Any other value set in both roots conflicts.
// A slot map entry is special: the overlay may fill a slot that the repo leaves empty (null); a second
// filler is E_SLOT_TWICE.

import { RigError, keyPath } from "./errors.ts";

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Peel fn/nul wrappers down to a structural node, for recursion only. */
function shape(spec) {
  while (spec && spec.t === "nul") spec = spec.spec;
  return spec;
}

/**
 * @param spec  the repo spec of this node (lib/world/schemas.ts)
 * @param overlay  canonical values; undefined when the root does not set the key
 * @param file  the overlay file, for errors
 */
export function mergeOverlay(spec: object, repo: unknown, overlay: unknown, file: string, path: (string|number)[] = []) {
  if (overlay === undefined) return repo;
  if (repo === undefined) return overlay;
  const conflict = (code = "E_OVERLAY_CONFLICT", msg = "the repo already sets this value; the overlay only adds", at = path) => {
    throw new RigError(code, msg, { file, path: keyPath(at) });
  };
  const s = shape(spec);
  if (s?.t === "rec" && isObj(repo) && isObj(overlay)) {
    const out = { ...repo };
    for (const k of Object.keys(overlay)) {
      if (path.length === 0 && k === "schema") continue; // both roots carry the version; the spec checked both
      out[k] = mergeOverlay(s.fields[k], repo[k], overlay[k], file, [...path, k]);
    }
    return out;
  }
  if (s?.t === "map" && isObj(repo) && isObj(overlay)) {
    const out = { ...repo };
    for (const k of Object.keys(overlay)) {
      if (!(k in repo)) {
        out[k] = overlay[k];
        continue;
      }
      if (s.slot) {
        if (repo[k] === null && overlay[k] !== null) out[k] = overlay[k];
        else if (overlay[k] === null) conflict("E_OVERLAY_CONFLICT", "the repo already sets this slot; the overlay cannot empty it", [...path, k]);
        else conflict("E_SLOT_TWICE", "the slot already has a filler in the repo; a slot takes one filler", [...path, k]);
        continue;
      }
      out[k] = mergeOverlay(s.val, repo[k], overlay[k], file, [...path, k]);
    }
    return out;
  }
  if (s?.t === "arr" && s.union && Array.isArray(repo) && Array.isArray(overlay)) {
    const have = new Set(repo.map((v) => JSON.stringify(v)));
    overlay.forEach((v, i) => {
      if (have.has(JSON.stringify(v))) {
        throw new RigError("E_OVERLAY_CONFLICT", "the repo already lists this entry", { file, path: keyPath([...path, i]) });
      }
    });
    return [...repo, ...overlay];
  }
  return conflict();
}
