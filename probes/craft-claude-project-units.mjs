#!/usr/bin/env node
// Probe (craft-claude): project-level command and skill are invocable headless. This is the shape rig's /craft uses.
import fs from "node:fs";
import path from "node:path";
import { finish, freshDir, parseOut, run } from "./_lib.mjs";

const probe = "craft-claude-project-units";
const sets = "claude /craft entry path (project command and skill units)";
const out = parseOut(process.argv);

const project = freshDir("craft-project");
const write = (rel, body) => {
  const file = path.join(project, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
};
write(".claude/commands/rigprobe-cmd.md", "---\ndescription: rig probe command\n---\nReply with the word cmd-ok and nothing else.\n");
write(
  ".claude/skills/rigprobe-skill/SKILL.md",
  "---\nname: rigprobe-skill\ndescription: rig probe skill\ndisable-model-invocation: true\n---\nReply with the word skill-ok and nothing else.\n",
);

const ask = (prompt) => run("claude", ["-p", "--max-turns", "3", prompt], { cwd: project, timeoutMs: 110000 });
const cmd = ask("/rigprobe-cmd");
const skill = ask("/rigprobe-skill");

const cmdOk = cmd.status === 0 && cmd.stdout.includes("cmd-ok");
const skillOk = skill.status === 0 && skill.stdout.includes("skill-ok");
finish({
  probe,
  verdict: cmdOk && skillOk ? "PASS" : "FAIL",
  sets,
  evidence: {
    command: { invocation: "/rigprobe-cmd", exit: cmd.status, timedOut: cmd.timedOut, sawMarker: cmd.stdout.includes("cmd-ok") },
    skillWithDisableModelInvocation: { invocation: "/rigprobe-skill", exit: skill.status, timedOut: skill.timedOut, sawMarker: skill.stdout.includes("skill-ok") },
  },
}, out);
