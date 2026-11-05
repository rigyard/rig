// mode: a unit name in the hub or a playbook of the mode skill that no kept unit has (E_MODE_NAME, block, ackable).
import { decode } from "./ctx.ts";

/** Names that the vendored mode files may use with no kept unit: harness built-ins and the hub's own names. */
const ALLOW = new Set(["loop", "create-skill", "poteto-mode", "setup-pstack"]);
const BARE = new Set(["control-cli", "control-ui"]);
const NAME = /^[A-Za-z0-9-]+$/;
const BOLD = /\*\*([^*\n]+)\*\* skill\b/g;
const TOKEN = /[^\s`]+/g;
const LEADING = /^[(["'*_]+/;
const TRAILING = /[.,;:!?)\]}'"*_]+$/;
/** Top-level dirs of a Unix root: a bare `/tmp` is a path, not a name. A token with a second `/` fails NAME. */
const ROOT_DIRS = new Set(["bin", "dev", "etc", "home", "opt", "private", "tmp", "usr", "var"]);

type ModeCtx = {stack?: {units?: {name: string}[], mode?: {files: Map<string, {bytes: Uint8Array, pack: string, from: string}>}}};

function modeNames(text: string): Map<string, number> {
  const out = new Map<string, number>();
  const add = (name: string, index: number) => {
    if (!out.has(name)) out.set(name, text.slice(0, index).split("\n").length);
  };
  for (const m of text.matchAll(BOLD)) if (NAME.test(m[1])) add(m[1], m.index);
  for (const m of text.matchAll(TOKEN)) {
    const token = m[0].replace(LEADING, "").replace(TRAILING, "");
    if (token.startsWith("/") && NAME.test(token.slice(1)) && !ROOT_DIRS.has(token.slice(1))) add(token.slice(1), m.index);
    else if (BARE.has(token)) add(token, m.index);
  }
  return out;
}

export function runModeNames(input: object) {
  const ctx = input as ModeCtx;
  const files = ctx.stack?.mode?.files;
  if (!files) return [];
  const kept = new Set((ctx.stack?.units ?? []).map((u) => u.name));
  const out = [];
  for (const [install, f] of files) {
    if (install !== "hub.md" && !install.startsWith("playbooks/")) continue;
    for (const [name, line] of modeNames(decode(f.bytes))) {
      if (kept.has(name) || ALLOW.has(name)) continue;
      out.push({
        severity: "block", pack: f.pack, path: f.from,
        evidence: `E_MODE_NAME ${name} at line ${line}: no kept unit has this name; vendor the unit, or ack the name`,
        idBytes: `name\0${name}`,
      });
    }
  }
  return out;
}
