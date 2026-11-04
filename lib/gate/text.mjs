// Shared by the checks that read text: safe display of hostile bytes, source and rendered dedupe.
import { decode } from "./ctx.mjs";

const SHOWN = 40;

/** Escape every code point that a terminal or reviewer cannot see as `<U+XXXX>`. @param {string} s */
export function visible(s) {
  return s.replace(/[\p{C}\p{Zl}\p{Zp}­؜᠎​-‏⁠-⁤⁦-⁩‪-‮﻿]/gu, (c) =>
    `<U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}>`);
}

/** A short single-line excerpt around a match, escaped. @param {string} line @param {number} at @param {number} len */
export function excerpt(line, at, len) {
  const from = Math.max(0, at - SHOWN / 2);
  const to = Math.min(line.length, at + len + SHOWN / 2);
  return `${from > 0 ? "..." : ""}${visible(line.slice(from, to))}${to < line.length ? "..." : ""}`;
}

/** First 4 chars of a secret, then its length. The full value never reaches output. @param {string} s */
export function redact(s) {
  return `${visible(s.slice(0, 4))}... (${s.length} chars)`;
}

/**
 * Run `scan` over every source file and every rendered entry. A scan item is
 * `{severity, evidence, key, idBytes}`; `key` names the offence (rule plus line text) and is what dedupe uses.
 * A rendered item is dropped when a source of the same pack has the same key or an earlier rendered entry had it,
 * so one hidden character in a source file is one finding, not one per harness copy.
 * @param {object} ctx
 * @param {(text: string, where: {pack: string, root: string, rendered: boolean}) => object[]} scan
 */
export function scanTexts(ctx, scan) {
  const out = [];
  const seen = new Set();
  for (const s of ctx.sources) {
    const keys = new Set();
    for (const item of scan(decode(s.bytes), { pack: s.pack, root: s.root, rendered: false })) {
      if (keys.has(item.key)) continue;
      keys.add(item.key);
      seen.add(`${s.pack}\0${item.key}`);
      out.push({ ...item, pack: s.pack, path: s.path });
    }
  }
  for (const r of ctx.rendered) {
    const keys = new Set();
    for (const item of scan(decode(r.bytes), { pack: r.pack, root: ctx.packRoot(r.pack), rendered: true })) {
      const k = `${r.pack}\0${item.key}`;
      if (keys.has(item.key) || seen.has(k)) continue;
      keys.add(item.key);
      seen.add(k);
      out.push({ ...item, pack: r.pack, path: r.path });
    }
  }
  return out;
}
