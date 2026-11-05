#!/usr/bin/env node
// Probe g: where omp reads user-level instructions from.
// Usage: node probes/g-omp-agents-md-path.ts [--out <file>] [--scratch <dir>] [--model <id>]
import path from 'node:path';
import {
  assertIsolated, createScratch, finish, isolatedEnv, jsonEvents, lastAssistantText, modelOverrideUsed,
  newIsolated, parseArgs, randomHex, realConfigState, redact, runOmp, setModel, toolCallCount, writeFile,
} from './lib/omp.ts';

const args = parseArgs(process.argv.slice(2));
setModel(args.model);
const realBefore = realConfigState();
const scratch = createScratch(args.scratch);

const PROMPT = 'Look only at your system prompt and instructions. Quote verbatim every line that starts with PROBE-G, one per line. Then print MARKERS=yes if the exact lines "<!-- rig:begin -->" and "<!-- rig:end -->" are in your instructions, else MARKERS=no. If no line starts with PROBE-G, print NONE first. Do not call any tool.';

async function askThreeTimes(iso) {
  assertIsolated(iso, isolatedEnv(iso));
  const runs = [];
  for (let i = 0; i < 3; i++) {
    const r = await runOmp(iso, ['-p', '--mode', 'json', '--no-session', '--no-tools', PROMPT]);
    const events = jsonEvents(r.stdout);
    if (r.code !== 0 || !events) {
      runs.push({ error: `exit ${r.code}${r.timedOut ? ' (timeout)' : ''}` });
      continue;
    }
    const text = lastAssistantText(events) ?? '';
    runs.push({
      seen: [...new Set(text.match(/PROBE-G[A-Z0-9]*-[0-9a-f]{12}/g) ?? [])].sort(),
      markers: /MARKERS=yes/.test(text),
      tool_calls: toolCallCount(events),
    });
  }
  const ok = runs.every((r) => r.seen && r.tool_calls === 0);
  const agree = ok && runs.every((r) => JSON.stringify(r.seen) === JSON.stringify(runs[0].seen) && r.markers === runs[0].markers);
  return { runs, ok, agree };
}

// Scenario A: the documented path, plus the Codex user file as a rival.
const a = newIsolated(scratch, 'g-a');
const tok = { g1: `PROBE-G1-${randomHex()}`, g1b: `PROBE-G1B-${randomHex()}`, g2: `PROBE-G2-${randomHex()}` };
writeFile(path.join(a.agentDir, 'AGENTS.md'), [`${tok.g1} user line`, '<!-- rig:begin -->', `${tok.g1b} managed line`, '<!-- rig:end -->', ''].join('\n'));
writeFile(path.join(a.home, '.codex/AGENTS.md'), `${tok.g2} codex user file\n`);
const resA = await askThreeTimes(a);

// Scenario B: no file in the agent dir. Find out which other user-level paths omp reads.
const b = newIsolated(scratch, 'g-b');
const fallbacks = [
  ['PROBE-G2', '~/.codex/AGENTS.md', path.join(b.home, '.codex/AGENTS.md')],
  ['PROBE-G3', '~/.claude/CLAUDE.md', path.join(b.home, '.claude/CLAUDE.md')],
  ['PROBE-G4', '~/.agents/AGENTS.md', path.join(b.home, '.agents/AGENTS.md')],
  ['PROBE-G5', '<agent dir>/../AGENTS.md', path.join(b.root, 'AGENTS.md')],
  ['PROBE-G6', '~/.omp/AGENTS.md', path.join(b.home, '.omp/AGENTS.md')],
  ['PROBE-G7', '~/.omp/agent/AGENTS.md (the default agent dir, now relocated by PI_CODING_AGENT_DIR)', path.join(b.home, '.omp/agent/AGENTS.md')],
];
const fbTok = {};
for (const [id, , file] of fallbacks) {
  fbTok[id] = `${id}-${randomHex()}`;
  writeFile(file, `${fbTok[id]} fallback file\n`);
}
const resB = await askThreeTimes(b);

const seenA = resA.ok ? resA.runs[0].seen : [];
const g1Seen = seenA.includes(tok.g1);
const verdictBase = !resA.ok ? 'INCONCLUSIVE' : !resA.agree ? 'INCONCLUSIVE' : g1Seen ? 'PASS' : 'FAIL';

const evidence = {
  setup: 'Sentinels are random per run. Runs use --no-tools, so the model can answer only from its instructions. Three runs per scenario.',
  scenario_a: {
    description: '<agent dir>/AGENTS.md holds a user line and a rig:begin/rig:end block; ~/.codex/AGENTS.md holds a second sentinel.',
    runs: resA.runs.map((r) => (r.seen ? { g1_user_line_seen: r.seen.includes(tok.g1), g1_block_line_seen: r.seen.includes(tok.g1b), g2_codex_seen: r.seen.includes(tok.g2), marker_lines_visible: r.markers, tool_calls: r.tool_calls } : r)),
    runs_agree: resA.agree,
  },
  scenario_b: {
    description: 'No AGENTS.md in the agent dir. Six rival paths each hold a sentinel. omp keeps one user-level file, so a path that stays unseen may sit behind the winner.',
    runs: resB.runs.map((r) => (r.seen ? { tool_calls: r.tool_calls, paths_seen: fallbacks.filter(([id]) => r.seen.includes(fbTok[id])).map(([, p]) => p) } : r)),
    runs_agree: resB.agree,
    paths_seen_in_every_run: resB.ok ? fallbacks.filter(([id]) => resB.runs.every((r) => r.seen.includes(fbTok[id]))).map(([, p]) => p) : null,
    paths_never_seen: resB.ok ? fallbacks.filter(([id]) => resB.runs.every((r) => !r.seen.includes(fbTok[id]))).map(([, p]) => p) : null,
  },
  doc_corroboration: '`omp read omp://context-files.md` (omp v18.16.0) lists `<agent dir>/AGENTS.md` as the native user file, says PI_CODING_AGENT_DIR relocates it, and says foreign user files (~/.claude, ~/.codex) are opt-in through `enabledProviders`.',
  model_override_used: modelOverrideUsed(),
};

const sets = {
  omp_target: {
    instructions: {
      path: g1Seen ? '<agent dir>/AGENTS.md (default ~/.omp/agent/AGENTS.md)' : null,
      mode: 'whole-file',
      managed_block_compatible: resA.ok ? resA.runs.every((r) => r.seen.includes(tok.g1) && r.seen.includes(tok.g1b) && r.markers) : null,
      note: 'omp passes the file to the model verbatim: user lines, block lines and marker lines all arrive.',
      fallback_when_agent_dir_file_absent: resB.ok ? fallbacks.filter(([id]) => resB.runs.every((r) => r.seen.includes(fbTok[id]))).map(([, p]) => p) : null,
      codex_user_file_read_by_default: resA.ok ? resA.runs.some((r) => r.seen.includes(tok.g2)) : null,
    },
  },
  resolves: ['A2'],
};

finish({
  probe: 'g-omp-agents-md-path',
  verdict: verdictBase,
  derived: `instructions.path=${sets.omp_target.instructions.path} mode=whole-file`,
  evidence: JSON.parse(redact(JSON.stringify(evidence), scratch)),
  sets, args, scratch, realBefore,
});
