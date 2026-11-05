// lib/targets/vars.ts — internal to targets. Template variables of core templates: bare {{name}} tokens.
// Pure. A closed set per template; `{{rig:<term>}}` tokens belong to terms.mjs and never match here.

const VARIABLE = /\{\{([a-z_]+)\}\}/g;

/**
 * Replace every {{name}} in text with its value. A name outside `vars` is E_TERM_UNKNOWN, except a name in `keep`,
 * which stays as written. A value is a thunk, called once and only when the text uses it; it returns the text or
 * `{error}`.
 */
export function fill(text: string, vars: Record<string, () => string | {error: {code: string, message: string, harness?: string}}>, keep: string[] = []): {text: string, errors: {code: string, message: string, harness?: string}[]} {
  const errors = [];
  const done = new Map();
  const out = text.replace(VARIABLE, (whole, name) => {
    if (keep.includes(name)) return whole;
    if (!Object.hasOwn(vars, name)) {
      errors.push({ code: "E_TERM_UNKNOWN", message: `${whole} is not a template variable here` });
      return whole;
    }
    if (!done.has(name)) done.set(name, vars[name]());
    const v = done.get(name);
    if (typeof v === "string") return v;
    errors.push(v.error);
    return whole;
  });
  // Errors of a value repeat once per use of the variable; report each once.
  return { text: out, errors: [...new Map(errors.map((e) => [e.message, e])).values()] };
}
