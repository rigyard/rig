// Hand-built World, Stack and Desired values for gate tests. Only the fields the gate reads exist.

export const HOME = "/home/test";

const enc = (v) => (typeof v === "string" ? Buffer.from(v, "utf8") : v);

/** @param {string} name @param {Record<string, string | Uint8Array | {bytes: string | Uint8Array, mode: number}>} files */
export function pack(name, files = {}, opts = {}) {
  const map = new Map();
  for (const [path, v] of Object.entries(files)) {
    const f = v && typeof v === "object" && "mode" in v ? v : { bytes: v, mode: 0o644 };
    map.set(path, { bytes: enc(f.bytes), mode: f.mode });
  }
  return {
    name,
    root: opts.root ?? "repo",
    manifest: { schema: 1, name, scopes: ["machine-hidden"], license: "license" in opts ? opts.license : "MIT", source: opts.source ?? null, units: {} },
    files: map,
  };
}

/** A pack with one harmless skill. */
export const goodPack = (name = "good", extra = {}, opts = {}) =>
  pack(name, { "skills/hello/SKILL.md": "# Hello\n\nSay hello.\n", ...extra }, opts);

export function world({ packs = [], acks = [], vars = {}, private_terms = [], pins = [], locks, facts, targets, providers, osv, now = new Date() } = {}) {
  return {
    now,
    env: { home: HOME, state: `${HOME}/.local/state/rig`, data: `${HOME}/.local/share/rig`, test: true },
    config: { schema: 1, pins, private_terms },
    packs: new Map(packs.map((p) => [p.name, p])),
    targets: new Map(Object.entries(targets ?? {})),
    providers: new Map(Object.entries(providers ?? {})),
    locks: locks ?? { repo: { schema: 1, core: { tree: "", candidate: null }, packs: {}, pins: {} }, overlay: null },
    acks,
    facts: new Map(Object.entries(facts ?? {})),
    osv: new Map(Object.entries(osv ?? {})),
    vars,
  };
}

export const stack = ({ providers = [] } = {}) => ({ units: [], slots: {}, providers, errors: [] });

/** @param {Record<string, {unit: string, text: string}>} owned  absolute path -> rendered text */
export function desired(owned = {}) {
  const entries = new Map();
  for (const [path, { unit, text }] of Object.entries(owned)) {
    entries.set(path, { kind: "owned", path, bytes: enc(text), mode: 0o644, unit });
  }
  return { entries, errors: [], info: [] };
}

export const ack = (f, extra = {}) => ({ id: f.id, check: f.check, pack: f.pack, path: f.path, reason: "reviewed by hand", expires: "2999-12-31", ...extra });

export const lockWith = ({ core = null, packs = {}, pins = {} } = {}) => ({
  repo: { schema: 1, core: { tree: core ?? "", candidate: null }, packs, pins },
  overlay: null,
});
