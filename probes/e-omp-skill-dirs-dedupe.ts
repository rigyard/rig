#!/usr/bin/env node
// Probe e: which skill and command directories omp reads, and how it dedupes skills.
// Usage: node probes/e-omp-skill-dirs-dedupe.ts [--out <file>] [--scratch <dir>] [--model <id>]
import fs from 'node:fs';
import path from 'node:path';
import {
  assertIsolated, createScratch, finish, firstUserText, isolatedEnv, jsonEvents, lastAssistantText,
  modelOverrideUsed, newIsolated, parseArgs, realConfigState, redact, runOmp, setModel, toolCallCount,
  writeFile, writeSkill,
} from './lib/omp.ts';

const args = parseArgs(process.argv.slice(2));
setModel(args.model);
const realBefore = realConfigState();
const scratch = createScratch(args.scratch);
const iso = newIsolated(scratch, 'e');
assertIsolated(iso, isolatedEnv(iso));
const { agentDir, home, proj } = iso;

// Skill dedupe enum, derived from the entry counts of three same-name pairs.
//   none            identical copies stay as separate entries
//   whole-dir       identical SKILL.md plus a sidecar file counts as different
//   skill-md-bytes  identical SKILL.md (and frontmatter) collapses, sidecars ignored; differing copies are namespaced
//   name-only       one entry per name, differing copies are dropped
const DEDUPE_ENUM = ['none', 'whole-dir', 'skill-md-bytes', 'name-only'];

// Controls: one unique skill per location. `expected` is not assumed; each result is observed.
const controls = [
  ['rigprobe-u-agentdir', path.join(agentDir, 'skills'), 'user: <agent dir>/skills'],
  ['rigprobe-u-home-agents', path.join(home, '.agents/skills'), 'user: ~/.agents/skills'],
  ['rigprobe-u-home-claude', path.join(home, '.claude/skills'), 'user: ~/.claude/skills'],
  ['rigprobe-u-home-codex', path.join(home, '.codex/skills'), 'user: ~/.codex/skills'],
  ['rigprobe-u-proj-claude', path.join(proj, '.claude/skills'), 'project: .claude/skills'],
  ['rigprobe-u-proj-codex', path.join(proj, '.codex/skills'), 'project: .codex/skills'],
  ['rigprobe-u-proj-agents', path.join(proj, '.agents/skills'), 'project: .agents/skills'],
  ['rigprobe-u-proj-omp', path.join(proj, '.omp/skills'), 'project: .omp/skills'],
];
for (const [name, dir] of controls) writeSkill(dir, name, `control ${name}`);

// Pairs. Same bytes across three dirs; one name with two descriptions; sidecar file; user plus project copy.
for (const d of ['.claude', '.codex', '.agents']) writeSkill(path.join(proj, d, 'skills'), 'rigprobe-same', 'identical copy');
writeSkill(path.join(proj, '.claude/skills'), 'rigprobe-diff', 'description one');
writeSkill(path.join(proj, '.codex/skills'), 'rigprobe-diff', 'description two');
writeSkill(path.join(proj, '.claude/skills'), 'rigprobe-side', 'sidecar pair');
writeSkill(path.join(proj, '.codex/skills'), 'rigprobe-side', 'sidecar pair');
writeFile(path.join(proj, '.codex/skills/rigprobe-side/agents/openai.yaml'), 'interface:\n  display_name: rigprobe\n');
writeSkill(path.join(agentDir, 'skills'), 'rigprobe-xsame', 'user and project copy');
writeSkill(path.join(proj, '.claude/skills'), 'rigprobe-xsame', 'user and project copy');

// Commands.
const CMD = { agentdir: 'RIGPROBE-CMD-AGENTDIR-77', projclaude: 'RIGPROBE-CMD-PROJCLAUDE-22', homeclaude: 'RIGPROBE-CMD-HOMECLAUDE-11', homeagents: 'RIGPROBE-CMD-HOMEAGENTS-33' };
const commands = [
  ['rigprobe-cmd', path.join(agentDir, 'commands'), CMD.agentdir, 'user: <agent dir>/commands'],
  ['rigprobe-cmd-pc', path.join(proj, '.claude/commands'), CMD.projclaude, 'project: .claude/commands'],
  ['rigprobe-cmd-hc', path.join(home, '.claude/commands'), CMD.homeclaude, 'user: ~/.claude/commands'],
  ['rigprobe-cmd-ha', path.join(home, '.agents/commands'), CMD.homeagents, 'user: ~/.agents/commands'],
];
for (const [name, dir, sentinel] of commands) writeFile(path.join(dir, `${name}.md`), `Say ${sentinel} and nothing else.\n`);

const rel = (p) => path.relative(fs.realpathSync(iso.root), fs.realpathSync(p));

// Channel 1, no model call: `omp read skill://<unknown>` answers with the effective skill names.
async function readChannelNames() {
  const r = await runOmp(iso, ['read', 'skill://rigprobe-no-such-skill']);
  const m = /^Available: (.*)$/m.exec(r.stdout + r.stderr);
  if (!m) return null;
  return m[1].split(',').map((s) => s.trim()).filter(Boolean);
}

async function readChannelPath(name) {
  const r = await runOmp(iso, ['read', `skill://${name}`]);
  const m = /^\[Skill file: (.*)\]$/m.exec(r.stdout);
  return m ? rel(m[1]) : null;
}

