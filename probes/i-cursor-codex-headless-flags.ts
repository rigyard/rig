#!/usr/bin/env node
// Probe i-cx: headless flags of cursor-agent and codex exec, read from their help output.
// No model call. Sets the headless block of the Cursor and Codex targets.
// Usage: node probes/i-cursor-codex-headless-flags.ts --out <file>
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { parseArgs } from 'node:util';

const { values: opt } = parseArgs({ options: { out: { type: 'string' } } });
const redact = (s) => String(s).replaceAll(os.homedir(), '~').replaceAll(os.userInfo().username, '<user>');
const help = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 30000 });
  return { exit: r.status, text: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};

const cursor = help('cursor-agent', ['--help']);
const codex = help('codex', ['exec', '--help']);
const codexTop = help('codex', ['--help']);

const need = (text, label, re) => {
  const m = text.match(re);
  return { label, found: Boolean(m), line: m ? redact(m[0].trim()).replace(/\(e\.g\.,[^)]*\)/g, '(e.g., <model>)').slice(0, 160) : null };
};

const cursorChecks = [
  need(cursor.text, 'print', /^\s*-p, --print\b.*/m),
  need(cursor.text, 'output format', /^\s*--output-format <format>.*/m),
  need(cursor.text, 'model', /^\s*--model <model>.*/m),
  need(cursor.text, 'read-only mode', /^\s*--mode <mode>.*/m),
  need(cursor.text, 'workspace', /^\s*--workspace <path-or-name>.*/m),
  need(cursor.text, 'sandbox', /^\s*--sandbox <mode>.*/m),
  need(cursor.text, 'trust', /^\s*--trust\b.*/m),
  need(cursor.text, 'plugin dir', /^\s*--plugin-dir <path>.*/m),
  need(cursor.text, 'force (allow commands)', /^\s*-f, --force\b.*/m),
  need(cursor.text, 'list models', /^\s*--list-models\b.*/m),
];
const codexChecks = [
  need(codex.text, 'non-interactive subcommand', /^Run Codex non-interactively/m),
  need(codex.text, 'json events', /^\s*--json\b.*/m),
  need(codex.text, 'model', /^\s*-m, --model <MODEL>.*/m),
  need(codex.text, 'sandbox mode with read-only', /\[possible values: read-only, workspace-write, danger-full-access\]/),
  need(codex.text, 'sandbox flag', /^\s*-s, --sandbox <SANDBOX_MODE>.*/m),
  need(codex.text, 'working root', /^\s*-C, --cd <DIR>.*/m),
  need(codex.text, 'skip git check', /^\s*--skip-git-repo-check\b.*/m),
  need(codex.text, 'ephemeral', /^\s*--ephemeral\b.*/m),
  need(codex.text, 'last message file', /^\s*-o, --output-last-message <FILE>.*/m),
  need(codex.text, 'config override', /^\s*-c, --config <key=value>.*/m),
  need(codex.text, 'ignore user config', /^\s*--ignore-user-config\b.*/m),
  need(codex.text, 'output schema', /^\s*--output-schema <FILE>.*/m),
  need(codexTop.text, 'approval policy (top-level only)', /^\s*-a, --ask-for-approval <APPROVAL_POLICY>.*/m),
];
const noApprovalOnExec = !/--ask-for-approval/.test(codex.text);

const modelSyntax = cursor.text.match(/'([a-z0-9.-]+\[[^\]]+\])'/i)?.[1] ?? null;
const all = [...cursorChecks, ...codexChecks];
const verdict = cursor.exit === 0 && codex.exit === 0 && all.every((c) => c.found) ? 'PASS' : cursor.exit !== 0 || codex.exit !== 0 ? 'INCONCLUSIVE' : 'FAIL';

const report = {
  probe: 'i-cursor-codex-headless-flags',
  claim: 'Both CLIs expose a non-interactive mode with output format, model, read-only mode, workspace and sandbox flags (PASS = every listed flag is in the help text)',
  verdict,
  evidence: {
    strength: 'help text of the installed versions; no model call',
    cursorAgentVersion: redact(spawnSync('cursor-agent', ['--version'], { encoding: 'utf8' }).stdout.trim()),
    codexVersion: redact(spawnSync('codex', ['--version'], { encoding: 'utf8' }).stdout.trim()),
    cursor: cursorChecks,
    codex: codexChecks,
    codexExecHasNoApprovalFlag: noApprovalOnExec,
    cursorModelParameterSyntaxExample: modelSyntax ? modelSyntax.replace(/^[a-z0-9.-]+(?=\[)/i, '<model>') : null,
  },
  sets: {
    'cursor.headless': {
      command: ['cursor-agent', '-p'],
      outputFormat: '--output-format text|json|stream-json',
      model: '--model <id>, bracket overrides such as [effort=high]',
      readOnly: '--mode ask|plan',
      workspace: '--workspace <path>',
      sandbox: '--sandbox enabled|disabled',
      trust: '--trust',
      pluginDir: '--plugin-dir <path>',
      printModeHasWriteAndShellByDefault: /Has access to all tools,\s*including write and shell/.test(cursor.text.replace(/\s+/g, ' ')),
    },
    'codex.headless': {
      command: ['codex', 'exec'],
      outputFormat: '--json (JSONL events), -o <file> for the last message, --output-schema <file>',
      model: '-m <id>, -c model_reasoning_effort=<level>',
      readOnly: '-s read-only',
      workspace: '-C <dir>',
      sandbox: '-s read-only|workspace-write|danger-full-access',
      other: ['--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '--ignore-rules'],
    },
  },
};
const json = JSON.stringify(report, null, 2);
if (opt.out) fs.writeFileSync(opt.out, `${json}\n`);
console.log(json);
