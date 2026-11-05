// unicode: hidden code points, pipe-to-shell and eval of fetched data (block); injection phrases (warn).
import { excerpt, scanTexts } from "./text.ts";

const HIDDEN = new RegExp(
  [
    "[\\u200B-\\u200D\\u2060-\\u2064\\u180E\\uFEFF]", // zero-width
    "[\\u200E\\u200F\\u061C\\u202A-\\u202E\\u2066-\\u2069]", // bidi controls
    "[\\u{E0000}-\\u{E007F}]", // tag characters
  ].join("|"),
  "gu",
);

const KIND = (cp) =>
  cp >= 0xe0000 ? "tag character"
  : (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069) || cp === 0x200e || cp === 0x200f || cp === 0x61c
    ? "bidi control"
    : "zero-width character";

const PICTO = /\p{Extended_Pictographic}/u;

/** U+200D joins emoji. It is hidden only outside an emoji sequence. */
function isEmojiJoiner(line, i) {
  const before = [...line.slice(0, i).replace(/️$/, "")].pop();
  const after = [...line.slice(i + 1)][0];
  return PICTO.test(before ?? "") && PICTO.test(after ?? "");
}

const DOWNLOAD = String.raw`(?:curl|wget|Invoke-WebRequest|iwr|Invoke-RestMethod|irm)`;
const EXEC_RULES = [
  ["pipe to shell", new RegExp(String.raw`\b${DOWNLOAD}\b[^\n|]*\|\s*(?:sudo\s+)?(?:(?:ba|z|da|k|a|fi)?sh|python[0-9.]*|node|perl|ruby|iex)\b`, "gi")],
  ["eval of fetched data", new RegExp(String.raw`\b(?:eval|source|iex|Invoke-Expression)\b[^\n]*(?:\$\(|<\(|\x60)\s*${DOWNLOAD}\b`, "gi")],
  ["run fetched data", new RegExp(String.raw`\b(?:ba|z|da|k|a|fi)?sh\s+(?:-c\s+)?["']?(?:\$\(|<\()\s*${DOWNLOAD}\b`, "gi")],
  ["download piped to iex", new RegExp(String.raw`\b${DOWNLOAD}\b[^\n]*\)\s*\|\s*iex\b|\biex\b\s*\(\s*${DOWNLOAD}\b`, "gi")],
];

const INJECTION = [
  /ignore (?:all |any )?(?:the )?(?:previous|prior|above|earlier) (?:instructions|prompts?|rules)/gi,
  /disregard (?:all |any )?(?:the |your )?(?:previous|prior|above|earlier)? ?(?:instructions|prompts?|rules)/gi,
  /forget (?:everything|all) (?:you were told|above|before)/gi,
  /(?:reveal|print|show|repeat) (?:me )?(?:your|the) (?:system|hidden) (?:prompt|instructions)/gi,
  /(?:do not|don't|never) (?:tell|inform|mention (?:this )?to) the user/gi,
  /without (?:telling|informing|notifying) the user/gi,
  /override (?:your|the) (?:safety|system) (?:rules|instructions|prompt|guidelines)/gi,
  /you are now (?:in )?(?:developer|jailbreak|dan|god) mode/gi,
];

function scan(text) {
  const items = [];
  text.split("\n").forEach((line, i) => {
    const n = i + 1;
    const hidden = new Map();
    for (const m of line.matchAll(HIDDEN)) {
      const cp = m[0].codePointAt(0);
      if (cp === 0xfeff && i === 0 && m.index === 0) continue;
      if (cp === 0x200d && isEmojiJoiner(line, m.index)) continue;
      const kind = KIND(cp);
      if (!hidden.has(kind)) hidden.set(kind, { cp, at: m.index, count: 0 });
      hidden.get(kind).count++;
    }
    for (const [kind, h] of hidden) {
      items.push({
        severity: "block",
        key: `unicode\0${kind}\0${line}`,
        idBytes: `${kind}\0${line}`,
        evidence: `${kind} U+${h.cp.toString(16).toUpperCase().padStart(4, "0")} x${h.count} at line ${n}: ${excerpt(line, h.at, 1)}`,
      });
    }
    for (const [name, re] of EXEC_RULES) {
      re.lastIndex = 0;
      const m = re.exec(line);
      if (!m) continue;
      items.push({
        severity: "block",
        key: `unicode\0${name}\0${line}`,
        idBytes: `${name}\0${line}`,
        evidence: `${name} at line ${n}: ${excerpt(line, m.index, m[0].length)}`,
      });
    }
    for (const re of INJECTION) {
      re.lastIndex = 0;
      const m = re.exec(line);
      if (!m) continue;
      items.push({
        severity: "warn",
        key: `unicode\0injection\0${m[0].toLowerCase()}\0${line}`,
        idBytes: `injection\0${m[0].toLowerCase()}\0${line}`,
        evidence: `injection phrase at line ${n}: ${excerpt(line, m.index, m[0].length)}`,
      });
    }
  });
  return items;
}

export function runUnicode(ctx: object) {
  return scanTexts(ctx, scan);
}
