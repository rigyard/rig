// lib/targets/place.ts — internal to targets. See docs/design/rig-architecture.md sections 4 and 7.
// Pure: reads nothing from disk. Every harness fact comes from the target records.

const RANK = { none: 0, "identical-bytes": 1, "by-name": 2 };

/**
 * Group copies of one skill the way a harness would collapse them. Two copies merge only under the weaker
 * dedupe rule of their two dirs. Greedy and pairwise on purpose: a copy joins a group only when it merges with
 * every member, so the result can overcount copies but never undercount them.
 */
export function collapseCopies<T extends {dedupe: string, digest?: string}>(items: T[]): T[][] {
  const groups: T[][] = [];
  for (const item of items) {
    const home = groups.find((g) => g.every((m) => mergeable(m, item)));
    if (home) home.push(item);
    else groups.push([item]);
  }
  return groups;
}

function mergeable(a, b) {
  const weaker = RANK[a.dedupe] <= RANK[b.dedupe] ? a.dedupe : b.dedupe;
  if (weaker === "by-name") return true;
  if (weaker === "identical-bytes") return a.digest !== undefined && a.digest === b.digest;
  return false;
}

/** `**` crosses slashes, `*` does not. A path matches a glob when the path or a file inside it matches. */
function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      re += ".*";
      i++;
    } else if (c === "*") re += "[^/]*";
    else re += c.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

function isNeverWrite(path, records) {
  for (const rec of records) {
    for (const glob of rec.reads?.never_write ?? []) {
      const re = globToRegExp(glob);
      if (re.test(path) || re.test(`${path}/SKILL.md`)) return true;
    }
  }
  return false;
}

/**
 * Candidates in declared order: writable read dirs by installed harness, then plugin channels.
 * A candidate is {key, path, owner, channel?, plugin, readers: Map<harness, dedupe>}.
 */
function candidatesFor(unit, installed, targets, records) {
  const optedOut = new Set(
    unit.harnesses.filter((h) => unit.channel?.[h] === "plugin"),
  );
  const out = [];
  const seen = new Set();
  for (const owner of installed) {
    if (optedOut.has(owner)) continue; // a harness on its plugin channel drops its own skill dirs
    for (const entry of targets.get(owner).reads.skills) {
      if (!entry.writable || seen.has(entry.path) || isNeverWrite(entry.path, records)) continue;
      seen.add(entry.path);
      out.push({
        key: entry.path,
        path: entry.path,
        owner,
        plugin: Boolean(entry.plugin),
        readers: readersOf(entry.path, installed, targets),
      });
    }
  }
  for (const owner of optedOut) {
    const chan = targets.get(owner).channels?.plugin;
    if (!chan) continue; // reported by place() as E_READSET
    if (isNeverWrite(chan.dir, records)) continue;
    const readEntry = targets.get(owner).reads.skills.find((e) => e.plugin && !e.writable);
    const readers = readEntry ? readersOf(readEntry.path, installed, targets) : new Map();
    if (!readers.has(owner)) readers.set(owner, "none");
    out.push({
      key: `channel:plugin:${owner}`,
      path: chan.dir,
      owner,
      channel: "plugin",
      plugin: true,
      readers,
    });
  }
  return out;
}

function readersOf(path, installed, targets) {
  const readers = new Map();
  for (const h of installed) {
    const entry = targets.get(h).reads.skills.find((e) => e.path === path);
    if (entry) readers.set(h, entry.dedupe);
  }
  return readers;
}

const cmp = (a, b) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
};

/**
 * Smallest set of writable dirs (plus declared channels) such that each harness in unit.harnesses sees the unit
 * exactly once after its own dedupe rule, and every other installed harness sees it at most once. `anchored` maps a dir
 * that the set must hold to the packs whose leaves there link to the unit.
 *
 * Cost order, first difference wins: harnesses that cannot hide a hidden unit, dir count, leaks, namespace cost
 * (documented before unverified), then declared candidate order. Equal-cost solutions are a tie, broken by that
 * order and never by chance.
 *
 */
