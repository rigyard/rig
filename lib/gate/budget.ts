// budget (decision 0012): static context cost over the rendered bytes. Block where the harness drops or truncates
// text, warn where text costs money. No hook runs here: hook output cost comes from transcripts in `rig stats`.
// A rendered file counts only when a target record places it: no record, no finding.
import { posix } from "node:path";
import { decode } from "./ctx.ts";
import { visible } from "./text.ts";

/** Thresholds. Sources are listed in the PR and in decision 0012; only the caps are harness facts. */
export const LIMITS = Object.freeze({
  descriptionWarn: 300, // routing doc: researcher proposal
  listingWarn: 8000, // routing doc: researcher proposal, per harness
  bodyLines: 500, // routing doc: researcher proposal
  bodyTokens: 5000, // routing doc: researcher proposal
  coLoadTokens: 25000, // routing doc: Claude compaction pool
  codexInstructionsWarn: 8192, // a rig choice (probes doc: not a harness fact)
  charsPerToken: 4, // assumption A28
});
/** Used when the target record has no `budget` value. Claude: routing doc. Codex: probe (d), 32,768 bytes. */
const DEFAULT_DESCRIPTION_MAX = { claude: 1536 };
const DEFAULT_INSTRUCTIONS_MAX = { codex: 32768 };

const tokens = (chars) => Math.ceil(chars / LIMITS.charsPerToken);
const num = (n) => n.toLocaleString("en-US");
const homeRel = (p, home) => (home && p.startsWith(`${home}/`) ? `~/${p.slice(home.length + 1)}` : p);
const under = (path, dir) => path === dir || path.startsWith(dir.endsWith("/") ? dir : `${dir}/`);

/** Split a text into frontmatter and body. @param {string} text */
function split(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  return m ? { fm: m[1], body: text.slice(m[0].length) } : { fm: null, body: text };
}

