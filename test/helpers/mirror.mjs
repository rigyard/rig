// Live seed kit. Copies the units of one harness from a fixture HOME into a scratch project and builds the
// headless argv per harness. Claude Code cannot log in from an isolated config dir, so it reads the units as
// project units with the normal login. omp needs no mirror: it runs with its agent dir inside the fixture HOME.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, relative, sep } from "node:path";
import { assertOutsideHomeDotDirs } from "./fixture-home.mjs";
import { realHome, runHarness } from "./live.mjs";

/** Per harness: [fixture-HOME-relative source, project-relative destination]. Two sources may share one destination dir. */
export const MIRROR_UNITS = {
  claude: [
    [".claude/commands", ".claude/commands"],
    [".claude/skills", ".claude/skills"],
    [".claude/rules", ".claude/rules"],
  ],
  codex: [
    [".codex/AGENTS.md", "AGENTS.md"],
    [".agents/skills", ".agents/skills"],
    [".codex/skills", ".agents/skills"],
  ],
  cursor: [
    [".cursor/rules", ".cursor/rules"],
    [".cursor/skills", ".cursor/skills"],
    [".cursor/commands", ".cursor/commands"],
  ],
};

/**
 * Env keys a seed run never inherits: they relocate a harness's user-level config, or (CLAUDE_CODE_PLUGIN_DIRS,
 * set inside a Claude Code session) add plugin units the fixture does not hold.
 */
const RELOCATE_ENV = ["CLAUDE_CONFIG_DIR", "CLAUDE_CODE_PLUGIN_DIRS", "CODEX_HOME", "OMP_PROFILE", "PI_PROFILE", "PI_CODING_AGENT_DIR", "COPILOT_HOME"];

/** A sentinel token no model can guess: a fixed prefix plus 12 random hex chars. @param {string} [prefix] */
export const sentinel = (prefix = "RIGSEED") => `${prefix}-${randomBytes(6).toString("hex").toUpperCase()}`;

/** realpath of p, or of its nearest existing ancestor joined with the rest, so a path not yet made resolves too. */
function resolveReal(p) {
  if (!isAbsolute(p)) throw new Error(`mirror: path must be absolute: ${p}`);
  let head = p;
  const tail = [];
  while (!existsSync(head)) {
    tail.unshift(basename(head));
    head = dirname(head);
  }
  return join(realpathSync(head), ...tail);
}

/**
 * Throw unless p lies outside the real home: not the home, not under a dot-dir of it, not anywhere inside it.
 * @param {string} p absolute @param {string} [home] the real home, injectable for tests
 */
export function assertOutsideRealHome(p, home = realHome()) {
  const abs = resolveReal(p);
  assertOutsideHomeDotDirs(abs, home);
  const rel = relative(home, abs);
  if (!(rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))) throw new Error(`mirror: refusing a path inside the real home: ${abs}`);
}

/**
 * Copy one file or tree, following symlinks. A file that already exists is an error, so two sources that share a
 * destination dir cannot overwrite each other. @param {string} from @param {string} to @param {string} rel
 * @param {string[]} written project-relative paths, appended
 */
function copyTree(from, to, rel, written) {
  const st = statSync(from);
  if (st.isDirectory()) {
    for (const name of readdirSync(from).sort()) copyTree(join(from, name), join(to, name), `${rel}/${name}`, written);
    return;
  }
  if (existsSync(to)) throw new Error(`mirror: two sources write ${rel}`);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to, constants.COPYFILE_EXCL);
  chmodSync(to, st.mode & 0o7777);
  written.push(rel);
}

/**
 * Copy the units of one harness from a fixture HOME into a scratch project. Each destination is removed first,
 * so a second mirror shows only what HOME holds now. Symlinks in HOME are copied as the files they point at.
 * @param {string} home fixture HOME @param {"claude"|"codex"|"cursor"} harness @param {string} dir scratch project
 * @param {{realHome?: string}} [opts] realHome: injectable for tests
 * @returns {string[]} project-relative files written, sorted
 */
export function mirrorProject(home, harness, dir, opts = {}) {
  const units = MIRROR_UNITS[harness];
  if (!units) throw new Error(`mirror: no project mirror for ${harness}${harness === "omp" ? "; run omp with PI_CODING_AGENT_DIR inside the fixture HOME" : ""}`);
  const real = opts.realHome ?? realHome();
  assertOutsideRealHome(home, real);
  assertOutsideRealHome(dir, real);
  const project = realpathSync(dir);
  // A symlinked dir in the project (say .claude -> ~/.claude) would send the rm and the copy outside it.
  for (const [, dest] of units) {
    const rel = relative(project, resolveReal(join(project, dest)));
    if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`mirror: ${dest} resolves outside the project ${project}`);
  }
  for (const dest of new Set(units.map(([, d]) => d))) rmSync(join(project, dest), { recursive: true, force: true });
  const written = [];
  for (const [src, dest] of units) {
    const from = join(home, src);
    if (existsSync(from)) copyTree(from, join(project, dest), dest, written);
  }
  return written.sort();
}

/**
 * Make a temp git repo outside the real home.
 * @returns {{dir: string, cleanup: () => void}}
 */
