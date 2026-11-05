#!/usr/bin/env node
// scripts/migrate-to-ts.mjs — the one-shot lever from .mjs plus JSDoc to .ts that Node runs through type stripping.
// It stays .mjs so that it runs on a tree that has not been migrated yet. Rerunnable: a second run changes nothing.
//
// Usage: node scripts/migrate-to-ts.mjs [--dry-run]
//
// What it does, in this order:
//  1. git mv every tracked .mjs under bin/, lib/, test/, probes/ to .ts.
//  2. Top-level JSDoc @typedef blocks -> `export type` (plain object or union shapes); `import("x").T` aliases ->
//     `import type`. A typedef it cannot convert keeps its JSDoc and gets a `// TODO(ts)` line.
//  3. @param/@returns of exported functions -> TS annotations where the JSDoc type is simple. A parameter with no
//     typed @param stays as it is. A function is left whole when a @param names no plain parameter (destructured,
//     dotted), a type is JSDoc-only, or it has @template. Converted tag types leave the comment; descriptions stay.
//  4. Relative specifiers of static import/export statements: ./x.mjs -> ./x.ts. In comments: JSDoc import("./x.mjs")
//     types and repo paths (bin|lib|test|probes)/....mjs. In test/: .mjs path tokens in strings, templates and
//     regex literals, plus the boundary test's file pattern, its `import type` handling and a rule case for it.
//  5. package.json: bin entries, the test script, any script path that was renamed.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIRS = ["bin", "lib", "test", "probes"];
const TEST_SCRIPT = 'node --test "test/**/*.test.ts"';
const TODO = "// TODO(ts):";

// ---------------------------------------------------------------------------------------------------------------
// Tokenizer: code, comments, strings, templates, regex literals. Enough for this repo's JavaScript.

const REGEX_AFTER_CHAR = "(,=:[!&|?{};+-*%<>~^";
const REGEX_AFTER_WORD = /\b(return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await|instanceof)$/;

/** @param {string} src @param {number} i index of the opening quote @returns {number} index after the closing quote */
function skipQuoted(src, i) {
  const q = src[i];
  let j = i + 1;
  while (j < src.length && src[j] !== q && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1;
  return Math.min(j + 1, src.length);
}

/** @param {string} src @param {number} i index of the opening backtick @returns {number} index after the closing one */
function skipTemplate(src, i) {
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === "\\") j += 2;
    else if (c === "`") return j + 1;
    else if (c === "$" && src[j + 1] === "{") {
      j += 2;
      let depth = 1;
      while (j < src.length && depth > 0) {
        const d = src[j];
        if (d === '"' || d === "'") j = skipQuoted(src, j);
        else if (d === "`") j = skipTemplate(src, j);
        else {
          if (d === "{") depth++;
          else if (d === "}") depth--;
          j++;
        }
      }
    } else j++;
  }
  return src.length;
}

/** @param {string} src @param {number} i index of "/" @returns {number} index after the flags, or -1: not a regex */
function skipRegex(src, i) {
  let j = i + 1;
  let inClass = false;
  while (j < src.length) {
    const c = src[j];
    if (c === "\n") return -1;
    if (c === "\\") j += 2;
    else {
      if (c === "[") inClass = true;
      else if (c === "]") inClass = false;
      else if (c === "/" && !inClass) break;
      j++;
    }
  }
  if (j >= src.length) return -1;
  j++;
  while (j < src.length && /[a-z]/i.test(src[j])) j++;
  return j;
}

/**
 * @param {string} src
 * @returns {{type: "code"|"line"|"block"|"string"|"template"|"regex", start: number, end: number}[]}
 */
