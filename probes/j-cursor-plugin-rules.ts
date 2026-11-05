#!/usr/bin/env node
// Probe j: Cursor plugin channel (--plugin-dir) and rules (project and user level).
// Informs assumption A24 (user-level always-on rules). Sets the Cursor channel and rules facts.
// Usage: node probes/j-cursor-plugin-rules.ts --out <file> [--scratch <dir>] [--model <id>] [--timeout <s>]
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values: opt } = parseArgs({
  options: {
    out: { type: 'string' },
    scratch: { type: 'string' },
    model: { type: 'string', default: 'composer-2.5' },
    timeout: { type: 'string', default: '120' },
  },
});
const scratch = opt.scratch ?? fs.mkdtempSync(path.join(os.tmpdir(), 'rig-probe-j-'));
fs.mkdirSync(scratch, { recursive: true });
const timeoutMs = Number(opt.timeout) * 1000;
const redact = (s: unknown) =>
  String(s)
    .replaceAll(scratch, '<scratch>')
    .replaceAll(os.homedir(), '~')
    .replaceAll(os.userInfo().username, '<user>')
    .replaceAll(opt.model, '<model>');

const w = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const plug = path.join(scratch, 'plugin');
const wsMain = path.join(scratch, 'ws-main');
const wsUser = path.join(scratch, 'ws-user');
for (const d of [plug, wsMain, wsUser]) fs.rmSync(d, { recursive: true, force: true });
w(path.join(plug, '.cursor-plugin/plugin.json'), JSON.stringify({ name: 'rigprobe-pack', displayName: 'rigprobe-pack', version: '0.0.1', description: 'rig probe fixture', skills: './skills/' }));
w(path.join(plug, 'skills/rigprobe-plugin/SKILL.md'), '---\nname: rigprobe-plugin\ndescription: ZQXPLUGHID hidden plugin probe skill.\ndisable-model-invocation: true\n---\n\nWhen invoked, reply with exactly the sentinel ZQXPLUGINVOKED and nothing else.\n');
w(path.join(plug, 'skills/rigprobe-plugin-shown/SKILL.md'), '---\nname: rigprobe-plugin-shown\ndescription: ZQXPLUGSHOWN shown plugin probe skill.\n---\n\nReply with exactly ZQXSHOWNINVOKED.\n');
w(path.join(wsMain, '.cursor/skills/rigprobe-projhidden/SKILL.md'), '---\nname: rigprobe-projhidden\ndescription: ZQXPROJHID hidden project skill.\ndisable-model-invocation: true\n---\n\nReply with exactly ZQXPROJINVOKED.\n');
w(path.join(wsMain, '.cursor/rules/rigprobe.mdc'), '---\ndescription: rig probe rule\nalwaysApply: true\n---\n\nThe rig probe sentinel is ZQXRULESENT.\n');
fs.mkdirSync(wsUser, { recursive: true });

const KNOWN = new Set(['system', 'user', 'thinking', 'assistant', 'result']);
type CursorResult = { type?: string; result?: string; is_error?: boolean };
type CursorRun = { ok: boolean; timedOut: boolean; text: string; eventTypes: string[]; toolEvents: string[] };

