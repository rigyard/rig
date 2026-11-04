// Inputs of one gate run, collected once: pack sources and rendered text.

const decoder = new TextDecoder("utf-8");

/** @param {Uint8Array} bytes */
export const decode = (bytes) => decoder.decode(bytes);

/** @param {string} p @param {string | undefined} home  `~/...` for paths inside HOME, so acks do not carry the user name */
function homeRelative(p, home) {
  return home && p.startsWith(`${home}/`) ? `~/${p.slice(home.length + 1)}` : p;
}

/**
 * @typedef {object} Source
 * @property {string} pack @property {"repo"|"overlay"} root @property {string} path  relative to the pack
 * @property {Uint8Array} bytes @property {number} mode
 */
/**
 * @typedef {object} Rendered
 * @property {string} pack @property {string} path @property {Uint8Array} bytes
 */

/** @param {object} world @returns {Source[]} */
function collectSources(world) {
  const out = [];
  for (const pack of world.packs?.values() ?? []) {
    for (const [path, f] of pack.files) {
      out.push({ pack: pack.name, root: pack.root ?? "repo", path, bytes: f.bytes, mode: f.mode });
    }
  }
  return out;
}

/** The text a rendered entry will put on disk. A JSON element or a set of cells renders as its values. */
function entryBytes(entry) {
  switch (entry.kind) {
    case "owned":
    case "block":
      return entry.bytes;
    case "json-element":
      return Buffer.from(JSON.stringify(entry.value ?? null), "utf8");
    case "cells":
      return Buffer.from((entry.values ?? []).map((v) => v.value).join("\n"), "utf8");
    default:
      return null;
  }
}

/** @returns {Rendered[]} */
function collectRendered(desired, home) {
  const out = [];
  for (const [path, entry] of desired?.entries ?? []) {
    const bytes = entryBytes(entry);
    if (!bytes) continue;
    out.push({ pack: String(entry.unit ?? "").split("/")[0] || "core", path: homeRelative(path, home), bytes });
  }
  return out;
}

/** @param {object} stack @param {object} desired @param {object} world */
export function makeCtx(stack, desired, world) {
  return {
    stack,
    desired,
    world,
    sources: collectSources(world),
    rendered: collectRendered(desired, world.env?.home),
    packRoot: (name) => world.packs?.get(name)?.root ?? "repo",
  };
}
