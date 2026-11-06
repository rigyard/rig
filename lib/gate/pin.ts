// pin: lock tree, locked excludes, port review, core seal, and installs of a seeded upstream made outside rig. Never ackable.
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { treeHash } from "../tree.ts";
import type { Desired } from "../targets.ts";
import type { Pack, PackLock, World } from "../world.ts";

const lockOf = (world, root) => (root === "overlay" ? world.locks?.overlay : world.locks?.repo);
const short = (h) => h.slice(0, 19);

function packFindings(world) {
  const out = [];
  for (const pack of world.packs?.values() ?? []) {
    if (pack.name === "core") continue;
    const entry = lockOf(world, pack.root)?.packs?.[pack.name];
    if (!entry) {
      out.push({
        severity: "block", pack: pack.name, path: ".",
        evidence: `pack ${pack.name} has no lock entry; rig pack add writes the entry`,
        idBytes: "no lock entry",
      });
      continue;
    }
    const excludes: string[] = entry.exclude.map((x: string) => x.replace(/\/+$/, ""));
    for (const path of pack.files.keys() as Iterable<string>) {
      const x = path === "pack.json" ? undefined : excludes.find((x) => path === x || path.startsWith(x + "/"));
      if (x !== undefined) {
        out.push({ severity: "block", pack: pack.name, path, evidence: `under the locked exclude ${x}`, idBytes: `exclude\0${x}` });
      }
    }
    const actual = treeHash(pack.files);
    if (actual !== entry.tree) {
      out.push({
        severity: "block", pack: pack.name, path: ".",
        evidence: `tree ${short(actual)}... differs from locked ${short(String(entry.tree))}...`,
        idBytes: `${actual}\0${entry.tree}`,
      });
    }
    const port = entry.port;
    if (port && port.tree !== port.reviewed_tree) {
      out.push({
        severity: "block", pack: pack.name, path: ".",
        evidence: `E_PORT_STALE ${pack.name}: port sources ${short(port.tree)}... are not reviewed${port.reviewed_tree ? ` (reviewed ${short(port.reviewed_tree)}...)` : ""}; re-port, then rig pin set ${pack.name} --ported`,
        idBytes: `port\0${port.tree}\0${port.reviewed_tree}`,
      });
    }
  }
  return out;
}

function coreFindings(world) {
  const locked = world.locks?.repo?.core?.tree;
  const core = world.packs?.get("core");
  if (!locked && !core) return [];
  if (!core) return [{ severity: "block", pack: "core", path: ".", evidence: "core pack is absent", idBytes: "absent" }];
  if (!locked) return [{ severity: "block", pack: "core", path: ".", evidence: "core seal missing from rig.lock.json", idBytes: "no seal" }];
  const actual = treeHash(core.files, { core: true });
  if (actual === locked) return [];
  return [{
    severity: "block", pack: "core", path: ".",
    evidence: `core seal broken: tree ${short(actual)}... differs from locked ${short(String(locked))}...`,
    idBytes: `${actual}\0${locked}`,
  }];
}

/** The plugin name an upstream would install under: the basename of the lock root, or of the repo when the root is ".". */
const upstreamName = (entry) => basename(entry.root === "." ? entry.repo.replace(/\/+$/, "").replace(/\.git$/, "") : entry.root);

const dirs = (p: string) => {
  try {
    return readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch {
    return [];
  }
};

const readJson = (p: string) => {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return undefined;
  }
};

const exists = (p: string) => {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
};

/** enabledPlugins[id] of the first settings file that sets it: true, false, or undefined when none does. */
function enabledIn(files: string[], id: string): boolean | undefined {
  for (const f of files) {
    const v = readJson(f)?.enabledPlugins?.[id];
    if (typeof v === "boolean") return v;
  }
  return undefined;
}

/** One record per install entry of installed_plugins.json, with the enabledPlugins value that applies to its scope. */
function claudePlugins(home: string) {
  const plugins = readJson(join(home, ".claude/plugins/installed_plugins.json"))?.plugins;
  if (!plugins || typeof plugins !== "object") return [];
  const user = join(home, ".claude/settings.json");
  const out = [];
  for (const id of Object.keys(plugins).sort()) {
    const installs = Array.isArray(plugins[id]) ? plugins[id] : [];
    for (const i of installs) {
      const scope = typeof i?.scope === "string" ? i.scope : "user";
      const project = scope !== "user" && typeof i?.projectPath === "string" ? i.projectPath : null;
      const settings = project === null ? [user]
        : [...(scope === "local" ? [join(project, ".claude/settings.local.json")] : []), join(project, ".claude/settings.json"), user];
      out.push({ id, name: id.split("@")[0], scope, project, enabled: enabledIn(settings, id) });
    }
  }
  return out;
}

