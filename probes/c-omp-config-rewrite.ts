#!/usr/bin/env node
// Probe c: does omp rewrite config.yml, and what survives the rewrite?
// Usage: node probes/c-omp-config-rewrite.ts [--out <file>] [--scratch <dir>]
import fs from 'node:fs';
import path from 'node:path';
import {
  assertIsolated, createScratch, finish, isolatedEnv, jsonEvents, lastAssistantText, newIsolated,
  modelOverrideUsed, parseArgs, realConfigState, redact, runOmp, setModel, sha256, writeFile,
} from './lib/omp.ts';

const args = parseArgs(process.argv.slice(2));
setModel(args.model);
const realBefore = realConfigState();
const scratch = createScratch(args.scratch);
const iso = newIsolated(scratch, 'c');
assertIsolated(iso, isolatedEnv(iso));

const ROLES: Record<string, string> = {
  plan: 'provider/model-e:medium',
  default: 'provider/model-a:medium',
  task: 'provider/model-b:low',
  advisor: 'provider/model-c:high',
  judge: 'provider/model-d:high',
};
const COMMENT = '# rig-probe comment: top';
const MARKER = '# rig:models:start';
const config = [
  COMMENT,
  'zeta: 1',
  'modelRoles:',
  ...Object.entries(ROLES).map(([k, v]) => `  ${k}: ${v}`),
  MARKER,
  'rigProbeUnknown: 1',
  'defaultThinkingLevel: medium',
  'alpha: 2',
  '',
].join('\n');
const cfg = path.join(iso.agentDir, 'config.yml');
const lock = `${cfg}.lock`;
writeFile(cfg, config, 0o600);

const topKeys = (text: string) => text.split('\n').filter((l: string) => /^[A-Za-z_][\w-]*:/.test(l)).map((l: string) => l.split(':')[0]);
const isSubsequence = (small: string[], big: string[]) => {
  let i = 0;
  for (const x of big) if (x === small[i]) i++;
  return i === small.length;
};

// Line-level locator for modelRoles cells. This is the shape that rig's writer must read.
function locateRoles(text: string): { block_style: boolean; cells: Record<string, string> } {
  const lines = text.split('\n');
  const start = lines.findIndex((l: string) => /^modelRoles:\s*$/.test(l));
  if (start < 0) return { block_style: false, cells: {} };
  const cells: Record<string, string> = {};
  for (let i = start + 1; i < lines.length; i++) {
    const m = /^ {2}([A-Za-z]+): (\S.*)$/.exec(lines[i]);
    if (!m) break;
    cells[m[1]] = m[2];
  }
  return { block_style: true, cells };
}

function snapshot() {
  const buf = fs.readFileSync(cfg);
  return { text: buf.toString('utf8'), sha: sha256(buf), bytes: buf.length, mode: (fs.statSync(cfg).mode & 0o777).toString(8), lock: fs.existsSync(lock) };
}

type Snapshot = ReturnType<typeof snapshot>;

function compare(before: Snapshot, after: Snapshot, expectedRoles: Record<string, string>) {
  const roles = locateRoles(after.text);
  const orderOk = isSubsequence(topKeys(before.text), topKeys(after.text));
  return {
    rewritten: before.sha !== after.sha,
    comment_kept: after.text.includes(COMMENT),
    marker_kept: after.text.includes(MARKER),
    unknown_key_kept: /^rigProbeUnknown: 1$/m.test(after.text),
    key_order_kept: orderOk,
    top_level_keys_after: topKeys(after.text),
    mode_before: before.mode,
    mode_after: after.mode,
    mode_kept: before.mode === after.mode,
    lock_file_before: before.lock,
    lock_file_after: after.lock,
    trailing_newline_kept: before.text.endsWith('\n') === after.text.endsWith('\n'),
    model_roles_block_style: roles.block_style,
    model_roles_cells_found: Object.keys(roles.cells).length,
    model_roles_values_as_expected: Object.entries(expectedRoles).every(([k, v]) => roles.cells[k] === v),
  };
}

