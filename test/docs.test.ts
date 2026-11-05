// The user docs (README, docs/README.md, docs/guide, docs/harnesses.md) against the real CLI: every relative link
// resolves, and every `rig` line in a code fence names a command, subcommand and flags that `rig --help` lists.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, test } from "node:test";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BIN = join(ROOT, "bin/rig.ts");
const COMMANDS = ["plan", "apply", "doctor", "stats", "models", "pack", "pin"];

const guideDir = join(ROOT, "docs/guide");
const DOCS = [
  "README.md",
  "docs/README.md",
  "docs/harnesses.md",
  ...(existsSync(guideDir) ? readdirSync(guideDir).filter((f) => f.endsWith(".md")).map((f) => `docs/guide/${f}`) : []),
].filter((f) => existsSync(join(ROOT, f)));

const home = mkdtempSync(join(tmpdir(), "rig-docs-"));
after(() => rmSync(home, { recursive: true, force: true }));

const help = spawnSync(process.execPath, [BIN, "--help"], { env: { PATH: process.env.PATH, HOME: home }, encoding: "utf8" });
const usage: string[][] = help.stdout.split("\n")
  .map((l) => l.trim())
  .filter((l) => l.startsWith("rig ") && !l.startsWith("rig:"))
  .map((l) => l.split(/\s{2,}/)[0].split(/\s+/));

/** Fenced code lines of a markdown file, with the fence language. */
function fencedLines(text: string): string[] {
  const out: string[] = [];
  let inFence = false;
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) out.push(line);
  }
  return out;
}

/** A shell command that starts with rig, after an optional `env [-i]` and `VAR=value` words. */
const RIG_CMD = /^(?:env(?:\s+-\S+)*\s+)?(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*rig\s+(.*)$/;

/**
 * The rig invocations of one fenced line. Only a line that is itself a command counts (`rig ...` or `$ rig ...`),
 * so output lines such as `rig plan: E_USAGE ...` and prose inside output do not. Each `&&`, `;` or `|` part of
 * such a line counts when it also starts with rig.
 */
function invocations(line: string): string[][] {
  const s = line.trim().replace(/^\$\s+/, "");
  if (!RIG_CMD.test(s)) return [];
  const out: string[][] = [];
  for (const part of s.split(/&&|;|\|/)) {
    const m = part.trim().match(RIG_CMD);
    if (!m) continue;
    const words = m[1].replace(/\s+#.*$/, "").trim().split(/\s+/);
    if (words[0] === undefined || words.slice(0, 2).some((w) => w.endsWith(":"))) continue;
    out.push(words);
  }
  return out;
}

describe("user docs", () => {
  test("rig --help lists the seven commands", () => {
    assert.equal(help.status, 0);
    assert.deepEqual([...new Set(usage.map((u) => u[1]))].sort(), [...COMMANDS].sort());
  });

  test("README names every command", () => {
    const text = readFileSync(join(ROOT, "README.md"), "utf8");
    for (const c of COMMANDS) assert.match(text, new RegExp(`rig ${c}\\b`), `README.md does not show rig ${c}`);
  });

  for (const file of DOCS) {
    const text = readFileSync(join(ROOT, file), "utf8");

    test(`${file}: relative links resolve`, () => {
      const prose = text.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
      for (const m of prose.matchAll(/\]\(([^)\s]+)\)/g)) {
        const target = m[1];
        if (/^[a-z]+:/i.test(target) || target.startsWith("#")) continue;
        const path = resolve(ROOT, dirname(file), decodeURIComponent(target.split("#")[0]));
        assert.ok(existsSync(path), `${file} links to ${target}, which does not exist`);
      }
    });

    test(`${file}: every rig line matches rig --help`, () => {
      for (const line of fencedLines(text)) {
        for (const words of invocations(line)) {
          const [cmd, maybeSub] = words;
          if (cmd === "--help") continue;
          assert.ok(COMMANDS.includes(cmd), `${file}: "${line.trim()}" names no rig command`);
          const rows = usage.filter((u) => u[1] === cmd);
          const isSub = (w: string | undefined) => w !== undefined && /^[a-z]/.test(w);
          const row = rows.filter((u) => isSub(maybeSub) ? u[2] === maybeSub : !isSub(u[2]));
          assert.ok(row.length, `${file}: "${line.trim()}" uses rig ${cmd} ${maybeSub}, which rig --help does not list`);
          const known = new Set(row.flatMap((u) => u.join(" ").match(/--[a-z-]+/g) ?? []).concat("--help"));
          for (const w of words) {
            const flag = w.match(/^--[a-z-]+/)?.[0];
            if (flag) assert.ok(known.has(flag), `${file}: "${line.trim()}" uses ${flag}, which rig --help does not list for rig ${cmd}`);
          }
        }
      }
    });
  }
});