function runCursor(ws: string, prompt: string, { pluginDir = null }: { pluginDir?: string | null } = {}): Promise<CursorRun> {
  return new Promise<CursorRun>((resolve) => {
    const args = ['-p', '--output-format', 'stream-json', '--mode', 'ask', '--trust', '--workspace', ws, '--model', opt.model];
    if (pluginDir) args.push('--plugin-dir', pluginDir);
    args.push(prompt);
    const child = spawn('cursor-agent', args, { cwd: ws, stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    let result: CursorResult | null = null;
    const types = new Set<string>();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    const done = () => {
      clearTimeout(timer);
      const toolEvents = [...types].filter((t) => !KNOWN.has(t));
      resolve({ ok: Boolean(result) && !result?.is_error, timedOut, text: result?.result ?? '', eventTypes: [...types], toolEvents });
    };
    child.stdout.on('data', (b: Buffer) => {
      buf += b;
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const l of lines) {
        try {
          const j = JSON.parse(l);
          types.add(j.type);
          if (j.type === 'result') {
            result = j;
            child.kill('SIGTERM');
          }
        } catch {}
      }
    });
    child.on('close', done);
    child.on('error', done);
  });
}

const listPrompt = 'List every available skill whose name starts with rigprobe, one per line, with its source path. Answer from your injected skill list. Do not read files.';
type Check = { verdict: string; detail?: string; answer?: string; toolEvents?: string[]; needsOperator?: string; supportingObservation?: unknown };
const checks = {} as Record<
  'pluginDirLoadsSkill' | 'disableModelInvocationHidesFromList' | 'hiddenPluginSkillInvocableBySlash' | 'hiddenProjectSkillInvocableBySlash' | 'projectRuleAlwaysApply' | 'userLevelRulesLoad' | 'userLevelLocalPluginsLoad',
  Check
>;

const list = await runCursor(wsMain, listPrompt, { pluginDir: plug });
const listed = (n: string) => new RegExp(`${n}(?![\\w-])`).test(list.text.split(/other\b|not in the session/i)[0]);
const shownPath = list.text.match(/rigprobe-plugin-shown[^\n]*/)?.[0] ?? '';
checks.pluginDirLoadsSkill = {
  verdict: list.ok && listed('rigprobe-plugin-shown') && shownPath.includes('plugin') ? 'PASS' : list.ok ? 'FAIL' : 'INCONCLUSIVE',
  detail: 'skill without disable-model-invocation, supplied only via --plugin-dir, appears in the model-visible skill list',
  answer: redact(list.text.split('\n').filter((l) => /rigprobe|ZQX/.test(l)).join('\n')).slice(0, 700),
  toolEvents: list.toolEvents,
};
checks.disableModelInvocationHidesFromList = {
  verdict: list.ok ? (!listed('rigprobe-plugin(?!-shown)') && !listed('rigprobe-projhidden') ? 'PASS' : 'FAIL') : 'INCONCLUSIVE',
  detail: 'plugin and project skills with disable-model-invocation: true are absent from the listing',
};

const inv = await runCursor(wsMain, '/rigprobe-plugin', { pluginDir: plug });
checks.hiddenPluginSkillInvocableBySlash = {
  verdict: inv.ok ? (inv.text.includes('ZQXPLUGINVOKED') ? 'PASS' : 'FAIL') : 'INCONCLUSIVE',
  detail: 'prompt "/rigprobe-plugin" returns the skill sentinel',
  answer: redact(inv.text).slice(0, 300),
  toolEvents: inv.toolEvents,
};
const invProj = await runCursor(wsMain, '/rigprobe-projhidden', { pluginDir: plug });
checks.hiddenProjectSkillInvocableBySlash = {
  verdict: invProj.ok ? (invProj.text.includes('ZQXPROJINVOKED') ? 'PASS' : 'FAIL') : 'INCONCLUSIVE',
  detail: 'control: same slash invocation for a hidden project skill',
  answer: redact(invProj.text).slice(0, 300),
  toolEvents: invProj.toolEvents,
};

const rule = await runCursor(wsMain, 'What is the rig probe sentinel? Reply with the sentinel only. Do not read files.');
checks.projectRuleAlwaysApply = {
  verdict: rule.ok ? (rule.text.includes('ZQXRULESENT') && rule.toolEvents.length === 0 ? 'PASS' : 'FAIL') : 'INCONCLUSIVE',
  detail: '.cursor/rules/rigprobe.mdc with alwaysApply: true; sentinel quoted with no tool event in the stream',
  answer: redact(rule.text).slice(0, 200),
  toolEvents: rule.toolEvents,
};

const rulesDir = path.join(os.homedir(), '.cursor/rules');
let userObs: Record<string, unknown> = { note: 'no always-on user rule file found to observe' };
try {
  for (const f of fs.readdirSync(rulesDir).filter((x) => x.endsWith('.mdc'))) {
    const txt = fs.readFileSync(path.join(rulesDir, f), 'utf8');
    const m = txt.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!m || !/alwaysApply:\s*true/.test(m[1])) continue;
    const line = m[2].split('\n').map((l) => l.trim()).find((l) => l.length >= 40);
    if (!line) continue;
    const start = line.slice(0, 40);
    const q = (s: string) => `Without reading any file and without searching: does your context contain a line that starts with exactly "${s}"? Answer YES or NO only.`;
    const ask = async (ws: string, text: string) => {
      const rs = [await runCursor(ws, text), await runCursor(ws, text)];
      return { answers: rs.map((r) => r.text.trim().slice(0, 20)), toolEvents: rs.flatMap((r) => r.toolEvents) };
    };
    const real = await ask(wsUser, q(start));
    const fake = await ask(wsUser, q('ZQX unique line that no rule contains 7f3a91'));
    const pos = await ask(wsMain, q('The rig probe sentinel is'));
    const all = (x: { answers: string[] }, re: RegExp) => x.answers.every((a) => re.test(a));
    const usable = all(pos, /yes/i) && all(fake, /^no/i);
    userObs = {
      userRuleLinePrefixAnswers: real.answers,
      negativeControlAnswers: fake.answers,
      positiveControlProjectRuleAnswers: pos.answers,
      usable,
      reading: !usable ? 'controls disagree, no reading' : all(real, /^no/i) ? 'the user-level always-on rule line is not in the headless context' : all(real, /yes/i) ? 'the user-level always-on rule line is in the headless context' : 'runs disagree',
      toolEvents: [...real.toolEvents, ...fake.toolEvents, ...pos.toolEvents],
      note: 'observation of a pre-existing user rule file, not a unique sentinel; supporting evidence only',
    };
    break;
  }
} catch (e) {
  const err = e as NodeJS.ErrnoException;
  userObs = { note: `could not observe: ${err.code ?? err.message}` };
}
checks.userLevelRulesLoad = {
  verdict: 'INCONCLUSIVE',
  needsOperator: 'write ~/.cursor/rules/rigprobe-user.mdc (alwaysApply: true, unique sentinel) in the real home directory, ask Cursor for the sentinel from a scratch workspace, then delete the file',
  supportingObservation: userObs,
};
let localObs: Record<string, unknown> = { note: 'no ~/.cursor/plugins/local plugin found to observe' };
try {
  const hasLocal = fs.readdirSync(path.join(os.homedir(), '.cursor/plugins/local')).length > 0;
  if (hasLocal) {
    const r = await runCursor(
      wsUser,
      'Answer from your injected skill list only, no file reads, no search. Two lines. A: YES or NO, does any entry have a source path containing "/.cursor/plugins/local/"? B: YES or NO, does any entry have a source path containing "/.cursor/plugins/cache/"?',
    );
    localObs = { answer: r.text.trim().slice(0, 80), toolEvents: r.toolEvents, note: 'a local plugin exists on this machine; line B is the positive control' };
  }
} catch (e) {
  const err = e as NodeJS.ErrnoException;
  localObs = { note: `could not observe: ${err.code ?? err.message}` };
}
checks.userLevelLocalPluginsLoad = {
  verdict: 'INCONCLUSIVE',
  supportingObservation: localObs,
  needsOperator: 'write a fixture plugin to ~/.cursor/plugins/local/rigprobe-pack in the real home directory, list skills from a scratch workspace, then delete it',
};

