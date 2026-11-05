// Hand-built World, Stack and Desired values for gate tests. Only the fields the gate reads exist.

import { treeHash } from "../lib/tree.ts";

export const HOME = "/home/test";

const enc = (v) => (typeof v === "string" ? Buffer.from(v, "utf8") : v);

export function pack(name: string, files: Record<string, string | Uint8Array | {bytes: string | Uint8Array, mode: number}> = {}, opts = {}) {
  const map = new Map();
  for (const [path, v] of Object.entries(files)) {
    const f = v && typeof v === "object" && "mode" in v ? v : { bytes: v, mode: 0o644 };
    map.set(path, { bytes: enc(f.bytes), mode: f.mode });
  }
  return {
    name,
    root: opts.root ?? "repo",
    manifest: { schema: 2, name, scopes: ["machine-hidden"], license: "license" in opts ? opts.license : "MIT", units: {}, ...(opts.telemetry ? { telemetry: opts.telemetry } : {}) },
    files: map,
  };
}

/** A pack with one harmless skill. */
export const goodPack = (name = "good", extra = {}, opts = {}) =>
  pack(name, { "skills/hello/SKILL.md": "# Hello\n\nSay hello.\n", ...extra }, opts);

const lockEntry = (p) => ({ repo: "x", sha: "0".repeat(40), root: ".", paths: [], exclude: [], license: "MIT", tree: treeHash(p.files), port: null, candidate: null });
const lockedPacks = (packs, root) => Object.fromEntries(packs.filter((p) => p.name !== "core" && (p.root ?? "repo") === root).map((p) => [p.name, lockEntry(p)]));

export function world({ packs = [], acks = [], vars = {}, private_terms = [], locks, targets, osv, now = new Date() } = {}) {
  return {
    now,
    env: { home: HOME, state: `${HOME}/.local/state/rig`, data: `${HOME}/.local/share/rig`, test: true },
    config: { schema: 2, private_terms },
    packs: new Map(packs.map((p) => [p.name, p])),
    targets: new Map(Object.entries(targets ?? {})),
    locks: locks ?? { repo: { schema: 2, core: { tree: "", candidate: null }, packs: lockedPacks(packs, "repo") }, overlay: { schema: 2, core: { tree: "", candidate: null }, packs: lockedPacks(packs, "overlay") } },
    acks,
    osv: new Map(Object.entries(osv ?? {})),
    vars,
  };
}

export const stack = () => ({ units: [], errors: [] });

/** @param owned  absolute path -> rendered text */
export function desired(owned: Record<string, {unit: string, text: string}> = {}) {
  const entries = new Map();
  for (const [path, { unit, text }] of Object.entries(owned)) {
    entries.set(path, { kind: "owned", path, bytes: enc(text), mode: 0o644, unit });
  }
  return { entries, errors: [], info: [] };
}

export const ack = (f, extra = {}) => ({ id: f.id, check: f.check, pack: f.pack, path: f.path, reason: "reviewed by hand", expires: "2999-12-31", ...extra });

export const lockWith = ({ core = null, packs = {} } = {}) => ({
  repo: { schema: 2, core: { tree: core ?? "", candidate: null }, packs },
  overlay: null,
});
