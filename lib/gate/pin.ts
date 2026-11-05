// pin: lock tree and core seal against the bytes in hand. Never ackable.
import { treeHash } from "../tree.ts";

const lockOf = (world, root) => (root === "overlay" ? world.locks?.overlay : world.locks?.repo);
const short = (h) => h.slice(0, 19);

function packFindings(world) {
  const out = [];
  for (const pack of world.packs?.values() ?? []) {
    if (pack.name === "core") continue;
    const entry = lockOf(world, pack.root)?.packs?.[pack.name];
    if (!entry) {
      out.push({
        severity: "warn", pack: pack.name, path: ".",
        evidence: `pack ${pack.name} has no lock entry; rig pack add writes the entry`,
        idBytes: "no lock entry",
      });
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

export function runPin(ctx: object) {
  return [...coreFindings(ctx.world), ...packFindings(ctx.world)];
}
