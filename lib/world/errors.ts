// Typed config errors. The CLI maps `code` to an exit code; `file` and `path` name where the problem is.

export class RigError extends Error {
  /**
   * @param {string} code      for example E_SCHEMA, E_SCOPE_MODE, E_OVERLAY_CONFLICT
   * @param {string} message
   * @param {{file?: string, path?: string}} [where]  file relative to its root or HOME, dotted key path
   */
  constructor(code, message, where = {}) {
    const at = [where.file, where.path].filter(Boolean).join(": ");
    super(at ? `${code} ${at}: ${message}` : `${code} ${message}`);
    this.name = "RigError";
    this.code = code;
    this.file = where.file;
    this.path = where.path;
  }
}

const PLAIN = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/** Dotted key path: `packs.own.scope`, `acks[0].reason`, `projects["~/src/app"]`. */
export function keyPath(parts: (string|number)[]) {
  let out = "";
  for (const p of parts) {
    if (typeof p === "number") out += `[${p}]`;
    else if (PLAIN.test(p)) out += out === "" ? p : `.${p}`;
    else out += `[${JSON.stringify(p)}]`;
  }
  return out;
}
