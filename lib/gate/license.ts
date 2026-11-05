// license: every non-core pack needs an SPDX expression whose licenses are all allowed.

/** Permissive and weak-copyleft SPDX ids that rig accepts without an ack. */
const ALLOWED = new Set([
  "MIT", "MIT-0", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "0BSD", "Unlicense", "CC0-1.0", "Zlib",
  "BlueOak-1.0.0", "MPL-2.0", "CC-BY-4.0", "Python-2.0",
]);

/**
 * Evaluate an SPDX expression: `OR` needs one allowed branch, `AND` needs every branch, `WITH <exception>` is
 * judged by its license, a trailing `+` is ignored. Anything that does not parse is disallowed.
 */
export function licenseAllowed(expr: string) {
  const tokens = expr.match(/\(|\)|[^\s()]+/g) ?? [];
  let i = 0;
  const orExpr = () => {
    let ok = andExpr();
    while (tokens[i]?.toUpperCase() === "OR") { i++; const r = andExpr(); ok = ok || r; }
    return ok;
  };
  const andExpr = () => {
    let ok = atom();
    while (tokens[i]?.toUpperCase() === "AND") { i++; const r = atom(); ok = ok && r; }
    return ok;
  };
  const atom = () => {
    const t = tokens[i++];
    if (t === undefined || t === ")" || ["AND", "OR", "WITH"].includes(t.toUpperCase())) throw new SyntaxError(expr);
    if (t === "(") {
      const ok = orExpr();
      if (tokens[i++] !== ")") throw new SyntaxError(expr);
      return ok;
    }
    const ok = ALLOWED.has(t.replace(/\+$/, ""));
    if (tokens[i]?.toUpperCase() === "WITH") {
      i++;
      if (tokens[i++] === undefined) throw new SyntaxError(expr);
    }
    return ok;
  };
  try {
    const ok = orExpr();
    return i === tokens.length && ok;
  } catch {
    return false;
  }
}

export function runLicense(ctx: object) {
  const out = [];
  for (const pack of ctx.world.packs?.values() ?? []) {
    if (pack.name === "core") continue;
    const license = pack.manifest?.license;
    const missing = typeof license !== "string" || license.trim() === "" || /^(NONE|NOASSERTION|UNKNOWN)$/i.test(license.trim());
    if (!missing && licenseAllowed(license)) continue;
    out.push({
      severity: "block",
      pack: pack.name,
      path: "pack.json",
      evidence: missing ? "license missing" : `license not allowed: ${license}`,
      idBytes: missing ? "license missing" : `license ${license}`,
    });
  }
  return out;
}
