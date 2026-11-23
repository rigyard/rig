// Assertions of the first seed (docs/design/rig-v1-first-seed.md, A1 to A17) over a config root and applied HOMEs.
// test/first-seed.test.ts runs them on the committed config, test/seed.test.ts on a synthetic twin.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { stripAnchor } from "../../lib/mode.ts";

export const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const BIN = join(ROOT, "bin/rig.ts");
export const NOW = "2026-11-05T00:00:00Z";
const STATE = ".local/state/rig/";
const ADAPTER = "craft/references/adapter.md";

type Target = {name: string, reads: {skills: {path: string}[]}, hide?: {method: string, key?: string, value?: unknown, file?: string}};

export const json = (p: string) => JSON.parse(readFileSync(p, "utf8"));

/** A temp copy of the config files of `src`: rig.json, the lock, models, targets and every pack. */
export function configCopy(src: string): string {
  const root = mkdtempSync(join(tmpdir(), "rig-seed-config-"));
  for (const rel of ["rig.json", "rig.lock.json", "models", "targets", "packs"]) {
    if (existsSync(join(src, rel))) cpSync(join(src, rel), join(root, rel), { recursive: true });
  }
  return root;
}

/** Run bin/rig.ts with HOME and RIG_ROOT set, no inherited harness or telemetry vars. */
export function rig(root: string, home: string, args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [BIN, ...args], { env: { PATH: process.env.PATH, HOME: home, RIG_ROOT: root, RIG_NOW: NOW, DO_NOT_TRACK: "1", ...env }, cwd: home, encoding: "utf8" });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, all: r.stdout + r.stderr };
}

function walk(dir: string, base = dir): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const abs = join(dir, name);
    if (lstatSync(abs).isDirectory()) out.push(...walk(abs, base));
    else out.push(relative(base, abs).split(sep).join("/"));
  }
  return out;
}

/**
 * Sorted `relpath<TAB>mode<TAB>sha256` lines of every file in HOME, without rig's state root. Tabs, not the design's
 * NUL separator, so git diffs the golden file as text.
 */
export function manifest(home: string): string[] {
  return walk(home).filter((p) => !p.startsWith(STATE)).map((p) => {
    const abs = join(home, p);
    const mode = (lstatSync(abs).mode & 0o777).toString(8);
    return `${p}\t${mode}\t${createHash("sha256").update(readFileSync(abs)).digest("hex")}`;
  });
}

export const targetsOf = (root: string): Target[] =>
  json(join(root, "rig.json")).harnesses.map((h: string) => json(join(root, `targets/${h}.json`)));

const expand = (home: string, p: string) => (p.startsWith("~/") ? join(home, p.slice(2)) : p);

/** Skill dirs (as written in the target records) that hold at least one skill in HOME, per harness. */
function skillDirs(home: string, t: Target) {
  return t.reads.skills.map((d) => d.path).filter((d) => existsSync(expand(home, d)));
}

const readersOf = (targets: Target[], dir: string) => targets.filter((t) => t.reads.skills.some((d) => d.path === dir));
const skillsIn = (home: string, dir: string) => readdirSync(expand(home, dir)).filter((n) => existsSync(join(expand(home, dir), n, "SKILL.md"))).sort();
const text = (p: string) => readFileSync(p, "utf8");

function frontmatter(t: string) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(t);
  return m ? m[1] : "";
}

/** A1: exit 0, 0 blocks, and no links or pin finding. */
export function assertPlanClean(p: {code: number | null, stdout: string}) {
  assert.equal(p.code, 0, p.stdout);
  assert.match(p.stdout, /^\d+ changes?, 0 blocks$/m);
  assert.doesNotMatch(p.stdout, /^(block|warn|info) (links|pin) /m);
}

/** The run id that rig apply printed (A2). */
export function runId(stdout: string) {
  const m = /^run (\S+): \d+ ops applied$/m.exec(stdout);
  assert.ok(m, stdout);
  return m[1];
}

/** A6: each harness reads exactly one craft/SKILL.md, next to an adapter.md with a section for it, and hidden for it. */
export function assertOneCraft(home: string, targets: Target[]) {
  for (const t of targets) {
    const crafts = skillDirs(home, t).filter((d) => existsSync(join(expand(home, d), "craft/SKILL.md")));
    const dedupe = (t.reads.skills as {path: string, dedupe?: string}[]).find((d) => crafts.includes(d.path))?.dedupe;
    assert.ok(crafts.length === 1 || (crafts.length > 1 && dedupe === "by-name"), `${t.name} reads craft in ${crafts.join(", ")}`);
    for (const d of crafts) {
      assert.match(text(join(expand(home, d), ADAPTER)), new RegExp(`^## ${t.name}$`, "m"), `${d}/${ADAPTER} has a ${t.name} section`);
      assert.ok(hidden(home, d, "craft", t), `${d}/craft carries the ${t.name} hide switch`);
    }
  }
}

