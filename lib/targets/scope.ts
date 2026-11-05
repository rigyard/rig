// lib/targets/scope.ts — internal to targets. Project delivery of `project` and `hybrid` packs (doc section 11,
// decision 0017). Pure: paths, plugin layout, manifests and the delivery facts that apply and doctor print.
//
// Claude Code: a pack renders as a local-path plugin inside the rig-owned marketplace under the data root
// (`channels.plugin.dir`, `$XDG_DATA_HOME` is the parent of world.env.data). rig writes no `enabledPlugins` entry and
// calls no `claude` command: apply prints the registration commands and the `enable_file` snippet.
// Codex, omp and Cursor hold no project channel: the project part is absent there, and doctor --project prints the
// repository paths that would deliver it, for the user to commit. rig writes nothing into a repository.

import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { treeHash } from "../tree.ts";
import type { Stack, Unit } from "../stack.ts";
import type { TargetRecord, World } from "../world.ts";

export type PluginFile = {path: string, mode: number, bytes: Uint8Array};
/** One rendered plugin: its files relative to the plugin dir. Keyed by the "~/"-relative plugin dir. */
export type Plugin = {pack: string, harness: string, marketplace: {name: string, dir: string}, files: PluginFile[]};
export type Delivery = {
  pack: string;
  scope: "project"|"hybrid";
  harness: string;
  /** absolute project dirs from rig.json */
  projects: string[];
  /** the Claude plugin; null on a harness with no project channel, or when no unit has a plugin component */
  plugin: {id: string, marketplace: string, dir: string, enable_file: string} | null;
  /** repository paths that would deliver the pack on a harness with no project channel, and their source */
  commit: {path: string, from: string}[];
  /** unit ids with no plugin component or no known repository path on this harness */
  absent: string[];
};

const DATA_VAR = "$XDG_DATA_HOME";
const encoder = new TextEncoder();

/** The project-relative dir of a skill on a harness with no project channel. Probe (f) Codex, (e) omp, (b) Cursor. */
const REPO_SKILL_DIRS: Record<string, string> = { codex: ".agents/skills", omp: ".omp/skills", cursor: ".cursor/skills" };

export const packOf = (unit: Unit): string => unit.id.split("/")[0];
const isProjectScope = (unit: Unit): boolean => unit.scope === "project" || unit.scope === "hybrid";

/** The info line of a project part that a harness cannot deliver: one per pack and harness. */
export const absentLine = (harness: string, pack: string): string =>
  `scope ${harness} ${pack}: project part absent: commit its files (doctor --project)`;

const inside = (child: string, parent: string): boolean => {
  const r = relative(parent, child);
  return r === "" || (r !== ".." && !r.startsWith(`..${sep}`) && !isAbsolute(r));
};

/**
 * The marketplace of a record's project channel: its name and its dir, "~/"-relative. The dir resolves
 * `$XDG_DATA_HOME` to the parent of the data root and must lie inside HOME.
 */
export function marketplaceOf(target: TargetRecord, home: string, data: string): {name: string, dir: string} | {error: string} {
  const ps = target.project_scope;
  const channel = ps ? target.channels?.[ps.channel] : undefined;
  if (!ps || !channel) return { error: `targets/${target.name}.json project_scope names channel ${ps?.channel ?? "none"}, which channels does not declare` };
  const raw = channel.dir.startsWith(`${DATA_VAR}/`) ? join(dirname(data), channel.dir.slice(DATA_VAR.length + 1))
    : channel.dir.startsWith("~/") ? join(home, channel.dir.slice(2)) : channel.dir;
  const abs = resolve(raw);
  if (!isAbsolute(raw) || !inside(abs, home) || abs === home) return { error: `targets/${target.name}.json channels.${ps.channel}.dir ${channel.dir} does not resolve inside HOME` };
  return { name: channel.marketplace, dir: `~/${relative(home, abs).split(sep).join("/")}` };
}

/** The plugin dir of one pack inside a marketplace dir. */
export const pluginDir = (marketplace: string, pack: string): string => `${marketplace}/plugins/${pack}`;

/** Where a unit file lands inside a Claude plugin: the plugin components skills/, commands/, agents/. Null: none. */
export function pluginPath(unit: Unit, file: string): string | null {
  if (unit.type === "skill") return `skills/${unit.name}/${file}`;
  if (unit.type === "command") return `commands/${file}`;
  if (unit.type === "agent") return `agents/${file}`;
  return null;
}

