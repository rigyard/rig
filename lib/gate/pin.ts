// pin: lock tree and core seal against the bytes in hand, installed plugin commit against the lock.
// Never ackable. Only the auto-update and the unlocked-entry rows are warnings.
import { treeHash } from "../tree.ts";

/** A parsed facts file declared by a target record, looked up by its home-relative key. */
function fact(world, name) {
  for (const target of world.targets?.values() ?? []) {
    const declared = target.facts?.[name];
    if (!declared) continue;
    for (const key of [declared, declared.replace(/^~\//, ""), world.env?.home && declared.replace(/^~/, world.env.home)]) {
      if (key && world.facts?.has(key)) return { path: declared, value: world.facts.get(key) };
    }
  }
  return null;
}

const lockOf = (world, root) => (root === "overlay" ? world.locks?.overlay : world.locks?.repo);
const short = (h) => h.slice(0, 19);

function packFindings(world) {
  const out = [];
  for (const pack of world.packs?.values() ?? []) {
    if (pack.name === "core") continue;
    const entry = lockOf(world, pack.root)?.packs?.[pack.name];
    if (!entry) {
      if (pack.manifest?.source) {
        out.push({ severity: "block", pack: pack.name, path: ".", evidence: "vendored pack has no rig.lock.json entry", idBytes: "no lock entry" });
      }
      continue;
    }
    const actual = treeHash(pack.files);
    if (actual !== entry.tree) {
      out.push({
        severity: "block", pack: pack.name, path: ".",
        evidence: `tree ${short(actual)}... differs from locked ${short(String(entry.tree))}...`,
        idBytes: `${actual}\0${entry.tree}`,
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

function pinFindings(world) {
  const out = [];
  const installed = fact(world, "installed_plugins");
  const markets = fact(world, "marketplaces");
  for (const name of world.config?.pins ?? []) {
    const lock = world.locks?.repo?.pins?.[name] ?? world.locks?.overlay?.pins?.[name];
    const current = lock?.current;
    if (!current) {
      out.push({ severity: "block", pack: name, path: "rig.lock.json", evidence: `pin ${name} has no locked current version`, idBytes: "no current" });
      continue;
    }
    const plugin = lock.plugin ?? world.providers?.get(name)?.pin?.plugin;
    if (!plugin) continue;
    const entries = installed?.value?.plugins?.[plugin];
    for (const e of Array.isArray(entries) ? entries : []) {
      const commit = e.gitCommitSha ?? e.sha;
      const same = commit ? commit.startsWith(current.sha) || current.sha.startsWith(commit) : e.version === current.version;
      if (!commit && !e.version) continue;
      if (!same) {
        out.push({
          severity: "block", pack: name, path: installed.path,
          evidence: `installed ${plugin} ${commit ?? e.version} differs from locked ${commit ? current.sha : current.version}`,
          idBytes: `${plugin}\0${commit ?? e.version}\0${current.sha}`,
        });
      }
    }
    const market = plugin.includes("@") ? plugin.slice(plugin.lastIndexOf("@") + 1) : null;
    if (market && markets?.value?.[market]?.autoUpdate === true) {
      out.push({
        severity: "warn", pack: name, path: markets.path,
        evidence: `marketplace ${market} has auto-update on and serves pinned plugin ${plugin}`,
        idBytes: `autoUpdate\0${market}\0${plugin}`,
      });
    }
  }
  return out;
}

/**
 * A workflow entry that reads the plugin cache renders its path from the locked version (lib/targets/providers.ts).
 * With no locked version, /craft tells the user to run `rig pin check`, and this warns. A name in rig.json `pins`
 * already blocks in pinFindings, so it is skipped here.
 */
function entryFindings(world) {
  const out = [];
  const pins = new Set(world.config?.pins ?? []);
  for (const p of world.providers?.values() ?? []) {
    if (p.kind !== "workflow" || pins.has(p.name)) continue;
    const lock = world.locks?.repo?.pins?.[p.name] ?? world.locks?.overlay?.pins?.[p.name];
    if (lock?.current?.version) continue;
    for (const h of world.config?.harnesses ?? []) {
      if (!String(p.entry?.[h]?.read ?? "").startsWith("plugin-cache:")) continue;
      out.push({
        severity: "warn", pack: p.name, path: "rig.lock.json",
        evidence: `/craft on ${h} reads ${p.name} from the plugin cache, and ${p.name} has no locked version: run rig pin check ${p.name}`,
        idBytes: `no locked entry version\0${h}`,
      });
    }
  }
  return out;
}

export function runPin(ctx: object) {
  return [...coreFindings(ctx.world), ...packFindings(ctx.world), ...pinFindings(ctx.world), ...entryFindings(ctx.world)];
}
