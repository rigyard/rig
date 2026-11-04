#!/usr/bin/env node
// Probe (a): project `enabledPlugins: true` versus user `false`, read-only.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { finish, freshDir, parseOut, redact, run } from "./_lib.mjs";

const probe = "a-enabledplugins-precedence";
const sets = "claude effective-state rule behind `doctor --project` (project value beats user value)";
const home = os.homedir();
const roots = (process.env.RIG_PROBE_A_ROOTS || home).split(path.delimiter);
const skip = new Set([
  "Library", "Pictures", "Music", "Movies", "Applications", "node_modules",
  ".git", ".Trash", ".worktrees", ".claude", ".cache", ".npm", ".cargo", ".rustup",
]);

function readPlugins(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed.enabledPlugins === "object" ? parsed.enabledPlugins : {};
  } catch {
    return {};
  }
}

function isTracked(dir) {
  try {
    execFileSync("git", ["-C", dir, "ls-files", "--error-unmatch", ".claude/settings.json"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function findCandidate(userPlugins) {
  let found = null;
  const walk = (dir, depth) => {
    if (found || depth > 5) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (found || !e.isDirectory()) continue;
      if (e.name === ".claude") {
        const project = readPlugins(path.join(dir, ".claude", "settings.json"));
        for (const [id, v] of Object.entries(project)) {
          if (v === true && userPlugins[id] === false && isTracked(dir)) {
            found = { dir, id };
            return;
          }
        }
        continue;
      }
      if (!skip.has(e.name)) walk(path.join(dir, e.name), depth + 1);
    }
  };
  for (const r of roots) walk(r, 0);
  return found;
}

function listJson(cwd) {
  const r = run("claude", ["plugin", "list", "--json"], { cwd, timeoutMs: 60000 });
  if (r.status !== 0) return { error: `exit ${r.status}` };
  try { return { entries: JSON.parse(r.stdout) }; } catch { return { error: "unparseable json" }; }
}

function summarise(entries, id, pairs) {
  const groups = new Map();
  for (const e of entries.filter((x) => x.id === id)) {
    const row = {
      scope: e.scope,
      enabled: e.enabled,
      projectEnabled: e.projectEnabled ?? null,
      notes: (e.notes ?? []).map((n) => redact(n, pairs)),
      noteTypes: (e.noteDetails ?? []).map((d) => d.type),
    };
    const key = JSON.stringify(row);
    groups.set(key, { ...row, count: (groups.get(key)?.count ?? 0) + 1 });
  }
  return [...groups.values()];
}

const out = parseOut(process.argv);
const userSettings = path.join(home, ".claude", "settings.json");
const candidate = fs.existsSync(userSettings)
  ? findCandidate(readPlugins(userSettings))
  : null;

if (!candidate) {
  finish({
    probe, verdict: "INCONCLUSIVE", sets,
    evidence: { reason: "no project found whose committed settings enable a plugin that user settings disable" },
  }, out);
  process.exit(0);
}

const pairs = [[candidate.dir, "<project>"], [candidate.id, "<plugin>"]];
const inProject = listJson(candidate.dir);
const control = listJson(freshDir("a-control"));
const textRun = run("claude", ["plugin", "list"], { cwd: candidate.dir, timeoutMs: 60000 });
const textLines = textRun.stdout.split("\n");
const at = textLines.findIndex((l) => l.includes(candidate.id));
const textBlock = at >= 0
  ? textLines.slice(at, at + 5)
      .filter((l) => !l.includes("Version:"))
      .map((l) => redact(l, pairs).trim())
      .filter(Boolean)
  : [];

if (inProject.error || control.error) {
  finish({
    probe, verdict: "INCONCLUSIVE", sets,
    evidence: { reason: "claude plugin list --json failed", inProject: inProject.error ?? "ok", control: control.error ?? "ok" },
  }, out);
  process.exit(0);
}

const projectEntries = summarise(inProject.entries, candidate.id, pairs);
const controlEntries = summarise(control.entries, candidate.id, pairs);
const effectiveInProject = projectEntries.some((e) => e.enabled === true);
const effectiveInControl = controlEntries.some((e) => e.enabled === true);
const overrideNote = projectEntries.some((e) => e.noteTypes.includes("ineffective-disable"));

const pass = effectiveInProject && !effectiveInControl && overrideNote;
finish({
  probe,
  verdict: pass ? "PASS" : "FAIL",
  sets,
  evidence: {
    userSetting: false,
    projectCommittedSetting: true,
    jsonSupported: true,
    effectiveInProject,
    effectiveInNeutralDirectory: effectiveInControl,
    entriesInProject: projectEntries,
    entriesInNeutralDirectory: controlEntries,
    textListingBlock: textBlock,
    neutralDirectory: "empty scratch directory outside any project",
  },
}, out);