/**
 * The manifests of every rendered plugin: one `.claude-plugin/plugin.json` per plugin and one
 * `.claude-plugin/marketplace.json` per marketplace, plugins sorted by name. A plugin's version is the tree hash of
 * its files, so a changed pack is a new version to `claude plugin update`.
 * @returns "~/"-relative path, bytes, the unit id and the harness for the plan report
 */
export function manifests(plugins: Map<string, Plugin>): {path: string, bytes: Uint8Array, unit: string, harness: string}[] {
  const out: {path: string, bytes: Uint8Array, unit: string, harness: string}[] = [];
  const markets = new Map<string, {name: string, harness: string, plugins: string[]}>();
  for (const [dir, p] of [...plugins].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const version = `0.0.0-${treeHash(p.files, { core: true }).slice("sha256:".length, "sha256:".length + 12)}`;
    const plugin = { name: p.pack, version, description: `rig pack ${p.pack}, project scope` };
    out.push({ path: `${dir}/.claude-plugin/plugin.json`, bytes: json(plugin), unit: `${p.pack}/plugin`, harness: p.harness });
    const m = markets.get(p.marketplace.dir) ?? { name: p.marketplace.name, harness: p.harness, plugins: [] };
    m.plugins.push(p.pack);
    markets.set(p.marketplace.dir, m);
  }
  for (const [dir, m] of markets) {
    const value = {
      name: m.name,
      owner: { name: "rig" },
      description: "rig-owned local marketplace: one plugin per project-scope pack",
      plugins: m.plugins.map((name) => ({ name, source: `./plugins/${name}` })),
    };
    out.push({ path: `${dir}/.claude-plugin/marketplace.json`, bytes: json(value), unit: "core/marketplace", harness: m.harness });
  }
  return out;
}

const json = (v: unknown): Uint8Array => encoder.encode(`${JSON.stringify(v, null, 2)}\n`);

const expandHome = (p: string, home: string): string => resolve(p.startsWith("~/") ? join(home, p.slice(2)) : p);

/** The source of a unit inside its pack, for the doctor line: the skill dir or the unit file. */
function sourceOf(world: World, unit: Unit): string {
  const pack = world.packs.get(packOf(unit));
  const root = pack?.root === "overlay" ? world.roots.overlay ?? world.roots.repo : world.roots.repo;
  const kind = unit.type === "skill" ? `skills/${unit.name}/` : `${unit.type}s/${[...unit.files.keys()][0] ?? `${unit.name}.md`}`;
  return join(root, "packs", packOf(unit), kind);
}

/**
 * Per pack and harness: how the project part of a `project` or `hybrid` pack reaches its listed projects. The Claude
 * plugin facts on a record with `project_scope`; the repository paths to commit on the others (skills only: the
 * project skill dirs are the probed paths; any other unit type is absent there).
 */
export function delivery(stack: Stack, world: World): Delivery[] {
  const home = world.env.home;
  const out = new Map<string, Delivery>();
  for (const unit of stack.units) {
    if (unit.id.startsWith("core/") || !isProjectScope(unit)) continue;
    const pack = packOf(unit);
    for (const h of world.config.harnesses.filter((x) => unit.harnesses.includes(x))) {
      const key = `${pack}\0${h}`;
      const target = world.targets.get(h);
      if (!target) continue;
      let d = out.get(key);
      if (!d) {
        d = { pack, scope: unit.scope as "project"|"hybrid", harness: h, projects: unit.projects.map((p) => expandHome(p, home)), plugin: null, commit: [], absent: [] };
        out.set(key, d);
      }
      if (target.project_scope) {
        const m = marketplaceOf(target, home, world.env.data);
        if ("error" in m || pluginPath(unit, "x") === null) {
          d.absent.push(unit.id);
          continue;
        }
        d.plugin ??= {
          id: `${pack}@${m.name}`,
          marketplace: expandHome(m.dir, home),
          dir: expandHome(pluginDir(m.dir, pack), home),
          enable_file: target.project_scope.enable_file,
        };
      } else if (unit.type === "skill" && REPO_SKILL_DIRS[h]) {
        d.commit.push({ path: `${REPO_SKILL_DIRS[h]}/${unit.name}/`, from: sourceOf(world, unit) });
      } else {
        d.absent.push(unit.id);
      }
    }
  }
  return [...out.values()];
}