const steps: Record<string, unknown> = {};
let prev = snapshot();
const run = async (label: string, argv: string[]) => {
  const r = await runOmp(iso, argv);
  const now = snapshot();
  return { r, now, label };
};

// Step 1: read-only commands must not rewrite.
for (const argv of [['config', 'list'], ['config', 'get', 'modelRoles']]) {
  const { r, now } = await run(argv.join(' '), argv);
  steps[argv.join(' ')] = { exit: r.code, rewritten: now.sha !== prev.sha, lock_file_after: now.lock };
  prev = now;
}

// Step 2: a plain headless run.
{
  const r = await runOmp(iso, ['-p', '--mode', 'json', '--no-session', 'reply with the single word ok']);
  const events = jsonEvents(r.stdout) ?? [];
  const now = snapshot();
  steps['-p run'] = {
    exit: r.code,
    model_answered: Boolean(lastAssistantText(events)),
    model_override_used: modelOverrideUsed(),
    rewritten: now.sha !== prev.sha,
    lock_file_after: now.lock,
  };
  prev = now;
}

// Step 3: a settings change unrelated to modelRoles, through omp itself.
let unrelated: ({ command: string; exit: number | null } & ReturnType<typeof compare>) | undefined;
{
  const before = prev;
  const r = await runOmp(iso, ['config', 'set', 'symbolPreset', 'ascii']);
  const after = snapshot();
  unrelated = { command: 'omp config set symbolPreset ascii', exit: r.code, ...compare(before, after, ROLES) };
  prev = after;
}

// Step 4: change one modelRoles cell the only way omp allows it (whole map as JSON).
let roles: ({ command: string; exit: number | null; dotted_key_command_exit: number | null; dotted_key_command_message: string } & ReturnType<typeof compare>) | undefined;
{
  const before = prev;
  const changed = { ...ROLES, default: 'provider/model-q:low' };
  const sub = await runOmp(iso, ['config', 'set', 'modelRoles.default', 'provider/model-q:low']);
  const whole = await runOmp(iso, ['config', 'set', 'modelRoles', JSON.stringify(changed)]);
  const after = snapshot();
  roles = {
    command: 'omp config set modelRoles <json map>',
    exit: whole.code,
    dotted_key_command_exit: sub.code,
    dotted_key_command_message: redact(sub.stdout + sub.stderr, scratch).split('\n')[0],
    ...compare(before, after, changed),
  };
}

const evidence = {
  setup: 'config.yml mode 0600 with a comment line, a marker line, an unknown key, a custom key order and five placeholder modelRoles values',
  read_only_and_plain_run: steps,
  settings_change_unrelated_key: unrelated,
  settings_change_model_roles: roles,
  how_a_write_was_triggered: '`omp config set <key> <value>` (subcommand `config`, actions list, get, set, reset, path, init-xdg). No flag or slash command was needed.',
};

let verdict;
if (!unrelated.rewritten) verdict = 'INCONCLUSIVE';
else if (!unrelated.model_roles_block_style || unrelated.model_roles_cells_found !== 5 || !unrelated.model_roles_values_as_expected || !roles.model_roles_values_as_expected) verdict = 'FAIL';
else verdict = 'PASS';

const sets = {
  omp_target: {
    config_yml: {
      harness_rewrites: unrelated.rewritten,
      locator: 'yaml-map-value (line level, block style, two-space indent)',
      comments_survive_rewrite: unrelated.comment_kept,
      markers_allowed_in_file: unrelated.marker_kept,
      unknown_keys_survive: unrelated.unknown_key_kept,
      key_order_survives: unrelated.key_order_kept,
      lock_file: unrelated.lock_file_after ? 'config.yml.lock (created by omp on first write)' : null,
      mode_survives: unrelated.mode_kept,
    },
  },
  resolves: ['A26'],
};

finish({
  probe: 'c-omp-config-rewrite',
  verdict,
  derived: `harness_rewrites=${unrelated.rewritten} comments_kept=${unrelated.comment_kept} marker_kept=${unrelated.marker_kept}`,
  evidence, sets, args, scratch, realBefore,
});
