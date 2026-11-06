// `rig stats --suggest`: the example rules of the draft's section 14 over the store lines of the window, as one
// unified diff against the repo config root (decision 0021). It reads rig.json and models/roles.json of that root
// and writes nothing: lib/metrics.ts saves the patch under the state root, and the user applies it with git apply.
// Every value in the diff comes from config or from a closed set (unit ids, role names, effort rungs); no
// transcript text reaches it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { encode } from "../world.ts";

const RIG_FILE = "rig.json";
const ROLES_FILE = "models/roles.json";
// First values with no measurement behind them (docs/plan/v0-prs.md: the first owner that measures records a median).
/** Sessions with an escalated repeat dispatch of one role before the role gets one effort rung more. */
const ESCALATED_SESSIONS = 2;
/** Mean hook output bytes per session above which the report names the hook. */
const HOOK_BYTES_PER_SESSION = 4096;

/**
 * @param {{lines: object[], units: {id: string, type: string, name: string, harnesses: string[]}[], world: object}} input
 *   lines: the store lines of the window; units: the composed stack's units
 * @returns {{notes: string[], patch: string | null}}
 */
export function propose({ lines, units, world }) {
  const notes = [];
  const diffs = [disableUnused(lines, units, world, notes), raiseEscalated(lines, world, notes)].filter(Boolean);
  hooksOverBudget(lines, notes);
  return { notes, patch: diffs.length ? diffs.join("") : null };
}

// ---------------------------------------------------------------- rules

/**
 * A pack skill with no use in the window, on a harness that records uses, gets a rig.json `disable` entry. A use is a
 * skill tool call or a read of a file inside the unit dir (the readers fold both into `skills`).
 */
function disableUnused(lines, units, world, notes) {
  const known = lines.filter((l) => l.skills && typeof l.skills === "object");
  const covered = new Set(known.map((l) => l.harness));
  const loads = (name, harnesses) =>
    known.filter((l) => harnesses.includes(l.harness))
      .reduce((n, l) => n + Object.entries(l.skills).reduce((m, [k, c]) => m + (k === name || k.endsWith(`:${name}`) ? c : 0), 0), 0);
  const unused = [];
  for (const u of units) {
    if (u.type !== "skill" || u.id.startsWith("core/")) continue;
    const seen = u.harnesses.filter((h) => covered.has(h));
    if (!seen.length || loads(u.name, seen) > 0) continue;
    const pack = u.id.split("/")[0];
    if (world.packs?.get(pack)?.root !== "repo") {
      notes.push(`skill ${u.id}: no use on ${seen.join(", ")}; its pack lives in the overlay, so disable it there by hand`);
      continue;
    }
    notes.push(`skill ${u.id}: no use on ${seen.join(", ")} in ${known.filter((l) => seen.includes(l.harness)).length} sessions: disable`);
    unused.push(u.id);
  }
  if (!unused.length) return null;
  return editConfig(world, RIG_FILE, "rig", notes, (cfg) => ({ ...cfg, disable: [...(cfg.disable ?? []), ...unused.sort()] }));
}

/** The configured effort of a role: the one `[tier, effort]` value under that label in the repo roles.json. */
function roleSlots(roles, role) {
  const out = [];
  for (const [consumer, map] of Object.entries(roles?.consumers ?? {})) {
    const v = map?.[role];
    if (Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === "string")) out.push({ consumer, tier: v[0], effort: v[1] });
  }
  return out;
}

/**
 * A role dispatched more than once in one session, at least once above its configured effort, is an escalated
 * session (the draft's heuristic). ESCALATED_SESSIONS of them raise the configured effort one rung on the ladder of
 * the harness that recorded them.
 */
function raiseEscalated(lines, world, notes) {
  const roles = readRepoJson(world, ROLES_FILE);
  if (!roles) return null;
  const counts = new Map();
  for (const line of lines) {
    const ladder = world.tiers?.ladders?.[line.harness];
    if (!line.agents || !Array.isArray(ladder)) continue;
    for (const [role, a] of Object.entries(line.agents)) {
      const slots = roleSlots(roles.value, role);
      if (slots.length !== 1 || !(a?.dispatches >= 2)) continue;
      const rung = ladder.indexOf(slots[0].effort);
      if (rung < 0 || !Object.keys(a.effort ?? {}).some((e) => ladder.indexOf(e) > rung)) continue;
      const c = counts.get(role) ?? { sessions: 0, ladder, slot: slots[0] };
      c.sessions += 1;
      counts.set(role, c);
    }
  }
  const raise = [];
  for (const [role, c] of [...counts].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (c.sessions < ESCALATED_SESSIONS) continue;
    const next = c.ladder[c.ladder.indexOf(c.slot.effort) + 1];
    if (!next) {
      notes.push(`role ${role}: escalated in ${c.sessions} sessions, already at the top rung ${c.slot.effort}`);
      continue;
    }
    notes.push(`role ${role}: escalated in ${c.sessions} sessions: effort ${c.slot.effort} -> ${next}`);
    raise.push({ ...c.slot, role, next });
  }
  if (!raise.length) return null;
  return editConfig(world, ROLES_FILE, "roles", notes, (cfg) => {
    const consumers = structuredClone(cfg.consumers);
    for (const r of raise) consumers[r.consumer][r.role] = [r.tier, r.next];
    return { ...cfg, consumers };
  });
}

