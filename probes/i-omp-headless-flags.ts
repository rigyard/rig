#!/usr/bin/env node
// Probe i (omp part): headless flags, JSON output shape and directory overrides.
// Usage: node probes/i-omp-headless-flags.ts [--out <file>] [--scratch <dir>] [--model <id>]
import { spawn } from 'node:child_process';
import path from 'node:path';
import {
  assertIsolated, createScratch, finish, isolatedEnv, jsonEvents, lastAssistantText, modelOverrideUsed,
  newIsolated, parseArgs, realConfigState, redact, runOmp, setModel,
} from './lib/omp.ts';

const args = parseArgs(process.argv.slice(2));
setModel(args.model);
const realBefore = realConfigState();
const scratch = createScratch(args.scratch);
const iso = newIsolated(scratch, 'i');
assertIsolated(iso, isolatedEnv(iso));

// Flags that a headless omp invocation in rig (writer probes, `second-opinion` template, stubs) may use.
const REQUIRED = [
  '--print', '--mode', '--model', '--profile', '--cwd', '--session-dir', '--no-session', '--no-tools',
  '--thinking', '--config', '--add-dir', '--skills', '--no-skills', '--no-context-files', '--system-prompt',
  '--append-system-prompt', '--max-time', '--approval-mode', '--auto-approve', '--smol', '--slow', '--plan',
];

const help = await runOmp(iso, ['--help']);
if (help.spawnError === 'ENOENT') {
  finish({ probe: 'i-omp-headless-flags', verdict: 'INCONCLUSIVE', derived: 'omp binary absent', evidence: { error: 'omp not found on PATH' }, sets: {}, args, scratch, realBefore });
  process.exit(0);
}
const helpText = help.stdout;
const flags: string[] = [];
const shortFlags: Record<string, string> = {};
for (const line of helpText.split('\n')) {
  const m = /^\s{2,}(?:(-[A-Za-z]),\s+)?(--[a-z][\w-]*)/.exec(line);
  if (!m) continue;
  flags.push(m[2]);
  if (m[1]) shortFlags[m[1]] = m[2];
}
const missing = REQUIRED.filter((f) => !flags.includes(f));
const modeLine = (/--mode=<value>\s+(.*)/.exec(helpText) ?? [])[1] ?? null;
const envLines = helpText.split('\n').filter((l: string) => /^\s+(PI_CODING_AGENT_DIR|OMP_PROFILE)\b/.test(l)).map((l) => l.trim().replace(/\s+/g, ' '));
const version = (await runOmp(iso, ['--version'])).stdout.trim();
const configHelp = (await runOmp(iso, ['config', '--help'])).stdout;
const configActions = (/ACTION\s+Config action \(([^)]*)\)/.exec(configHelp) ?? [])[1] ?? null;

// Part 2: one minimal JSON run, stdin closed.
const run = await runOmp(iso, ['-p', '--mode', 'json', '--no-session', 'reply with the single word ok']);
const events = jsonEvents(run.stdout);
const types = events ? [...new Set(events.map((e) => e.type))] : null;
const finalMsg = events?.filter((e) => e.type === 'message_end' && e.message?.role === 'assistant').at(-1)?.message;
const usageKeys = finalMsg?.usage ? Object.keys(finalMsg.usage) : null;
const jsonRun = {
  exit: run.code,
  every_stdout_line_parses_as_json: events !== null,
  event_types: types,
  ends_with_agent_end: Boolean(events && events.at(-1)?.type === 'agent_end'),
  answered: Boolean(events && lastAssistantText(events)),
  assistant_usage_fields: usageKeys,
  usage_has_cost_total: typeof finalMsg?.usage?.cost?.total === 'number',
  first_event_is_session_with_cwd: Boolean(events && events[0]?.type === 'session' && events[0].cwd),
  model_override_used: modelOverrideUsed(),
};