export function scratchRepo() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rig-seed-")));
  try {
    assertOutsideRealHome(dir);
    const r = spawnSync("git", ["init", "-q"], { cwd: dir, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`mirror: git init failed: ${r.stderr}`);
  } catch (err) {
    rmSync(dir, { recursive: true, force: true });
    throw err;
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * Env for an isolated omp run: HOME and PI_CODING_AGENT_DIR inside the fixture HOME, no profile.
 * @param {string} home fixture HOME @param {string} [agentDir] defaults to <home>/.omp/agent @param {NodeJS.ProcessEnv} [base]
 */
export function ompEnv(home, agentDir = join(home, ".omp", "agent"), base = process.env) {
  assertOutsideRealHome(home);
  assertOutsideRealHome(agentDir);
  const env = { ...base };
  for (const k of RELOCATE_ENV) delete env[k];
  return { ...env, HOME: home, PI_CODING_AGENT_DIR: agentDir };
}

/**
 * Headless argv per harness, from the probe (i) verdicts. omp gets its fixture HOME and agent dir, and a closed
 * stdin (runHarness ends stdin at once). The other harnesses keep the real HOME and its login.
 * The omp model defaults to $RIG_LIVE_OMP_MODEL, because the omp default model can hit a provider spending limit.
 * @param {"claude"|"omp"|"codex"|"cursor"} harness @param {string} prompt
 * @param {{dir: string, home?: string, agentDir?: string, maxTurns?: number, model?: string, pluginDir?: string, env?: NodeJS.ProcessEnv}} opts
 *        dir: the scratch project (cwd); home: the fixture HOME (omp)
 * @returns {{bin: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, input: string}}
 */
export function harnessArgv(harness, prompt, opts) {
  const { dir } = opts;
  const base = { ...(opts.env ?? process.env) };
  const model = opts.model ?? (harness === "omp" ? base.RIG_LIVE_OMP_MODEL || undefined : undefined);
  for (const k of RELOCATE_ENV) delete base[k];
  const m = (flag) => (model ? [flag, model] : []);
  const out = (bin, args, env = base) => ({ bin, args, cwd: dir, env, input: "" });
  if (harness === "claude") return out("claude", ["-p", "--max-turns", String(opts.maxTurns ?? 3), "--output-format", "json", ...m("--model"), prompt]);
  if (harness === "omp") {
    if (!opts.home) throw new Error("mirror: omp needs the fixture home");
    return out("omp", [...m("--model"), "-p", "--mode", "json", "--no-session", prompt], ompEnv(opts.home, opts.agentDir, base));
  }
  if (harness === "codex") return out("codex", ["exec", "-s", "read-only", "--ephemeral", "--ignore-user-config", "--json", ...m("-m"), "-C", dir, prompt]);
  if (harness === "cursor") {
    const plugin = opts.pluginDir ? ["--plugin-dir", opts.pluginDir] : [];
    return out("cursor-agent", ["-p", "--mode", "ask", "--trust", "--workspace", dir, "--output-format", "json", ...m("--model"), ...plugin, prompt]);
  }
  throw new Error(`mirror: unknown harness ${harness}`);
}

/**
 * Resolve a harness binary on PATH. Refuse a recording stub, so a live case cannot pass without the real CLI.
 * @param {string} name @param {string} [PATH] @returns {string} absolute path
 */
export function realBin(name, PATH = process.env.PATH ?? "") {
  for (const d of PATH.split(delimiter)) {
    if (!d || !existsSync(join(d, name))) continue;
    const abs = realpathSync(join(d, name));
    if (abs.split(sep).some((part) => part.startsWith("rig-stubs-"))) throw new Error(`mirror: ${name} on PATH is a test stub: ${abs}`);
    return abs;
  }
  throw new Error(`mirror: ${name} is not on PATH`);
}

/** Lines of JSONL output that parse, in order. @param {string} stdout */
const jsonLines = (stdout) =>
  stdout.split("\n").flatMap((l) => {
    try {
      return [JSON.parse(l)];
    } catch {
      return [];
    }
  });

/**
 * The final assistant reply of one run, or null when the harness gave none or reported an error.
 * Only the reply counts: omp echoes an expanded command in its user message, so stdout alone proves nothing.
 * @param {"claude"|"omp"|"codex"|"cursor"} harness @param {{code: number | null, stdout: string, json: unknown}} r
 */
export function replyOf(harness, r) {
  if (r.code !== 0) return null;
  if (harness === "claude" || harness === "cursor") {
    const j = /** @type {any} */ (r.json);
    return j && j.type === "result" && j.is_error === false && typeof j.result === "string" ? j.result : null;
  }
  const events = jsonLines(r.stdout);
  if (harness === "omp") {
    const last = events.filter((e) => e.type === "message_end" && e.message?.role === "assistant").at(-1)?.message;
    if (!last || last.stopReason === "error") return null;
    return last.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
  }
  if (harness === "codex") {
    if (events.some((e) => e.type === "turn.failed" || e.type === "error")) return null;
    const msgs = events.filter((e) => e.type === "item.completed" && e.item?.type === "agent_message").map((e) => e.item.text);
    return msgs.length ? msgs.join("\n") : null;
  }
  throw new Error(`mirror: unknown harness ${harness}`);
}

/**
 * Run one real harness headless and return its reply. The binary must not be a stub.
 * @param {"claude"|"omp"|"codex"|"cursor"} harness @param {string} prompt @param {Parameters<typeof harnessArgv>[2] & {timeoutMs?: number}} opts
 */
export async function runSeed(harness, prompt, opts) {
  const a = harnessArgv(harness, prompt, opts);
  const r = await runHarness({ ...a, bin: realBin(a.bin, a.env.PATH), timeoutMs: opts.timeoutMs ?? 180_000 });
  return { ...r, reply: replyOf(harness, r) };
}