/** rig writes no foreign hook, so a hook over budget is a report line, never a diff. */
function hooksOverBudget(lines, notes) {
  const measured = lines.filter((l) => l.hook_bytes && typeof l.hook_bytes === "object");
  const totals = {};
  for (const l of measured) for (const [event, n] of Object.entries(l.hook_bytes)) totals[event] = (totals[event] ?? 0) + n;
  for (const event of Object.keys(totals).sort()) {
    const mean = Math.round(totals[event] / measured.length);
    if (mean <= HOOK_BYTES_PER_SESSION) continue;
    notes.push(`hook ${event}: ${mean} bytes per session over ${measured.length} sessions, above ${HOOK_BYTES_PER_SESSION}; rig did not write it, so no diff: trim it where it is configured`);
  }
}

// ---------------------------------------------------------------- config files

function readRepoJson(world, rel) {
  if (!world.roots?.repo) return null;
  let text;
  try {
    text = readFileSync(join(world.roots.repo, rel), "utf8");
  } catch {
    return null;
  }
  try {
    return { text, value: JSON.parse(text) };
  } catch {
    return null;
  }
}

/** The diff of one repo config file, through the world's canonical encoder. Null with a note when it cannot apply. */
function editConfig(world, rel, kind, notes, change) {
  const cur = readRepoJson(world, rel);
  if (!cur) {
    notes.push(`${rel}: not readable in the repo root, so no diff`);
    return null;
  }
  const decoder = new TextDecoder();
  if (decoder.decode(encode(kind, cur.value)) !== cur.text) {
    notes.push(`${rel}: not in canonical form (E_JSON_ROUNDTRIP), so no diff; make the change by hand`);
    return null;
  }
  return unifiedDiff(rel, cur.text, decoder.decode(encode(kind, change(cur.value))));
}

// ---------------------------------------------------------------- diff

const CONTEXT = 3;

/** A git-style unified diff of two texts that end in a newline. Empty when they are equal. */
export function unifiedDiff(rel, before, after) {
  const a = before.split("\n").slice(0, -1);
  const b = after.split("\n").slice(0, -1);
  const lcs = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  }
  const ops = [];
  for (let i = 0, j = 0; i < a.length || j < b.length;) {
    if (i < a.length && j < b.length && a[i] === b[j]) ops.push([" ", a[i++], j++]);
    else if (i < a.length && (j === b.length || lcs[i + 1][j] >= lcs[i][j + 1])) ops.push(["-", a[i++]]);
    else ops.push(["+", b[j++]]);
  }
  const changes = ops.flatMap((o, k) => (o[0] === " " ? [] : [k]));
  if (!changes.length) return "";
  let out = `diff --git a/${rel} b/${rel}\n--- a/${rel}\n+++ b/${rel}\n`;
  for (let c = 0; c < changes.length;) {
    let last = c;
    while (last + 1 < changes.length && changes[last + 1] - changes[last] <= 2 * CONTEXT) last++;
    const s = Math.max(0, changes[c] - CONTEXT);
    const e = Math.min(ops.length, changes[last] + CONTEXT + 1);
    const count = (from, to, kinds) => ops.slice(from, to).filter((o) => kinds.includes(o[0])).length;
    const oldBefore = count(0, s, " -");
    const newBefore = count(0, s, " +");
    const oldCount = count(s, e, " -");
    const newCount = count(s, e, " +");
    out += `@@ -${oldBefore + (oldCount ? 1 : 0)},${oldCount} +${newBefore + (newCount ? 1 : 0)},${newCount} @@\n`;
    for (const o of ops.slice(s, e)) out += `${o[0]}${o[1]}\n`;
    c = last + 1;
  }
  return out;
}
