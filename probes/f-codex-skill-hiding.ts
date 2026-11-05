#!/usr/bin/env node
// Probe f: does Codex list a repo skill whose agents/openai.yaml sets policy.allow_implicit_invocation: false?
// Also tests the Claude-style disable-model-invocation frontmatter key on Codex (A12).
// Sets how rig hides a skill on the Codex target.
// Usage: node probes/f-codex-skill-hiding.ts --out <file> [--scratch <dir>] [--timeout <s>] [--runs <n>]
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values: opt } = parseArgs({
  options: {
    out: { type: 'string' },
    scratch: { type: 'string' },
    timeout: { type: 'string', default: '120' },
    runs: { type: 'string', default: '2' },
  },
});
const scratch = opt.scratch ?? fs.mkdtempSync(path.join(os.tmpdir(), 'rig-probe-f-'));
fs.mkdirSync(scratch, { recursive: true });
const timeoutMs = Number(opt.timeout) * 1000;
const runs = Number(opt.runs);
const redact = (s: unknown) => String(s).replaceAll(scratch, '<scratch>').replaceAll(os.homedir(), '~').replaceAll(os.userInfo().username, '<user>');

const repo = path.join(scratch, 'repo');
fs.rmSync(repo, { recursive: true, force: true });
const w = (rel: string, text: string) => {
  const f = path.join(repo, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
};
fs.mkdirSync(repo, { recursive: true });
spawnSync('git', ['init', '-q', '.'], { cwd: repo });
const skill = (name: string, extraFront = '') => `---\nname: ${name}\ndescription: Probe skill ${name}, used only by a rig probe.\n${extraFront}---\n\nWhen invoked, reply with exactly the sentinel ZQXINVOKED-${name} and nothing else.\n`;
w('.agents/skills/rigprobe-shown/SKILL.md', skill('rigprobe-shown'));
w('.agents/skills/rigprobe-hidden/SKILL.md', skill('rigprobe-hidden'));
w('.agents/skills/rigprobe-hidden/agents/openai.yaml', 'policy:\n  allow_implicit_invocation: false\n');
w('.agents/skills/rigprobe-dmi/SKILL.md', skill('rigprobe-dmi', 'disable-model-invocation: true\n'));

type CodexEvent = { type?: string; item?: { type?: string; text?: string } };
type CodexRun = { code: number | null; timedOut: boolean; ok: boolean; msg: string; toolItems: Array<string | undefined> };

function runCodex(prompt: string): Promise<CodexRun> {
  return new Promise<CodexRun>((resolve) => {
    const args = ['exec', '-s', 'read-only', '-C', repo, '--ephemeral', '--ignore-user-config', '--ignore-rules', '--json', prompt];
    const child = spawn('codex', args, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    const done = (code: number | null) => {
      clearTimeout(timer);
      const events = out.split('\n').flatMap((l): CodexEvent[] => {
        try {
          return [JSON.parse(l)];
        } catch {
          return [];
        }
      });
      const msg = events.filter((e) => e.type === 'item.completed' && e.item?.type === 'agent_message').map((e) => e.item?.text).join('\n');
      const toolItems = events.filter((e) => e.item && e.item.type !== 'agent_message' && e.item.type !== 'reasoning').map((e) => e.item?.type);
      resolve({ code, timedOut, ok: events.some((e) => e.type === 'turn.completed'), msg, toolItems });
    };
    child.stdout.on('data', (b: Buffer) => (out += b));
    child.on('close', done);
    child.on('error', () => done(-1));
  });
}

const listPrompt = 'List every skill in your available-skills list whose name starts with rigprobe, one name per line. Answer from your instructions only. Do not run commands or read files. If none, answer NONE.';
const listRuns: Array<{ run: number; ok: boolean; names: string[]; toolItems: Array<string | undefined>; answer: string }> = [];
for (let i = 0; i < runs; i++) {
  const r = await runCodex(listPrompt);
  const names = [...new Set(r.msg.match(/rigprobe-[a-z]+/g) ?? [])];
  listRuns.push({ run: i + 1, ok: r.ok && !r.timedOut, names, toolItems: r.toolItems, answer: redact(r.msg).slice(0, 300) });
}
const inv: Record<string, { ok: boolean; invoked: boolean; toolItems: Array<string | undefined>; answer: string }> = {};
for (const n of ['hidden', 'dmi']) {
  const r = await runCodex(`$rigprobe-${n}`);
  inv[n] = { ok: r.ok && !r.timedOut, invoked: r.msg.includes(`ZQXINVOKED-rigprobe-${n}`), toolItems: r.toolItems, answer: redact(r.msg).slice(0, 200) };
}

const allOk = listRuns.every((r) => r.ok);
const shownListed = listRuns.every((r) => r.names.includes('rigprobe-shown'));
const hiddenListed = listRuns.map((r) => r.names.includes('rigprobe-hidden'));
const dmiListed = listRuns.map((r) => r.names.includes('rigprobe-dmi'));
const consistent = (a: boolean[]) => a.every((x) => x === a[0]);
let verdict = 'INCONCLUSIVE';
let reason = '';
if (!allOk) reason = 'a run failed or timed out';
else if (!shownListed) reason = 'control skill rigprobe-shown is not listed, so repo .agents/skills may not be read (or the project is untrusted)';
else if (!consistent(hiddenListed) || !consistent(dmiListed)) reason = 'runs disagree';
else verdict = hiddenListed[0] ? 'FAIL' : 'PASS';

const report = {
  probe: 'f-codex-skill-hiding',
  claim: 'A12: agents/openai.yaml policy.allow_implicit_invocation: false removes a skill from the Codex listing (PASS = absent from listing). The disable-model-invocation key is reported separately.',
  verdict,
  evidence: {
    strength: 'model-reported, but the JSON event stream shows no tool item in the listing runs, so the list came from injected instructions',
    codexVersion: redact(spawnSync('codex', ['--version'], { encoding: 'utf8' }).stdout.trim()),
    reason: reason || undefined,
    listingRuns: listRuns,
    openaiYamlSkillListed: hiddenListed[0] ?? null,
    disableModelInvocationSkillListed: dmiListed[0] ?? null,
    explicitInvocation: inv,
    binaryMentionsAllowImplicitInvocation: (() => {
      const bin = fs.realpathSync(spawnSync('which', ['codex'], { encoding: 'utf8' }).stdout.trim());
      return spawnSync('grep', ['-a', '-c', 'allowImplicitInvocation', bin], { encoding: 'utf8' }).stdout.trim() !== '0';
    })(),
  },
  sets: {
    'codex.skills.hide': verdict === 'INCONCLUSIVE' ? null : { mechanism: 'agents/openai.yaml policy.allow_implicit_invocation: false', removedFromListing: !hiddenListed[0], disableModelInvocationKeyRemovesFromListing: !dmiListed[0], explicitDollarInvocationWorks: inv.hidden?.invoked },
  },
};
const json = JSON.stringify(report, null, 2);
if (opt.out) fs.writeFileSync(opt.out, `${json}\n`);
console.log(json);