function tokenize(src) {
  const out = [];
  let codeStart = 0;
  const push = (type, start, end) => {
    if (start > codeStart) out.push({ type: "code", start: codeStart, end: start });
    out.push({ type, start, end });
    codeStart = end;
  };
  let i = 0;
  let prev = ""; // last significant character outside comments; "v" after a literal token
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === "/" && n === "/") {
      const end = src.indexOf("\n", i);
      push("line", i, end === -1 ? src.length : end);
      i = end === -1 ? src.length : end;
    } else if (c === "/" && n === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      push("block", i, stop);
      i = stop;
    } else if (c === '"' || c === "'") {
      const end = skipQuoted(src, i);
      push("string", i, end);
      i = end;
      prev = "v";
    } else if (c === "`") {
      const end = skipTemplate(src, i);
      push("template", i, end);
      i = end;
      prev = "v";
    } else if (c === "/") {
      const code = src.slice(codeStart, i).trimEnd();
      const allowed = prev === "" || REGEX_AFTER_CHAR.includes(prev) || (/[\w$]/.test(prev) && REGEX_AFTER_WORD.test(code));
      const end = allowed ? skipRegex(src, i) : -1;
      if (end !== -1) {
        push("regex", i, end);
        i = end;
        prev = "v";
      } else {
        i++;
        prev = "/";
      }
    } else {
      if (!/\s/.test(c)) prev = c;
      i++;
    }
  }
  if (src.length > codeStart) out.push({ type: "code", start: codeStart, end: src.length });
  return out;
}

/** Same length as src; everything but code and newlines blanked. For bracket matching and statement search. */
function mask(src, tokens) {
  let out = "";
  for (const t of tokens) {
    const s = src.slice(t.start, t.end);
    out += t.type === "code" ? s : s.replace(/[^\n]/g, " ");
  }
  return out;
}

/** @param {string} s @param {{start: number, end: number, text: string}[]} edits non-overlapping @returns {string} */
function applyEdits(s, edits) {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  for (let k = 1; k < sorted.length; k++) {
    if (sorted[k].end > sorted[k - 1].start) throw new Error(`overlapping edits at ${sorted[k].start}`);
  }
  for (const e of sorted) s = s.slice(0, e.start) + e.text + s.slice(e.end);
  return s;
}

const lineAt = (src, index) => src.slice(0, index).split("\n").length;

// ---------------------------------------------------------------------------------------------------------------
// JSDoc parsing

/** @param {string} s @param {number} i index of "{" @returns {number} index after the matching "}", or -1 */
function matchBrace(s, i) {
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === '"' || c === "'") {
      j = skipQuoted(s, j) - 1;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return j + 1;
  }
  return -1;
}

/** Drop the " * " prefixes of continuation lines. */
const unstar = (s) => s.replace(/\n[ \t]*\*(?!\/)[ \t]?/g, "\n");

/**
 * The tags of one block comment, with offsets into the comment text.
 * @param {string} comment the whole comment, "/**" to "*\/"
 * @returns {{description: string, tags: {tag: string, start: number, typeStart: number, typeEnd: number, type: string | null, rest: string, restStart: number, end: number}[]}}
 */
function parseDoc(comment) {
  const bodyEnd = comment.length - 2;
  const tags = [];
  let i = 3;
  const tagAt = (j) => comment[j] === "@" && /[\s*]/.test(comment[j - 1]) && /[a-z]/i.test(comment[j + 1] ?? "");
  const nextTag = (from) => {
    for (let j = from; j < bodyEnd; j++) if (tagAt(j)) return j;
    return bodyEnd;
  };
  i = nextTag(i);
  const description = unstar(comment.slice(3, i)).trim();
  while (i < bodyEnd) {
    const name = comment.slice(i + 1).match(/^\w+/)[0];
    let j = i + 1 + name.length;
    while (j < bodyEnd && /[ \t]/.test(comment[j])) j++;
    let type = null;
    let typeStart = j;
    let typeEnd = j;
    if (comment[j] === "{") {
      const close = matchBrace(comment, j);
      if (close !== -1 && close <= bodyEnd) {
        type = unstar(comment.slice(j + 1, close - 1)).replace(/\n\s*/g, "\n").trim();
        typeEnd = close;
        j = close;
      }
    }
    const end = nextTag(j);
    tags.push({ tag: name, start: i, typeStart, typeEnd, type, rest: unstar(comment.slice(j, end)).trim(), restStart: j, end });
    i = end;
  }
  return { description, tags };
}

