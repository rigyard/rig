// links: every relative Markdown link in an owned .md entry resolves to an owned path of the same harness (block).
import { posix } from "node:path";
import { decode } from "./ctx.ts";
import { visible } from "./text.ts";
import type { Rendered } from "./ctx.ts";
import type { TargetRecord } from "../world.ts";

type LinksCtx = {rendered: Rendered[], world: {targets?: Map<string, TargetRecord>}};

const under = (dir: string, p: string) => p === dir || p.startsWith(`${dir}/`);

/** The harness column rule of `rig plan`: the record whose root holds the path, else the one whose writable skill dir does. */
function harnessOf(ctx: LinksCtx, path: string) {
  const records = [...(ctx.world.targets?.values() ?? [])];
  const byRoot = records.find((t) => typeof t.root === "string" && under(t.root, path));
  if (byRoot) return byRoot.name;
  return records.find((t) => (t.reads?.skills ?? []).some((d: {path: string, writable: boolean}) => d.writable && under(d.path, path)))?.name ?? "";
}

/** Blank fenced blocks and code spans with spaces, so a link inside code is not seen and line numbers stay. */
function prose(text: string) {
  const blank = (s: string) => s.replace(/[^\n]/g, " ");
  const out = [];
  let fence: string | null = null;
  for (const line of text.split("\n")) {
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length && line.trim() === m[1]) fence = null;
      out.push(blank(line));
    } else if (m) {
      fence = m[1];
      out.push(blank(line));
    } else {
      out.push(line);
    }
  }
  return out.join("\n").replace(/(`+)[\s\S]*?\1/g, blank);
}

const LINK = /\]\(\s*(<[^>\n]*>|[^\s)]*)(?:\s+["'(][^)\n]*)?\)/g;

/** The path part of a link target, or null when the target is not a relative path. */
function relativePath(raw: string) {
  const t = raw.replace(/^<|>$/g, "").replace(/[#?].*$/, "");
  if (t === "" || /^[a-z][a-z0-9+.-]*:/i.test(t) || /^[/~]/.test(t)) return null;
  if (!t.includes("/") && !/\.[a-z0-9]+$/i.test(t)) return null;
  try {
    return decodeURIComponent(t);
  } catch {
    return t;
  }
}

export function runLinks(input: object) {
  const ctx = input as LinksCtx;
  const owned = new Set<string>();
  for (const r of ctx.rendered) {
    if (r.kind !== "owned") continue;
    for (let p = r.path; !owned.has(p) && p !== "." && p !== "/"; p = posix.dirname(p)) owned.add(p);
  }
  const out = [];
  for (const r of ctx.rendered) {
    if (r.kind !== "owned" || !r.path.endsWith(".md")) continue;
    const text = prose(decode(r.bytes));
    const from = harnessOf(ctx, r.path);
    const seen = new Set();
    for (const m of text.matchAll(LINK)) {
      const target = relativePath(m[1]);
      if (target === null || seen.has(target)) continue;
      const to = posix.normalize(posix.join(posix.dirname(r.path), target)).replace(/(.)\/$/, "$1");
      const where = owned.has(to) ? harnessOf(ctx, to) : null;
      if (where === from) continue;
      seen.add(target);
      const line = text.slice(0, m.index).split("\n").length;
      const why = where === null ? "which rig does not plan" : `which rig plans for ${where || "no harness"}, not ${from || "no harness"}`;
      out.push({
        severity: "block", pack: r.pack, path: r.path,
        evidence: `link to ${visible(target)} at line ${line} resolves to ${visible(to)}, ${why}`,
        idBytes: `link\0${target}`,
      });
    }
  }
  return out;
}
