#!/usr/bin/env node
// Probe d: size limit of a project AGENTS.md in Codex. Resolves assumption A32.
// Sets the byte limit of the Codex target's instructions surface.
// Usage: node probes/d-codex-agents-md-limit.mjs --out <file> [--scratch <dir>] [--timeout <s>] [--runs <n>]
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
const scratch = opt.scratch ?? fs.mkdtempSync(path.join(os.tmpdir(), 'rig-probe-d-'));
fs.mkdirSync(scratch, { recursive: true });
const timeoutMs = Number(opt.timeout) * 1000;
const runs = Number(opt.runs);
const redact = (s) => String(s).replaceAll(scratch, '<scratch>').replaceAll(os.homedir(), '~').replaceAll(os.userInfo().username, '<user>');

const TOTAL = 40 * 1024;
const TARGETS = [4096, 16384, 30720, 31744, 32700, 32800, 33280, 36864, 39936];

function buildDoc() {
  let out = '# Probe doc\n\n';
  const starts = {};
  let i = 0;
  const size = () => Buffer.byteLength(out);
  for (const t of TARGETS) {
    while (size() + 80 < t) out += `Filler line ${String(i++).padStart(5, '0')} for the rig probe, ignore this text.\n`;
    const rest = t - size();
    if (rest >= 2) out += `${'p'.repeat(rest - 1)}\n`;
    const name = `RIGSENT-${t}`;
    starts[name] = size();
    out += `${name}\n`;
  }
  while (size() < TOTAL) out += `Filler line ${String(i++).padStart(5, '0')} for the rig probe, ignore this text.\n`;
  const sentinels = Object.entries(starts).map(([name, start]) => ({ name, start, end: start + Buffer.byteLength(name) + 1 }));
  return { text: out, sentinels };
}

const repo = path.join(scratch, 'repo');
fs.rmSync(repo, { recursive: true, force: true });
fs.mkdirSync(repo, { recursive: true });
spawnSync('git', ['init', '-q', '.'], { cwd: repo });
const { text, sentinels } = buildDoc();
fs.writeFileSync(path.join(repo, 'AGENTS.md'), text);

const PROMPT = 'List every line in your instructions that starts with RIGSENT-, exactly as written, one per line. Do not read files or run commands.';
function runCodex(extra = []) {
  return new Promise((resolve) => {
    const args = ['exec', '-s', 'read-only', '-C', repo, '--ephemeral', '--ignore-user-config', '--ignore-rules', '--json', ...extra, PROMPT];
    const child = spawn('codex', args, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    const done = (code) => {
      clearTimeout(timer);
      const events = out.split('\n').flatMap((l) => {
        try {
          return [JSON.parse(l)];
        } catch {
          return [];
        }
      });
      const msg = events.filter((e) => e.type === 'item.completed' && e.item?.type === 'agent_message').map((e) => e.item.text).join('\n');
      const toolItems = events.filter((e) => e.item && e.item.type !== 'agent_message' && e.item.type !== 'reasoning').map((e) => e.item.type);
      const seen = [...new Set(msg.match(/RIGSENT-\d+/g) ?? [])];
      resolve({ code, timedOut, ok: events.some((e) => e.type === 'turn.completed'), seen, toolItems, answer: msg.slice(0, 400) });
    };
    child.stdout.on('data', (b) => (out += b));
    child.on('close', done);
    child.on('error', () => done(-1));
  });
}

const defaultRuns = [];
for (let i = 0; i < runs; i++) defaultRuns.push(await runCodex());
const raised = await runCodex(['-c', 'project_doc_max_bytes=65536']);

const bin = fs.realpathSync(spawnSync('which', ['codex'], { encoding: 'utf8' }).stdout.trim());
const g = spawnSync('grep', ['-a', '-o', 'project_doc_max_bytes = [0-9]*', bin], { encoding: 'utf8', maxBuffer: 1 << 24 });
const binaryDefault = [...new Set(g.stdout.split('\n').filter(Boolean))];
const helpHits = ['--help', 'exec --help'].map((a) => {
  const r = spawnSync('codex', a.split(' '), { encoding: 'utf8' });
  return { command: `codex ${a}`, mentionsProjectDoc: /project_doc|AGENTS\.md/i.test(r.stdout + r.stderr) };
});

const sets = (r) => new Set(r.seen);
const classify = (r) => sentinels.map((s) => ({ ...s, seen: sets(r).has(s.name) }));
const rows = defaultRuns.map(classify);
const stable = rows.every((r) => r.every((x, i) => x.seen === rows[0][i].seen));
const first = rows[0] ?? [];
const highestSeenEnd = Math.max(0, ...first.filter((x) => x.seen).map((x) => x.end));
const lowestUnseenStart = Math.min(Infinity, ...first.filter((x) => !x.seen).map((x) => x.start));
const monotone = first.every((x) => x.seen === (x.end <= highestSeenEnd));
const okAll = defaultRuns.every((r) => r.ok && !r.timedOut);
let verdict = 'INCONCLUSIVE';
let limit = null;
let reason = '';
if (!okAll) reason = 'a run failed or timed out';
else if (!stable) reason = 'runs disagree on which sentinels are visible';
else if (!monotone || lowestUnseenStart === Infinity) reason = 'visible sentinels do not form a prefix of the file';
else {
  limit = { lowerBoundBytes: highestSeenEnd, upperBoundBytes: lowestUnseenStart };
  verdict = highestSeenEnd <= 32768 && lowestUnseenStart >= 32768 && lowestUnseenStart - highestSeenEnd <= 2048 ? 'PASS' : 'FAIL';
}

const report = {
  probe: 'd-codex-agents-md-limit',
  claim: 'A32: the Codex AGENTS.md cap is 32 KiB (32768 bytes) (PASS = cut falls on 32768 within the sentinel spacing)',
  verdict,
  evidence: {
    strength: 'model-reported, but the JSON event stream shows no tool item, so the text came from injected instructions',
    codexVersion: redact(spawnSync('codex', ['--version'], { encoding: 'utf8' }).stdout.trim()),
    docBytes: Buffer.byteLength(text),
    sentinelsInFile: sentinels,
    reason: reason || undefined,
    visibleInDefaultRuns: defaultRuns.map((r, i) => ({ run: i + 1, ok: r.ok, timedOut: r.timedOut, seen: r.seen, toolItems: r.toolItems, answer: r.answer })),
    inferredCutBetweenBytes: limit,
    withRaisedLimitFlag: { flag: 'project_doc_max_bytes=65536', ok: raised.ok, seen: raised.seen, toolItems: raised.toolItems },
    documentedDefaultInBinary: binaryDefault,
    helpMentionsLimit: helpHits,
    caveat: 'The user-level ~/.codex/AGENTS.md was not removed. Whether it loads under --ignore-user-config is unknown. The cut near 32768 shows it did not shrink the project budget in this invocation.',
  },
  sets: { 'codex.instructions.byteLimit': limit && verdict === 'PASS' ? 32768 : null },
};
const json = JSON.stringify(report, null, 2);
if (opt.out) fs.writeFileSync(opt.out, `${json}\n`);
console.log(json);
