// secret: token patterns, and the overlay private_terms list as a sub-rule. Both block.
import { redact, scanTexts } from "./text.ts";

/** @type {[string, RegExp][]} */
const PATTERNS = [
  ["cloud access key id", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ["github token", /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g],
  ["github fine-grained token", /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g],
  ["slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/g],
  ["google api key", /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ["model api key", /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{32,}/g],
  ["stripe live key", /\b[sr]k_live_[0-9A-Za-z]{16,}/g],
  ["npm token", /\bnpm_[A-Za-z0-9]{36}\b/g],
  ["private key block", /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY(?: BLOCK)?-----/g],
  ["json web token", /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
  ["url with credentials", /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s:/@]{3,}@/gi],
  ["assigned secret", /\b(?:api[_-]?key|secret|token|passw(?:or)?d|auth)[\w-]*\s*[:=]\s*["']?([A-Za-z0-9/+_.-]{24,})/gi],
];

/** A bare assignment only counts when the value mixes letters and digits, so prose and placeholders pass. */
const looksSecret = (v) => /[A-Za-z]/.test(v) && /\d/.test(v);

/** @param {string[]} terms */
function scanner(terms) {
  const lowered = terms.map((t) => t.toLowerCase());
  return (text, where) => {
    const items = [];
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      const n = i + 1;
      for (const [name, re] of PATTERNS) {
        re.lastIndex = 0;
        for (const m of line.matchAll(re)) {
          if (name === "assigned secret" && !looksSecret(m[1])) continue;
          items.push({
            severity: "block",
            key: `secret\0${name}\0${line}`,
            idBytes: `${name}\0${line}`,
            evidence: `${name} at line ${n}: ${redact(m[0])}`,
          });
        }
      }
      if (where.root !== "repo") return;
      const low = line.toLowerCase();
      lowered.forEach((term, t) => {
        if (term === "" || !low.includes(term)) return;
        items.push({
          severity: "block",
          key: `private_terms\0${term}\0${line}`,
          idBytes: `private_terms\0${term}\0${line}`,
          evidence: `private_terms[${t}] at line ${n}`,
        });
      });
    });
    return items;
  };
}

export function runSecret(ctx: object) {
  return scanTexts(ctx, scanner(ctx.world.config?.private_terms ?? []));
}
