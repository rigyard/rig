// Overlay merge: the overlay adds keys and entries. It never changes a value that the repo sets.
// Records and maps merge key by key. A `union` array appends. Any other value set in both roots conflicts.

import { RigError, keyPath } from "./errors.ts";

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Peel nul wrappers, and fn wrappers that carry their record (schema 2 roots), down to a structural node. */
function shape(spec) {
  while (spec && (spec.t === "nul" || (spec.t === "fn" && spec.spec))) spec = spec.spec;
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
  const conflict = () => {
    throw new RigError("E_OVERLAY_CONFLICT", "the repo already sets this value; the overlay only adds", { file, path: keyPath(path) });
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
