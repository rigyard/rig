// exec: anything in a pack that can run or ask the harness to run something. One finding per file.
import { createHash } from "node:crypto";
import { decode } from "./ctx.mjs";

const SCRIPT_EXT = new Set([
  "sh", "bash", "zsh", "fish", "ksh", "csh", "py", "pyw", "rb", "pl", "php", "lua", "js", "mjs", "cjs", "ts", "mts", "cts",
  "ps1", "psm1", "bat", "cmd", "vbs", "command", "applescript", "scpt", "jar", "so", "dylib", "dll", "exe",
]);

const MAGIC = [
  ["ELF binary", [0x7f, 0x45, 0x4c, 0x46]],
  ["Mach-O binary", [0xfe, 0xed, 0xfa, 0xce]],
  ["Mach-O binary", [0xfe, 0xed, 0xfa, 0xcf]],
  ["Mach-O binary", [0xce, 0xfa, 0xed, 0xfe]],
  ["Mach-O binary", [0xcf, 0xfa, 0xed, 0xfe]],
  ["Mach-O or Java class", [0xca, 0xfe, 0xba, 0xbe]],
  ["PE binary", [0x4d, 0x5a]],
  ["WebAssembly binary", [0x00, 0x61, 0x73, 0x6d]],
  ["zip archive", [0x50, 0x4b, 0x03, 0x04]],
  ["gzip archive", [0x1f, 0x8b]],
];

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

const startsWith = (bytes, magic) => magic.every((b, i) => bytes[i] === b);

/** @param {Uint8Array} bytes */
function packageScripts(bytes) {
  try {
    const scripts = JSON.parse(decode(bytes))?.scripts;
    return scripts && typeof scripts === "object" ? Object.keys(scripts) : [];
  } catch {
    return [];
  }
}

/** @param {{path: string, bytes: Uint8Array, mode: number}} f @returns {string[]} */
export function execReasons(f) {
  const reasons = [];
  const base = f.path.split("/").pop();
  if ((f.mode & S_IFMT) === S_IFLNK) reasons.push("symlink");
  if ((f.mode & 0o111) !== 0 && (f.mode & S_IFMT) !== S_IFLNK) reasons.push("exec bit");
  if (f.bytes[0] === 0x23 && f.bytes[1] === 0x21) reasons.push("shebang");
  const dot = base.lastIndexOf(".");
  if (dot > 0 && SCRIPT_EXT.has(base.slice(dot + 1).toLowerCase())) reasons.push("script extension");
  const magic = MAGIC.find(([, m]) => startsWith(f.bytes, m));
  if (magic) reasons.push(`binary magic (${magic[0]})`);
  if (base === "hooks.json") reasons.push("hooks.json");
  if (base === ".mcp.json") reasons.push(".mcp.json");
  if (base === "package.json") {
    const names = packageScripts(f.bytes);
    if (names.length) reasons.push(`package.json scripts (${names.join(", ")})`);
  }
  return reasons;
}

/** @param {object} ctx */
export function runExec(ctx) {
  const out = [];
  for (const s of ctx.sources) {
    const reasons = execReasons(s);
    if (reasons.length === 0) continue;
    const digest = createHash("sha256").update(s.bytes).digest("hex").slice(0, 12);
    out.push({
      severity: "block",
      pack: s.pack,
      path: s.path,
      evidence: `${reasons.join(", ")}; mode ${(s.mode & 0o7777).toString(8)}, sha256 ${digest}`,
      idBytes: Buffer.concat([Buffer.from(`${(s.mode & S_IFMT).toString(8)}:${(s.mode & 0o7777).toString(8)}\0`), s.bytes]),
    });
  }
  return out;
}