/** One top-level frontmatter value: plain, quoted, folded (`>`), literal (`|`) or an indented continuation. @param {string | null} fm @param {string} key */
function fmValue(fm, key) {
  if (fm === null) return null;
  const lines = fm.split(/\r?\n/);
  const at = lines.findIndex((l) => l.startsWith(`${key}:`));
  if (at < 0) return null;
  const rest = lines[at].slice(key.length + 1).trim();
  const more = [];
  for (let i = at + 1; i < lines.length && (/^[ \t]/.test(lines[i]) || lines[i] === ""); i++) more.push(lines[i].trim());
  while (more.length && more[more.length - 1] === "") more.pop();
  if (/^[>|][+-]?$/.test(rest)) return more.join(rest[0] === ">" ? " " : "\n").trim();
  const quoted = /^(["'])([\s\S]*)\1$/.exec(rest);
  const first = quoted ? quoted[2] : rest;
  return [first, ...more].filter((s) => s !== "").join(" ");
}

/** The target that places a path, by longest matching prefix. @returns {{name: string, rec: object, role: "instructions"|"rule"|"skill"} | null} */
function place(ctx, path) {
  const home = ctx.world.env?.home;
  let best = null;
  const offer = (name, rec, role, dir, exact) => {
    if (typeof dir !== "string" || dir.startsWith("$")) return;
    const d = homeRel(dir.replace(/^~(?=\/|$)/, home ?? "~"), home);
    if (exact ? path !== d : !under(path, d)) return;
    if (!best || d.length > best.len) best = { name, rec, role, len: d.length };
  };
  for (const [key, rec] of ctx.world.targets ?? []) {
    const name = rec.name ?? key;
    offer(name, rec, "instructions", rec.instructions?.path, true);
    offer(name, rec, "rule", rec.units?.rule?.dir, false);
    if (posix.basename(path) === "SKILL.md") for (const d of rec.reads?.skills ?? []) if (d.writable) offer(name, rec, "skill", d.path, false);
  }
  return best;
}

const hidden = (rec, fm) => rec.hide?.method === "frontmatter-key" && fmValue(fm, rec.hide.key) === String(rec.hide.value);

const CACHE_BUST = [
  ["timestamp", /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?/],
  ["date", /\b\d{4}-\d{2}-\d{2}\b/],
  ["stated date", /\b(?:today's date|the current date|current date) is\b/i],
  ["clock time", /\b\d{2}:\d{2}:\d{2}\b/],
  ["session id", /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|\bsession[_ -]?id\b/i],
  ["git status output", /^(?:On branch \S|Your branch is |Changes (?:not staged for|to be) commit|Untracked files:|nothing to commit)/m],
];

function cacheBust(text, base) {
  const out = [];
  for (const [kind, re] of CACHE_BUST) {
    const m = re.exec(text);
    if (!m) continue;
    const line = text.slice(0, m.index).split("\n").length;
    out.push({
      severity: "warn", ...base,
      evidence: `cache-bust: ${kind} "${visible(m[0].slice(0, 40))}" at line ${line} sits in text the harness loads at session start, so it breaks the prompt cache prefix`,
      idBytes: `cache-bust\0${kind}\0${m[0]}`,
    });
  }
  return out;
}

/** Skill reference chains over pack sources. Depth 1 is SKILL.md linking a file. A file linked from that file is depth 2. */
function referenceDepth(ctx) {
  const out = [];
  const link = /\]\(([^)\s#]+)(?:#[^)]*)?\)/g;
  for (const pack of ctx.world.packs?.values() ?? []) {
    for (const path of pack.files.keys()) {
      if (posix.basename(path) !== "SKILL.md") continue;
      const refs = (from) => {
        const dir = posix.dirname(from);
        const found = [];
        for (const m of decode(pack.files.get(from).bytes).matchAll(link)) {
          if (/^([a-z][a-z0-9+.-]*:|\/)/i.test(m[1])) continue;
          const to = posix.normalize(posix.join(dir, m[1]));
          if (!to.startsWith("..") && to.endsWith(".md") && pack.files.has(to)) found.push(to);
        }
        return found;
      };
      const seen = new Set([path]);
      let chain = null;
      const walk = (from, trail) => {
        for (const to of refs(from)) {
          if (seen.has(to) || chain) continue;
          seen.add(to);
          if (trail.length >= 2) chain = [...trail, to];
          else walk(to, [...trail, to]);
        }
      };
      walk(path, [path]);
      if (chain) {
        const shown = chain.map((p) => visible(p)).join(" -> ");
        out.push({ severity: "warn", pack: pack.name, path, evidence: `reference chain ${shown} is ${chain.length - 1} levels deep; keep references one level from SKILL.md`, idBytes: `reference depth\0${shown}` });
      }
    }
  }
  return out;
}

export function runBudget(ctx: object) {
  const out = [];
  const per = new Map(); // harness -> {rec, alwaysOn, listing, bodies}
  const of = (p) => {
    if (!per.has(p.name)) per.set(p.name, { rec: p.rec, alwaysOn: 0, listing: 0, bodies: [] });
    return per.get(p.name);
  };

  for (const r of ctx.rendered) {
    const where = place(ctx, r.path);
    if (!where) continue;
    const h = of(where);
    const text = decode(r.bytes);
    const base = { pack: r.pack, path: r.path };

    if (where.role === "skill") {
      const { fm, body } = split(text);
      const bodyTokens = tokens(body.length);
      const lines = body.replace(/\n$/, "").split("\n").length;
      h.bodies.push(bodyTokens);
      if (lines > LIMITS.bodyLines || bodyTokens > LIMITS.bodyTokens) {
        out.push({ severity: "warn", ...base, evidence: `skill body is ${num(lines)} lines and ${num(bodyTokens)} tokens; the limits are ${LIMITS.bodyLines} lines and ${num(LIMITS.bodyTokens)} tokens`, idBytes: `body\0${lines}\0${bodyTokens}` });
      }
      const description = fmValue(fm, "description");
      if (description === null || hidden(where.rec, fm)) continue;
      h.listing += (fmValue(fm, "name") ?? posix.basename(posix.dirname(r.path))).length + description.length;
      const cap = where.rec.budget?.description_max ?? DEFAULT_DESCRIPTION_MAX[where.name];
      if (cap !== undefined && description.length > cap) {
        out.push({ severity: "block", ...base, evidence: `description is ${num(description.length)} characters, over the ${num(cap)}-character cap of ${where.name}`, idBytes: `description cap\0${description.length}\0${cap}` });
      } else if (description.length > LIMITS.descriptionWarn) {
        out.push({ severity: "warn", ...base, evidence: `description is ${num(description.length)} characters, over ${LIMITS.descriptionWarn}`, idBytes: `description\0${description.length}` });
      }
      out.push(...cacheBust(description, base));
      continue;
    }

    h.alwaysOn += text.length;
    out.push(...cacheBust(text, base));
    if (where.role !== "instructions") continue;
    const cap = where.rec.budget?.instructions_max_bytes ?? DEFAULT_INSTRUCTIONS_MAX[where.name];
    const warnAt = where.name === "codex" ? LIMITS.codexInstructionsWarn : undefined;
    if (cap !== undefined && r.bytes.length > cap) {
      out.push({ severity: "block", ...base, evidence: `instructions are ${num(r.bytes.length)} bytes, over the ${num(cap)}-byte limit of ${where.name}; the harness drops the rest`, idBytes: `instructions cap\0${r.bytes.length}` });
    } else if (warnAt !== undefined && r.bytes.length > warnAt) {
      out.push({ severity: "warn", ...base, evidence: `instructions are ${num(r.bytes.length)} bytes, over ${num(warnAt)}`, idBytes: `instructions\0${r.bytes.length}` });
    }
  }

  for (const [name, h] of per) {
    const alwaysOn = tokens(h.alwaysOn);
    const base = { pack: "*", path: `harness:${name}` };
    out.push({ severity: "info", ...base, evidence: `always-on: ${num(h.alwaysOn)} characters, ${num(alwaysOn)} tokens`, idBytes: `always-on\0${h.alwaysOn}` });
    if (h.listing > LIMITS.listingWarn) {
      out.push({ severity: "warn", ...base, evidence: `skill listing is ${num(h.listing)} characters, over ${num(LIMITS.listingWarn)}`, idBytes: `listing\0${h.listing}` });
    }
    const largest = h.bodies.sort((a, b) => b - a).slice(0, 3);
    const coLoad = alwaysOn + largest.reduce((a, b) => a + b, 0);
    if (coLoad > LIMITS.coLoadTokens) {
      out.push({ severity: "warn", ...base, evidence: `worst-case co-load is ${num(coLoad)} tokens (always-on plus the ${largest.length} largest bodies), over ${num(LIMITS.coLoadTokens)}`, idBytes: `co-load\0${coLoad}` });
    }
  }

  out.push(...referenceDepth(ctx));
  return out;
}
