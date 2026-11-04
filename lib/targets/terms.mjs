// lib/targets/terms.mjs — internal to targets. The vocabulary: {{rig:<term>}} placeholders, docs section 2.3.
// Pure. One placeholder form exists; no free-string rewrite.

const PLACEHOLDER = /\{\{rig:([^{}]*)\}\}/g;
const utf8 = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();

/**
 * Replace every {{rig:<term>}} in text with the row of `harness`.
 * @param {string} text
 * @param {Record<string, Record<string, string>>} terms   term -> harness -> text
 * @param {string} harness   the format owner whose row applies
 * @returns {{text: string, errors: {code: string, message: string, harness?: string}[]}}
 */
export function substitute(text, terms, harness) {
  const errors = [];
  const out = text.replace(PLACEHOLDER, (whole, key) => {
    const row = Object.hasOwn(terms, key) ? terms[key] : undefined;
    if (!row) {
      errors.push({ code: "E_TERM_UNKNOWN", message: `${whole} is not a term in terms.json` });
      return whole;
    }
    if (!Object.hasOwn(row, harness)) {
      errors.push({ code: "E_TERM_MISSING", harness, message: `term "${key}" has no row for ${harness}` });
      return whole;
    }
    return row[harness];
  });
  return { text: out, errors };
}

/**
 * Bytes variant. Only files that decode as strict UTF-8 and hold a placeholder change; all others pass byte-exact.
 * @param {Uint8Array} bytes @param {Record<string, Record<string, string>>} terms @param {string} harness
 * @returns {{bytes: Uint8Array, errors: {code: string, message: string, harness?: string}[]}}
 */
export function substituteBytes(bytes, terms, harness) {
  let text;
  try {
    text = utf8.decode(bytes);
  } catch {
    return { bytes, errors: [] };
  }
  if (!text.includes("{{rig:")) return { bytes, errors: [] };
  const r = substitute(text, terms, harness);
  return { bytes: encoder.encode(r.text), errors: r.errors };
}
