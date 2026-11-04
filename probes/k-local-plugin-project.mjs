#!/usr/bin/env node
// Probe (k): project-only local plugin. Runs the variant that needs no user-config write.
import fs from "node:fs";
import path from "node:path";
import { finish, freshDir, parseOut, run } from "./_lib.mjs";

const probe = "k-local-plugin-project";
const sets = "claude project_scope (partial: session-only local plugin; local marketplace variant needs operator)";
const out = parseOut(process.argv);

const help = run("claude", ["--help"], { timeoutMs: 30000 }).stdout;
const flagListed = /--plugin-dir\s/.test(help);

const root = freshDir("k");
const pluginDir = path.join(root, "rigprobe-plugin");
const project = path.join(root, "project");
fs.mkdirSync(path.join(pluginDir, ".claude-plugin"), { recursive: true });
fs.mkdirSync(path.join(pluginDir, "commands"));
fs.mkdirSync(project);
fs.writeFileSync(
  path.join(pluginDir, ".claude-plugin", "plugin.json"),
  JSON.stringify({ name: "rigprobe", version: "0.0.1", description: "rig probe fixture" }, null, 2),
);
fs.writeFileSync(
  path.join(pluginDir, "commands", "rigprobe-k.md"),
  "---\ndescription: rig probe command\n---\nReply with exactly the word k-ok and nothing else.\n",
);

const ask = (cmd, withPlugin) =>
  run(
    "claude",
    ["-p", "--max-turns", "2", ...(withPlugin ? ["--plugin-dir", pluginDir] : []), cmd],
    { cwd: project, timeoutMs: 110000 },
  );

const attempts = {};
const worked = [];
if (flagListed) {
  for (const [label, cmd] of [["bare", "/rigprobe-k"], ["namespaced", "/rigprobe:rigprobe-k"]]) {
    const r = ask(cmd, true);
    attempts[label] = { exit: r.status, timedOut: r.timedOut, sawMarker: r.stdout.includes("k-ok") };
    if (attempts[label].sawMarker) worked.push(label);
  }
}
const control = flagListed ? ask("/rigprobe-k", false) : null;
const controlSawMarker = control ? control.stdout.includes("k-ok") : null;

const localVariantPass =
  flagListed && worked.includes("bare") && control.status === 0 && controlSawMarker === false;
finish({
  probe,
  verdict: "INCONCLUSIVE",
  sets,
  evidence: {
    reason: "needs operator: the full variant (rig-owned marketplace, user false, project-local true) needs `claude plugin marketplace add` and a user settings write",
    pluginDirFlagListedInHelp: flagListed,
    localVariant: {
      verdict: localVariantPass ? "PASS" : "FAIL",
      invocationFormsThatWorked: worked,
      attempts,
      controlWithoutFlagExit: control?.status ?? null,
      controlWithoutFlagSawMarker: controlSawMarker,
      scope: "the plugin loads for that one invocation only, and not without the flag",
    },
  },
}, out);