// Stdin: `omp -p` with an open stdin pipe never starts. A closed stdin works (the run above).
async function openStdinRun() {
  const child = spawn('omp', ['-p', '--mode', 'json', '--no-session', 'reply with the single word ok'], { cwd: iso.proj, env: isolatedEnv(iso), stdio: ['pipe', 'pipe', 'pipe'] });
  let bytes = 0;
  child.stdout.on('data', (d: Buffer) => (bytes += d.length));
  child.stderr.on('data', () => {});
  const exited = new Promise<{ code: number | null; timedOut?: undefined }>((resolve) => child.on('close', (code) => resolve({ code })));
  const timer = new Promise<{ timedOut: true; code?: undefined }>((resolve) => setTimeout(() => resolve({ timedOut: true }), 15_000));
  const r = await Promise.race([exited, timer]);
  if (r.timedOut) child.kill('SIGKILL');
  return { hung_after_15s: Boolean(r.timedOut), stdout_bytes: bytes };
}
const stdinOpen = await openStdinRun();

// Directory overrides, read with `omp config path` (no model call).
const withProfileEnv = { ...isolatedEnv(iso), OMP_PROFILE: 'probe-profile' };
const rel = (p: string) => {
  const t = p.trim();
  return t ? redact(t, scratch) : t;
};
const pathEnv = await runOmp(iso, ['config', 'path']);
const pathFlag = await runOmp(iso, ['--profile', 'probe-profile', 'config', 'path']);
const pathProfileEnv = await runOmp(iso, ['config', 'path'], { env: withProfileEnv, allowProfile: true });
const overrides = {
  PI_CODING_AGENT_DIR_only: { config_path: rel(pathEnv.stdout), equals_agent_dir: path.resolve(pathEnv.stdout.trim()) === path.resolve(iso.agentDir) },
  with_profile_flag: { config_path: rel(pathFlag.stdout), profile_beats_agent_dir_env: path.resolve(pathFlag.stdout.trim()) !== path.resolve(iso.agentDir) },
  with_OMP_PROFILE_env: { config_path: rel(pathProfileEnv.stdout), profile_beats_agent_dir_env: path.resolve(pathProfileEnv.stdout.trim()) !== path.resolve(iso.agentDir) },
};

const evidence = {
  omp_version: version,
  help: { exit: help.code, flag_count: flags.length, short_flags: shortFlags, required_flags: REQUIRED, missing_required_flags: missing, mode_values_line: modeLine, env_lines: envLines, config_actions: configActions },
  all_flags: flags,
  json_run: jsonRun,
  stdin_open_pipe_run: stdinOpen,
  directory_overrides: overrides,
};

let verdict: string;
if (help.code !== 0 || !flags.length) verdict = 'INCONCLUSIVE';
else if (missing.length) verdict = 'FAIL';
else if (!jsonRun.every_stdout_line_parses_as_json || !jsonRun.ends_with_agent_end || run.code !== 0) verdict = run.code === 0 ? 'FAIL' : 'INCONCLUSIVE';
else verdict = 'PASS';

const sets = {
  omp_target: {
    headless_argv: ['omp', '-p', '--mode', 'json', '--no-session', '[--model', '<id>]', '[--thinking', '<level>]', '[--cwd', '<dir>]', '<prompt>'],
    stdin: 'must be closed or ignored; an open stdin pipe hangs `omp -p` with no output',
    output: 'JSON lines; first event `session` with cwd, last event `agent_end`; assistant `message_end` carries `usage` with `cost.total`',
    isolation_env: { PI_CODING_AGENT_DIR: '<dir>', HOME: '<dir>', profile_precedence: 'a profile (--profile or OMP_PROFILE) overrides PI_CODING_AGENT_DIR' },
    config_overlay_flag: '--config <file> (config.yml-style overlay for one run)',
    model_flag: '--model (fuzzy match; exact form provider/id)',
  },
  resolves: ['A14 (omp part)'],
};

finish({
  probe: 'i-omp-headless-flags',
  verdict,
  derived: `required_flags_missing=${missing.length} json_ok=${jsonRun.ends_with_agent_end} open_stdin_hangs=${stdinOpen.hung_after_15s}`,
  evidence, sets, args, scratch, realBefore,
});
