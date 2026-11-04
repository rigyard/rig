// cve: a pack with a dependency manifest needs a cached OSV result for those exact bytes. Reads the cache from
// world.osv; never touches the network or the disk. refreshOsv is the only writer of cache/osv/<ecosystem>.json.
//
// Cache shape, one file per ecosystem: {"schema": 1, "results": {"sha256:<hex of manifest bytes>": {"advisories": [{"id": "...", "severity": "..."}]}}}.
// Keying by the manifest digest means a changed lockfile misses the cache and blocks until the next refresh.
import { createHash } from "node:crypto";
import { visible } from "./text.mjs";

/** Manifest file names by OSV ecosystem. */
const MANIFESTS = [
  [/^(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/, "npm"],
  [/^(requirements.*\.txt|poetry\.lock)$/, "PyPI"],
  [/^go\.sum$/, "Go"],
  [/^Cargo\.lock$/, "crates.io"],
  [/^Gemfile\.lock$/, "RubyGems"],
];

const BLOCKING = new Set(["high", "critical"]);
const LOWER = new Set(["moderate", "medium", "low"]);

/** @param {string} path @returns {string | null} the OSV ecosystem, or null when the file is no manifest */
export function ecosystemOf(path) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  for (const [re, eco] of MANIFESTS) if (re.test(name)) return eco;
  return null;
}

const OPEN_QUESTION = "no cached result blocks for now; block versus warn is an open question (design doc, section 10)";

/** @param {object} ctx */
export function runCve(ctx) {
  const out = [];
  for (const s of ctx.sources) {
    const eco = ecosystemOf(s.path);
    if (eco === null) continue;
    const digest = `sha256:${createHash("sha256").update(s.bytes).digest("hex")}`;
    const entry = ctx.world.osv?.get(eco)?.results?.[digest];
    const advisories = entry?.advisories;
    if (!Array.isArray(advisories)) {
      const why = ctx.world.osv?.has(eco) ? `no cached OSV result for these bytes in cache/osv/${eco}.json` : `no cached OSV result: cache/osv/${eco}.json is absent`;
      out.push({
        severity: "block", pack: s.pack, path: s.path,
        evidence: `${why}. Run rig pack add or rig pin check to refresh it (${OPEN_QUESTION})`,
        idBytes: `${eco}\0${digest}\0no cache`,
      });
      continue;
    }
    for (const a of advisories) {
      const id = visible(String(a?.id ?? "unknown").slice(0, 80));
      const level = String(a?.severity ?? "").toLowerCase();
      const severity = LOWER.has(level) ? "warn" : "block";
      const shown = BLOCKING.has(level) || LOWER.has(level) ? level : `unrecognized (${visible(JSON.stringify(a?.severity ?? null).slice(0, 40))}), treated as high`;
      out.push({
        severity, pack: s.pack, path: s.path,
        evidence: `${id}: ${shown} advisory for ${eco} dependencies`,
        idBytes: `${eco}\0${digest}\0${id}`,
      });
    }
  }
  return out;
}