function cursorPlugins(home: string) {
  const root = join(home, ".cursor/plugins");
  const cached = dirs(join(root, "cache")).flatMap((m) => dirs(join(root, "cache", m)).map((name) => ({ name, dir: `~/.cursor/plugins/cache/${m}/${name}` })));
  return [...cached, ...dirs(join(root, "local")).map((name) => ({ name, dir: `~/.cursor/plugins/local/${name}` }))];
}

/** One record per ~/.codex/plugins/cache/<marketplace>/<name> dir that config.toml lists as `[plugins."<name>@<marketplace>"]`, with its `enabled` flag. A cache dir with no such table is not installed in Codex. */
function codexPlugins(home: string) {
  const root = join(home, ".codex/plugins/cache");
  let config = "";
  try {
    config = readFileSync(join(home, ".codex/config.toml"), "utf8");
  } catch {}
  const state = (id: string) => {
    const quoted = `"${id}"`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const header = new RegExp(`^[ \\t]*\\[[ \\t]*plugins\\.${quoted}[ \\t]*\\]`, "m").exec(config);
    if (!header) return undefined;
    const table = config.slice(header.index + header[0].length).split(/^[ \t]*\[/m)[0];
    return !/^\s*enabled\s*=\s*false\b/m.test(table);
  };
  return dirs(root).flatMap((m) => dirs(join(root, m)).flatMap((name) => {
    const enabled = state(`${name}@${m}`);
    return enabled === undefined ? [] : [{ name, id: `${name}@${m}`, dir: `~/.codex/plugins/cache/${m}/${name}`, enabled }];
  }));
}

/** The plugins of ~/.omp/plugins/omp-plugins.lock.json, by npm package name, with their enabled flag. */
function ompPlugins(home: string) {
  const plugins = readJson(join(home, ".omp/plugins/omp-plugins.lock.json"))?.plugins;
  if (!plugins || typeof plugins !== "object") return [];
  return Object.keys(plugins).sort().map((pkg) => ({ pkg, enabled: plugins[pkg]?.enabled !== false }));
}

/** The seeded upstream an npm package ships: its unscoped name equals the upstream name or ends in -<name>, as in pi-pstack. */
const ompUpstream = (pkg: string, seeded: Map<string, string>) => {
  const base = pkg.replace(/^@[^/]+\//, "");
  return [...seeded.keys()].find((n) => base === n || base.endsWith(`-${n}`));
};

/** The skill names that a pack of this config excludes as `skills/<x>` or adopts from `skills/<x>/`, with the names it blocks. */
function leftOut(pack: Pack, entry: PackLock) {
  const names = new Set<string>();
  for (const x of entry?.exclude ?? []) {
    const m = /^skills\/([^/]+)\/?$/.exec(x);
    if (m) names.add(m[1]);
  }
  for (const { from } of Object.values((pack.manifest.mode?.adopt ?? {}) as Record<string, { from: string }>)) {
    const m = /^skills\/([^/]+)\//.exec(from);
    if (m) names.add(m[1]);
  }
  return { names, block: new Set<string>(pack.manifest.foreign_block ?? []) };
}

/** Paths that rig renders this run or recorded as owned: a skill dir with one of them is rig's. */
function rigPaths(world: World, desired: Desired | undefined) {
  const out = new Set<string>(desired?.entries.keys() ?? []);
  const entries = world.env.state ? readJson(join(world.env.state, "installed.json"))?.entries : undefined;
  for (const [p, e] of Object.entries(entries ?? {}) as [string, { kind?: string }][]) {
    if (e?.kind === "owned") out.add(p.startsWith("~/") ? join(world.env.home, p.slice(2)) : p);
  }
  return out;
}

/** Each skill read-set dir of a non-plugin entry, with the harnesses that read it. */
function readDirs(world: World) {
  const out = new Map<string, string[]>();
  for (const [h, t] of world.targets ?? []) {
    for (const d of t.reads.skills) if (!d.plugin) out.set(d.path, [...(out.get(d.path) ?? []), h]);
  }
  return out;
}

/**
 * E_FOREIGN_INSTALL: an install of an upstream that a pack of this config seeds, made outside rig. That is a Claude Code,
 * Cursor, Codex or omp plugin, a clone or link with the upstream name in a skill read-set dir, or an unmanaged skill dir with a
 * name that the pack excludes or adopts. rig never deletes it. A disabled plugin and a left-out name that the pack does not
 * list in `foreign_block` warn; the rest block.
 */
function foreignFindings(world: World, desired: Desired | undefined) {
  const home = world.env?.home;
  const seeded = new Map<string, string>();
  const packs: { pack: Pack; entry: PackLock }[] = [];
  for (const pack of world.packs?.values() ?? []) {
    const entry: PackLock | undefined = pack.name === "core" ? undefined : lockOf(world, pack.root)?.packs?.[pack.name];
    if (!entry?.repo) continue;
    seeded.set(upstreamName(entry), pack.name);
    packs.push({ pack, entry });
  }
  if (!home || seeded.size === 0) return [];
  const out: object[] = [];
  const finding = (severity: string, pack: string, path: string, name: string, where: string, why: string, remove: string) => out.push({
    severity, pack, path,
    evidence: `E_FOREIGN_INSTALL ${name}: ${where}, and ${why}; rig never deletes what it does not own, so ${remove}`,
    idBytes: `foreign\0${path}\0${where}`,
  });
  const plugin = (harness: string, name: string, where: string, remove: string, enabled = true) =>
    finding(enabled ? "block" : "warn", "*", `harness:${harness}`, name, where, `pack ${seeded.get(name)} seeds the same upstream`, remove);

  for (const p of claudePlugins(home)) {
    if (!seeded.has(p.name)) continue;
    const at = p.project === null ? `scope ${p.scope}` : `scope ${p.scope} in ${p.project}`;
    const off = p.enabled === false ? " but not enabled" : "";
    plugin("claude", p.name, `Claude Code has the plugin ${p.id} installed (${at})${off}`, `run claude plugin uninstall ${p.id} --scope ${p.scope}${p.project === null ? "" : ` in ${p.project}`}`, p.enabled !== false);
  }
  for (const p of cursorPlugins(home)) {
    if (seeded.has(p.name)) plugin("cursor", p.name, `Cursor has the plugin ${p.name} in ${p.dir}`, `remove it in Cursor, or delete ${p.dir} by hand (cursor-agent has no plugin uninstall command)`);
  }
  for (const p of codexPlugins(home)) {
    if (seeded.has(p.name)) plugin("codex", p.name, `Codex has the plugin ${p.id} in ${p.dir}${p.enabled ? "" : " but not enabled"}`, `run codex plugin remove ${p.id}`, p.enabled);
  }
  for (const p of ompPlugins(home)) {
    const name = ompUpstream(p.pkg, seeded);
    if (name) plugin("omp", name, `omp has the plugin ${p.pkg} in ~/.omp/plugins/omp-plugins.lock.json${p.enabled ? "" : " but not enabled"}`, `run omp plugin uninstall ${p.pkg}`, p.enabled);
  }

  const owned = rigPaths(world, desired);
  const expand = (d: string) => (d.startsWith("~/") ? join(home, d.slice(2)) : d);
  const remove = (tilde: string) => `move or delete ${tilde} by hand`;
  for (const [dir, readers] of readDirs(world)) {
    const seen = (name: string) => exists(join(expand(dir), name)) && !owned.has(join(expand(dir), name, "SKILL.md"));
    const by = `read by ${readers.join(", ")}`;
    for (const [name, pack] of seeded) {
      const tilde = `${dir}/${name}`;
      if (seen(name)) finding("block", pack, tilde, name, `${tilde} is a clone or link of the upstream, ${by}`, `pack ${pack} seeds the same upstream`, remove(tilde));
    }
    for (const { pack, entry } of packs) {
      const { names, block } = leftOut(pack, entry);
      for (const name of [...names].sort()) {
        const tilde = `${dir}/${name}`;
        if (!seen(name)) continue;
        const why = block.has(name) ? `pack ${pack.name} leaves skills/${name} out and lists it in foreign_block, because a second copy competes with the seed`
          : `pack ${pack.name} leaves skills/${name} out of the seed`;
        finding(block.has(name) ? "block" : "warn", pack.name, tilde, name, `${tilde} is a skill dir that rig does not manage, ${by}`, why, remove(tilde));
      }
    }
  }
  return out;
}

export function runPin(ctx: { world: World; desired?: Desired }) {
  return [...coreFindings(ctx.world), ...packFindings(ctx.world), ...foreignFindings(ctx.world, ctx.desired)];
}