function hidden(home: string, dir: string, name: string, t: Target) {
  const h = t.hide ?? { method: "none" };
  const base = join(expand(home, dir), name);
  if (h.method === "frontmatter-key") return new RegExp(`^${h.key}: ${JSON.stringify(h.value)}$`, "m").test(frontmatter(text(join(base, "SKILL.md"))));
  if (h.method === "sidecar") return existsSync(join(base, h.file!)) && /^policy:\n\s+allow_implicit_invocation: false$/m.test(text(join(base, h.file!)));
  return true;
}

/** A7: with `auto` empty, every skill in every read-set carries the hide switch of that harness. Returns the count checked. */
export function assertAllHidden(home: string, targets: Target[]) {
  let n = 0;
  for (const t of targets) {
    for (const d of skillDirs(home, t)) {
      for (const name of skillsIn(home, d)) {
        assert.ok(hidden(home, d, name, t), `${d}/${name} is hidden on ${t.name}`);
        n++;
      }
    }
  }
  return n;
}

/** The hide keys of the frontmatter readers of a dir, set in reader order: an existing key line is replaced, a new one goes before the close. */
function withHideKeys(source: string, readers: Target[]) {
  let out = source;
  for (const t of readers.filter((r) => r.hide?.method === "frontmatter-key")) {
    const line = `${t.hide!.key}: ${JSON.stringify(t.hide!.value)}`;
    const close = out.indexOf("\n---", 4);
    const head = out.slice(0, close + 1);
    const existing = new RegExp(`^${t.hide!.key}:.*$`, "m");
    out = existing.test(head) ? head.replace(existing, line) + out.slice(close + 1) : `${head}${line}\n${out.slice(close + 1)}`;
  }
  return out;
}

/**
 * A8: the hub, the playbooks and bugbot-triage.md equal their pack files, and each vendored leaf copy equals the pack
 * leaf plus the hide keys of its readers and the anchor block. Returns the number of leaf copies checked.
 */
export function assertByteIdentity(home: string, root: string, targets: Target[], hubPack: string) {
  const lock = json(join(root, "rig.lock.json"));
  const mode = join(root, `packs/${hubPack}/skills/poteto-mode`);
  const vendoredLeaves = new Map<string, string>();
  for (const [pack, entry] of Object.entries(lock.packs) as [string, {paths: string[]}][]) {
    if (entry.paths.length === 0) continue;
    const skills = join(root, `packs/${pack}/skills`);
    if (!existsSync(skills)) continue;
    for (const name of readdirSync(skills)) if (name !== "poteto-mode" && existsSync(join(skills, name, "SKILL.md"))) vendoredLeaves.set(name, join(skills, name));
  }
  let leaves = 0;
  const dirs = [...new Set(targets.flatMap((t) => skillDirs(home, t)))];
  for (const d of dirs) {
    const base = expand(home, d);
    if (existsSync(join(base, "craft"))) {
      assert.deepEqual(readFileSync(join(base, "craft/hub.md")), readFileSync(join(mode, "SKILL.md")), `${d}/craft/hub.md`);
      for (const f of walk(join(mode, "playbooks"))) assert.deepEqual(readFileSync(join(base, "craft/playbooks", f)), readFileSync(join(mode, "playbooks", f)), `${d}/craft/playbooks/${f}`);
      assert.deepEqual(readFileSync(join(base, "craft/references/bugbot-triage.md")), readFileSync(join(mode, "references/bugbot-triage.md")), `${d}/craft/references/bugbot-triage.md`);
    }
    const readers = readersOf(targets, d);
    const sidecars = readers.filter((t) => t.hide?.method === "sidecar").map((t) => t.hide!.file!);
    for (const name of skillsIn(home, d)) {
      const src = vendoredLeaves.get(name);
      if (!src) continue;
      const copy = walk(join(base, name)).filter((f) => !sidecars.includes(f) || existsSync(join(src, f)));
      assert.deepEqual(copy, walk(src), `${d}/${name} holds the pack files`);
      for (const f of copy) {
        if (f !== "SKILL.md") assert.deepEqual(readFileSync(join(base, name, f)), readFileSync(join(src, f)), `${d}/${name}/${f}`);
      }
      assert.equal(stripAnchor(text(join(base, name, "SKILL.md"))), withHideKeys(text(join(src, "SKILL.md")), readers), `${d}/${name}/SKILL.md`);
      leaves++;
    }
  }
  return leaves;
}

/** Code fences and code spans blanked, so a link inside code is not read. */
function prose(t: string) {
  return t.replace(/^ {0,3}(`{3,}|~{3,})[\s\S]*?^ {0,3}\1[^\n]*$/gm, "").replace(/(`+)[\s\S]*?\1/g, "");
}