/**
 * A JSDoc type as a TS type, or null when it uses JSDoc-only syntax. `import("spec").Name` becomes `Name` and is
 * recorded in imports (name -> spec).
 * @param {string} type @param {Map<string, string>} imports @returns {string | null}
 */
function tsType(type, imports) {
  let t = type;
  for (const m of [...t.matchAll(/\bimport\(\s*(["'])([^"']+)\1\s*\)\.([A-Za-z_$][\w$]*)/g)]) {
    const [whole, , spec, name] = m;
    if (imports.has(name) && imports.get(name) !== spec) return null;
    imports.set(name, spec);
    t = t.replace(whole, name);
  }
  if (/\bimport\s*\(/.test(t)) return null;
  if (/(^|[^\w$\])])\*(?![\w$])/.test(t)) return null; // * (any)
  if (/(^|[(<,|:&\s[])[?!](?=[\w$({[])/.test(t)) return null; // ?T, !T
  if (/\bfunction\b/.test(t)) return null;
  if (/\.</.test(t)) return null; // Array.<T>
  if (/=(?!>)/.test(t)) return null; // T= optional
  if (/^\.\.\./.test(t)) return null; // ...T rest
  return t;
}

const IDENT = /^[A-Za-z_$][\w$]*$/;

/** @param {string} text @returns {string} the text as a doc comment or line comments, without a trailing newline */
function docComment(text, indent = "") {
  if (!text) return "";
  if (text.startsWith("//")) return text.split("\n").map((l) => indent + (l.startsWith("//") ? l : `// ${l}`)).join("\n");
  const lines = text.split("\n");
  if (lines.length === 1) return `${indent}/** ${text} */`;
  return [`${indent}/**`, ...lines.map((l) => (l ? `${indent} * ${l}` : `${indent} *`)), `${indent} */`].join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// Pass 1: @typedef blocks

/**
 * @param {string} src @param {string} rel
 * @returns {{src: string, converted: number, todos: string[]}}
 */
function convertTypedefs(src, rel) {
  const tokens = tokenize(src);
  const edits = [];
  const todos = [];
  const hoisted = new Map();
  let converted = 0;
  const lineStart = (i) => src.lastIndexOf("\n", i - 1) + 1;
  for (const t of tokens) {
    if (t.type !== "block") continue;
    const comment = src.slice(t.start, t.end);
    if (!comment.startsWith("/**") || !/@typedef\b/.test(comment)) continue;
    if (lineStart(t.start) !== t.start) continue; // top level only: the comment opens its line at column 0
    const { description, tags } = parseDoc(comment);
    const typedefs = tags.filter((x) => x.tag === "typedef");
    if (!typedefs.length) continue; // "@typedef" inside other text, not a tag
    const name = typedefs[0].rest.split(/\s+/)[0] || "?";
    const fail = (why) => {
      const before = src.slice(lineStart(t.start - 1), t.start);
      const marker = `${TODO} convert @typedef ${name} by hand (${why})`;
      if (!before.startsWith(TODO)) edits.push({ start: t.start, end: t.start, text: `${marker}\n` });
      todos.push(`${rel}:${lineAt(src, t.start)} ${name}: ${why}`);
    };
    if (typedefs.length !== 1) {
      fail("more than one @typedef in one comment");
      continue;
    }
    const td = typedefs[0];
    const others = tags.filter((x) => x !== td && x.tag !== "property" && x.tag !== "prop");
    if (others.length) {
      fail(`unsupported tag @${others[0].tag}`);
      continue;
    }
    if (!IDENT.test(name) || td.rest.split(/\s+/).length !== 1) {
      fail("name is not a plain identifier");
      continue;
    }
    if (td.type === null) {
      fail("no type");
      continue;
    }
    const props = tags.filter((x) => x.tag === "property" || x.tag === "prop");
    const local = new Map(hoisted); // merged into hoisted only when this typedef converts
    let text;
    const alias = td.type.match(/^import\(\s*(["'])([^"']+)\1\s*\)\.([A-Za-z_$][\w$]*)$/);
    if (alias && !props.length) {
      const [, , spec, imported] = alias;
      const clause = imported === name ? name : `${imported} as ${name}`;
      text = [docComment(description), `import type { ${clause} } from "${spec}";`].filter(Boolean).join("\n");
    } else if (!props.length) {
      const ty = tsType(td.type, local);
      if (ty === null) {
        fail("JSDoc-only type syntax");
        continue;
      }
      const body = ty.split("\n").map((l, k) => (k === 0 ? l : `  ${l}`)).join("\n");
      text = [docComment(description), `export type ${name} = ${body};`].filter(Boolean).join("\n");
    } else {
      if (!/^(object|Object)$/.test(td.type)) {
        fail("@property on a non-object typedef");
        continue;
      }
      const lines = [];
      let bad = null;
      for (const p of props) {
        const m = p.rest.match(/^(\[([^\]=\s]+)(?:=[^\]]*)?\]|(\S+))\s*([\s\S]*)$/);
        const pname = m && (m[2] ?? m[3]);
        const ty = p.type === null ? null : tsType(p.type, local);
        if (!m || !pname || pname.includes(".") || ty === null) {
          bad = `property ${pname ?? "?"} is not simple`;
          break;
        }
        const key = IDENT.test(pname) ? pname : JSON.stringify(pname);
        const desc = m[4].replace(/\s+/g, " ").trim();
        if (desc) lines.push(docComment(desc, "  "));
        lines.push(`  ${key}${m[2] ? "?" : ""}: ${ty.split("\n").join("\n    ")};`);
      }
      if (bad) {
        fail(bad);
        continue;
      }
      text = [docComment(description), `export type ${name} = {`, ...lines, "};"].filter(Boolean).join("\n");
    }
    edits.push({ start: t.start, end: t.end, text });
    for (const [k, v] of local) hoisted.set(k, v);
    converted++;
  }
  // `import("x").T` inside converted types: one `import type` line per name, after the last import statement.
  const out = applyEdits(src, edits);
  return { src: hoisted.size ? insertImports(out, hoisted) : out, converted, todos };
}

/**
 * The string tokens that are specifiers of static import or export-from statements. `import(` is not one.
 * @param {string} src @param {ReturnType<typeof tokenize>} tokens
 */
function staticSpecifiers(src, tokens) {
  const out = [];
  let codeBefore = "";
  for (const t of tokens) {
    if (t.type === "line" || t.type === "block") continue;
    if (t.type === "code") {
      codeBefore = (codeBefore + src.slice(t.start, t.end)).slice(-200);
      continue;
    }
    if (t.type === "string" && /(?:^|[^\w$.])(?:from|import)\s*$/.test(codeBefore)) out.push(t);
    codeBefore += "v";
  }
  return out;
}

/**
 * Add `import type { name } from "spec";` lines after the last static import, or after the leading comment
 * header. A name that the file already imports as a type is skipped.
 * @param {string} src @param {Map<string, string>} names name -> spec
 */
function insertImports(src, names) {
  const tokens = tokenize(src);
  const lines = [...names]
    .filter(([n]) => !new RegExp(`^import\\s+type\\s*\\{[^}]*\\b${n.replace(/\$/g, "\\$")}\\b[^}]*\\}`, "m").test(src))
    .map(([n, spec]) => `import type { ${n} } from "${spec}";`);
  if (!lines.length) return src;
  const specs = staticSpecifiers(src, tokens);
  if (!specs.length) {
    const header = src.match(/^(#!.*\n)?(\/\/.*\n)*/)[0].length;
    return `${src.slice(0, header)}${lines.join("\n")}\n${src.slice(header)}`;
  }
  const last = specs.at(-1).end;
  const eol = src.indexOf("\n", last);
  const at = eol === -1 ? src.length : eol;
  return `${src.slice(0, at)}\n${lines.join("\n")}${src.slice(at)}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Pass 2: @param/@returns of exported functions

/** @param {string} masked @param {number} open index of "(" @returns {number} index of the matching ")" */
function matchParen(masked, open) {
  let depth = 0;
  for (let j = open; j < masked.length; j++) {
    const c = masked[j];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if ((c === ")" || c === "]" || c === "}") && --depth === 0) return j;
  }
  return -1;
}

/** Remove the converted tag types from a doc comment. Returns "" when nothing is left. */
function stripTagTypes(comment, tags) {
  const SENTINEL = "\u0000";
  // Keep blank " *" lines that were already there; drop only those this edit empties. Same length: offsets hold.
  let c = comment.replace(/^([ \t]*)\*([ \t]*)$/gm, `$1${SENTINEL}$2`);
  const edits = [];
  for (const t of tags) {
    const restText = c.slice(t.restStart, t.end);
    const nameMatch = t.tag === "param" ? restText.match(/^(\s*)(\[([^\]=\s]+)[^\]]*\]|\S+)/) : null;
    const after = nameMatch ? restText.slice(nameMatch[0].length) : restText;
    const hasDesc = unstar(after).replaceAll(SENTINEL, "").trim().length > 0;
    if (!hasDesc) {
      const isLast = t.end >= c.length - 2;
      const end = isLast ? t.restStart + restText.trimEnd().length : t.end;
      edits.push({ start: t.start, end, text: "" });
    } else {
      let typeEnd = t.typeEnd;
      while (/[ \t]/.test(c[typeEnd] ?? "")) typeEnd++;
      edits.push({ start: t.typeStart, end: typeEnd, text: "" });
      if (nameMatch && nameMatch[3]) {
        const s = t.restStart + nameMatch[1].length;
        edits.push({ start: s, end: s + nameMatch[2].length, text: nameMatch[3] });
      }
    }
  }
  c = applyEdits(c, edits);
  if (!c.includes("\n")) {
    const body = c.slice(3, -2).trim();
    return body ? `/** ${body} */` : "";
  }
  const lines = c.split("\n").map((l) => l.replace(/[ \t]+$/, ""));
  const kept = lines.filter((l, k) => k === 0 || k === lines.length - 1 || !/^[ \t]*\*?$/.test(l));
  const out = kept.join("\n").replaceAll(SENTINEL, "*");
  const body = unstar(out.slice(3, -2)).replace(/\s+/g, "");
  return body ? out : "";
}

/**
 * @param {string} src @param {string} rel
 * @returns {{src: string, annotated: string[], skipped: string[]}}
 */
function annotateExports(src, rel) {
  const tokens = tokenize(src);
  const masked = mask(src, tokens);
  const edits = [];
  const annotated = [];
  const skipped = [];
  const hoisted = new Map();
  for (const m of masked.matchAll(/^export\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/gm)) {
    const fname = m[1];
    const open = m.index + m[0].length - 1;
    const close = matchParen(masked, open);
    if (close === -1) continue;
    const doc = tokens.findLast((t) => t.end <= m.index && t.type !== "code");
    const between = doc ? src.slice(doc.end, m.index) : "x";
    if (!doc || doc.type !== "block" || !/^\s*$/.test(between) || !src.startsWith("/**", doc.start)) continue;
    const comment = src.slice(doc.start, doc.end);
    const { tags } = parseDoc(comment);
    const params = tags.filter((t) => t.tag === "param");
    const returns = tags.filter((t) => t.tag === "returns" || t.tag === "return");
    const typed = [...params, ...returns].filter((t) => t.type !== null);
    if (!typed.length) continue;
    const where = `${rel}:${lineAt(src, m.index)} ${fname}`;
    const skip = (why) => skipped.push(`${where}: ${why}`);
    if (tags.some((t) => t.tag === "template")) {
      skip("@template");
      continue;
    }
    // Split the parameter list at top-level commas.
    const parts = [];
    let depth = 0;
    let s = open + 1;
    for (let j = open + 1; j <= close; j++) {
      const c = masked[j];
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") depth--;
      if ((c === "," && depth === 0) || j === close) {
        const text = src.slice(s, j);
        if (text.trim()) parts.push({ start: s + (text.length - text.trimStart().length), text: text.trim() });
        s = j + 1;
      }
    }
    const docParams = params.map((p) => {
      const pm = p.rest.match(/^(\[([^\]=\s]+)(?:=[^\]]*)?\]|(\S+))/);
      return { tag: p, name: pm ? (pm[2] ?? pm[3]) : null, optional: Boolean(pm && pm[2]) };
    });
    let bad = null;
    const local = new Map(hoisted); // merged into hoisted only when this function converts
    const paramEdits = [];
    for (const part of parts) {
      // A parameter without a typed @param stays as it is; a @param that names no parameter is caught below.
      const pm = part.text.match(/^([A-Za-z_$][\w$]*)(\s*=[\s\S]*)?$/);
      if (!pm) continue;
      const dp = docParams.filter((d) => d.name === pm[1]);
      if (dp.length > 1) {
        bad = `parameter ${pm[1]} has more than one @param`;
        break;
      }
      if (dp.length === 0 || dp[0].tag.type === null) continue;
      const ty = tsType(dp[0].tag.type, local);
      if (ty === null) {
        bad = `parameter ${pm[1]} has a JSDoc-only type`;
        break;
      }
      const opt = dp[0].optional && !pm[2] ? "?" : "";
      paramEdits.push({ start: part.start, end: part.start + pm[1].length, text: `${pm[1]}${opt}: ${ty.replace(/\s*\n\s*/g, " ")}` });
    }
    if (!bad && docParams.some((d) => !parts.some((p) => p.text.match(/^[A-Za-z_$][\w$]*/)?.[0] === d.name))) {
      bad = "a @param names no parameter (destructured or dotted)";
    }
    let retEdit = null;
    if (!bad && returns.length > 1) bad = "more than one @returns";
    if (!bad && returns.length === 1 && returns[0].type !== null) {
      if (/^\s*:/.test(masked.slice(close + 1))) bad = "return type already annotated";
      else {
        const ty = tsType(returns[0].type, local);
        if (ty === null) bad = "@returns has a JSDoc-only type";
        else retEdit = { start: close + 1, end: close + 1, text: `: ${ty.replace(/\s*\n\s*/g, " ")}` };
      }
    }
    if (bad) {
      skip(bad);
      continue;
    }
    for (const [k, v] of local) hoisted.set(k, v);
    edits.push(...paramEdits);
    if (retEdit) edits.push(retEdit);
    const converted = [...params, ...(retEdit ? returns : [])].filter((t) => t.type !== null);
    const newDoc = stripTagTypes(comment, converted);
    if (newDoc) edits.push({ start: doc.start, end: doc.end, text: newDoc });
    else {
      const lineEnd = src.indexOf("\n", doc.end);
      edits.push({ start: doc.start, end: lineEnd === -1 ? doc.end : lineEnd + 1, text: "" });
    }
    annotated.push(where);
  }
  const out = applyEdits(src, edits);
  return { src: hoisted.size ? insertImports(out, hoisted) : out, annotated, skipped };
}

// ---------------------------------------------------------------------------------------------------------------
// Pass 3: specifiers and .mjs paths

const REL_MJS = /^(\.{1,2}\/[^"'`]*)\.mjs$/;
const COMMENT_PATH = /(?<![\w/.-])((?:bin|lib|test|probes)\/[\w./-]*?[\w-])\.mjs\b/g;
const COMMENT_IMPORT = /(\bimport\(\s*["'])(\.{1,2}\/[^"']*?)\.mjs(["']\s*\))/g;
const TEST_LITERAL = /(?<=[\w}$-])\.mjs\b/g;
const TEST_REGEX = /(?<=[\w}$-])\\\.mjs\b/g;

/** Exact edits to the boundary test: [old, new]. Each applies once; already applied is fine; neither is a warning. */
const BOUNDARY_EDITS = [
  ["/\\.(mjs|js|cjs)$/", "/\\.(ts|mjs|js|cjs)$/"],
  ["every .mjs and .js file under bin/ and lib/", "every .ts, .mjs and .js file under bin/ and lib/"],
  ['const outside = clause.replace(/\\{[^}]*\\}/, "")', 'const outside = clause.replace(/^\\s*type\\s+/, "").replace(/\\{[^}]*\\}/, "")'],
  [
    `  test("writeState from gate", () => assert.deepEqual(check("lib/gate.ts", 'import { writeState } from "./fs.ts";'), []));`,
    `  test("writeState from gate", () => assert.deepEqual(check("lib/gate.ts", 'import { writeState } from "./fs.ts";'), []));\n` +
      `  test("import type is a named import", () => assert.deepEqual(check("lib/gate.ts", 'import type { writeState } from "./fs.ts";'), []));`,
  ],
];

/**
 * @param {string} src @param {string} rel
 * @returns {{src: string, imports: number, comments: number, literals: number, warnings: string[]}}
 */
function rewritePaths(src, rel) {
  const tokens = tokenize(src);
  const edits = [];
  let imports = 0;
  let comments = 0;
  let literals = 0;
  const warnings = [];
  const isTest = rel.startsWith("test/");
  const specifiers = new Set(staticSpecifiers(src, tokens));
  for (const t of tokens) {
    const text = src.slice(t.start, t.end);
    if (t.type === "code") continue;
    if (t.type === "string") {
      const inner = text.slice(1, -1);
      if (specifiers.has(t) && REL_MJS.test(inner)) {
        edits.push({ start: t.start + 1, end: t.end - 1, text: inner.replace(REL_MJS, "$1.ts") });
        imports++;
        continue;
      }
      const hits = isTest ? text.match(TEST_LITERAL) : null;
      if (hits) {
        edits.push({ start: t.start, end: t.end, text: text.replace(TEST_LITERAL, ".ts") });
        literals += hits.length;
      }
      continue;
    }
    if (t.type === "template" || t.type === "regex") {
      if (!isTest) continue;
      const re = t.type === "regex" ? TEST_REGEX : TEST_LITERAL;
      const to = t.type === "regex" ? "\\.ts" : ".ts";
      const hits = text.match(re);
      if (hits) {
        edits.push({ start: t.start, end: t.end, text: text.replace(re, to) });
        literals += hits.length;
      }
      continue;
    }
    // line or block comment
    let next = text.replace(COMMENT_IMPORT, (_, a, p, b) => (comments++, `${a}${p}.ts${b}`));
    next = next.replace(COMMENT_PATH, (_, p) => (comments++, `${p}.ts`));
    if (next !== text) edits.push({ start: t.start, end: t.end, text: next });
  }
  let out = applyEdits(src, edits);
  if (rel === "test/boundaries.test.ts") {
    for (const [from, to] of BOUNDARY_EDITS) {
      if (out.includes(to)) continue;
      if (out.includes(from)) out = out.replace(from, to);
      else warnings.push(`${rel}: boundary edit not applied, pattern not found: ${from}`);
    }
  }
  return { src: out, imports, comments, literals, warnings };
}

// ---------------------------------------------------------------------------------------------------------------
// package.json

function editPackage(pkg, renames) {
  const notes = [];
  const renamed = new Map(renames.map(([a, b]) => [a, b]));
  const swap = (p) => {
    const to = renamed.get(p.replace(/^\.\//, ""));
    return to ? `${p.startsWith("./") ? "./" : ""}${to}` : null;
  };
  if (typeof pkg.bin === "string") {
    const to = swap(pkg.bin);
    if (to) (notes.push(`bin: ${pkg.bin} -> ${to}`), (pkg.bin = to));
  } else if (pkg.bin) {
    for (const [k, v] of Object.entries(pkg.bin)) {
      const to = swap(v);
      if (to) (notes.push(`bin.${k}: ${v} -> ${to}`), (pkg.bin[k] = to));
    }
  }
  pkg.scripts ??= {};
  for (const [k, v] of Object.entries(pkg.scripts)) {
    let next = v;
    for (const [a, b] of renames) next = next.replaceAll(a, b);
    if (k === "test" && next === "node --test") next = TEST_SCRIPT;
    if (k === "test" && next !== TEST_SCRIPT) notes.push(`WARNING scripts.test is "${next}", expected "${TEST_SCRIPT}"; edit by hand`);
    if (next !== v) (notes.push(`scripts.${k}: ${v} -> ${next}`), (pkg.scripts[k] = next));
  }
  return notes;
}

// ---------------------------------------------------------------------------------------------------------------
// main

function main() {
  const dry = process.argv.includes("--dry-run");
  const unknown = process.argv.slice(2).filter((a) => a !== "--dry-run");
  if (unknown.length) {
    console.error(`migrate-to-ts: unknown argument ${unknown[0]}\nUsage: node scripts/migrate-to-ts.mjs [--dry-run]`);
    process.exit(2);
  }
  const git = (...args) => execFileSync("git", ["-C", ROOT, ...args], { encoding: "utf8" });
  const tracked = git("ls-files", "-z", "--", ...DIRS).split("\0").filter(Boolean);
  const renames = tracked.filter((f) => f.endsWith(".mjs")).map((f) => [f, f.replace(/\.mjs$/, ".ts")]);
  for (const [, to] of renames) {
    if (existsSync(join(ROOT, to))) throw new Error(`migrate-to-ts: ${to} exists; refusing to overwrite`);
  }
  // Every file to transform, by its final path, read from where it lives now.
  const files = [
    ...renames.map(([from, to]) => ({ from, to })),
    ...tracked.filter((f) => f.endsWith(".ts") && existsSync(join(ROOT, f))).map((f) => ({ from: f, to: f })),
  ].sort((a, b) => a.to.localeCompare(b.to));

  const report = { renamed: renames.length, imports: 0, comments: 0, literals: 0, typedefs: 0, functions: 0 };
  const todos = [];
  const skipped = [];
  const warnings = [];
  const writes = [];
  for (const { from, to } of files) {
    const before = readFileSync(join(ROOT, from), "utf8");
    const a = convertTypedefs(before, to);
    const b = annotateExports(a.src, to);
    const c = rewritePaths(b.src, to);
    report.typedefs += a.converted;
    report.functions += b.annotated.length;
    report.imports += c.imports;
    report.comments += c.comments;
    report.literals += c.literals;
    todos.push(...a.todos);
    skipped.push(...b.skipped);
    warnings.push(...c.warnings);
    if (c.src !== before) {
      writes.push({ path: to, src: c.src });
      if (dry) {
        const parts = [
          a.converted && `${a.converted} typedefs`,
          a.todos.length && `${a.todos.length} TODO(ts)`,
          b.annotated.length && `${b.annotated.length} functions annotated`,
          c.imports && `${c.imports} import specifiers`,
          c.comments && `${c.comments} comment paths`,
          c.literals && `${c.literals} test literals`,
        ].filter(Boolean);
        console.log(`edit   ${to}: ${parts.join(", ")}`);
      }
    }
  }

  const pkgPath = join(ROOT, "package.json");
  const pkgBefore = readFileSync(pkgPath, "utf8");
  const pkg = JSON.parse(pkgBefore);
  const pkgNotes = editPackage(pkg, renames);
  const pkgAfter = `${JSON.stringify(pkg, null, 2)}\n`;

  if (dry) {
    for (const [from, to] of renames) console.log(`rename ${from} -> ${to}`);
    for (const n of pkgNotes) console.log(`edit   package.json: ${n}`);
    for (const t of todos) console.log(`todo   ${t}`);
    for (const s of skipped) console.log(`skip   ${s}`);
  } else {
    for (const [from, to] of renames) git("mv", from, to);
    for (const w of writes) writeFileSync(join(ROOT, w.path), w.src);
    if (pkgAfter !== pkgBefore) writeFileSync(pkgPath, pkgAfter);
  }
  for (const w of warnings) console.error(`WARNING ${w}`);
  for (const n of pkgNotes.filter((n) => n.startsWith("WARNING"))) console.error(n);
  console.log(
    `${dry ? "planned" : "done"}: ${report.renamed} renamed, ${writes.length} files edited, ${report.imports} import specifiers, ` +
      `${report.comments} comment paths, ${report.literals} test literals, ${report.typedefs} typedefs converted, ` +
      `${todos.length} TODO(ts) left, ${report.functions} exported functions annotated, ${skipped.length} skipped, ` +
      `package.json ${pkgAfter === pkgBefore ? "unchanged" : "edited"}`,
  );
}

main();
