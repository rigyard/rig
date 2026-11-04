// Tree hash: the one implementation shared by lib/lock.mjs (writes it) and lib/gate (re-checks it).
import { createHash } from "node:crypto";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

/**
 * sha256 over the sorted lines `<relative path>\0<mode>\0<sha256 of bytes>\n`, where mode is the permission bits in
 * octal without padding. The result carries the `sha256:` prefix. File order does not matter.
 * `pack.json` is the pack's own manifest and is left out unless `opts.core` is true (the core seal covers it).
 * @param {Iterable<{path: string, mode: number, bytes: Uint8Array}> | Map<string, {mode: number, bytes: Uint8Array}>} files
 * @param {{core?: boolean}} [opts]
 * @returns {string}
 */
export function treeHash(files, opts = {}) {
  const entries = files instanceof Map ? [...files].map(([path, f]) => ({ path, mode: f.mode, bytes: f.bytes })) : [...files];
  const lines = [];
  for (const f of entries) {
    if (!opts.core && f.path === "pack.json") continue;
    lines.push(`${f.path}\0${(f.mode & 0o777).toString(8)}\0${sha(f.bytes)}\n`);
  }
  lines.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return `sha256:${sha(lines.join(""))}`;
}