const linkTargets = (t: string) => [...prose(t).matchAll(/\]\(\s*<?([^\s)>]*)>?(?:\s+["'(][^)\n]*)?\)/g)].map((m) => m[1].replace(/[#?].*$/, ""))
  .filter((x) => x !== "" && !/^[a-z][a-z0-9+.-]*:/i.test(x) && !/^[/~]/.test(x) && (x.includes("/") || /\.[a-z0-9]+$/i.test(x)));

/** A9: every relative Markdown link in every file of a skill dir resolves to a file in the same skill dir. Returns the link count. */
export function assertLinks(home: string, targets: Target[]) {
  let n = 0;
  for (const d of new Set(targets.flatMap((t) => skillDirs(home, t)))) {
    const base = expand(home, d);
    for (const f of walk(base).filter((p) => p.endsWith(".md"))) {
      for (const target of linkTargets(text(join(base, f)))) {
        const to = posix.normalize(posix.join(posix.dirname(f), decodeURIComponent(target)));
        assert.ok(!to.startsWith("../") && existsSync(join(base, to)), `${d}/${f} links ${target}, which resolves to no file of ${d}`);
        n++;
      }
    }
  }
  return n;
}

/** A10: the Codex listing counts only skills with no hide sidecar. Returns the listed names and their characters. */
export function codexListing(home: string, targets: Target[]) {
  const codex = targets.find((t) => t.name === "codex")!;
  const listed: string[] = [];
  let chars = 0;
  for (const d of skillDirs(home, codex)) {
    for (const name of skillsIn(home, d)) {
      if (hidden(home, d, name, codex)) continue;
      listed.push(name);
      chars += name.length + (/^description: (.*)$/m.exec(frontmatter(text(join(expand(home, d), name, "SKILL.md"))))?.[1].length ?? 0);
    }
  }
  return { listed, chars };
}

/** A14: no pack file sits at or under a locked exclude. */
export function assertNoExcludedFile(root: string) {
  for (const [pack, entry] of Object.entries(json(join(root, "rig.lock.json")).packs) as [string, {exclude: string[]}][]) {
    for (const f of walk(join(root, "packs", pack))) {
      const x = entry.exclude.find((e) => f === e || f.startsWith(`${e}/`));
      assert.equal(x, undefined, `packs/${pack}/${f} sits under the locked exclude ${x}`);
    }
  }
}

/** A16: the anchor of each vendored leaf reaches an adapter.md with a section for each harness that reads it. Returns the anchors checked. */
export function assertAnchors(home: string, targets: Target[]) {
  let n = 0;
  for (const t of targets) {
    for (const d of skillDirs(home, t)) {
      for (const name of skillsIn(home, d)) {
        const m = /^Read the section for your harness in \[the rig adapter\]\(([^)]+)\) once per session before you follow this skill\.$/m.exec(text(join(expand(home, d), name, "SKILL.md")));
        if (!m) continue;
        const adapter = posix.normalize(posix.join(name, m[1]));
        assert.equal(adapter, ADAPTER, `${d}/${name} anchors ${m[1]}`);
        assert.match(text(join(expand(home, d), adapter)), new RegExp(`^## ${t.name}$`, "m"), `${d}/${adapter} has a ${t.name} section`);
        n++;
      }
    }
  }
  return n;
}

const MODE_PATH = /^(?:\.\.\/[^/\s]+\/SKILL\.md|(?:\.\.\/)?playbooks\/[^/\s]+\.md|(?:\.\.\/)?references\/[^/\s]+\.md|worker\.md)$/;

/**
 * A17: each `../<x>/SKILL.md`, `playbooks/<y>.md` or `references/<z>.md` in a code span or link of the hub or a playbook
 * resolves to a file of the same skill dir, first from the file's dir, then from craft/. Returns the paths checked.
 */
export function assertModePaths(home: string, targets: Target[]) {
  let n = 0;
  for (const d of new Set(targets.flatMap((t) => skillDirs(home, t)))) {
    const base = expand(home, d);
    if (!existsSync(join(base, "craft/hub.md"))) continue;
    for (const f of ["craft/hub.md", ...(existsSync(join(base, "craft/worker.md")) ? ["craft/worker.md"] : []), ...walk(join(base, "craft/playbooks")).map((p) => `craft/playbooks/${p}`)]) {
      const t = text(join(base, f));
      const spans = [...t.matchAll(/(`+)([\s\S]*?)\1/g)].map((m) => m[2]);
      const links = [...t.matchAll(/\]\(\s*<?([^\s)>]*)>?\)/g)].map((m) => m[1]);
      const tokens = [...spans, ...links].flatMap((s) => s.split(/\s+/)).map((x) => x.replace(/[.,;:)]+$/, "")).filter((x) => MODE_PATH.test(x) && !x.includes("<"));
      for (const p of tokens) {
        const hit = [posix.dirname(f), "craft"].map((from) => posix.normalize(posix.join(from, p))).find((to) => !to.startsWith("../") && existsSync(join(base, to)));
        assert.ok(hit, `${d}/${f} names ${p}, which resolves to no file of ${d}`);
        n++;
      }
    }
  }
  return n;
}
