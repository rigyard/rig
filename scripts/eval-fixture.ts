// scripts/eval-fixture.ts — prepare and grade one trial of a published eval fixture by hand (evals/fixtures/).
//
// Usage:
//   node scripts/eval-fixture.ts hash <fx>
//   node scripts/eval-fixture.ts prompt <fx>
//   node scripts/eval-fixture.ts prepare <fx> <none|rule> <dir> [--instruction-file <name>]
//   node scripts/eval-fixture.ts grade <fx> <dir>
// Exit codes: 0 ok or pass, 1 grade fail, 2 usage error.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, chmodSync, cpSync, existsSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const FIXTURES = join(ROOT, "evals", "fixtures");
export const RULE_SHA256 = "4e8c5d3f01c69c929959d1d9e19c5e77ce0c8fac49459fa38930994f51db42ff";
/** Tests in the TAP plan of each primary grader. A trial passes only when exactly this many tests run and all pass. */
export const EXPECTED_TESTS: Record<string, number> = { fx3: 4, fx4b: 4 };
const ARMS = ["none", "rule"];
const EXCLUDED = ["CLAUDE.md", "AGENTS.md", ".claude/", ".agents/"];
const GRADER_COPY = "grader.check.ts";

class UsageError extends Error {}

const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

function fixtureDir(fx: string | undefined): string {
  if (!fx || !Object.hasOwn(EXPECTED_TESTS, fx)) throw new UsageError(`unknown fixture ${fx ?? "(missing)"}: use ${Object.keys(EXPECTED_TESTS).join(" or ")}`);
  return join(FIXTURES, fx);
}

/** Relative paths of every file under root except .git, ordered by lower-cased path, then by bytes. */
function treeFiles(root: string): string[] {
  const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => relative(root, join(e.parentPath, e.name)).split(sep).join("/"))
    .filter((p) => p.split("/")[0] !== ".git")
    .sort((a, b) => order(a.toLowerCase(), b.toLowerCase()) || order(a, b));
}

/** sha256 of the lines `<sha256 of file>  ./<path>`, one per file, each ending in a newline. */
export function treeSha256(root: string): string {
  return sha256(treeFiles(root).map((p) => `${sha256(readFileSync(join(root, p)))}  ./${p}\n`).join(""));
}

export function hashes(fx: string): { fixture: string; fixture_sha256: string; grader_sha256: string } {
  const dir = fixtureDir(fx);
  return { fixture: fx, fixture_sha256: treeSha256(join(dir, "fixture")), grader_sha256: sha256(readFileSync(join(dir, "grader", "check.ts"))) };
}

