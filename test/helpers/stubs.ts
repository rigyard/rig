// Recording stubs for harness and tool CLIs. Test fixtures written at test time, not pack content.

import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";

/** Names a stub may take. "git" records, then runs the real git with the same argv. */
export const STUB_NAMES = ["claude", "codex", "omp", "cursor-agent", "osv-scanner", "git"];

/** Env keys a stub records. The allowlist keeps secret values out of the log. */
const ENV_KEY = /^(HOME|DO_NOT_TRACK|XDG_.*|RIG_.*)$/;

/** @param {string} name @returns {string | null} the first match on the current PATH */
function which(name) {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (dir && existsSync(join(dir, name))) return join(dir, name);
  }
  return null;
}

/**
 * Script text of one stub. Values are embedded as JSON literals, so no input becomes code.
 * @param {string} name @param {string} stdout @param {string} defaultLog @param {string | null} realGit
 */
function stubSource(name, stdout, defaultLog, realGit) {
  const lines = [
    "#!/usr/bin/env node",
    'const { appendFileSync } = require("node:fs");',
    `const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => ${ENV_KEY}.test(k)));`,
    `const line = JSON.stringify({ name: ${JSON.stringify(name)}, argv: process.argv.slice(2), cwd: process.cwd(), env });`,
    `appendFileSync(process.env.RIG_STUB_LOG || ${JSON.stringify(defaultLog)}, line + "\\n");`,
  ];
  if (realGit) {
    lines.push(
      'const { spawnSync } = require("node:child_process");',
      `const r = spawnSync(${JSON.stringify(realGit)}, process.argv.slice(2), { stdio: "inherit" });`,
      "process.exitCode = r.status ?? 1;",
    );
  } else {
    lines.push(`process.stdout.write(${JSON.stringify(stdout)});`);
  }
  return lines.join("\n") + "\n";
}

/**
 * Write executable recording stubs into a temp bin dir. Each call appends one JSON line
 * {name, argv, cwd, env} to $RIG_STUB_LOG (default: the log this helper created) and prints canned[name].
 * PATH holds the stub dir and the dir of the running node, plus the dir of the real git when git is not stubbed.
 * @param {string[]} names a subset of STUB_NAMES
 * @param {{canned?: Record<string, string>}} [opts]
 * @returns {{binDir: string, logFile: string, PATH: string, env: {PATH: string, RIG_STUB_LOG: string},
 *            log: () => {name: string, argv: string[], cwd: string, env: Record<string, string>}[], cleanup: () => void}}
 */
export function makeStubs(names, { canned = {} } = {}) {
  for (const n of names) if (!STUB_NAMES.includes(n)) throw new Error(`stubs: unknown stub name: ${n}`);
  for (const n of Object.keys(canned)) if (!names.includes(n)) throw new Error(`stubs: canned output for a name not stubbed: ${n}`);

  const root = realpathSync(mkdtempSync(join(tmpdir(), "rig-stubs-")));
  const binDir = join(root, "bin");
  const logFile = join(root, "stub-log.jsonl");
  writeFileSync(logFile, "");

  const realGit = which("git");
  if (names.includes("git") && !realGit) throw new Error("stubs: git passthrough needs a real git on PATH");

  // Stubs are extensionless CommonJS scripts. Pin the module type so no parent package.json changes it.
  writeFileSync(join(root, "package.json"), '{"type": "commonjs"}\n');
  mkdirSync(binDir);
  for (const name of names) {
    const file = join(binDir, name);
    writeFileSync(file, stubSource(name, canned[name] ?? "", logFile, name === "git" ? realGit : null), { flag: "wx" });
    chmodSync(file, 0o755);
  }

  const dirs = [binDir, dirname(process.execPath)];
  if (!names.includes("git") && realGit) dirs.push(dirname(realGit));
  const PATH = [...new Set(dirs)].join(delimiter);

  const log = () =>
    readFileSync(logFile, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));

  const cleanup = () => rmSync(root, { recursive: true, force: true });

  return { binDir, logFile, PATH, env: { PATH, RIG_STUB_LOG: logFile }, log, cleanup };
}
