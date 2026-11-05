// lib/targets/terms.ts — internal to targets. The vocabulary: {{rig:<term>}} placeholders, docs section 2.3.
// Pure. One placeholder form exists; no free-string rewrite.

const PLACEHOLDER = /\{\{rig:([^{}]*)\}\}/g;
const utf8 = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();

/**
 * Replace every {{rig:<term>}} in text with the row of `harness`.
 * @param terms   term -> harness -> text
 * @param harness   the format owner whose row applies
 */
export function substitute(text: string, terms: Record<string, Record<string, string>>, harness: string): {text: string, errors: {code: string, message: string, harness?: string}[]} {
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
 */
export function substituteBytes(bytes: Uint8Array, terms: Record<string, Record<string, string>>, harness: string): {bytes: Uint8Array, errors: {code: string, message: string, harness?: string}[]} {
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