function git(dir: string, args: string[]): void {
  const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed in ${dir}: ${r.error?.message ?? r.stderr}`);
}

function checkInstructionFile(name: string, src: string): void {
  if (!name || name === "." || name === ".." || name === ".git" || /[\\/]/.test(name) || basename(name) !== name) throw new UsageError(`--instruction-file takes a plain file name: ${JSON.stringify(name)}`);
  if (readdirSync(src).some((f) => f.toLowerCase() === name.toLowerCase())) throw new UsageError(`--instruction-file ${name} would overwrite a file of the fixture`);
}

/** The real path of target: the real path of its nearest existing ancestor, joined with the part that does not exist yet. */
function realTarget(target: string): string {
  let head = target;
  const tail: string[] = [];
  while (!existsSync(head)) {
    tail.unshift(basename(head));
    head = dirname(head);
  }
  return join(realpathSync.native(head), ...tail);
}

export function prepare(fx: string, arm: string, dir: string, instructionFile: string): { dir: string; fixture: string; arm: string; instruction_file: string | null } {
  const src = join(fixtureDir(fx), "fixture");
  if (!ARMS.includes(arm)) throw new UsageError(`unknown arm ${arm}: use none or rule`);
  checkInstructionFile(instructionFile, src);
  const target = resolve(dir);
  const real = realTarget(target);
  const root = realpathSync.native(ROOT);
  if (real === root || real.startsWith(root + sep)) throw new UsageError(`${target} is inside the rig checkout, where the agent could read the graders: use a directory outside it`);
  if (existsSync(target) && (!statSync(target).isDirectory() || readdirSync(target).length > 0)) throw new UsageError(`${target} exists and is not an empty directory`);
  let rule: string | null = null;
  if (arm === "rule") {
    rule = readFileSync(join(FIXTURES, "rule.txt"), "utf8");
    if (sha256(rule) !== RULE_SHA256) throw new Error(`evals/fixtures/rule.txt changed: sha256 ${sha256(rule)}, expected ${RULE_SHA256}`);
  }
  cpSync(src, target, { recursive: true });
  for (const p of treeFiles(target)) chmodSync(join(target, p), statSync(join(target, p)).mode | 0o200);
  git(target, ["init", "-q"]);
  appendFileSync(join(target, ".git", "info", "exclude"), [...new Set([...EXCLUDED, instructionFile])].map((l) => `${l}\n`).join(""));
  git(target, ["add", "-A"]);
  if (rule !== null) writeFileSync(join(target, instructionFile), rule);
  return { dir: target, fixture: fx, arm, instruction_file: rule === null ? null : instructionFile };
}

export type Grade = { pass: boolean; tests: { name: string; pass: boolean }[]; failed: string[] };

export function grade(fx: string, dir: string): Grade {
  const grader = join(fixtureDir(fx), "grader", "check.ts");
  const target = resolve(dir);
  if (!existsSync(target) || !statSync(target).isDirectory()) throw new UsageError(`${target} is not a directory`);
  const copy = join(target, GRADER_COPY);
  if (existsSync(copy)) throw new UsageError(`${copy} already exists: grade a fresh trial directory`);
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  cpSync(grader, copy);
  let out: string;
  try {
    const r = spawnSync(process.execPath, ["--test", "--test-reporter=tap", GRADER_COPY], { cwd: target, encoding: "utf8", timeout: 60_000, env });
    out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  } finally {
    rmSync(copy, { force: true });
  }
  return parseTap(out, EXPECTED_TESTS[fx]!);
}

/** Top-level TAP results. pass needs exactly `expected` tests, all ok. */
export function parseTap(out: string, expected: number): Grade {
  const tests = [...out.matchAll(/^(not ok|ok) \d+ - (.+)$/gm)].map((m) => ({ name: m[2]!, pass: m[1] === "ok" }));
  return { pass: tests.length === expected && tests.every((t) => t.pass), tests, failed: tests.filter((t) => !t.pass).map((t) => t.name) };
}

const USAGE = "usage: node scripts/eval-fixture.ts hash <fx> | prompt <fx> | prepare <fx> <none|rule> <dir> [--instruction-file <name>] | grade <fx> <dir>";

export function main(argv: string[]): number {
  try {
    const args = [...argv];
    let instructionFile = "AGENTS.md";
    const flag = args.indexOf("--instruction-file");
    if (flag !== -1) {
      const value = args[flag + 1];
      if (!value || value.startsWith("--")) throw new UsageError("--instruction-file needs a file name");
      instructionFile = value;
      args.splice(flag, 2);
    }
    const unknown = args.find((a) => a.startsWith("--"));
    if (unknown) throw new UsageError(`unknown option ${unknown}`);
    const [cmd, fx, ...rest] = args;
    const forms: Record<string, string> = { hash: "hash <fx>", prompt: "prompt <fx>", prepare: "prepare <fx> <none|rule> <dir>", grade: "grade <fx> <dir>" };
    if (!cmd || !Object.hasOwn(forms, cmd)) throw new UsageError(`unknown command ${cmd ?? "(missing)"}`);
    if (rest.length !== forms[cmd]!.split(" ").length - 2) throw new UsageError(`wrong number of arguments: ${forms[cmd]}`);
    if (flag !== -1 && cmd !== "prepare") throw new UsageError("--instruction-file applies to prepare only");
    if (cmd === "hash") console.log(JSON.stringify(hashes(fx!), null, 2));
    if (cmd === "prompt") process.stdout.write(readFileSync(join(fixtureDir(fx), "prompt.txt"), "utf8"));
    if (cmd === "prepare") console.log(JSON.stringify(prepare(fx!, rest[0]!, rest[1]!, instructionFile), null, 2));
    if (cmd === "grade") {
      const g = grade(fx!, rest[0]!);
      console.log(JSON.stringify(g, null, 2));
      return g.pass ? 0 : 1;
    }
    return 0;
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    console.error(`eval-fixture: ${err.message}\n${USAGE}`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main(process.argv.slice(2));