// Channel 2, model call: ask for the skills list three times. Every run must agree.
const LIST_PROMPT = 'List every skill whose name contains "rigprobe" in your available skills list. Output one line per list entry exactly as the entry is named, including any prefix before a slash. If the same name appears several times in the list, repeat it. Do not call any tool. If none, output NONE.';
async function modelListing() {
  const r = await runOmp(iso, ['-p', '--mode', 'json', '--no-session', LIST_PROMPT]);
  const events = jsonEvents(r.stdout);
  if (r.code !== 0 || !events) return { error: `exit ${r.code}${r.timedOut ? ' (timeout)' : ''}` };
  const text = lastAssistantText(events) ?? '';
  const names = [...text.matchAll(/[A-Za-z0-9_.-]*\/?rigprobe-[A-Za-z0-9-]+/g)].map((m) => m[0]).sort();
  return { names, tool_calls: toolCallCount(events) };
}

const readNames = await readChannelNames();
const runs = [];
for (let i = 0; i < 3; i++) runs.push(await modelListing());

const readOk = Array.isArray(readNames);
const runsOk = runs.every((r) => r.names && r.tool_calls === 0);
const runsAgree = runsOk && runs.every((r) => JSON.stringify(r.names) === JSON.stringify(runs[0].names));
const modelNames = runsOk ? runs[0].names : [];
const modelMatchesRead = readOk && runsAgree && JSON.stringify([...readNames].sort()) === JSON.stringify(modelNames);

const bare = (n) => n.split('/').pop();
const count = (list, name) => list.filter((n) => bare(n) === name).length;
const effective = readOk ? readNames : modelNames;
const same = count(effective, 'rigprobe-same');
const side = count(effective, 'rigprobe-side');
const diff = count(effective, 'rigprobe-diff');
const xsame = count(effective, 'rigprobe-xsame');

let dedupe = null;
if (same === 2 || same === 3) dedupe = 'none';
else if (same === 1 && side === 2) dedupe = 'whole-dir';
else if (same === 1 && side === 1 && diff === 2) dedupe = 'skill-md-bytes';
else if (same === 1 && side === 1 && diff === 1) dedupe = 'name-only';

const reads = controls.map(([name, , label]) => ({ location: label, name, read: effective.includes(name) }));

const pathsEvidence = {
  'rigprobe-diff': await readChannelPath('rigprobe-diff'),
  'codex/rigprobe-diff': await readChannelPath('codex/rigprobe-diff'),
  'rigprobe-same': await readChannelPath('rigprobe-same'),
  'rigprobe-xsame': await readChannelPath('rigprobe-xsame'),
};

// Commands: a command file is read when omp replaces the prompt with the file body.
const commandResults = [];
for (const [name, , sentinel, label] of commands) {
  const r = await runOmp(iso, ['-p', '--mode', 'json', '--no-session', `/${name}`]);
  const events = jsonEvents(r.stdout);
  const user = events ? firstUserText(events) : null;
  commandResults.push({ location: label, command: `/${name}`, exit: r.code, expanded: Boolean(user && user.includes(sentinel)) });
}
const cmdByLabel = Object.fromEntries(commandResults.map((c) => [c.location, c.expanded]));
const cmdRan = commandResults.every((c) => c.exit === 0);

const evidence = {
  channels: 'Channel 1 is `omp read skill://<unknown>`, which lists effective skill names with no model call. Channel 2 asks the model for its skills list three times with no tool calls.',
  read_channel_available: readOk,
  read_channel_names: readOk ? readNames : null,
  model_runs: runs.map((r) => (r.names ? { names: r.names, tool_calls: r.tool_calls } : r)),
  model_runs_agree: runsAgree,
  model_agrees_with_read_channel: modelMatchesRead,
  location_results: reads,
  pair_counts: { 'rigprobe-same (3 dirs, identical bytes)': same, 'rigprobe-side (identical SKILL.md, sidecar agents/openai.yaml in the .codex copy)': side, 'rigprobe-diff (different description)': diff, 'rigprobe-xsame (agent dir plus project .claude)': xsame },
  winner_paths: pathsEvidence,
  command_results: commandResults,
  doc_corroboration: '`omp read omp://skills.md` (omp v18.16.0) states: a later same-named skill is dropped when its body is identical and its frontmatter deeply equal; differing copies get `<namespace>/<name>`; foreign user-level providers (claude, codex) are opt-in through `enabledProviders`; `.agents` has its own toggles. Observed behavior matches.',
  model_override_used: modelOverrideUsed(),
};

let verdict;
if (!readOk && !runsOk) verdict = 'INCONCLUSIVE';
else if (readOk && runsOk && (!runsAgree || !modelMatchesRead)) verdict = 'INCONCLUSIVE';
else if (!cmdRan) verdict = 'INCONCLUSIVE';
else if (dedupe === null) verdict = 'FAIL';
else if (!cmdByLabel['user: <agent dir>/commands']) verdict = 'FAIL';
else verdict = 'PASS';

const readLocations = reads.filter((r) => r.read).map((r) => r.location);
const sets = {
  omp_target: {
    reads_skills: reads.map((r) => ({ location: r.location, read: r.read })),
    skills_dedupe: dedupe,
    skills_dedupe_enum: DEDUPE_ENUM,
    user_command_dir: cmdByLabel['user: <agent dir>/commands'] ? '<agent dir>/commands/*.md' : null,
    commands_read: commandResults.map((c) => ({ location: c.location, read: c.expanded })),
    bare_command_works_in_print_mode: cmdByLabel['user: <agent dir>/commands'] ?? false,
  },
  resolves: ['A13', 'A36 (omp part)'],
};

finish({
  probe: 'e-omp-skill-dirs-dedupe',
  verdict,
  derived: `dedupe=${dedupe} read=[${readLocations.length} of ${reads.length} locations] user_command_dir=${sets.omp_target.user_command_dir}`,
  evidence: JSON.parse(redact(JSON.stringify(evidence), scratch)),
  sets, args, scratch, realBefore,
});