const versions = spawnSync('cursor-agent', ['--version'], { encoding: 'utf8' }).stdout.trim();
const verdicts = Object.values(checks).map((c) => c.verdict);
const verdict = verdicts.includes('FAIL') ? 'FAIL' : verdicts.includes('INCONCLUSIVE') ? 'INCONCLUSIVE' : 'PASS';
const report = {
  probe: 'j-cursor-plugin-rules',
  claim: 'Cursor loads a --plugin-dir plugin (hidden skills invocable), project alwaysApply rules, and user-level rules (A24). The overall verdict is the worst sub-verdict.',
  verdict,
  evidence: {
    strength: 'model-reported, but the stream-json event types show no tool call in the sentinel checks, so the text came from injected context',
    cursorAgentVersion: redact(versions),
    checks,
  },
  sets: {
    'cursor.channels.pluginDir': { flag: '--plugin-dir', manifest: '.cursor-plugin/plugin.json', loadsSkills: checks.pluginDirLoadsSkill.verdict === 'PASS' },
    'cursor.skills.hiddenByDisableModelInvocation': { listed: checks.disableModelInvocationHidesFromList.verdict === 'PASS' ? false : null, invocableBySlash: checks.hiddenPluginSkillInvocableBySlash.verdict === 'PASS' },
    'cursor.reads.projectRules.alwaysApply': checks.projectRuleAlwaysApply.verdict === 'PASS',
    'cursor.reads.userRules': null,
  },
};
const json = JSON.stringify(report, null, 2);
if (opt.out) fs.writeFileSync(opt.out, `${json}\n`);
console.log(json);