export function place(unit: {id: string, harnesses: string[], channel?: Record<string, "plugin">, digests: Record<string, string>, hidden?: boolean, anchored?: Record<string, string[]>}, installed: string[], targets: Map<string, object>): {dirs: {path: string, owner: string, channel?: "plugin"}[], leaks: string[], copies: Record<string, number>, namespace: {harness: string, dir: string, certainty: "documented" | "unverified"}[], unhidden: string[]} | {error: {code: string, message: string, path?: string, harness?: string}} {
  for (const h of [...installed, ...unit.harnesses]) {
    if (!targets.has(h)) throw new TypeError(`place: no target record for harness "${h}"`);
  }
  for (const h of unit.harnesses) {
    if (!installed.includes(h)) throw new TypeError(`place: unit "${unit.id}" targets "${h}", which is not installed`);
  }
  const wanted = new Set(unit.harnesses);
  const records = installed.map((h) => targets.get(h));
  const pack = unit.id.split("/")[0];

  for (const h of unit.harnesses) {
    if (unit.channel?.[h] === "plugin" && !targets.get(h).channels?.plugin) {
      return {
        error: {
          code: "E_READSET",
          harness: h,
          message: `${h} declares no plugin channel, but unit ${unit.id} asks for one. Remove packs.${pack}.channel.${h} from rig.json.`,
        },
      };
    }
  }

  const cands = candidatesFor(unit, installed, targets, records);
  let required = 0;
  for (const dir of Object.keys(unit.anchored ?? {})) {
    const i = cands.findIndex((c) => c.path === dir && !c.channel);
    if (i < 0) throw new TypeError(`place: unit "${unit.id}" must sit in ${dir}, which is no candidate dir`);
    required |= 1 << i;
  }
  const evaluate = (mask) => {
    const chosen = cands.filter((_, i) => mask & (1 << i));
    const copies = {};
    const sees = {};
    const failing = [];
    for (const h of installed) {
      const items = chosen
        .filter((c) => c.readers.has(h))
        .map((c) => ({ dedupe: c.readers.get(h), digest: unit.digests?.[c.owner], dir: c.path }));
      sees[h] = items.map((i) => i.dir);
      copies[h] = collapseCopies(items).length;
      if (wanted.has(h) ? copies[h] !== 1 : copies[h] > 1) failing.push(h);
    }
    return { chosen, copies, sees, failing };
  };

  if (unit.harnesses.length === 0) {
    return {
      dirs: [],
      leaks: [],
      copies: Object.fromEntries(installed.map((h) => [h, 0])),
      namespace: [],
      unhidden: [],
    };
  }

  let best = null;
  let nearest = null;
  for (let mask = 1; mask < 1 << cands.length; mask++) {
    if ((mask & required) !== required) continue;
    const r = evaluate(mask);
    const order = cands.map((_, i) => (mask & (1 << i) ? i : 99)).sort((a, b) => a - b);
    if (r.failing.length === 0) {
      const leaks = installed.filter((h) => !wanted.has(h) && r.copies[h] === 1);
      const namespace = [];
      for (const c of r.chosen) {
        if (!c.plugin) continue;
        for (const h of unit.harnesses) {
          if (c.readers.has(h)) {
            namespace.push({ harness: h, dir: c.path, certainty: c.channel ? "documented" : "unverified" });
          }
        }
      }
      const unhidden = unit.hidden
        ? installed.filter((h) => r.copies[h] > 0 && (targets.get(h).hide?.method ?? "none") === "none")
        : [];
      const nsCost = namespace.filter((n) => n.certainty === "documented").length * 10 +
        namespace.filter((n) => n.certainty === "unverified").length;
      const key = [unhidden.length, r.chosen.length, leaks.length, nsCost, ...order];
      if (!best || cmp(key, best.key) < 0) best = { key, r, leaks, namespace, unhidden };
    } else {
      const uncovered = unit.harnesses.filter((h) => r.copies[h] === 0).length;
      const key = [uncovered, r.failing.length, r.chosen.length, ...order];
      if (!nearest || cmp(key, nearest.key) < 0) nearest = { key, r };
    }
  }

  if (best) {
    return {
      dirs: best.r.chosen.map((c) => ({
        path: c.path,
        owner: c.owner,
        ...(c.channel ? { channel: c.channel } : {}),
      })),
      leaks: best.leaks,
      copies: best.r.copies,
      namespace: best.namespace,
      unhidden: best.unhidden,
    };
  }
  return { error: readsetError(unit, pack, nearest?.r, installed, targets, wanted, cands) };
}

type Cand = {path: string, readers: Map<string, string>};
type Near = {chosen: Cand[], copies: Record<string, number>, sees: Record<string, string[]>, failing: string[]};

function readsetError(unit, pack, near: Near | undefined, installed, targets, wanted: Set<string>, cands: Cand[]) {
  if (!near) {
    const h = unit.harnesses[0];
    return {
      code: "E_READSET",
      harness: h,
      message: `Unit ${unit.id}: no writable dir or channel reaches ${h}. Every dir it reads is never-write or read-only.`,
    };
  }
  const harness = near.failing[0];
  const dirs = near.sees[harness];
  const count = near.copies[harness];
  const what = wanted.has(harness)
    ? `${harness} would see unit ${unit.id} ${count === 0 ? "zero times" : `${count} times`}`
    : `${harness} is not a target of unit ${unit.id} but would see it ${count} times`;
  const anchored = Object.entries(unit.anchored ?? {});
  if (anchored.length) {
    const packs = [...new Set(anchored.flatMap(([, p]) => p))].sort();
    const packLists = packs.map((p) => `rig.json packs.${p}.harnesses`);
    const anchoredDirs = new Set(anchored.map(([d]) => d));
    const extra = near.chosen.filter((c) => !anchoredDirs.has(c.path) && c.readers.has(harness));
    const pulled = [...wanted].filter((h) => {
      const reaching = cands.filter((c) => c.readers.has(h));
      return h !== harness && reaching.length > 0 && reaching.every((c) => extra.includes(c));
    });
    const exits = pulled.length
      ? `add ${pulled.join(" and ")} to ${packLists.join(" and ")}, or remove ${pulled.join(" and ")} from rig.json harnesses`
      : `give ${packLists.join(" and ")} one harness list, so the leaves share dirs`;
    return {
      code: "E_READSET",
      harness,
      path: dirs[0],
      message: `${what}, via ${dirs.join(" and ")}: unit ${unit.id} must sit in ${anchored.map(([d]) => d).join(" and ")}, where vendored leaves link to it. Exits: ${exits}.`,
    };
  }
  const exits = [`narrow the unit's harnesses in rig.json packs.${pack}.harnesses`];
  const canPlugin = unit.harnesses.filter(
    (h) => targets.get(h).channels?.plugin && unit.channel?.[h] !== "plugin",
  );
  for (const h of canPlugin) exits.push(`set rig.json packs.${pack}.channel.${h} = "plugin"`);
  return {
    code: "E_READSET",
    harness,
    path: dirs[0],
    message: `${what}, via ${dirs.length ? dirs.join(" and ") : "no writable dir"}. Exits: ${exits.join(", or ")}.`,
  };
}
