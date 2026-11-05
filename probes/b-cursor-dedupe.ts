#!/usr/bin/env node
// Probe b: does Cursor collapse a skill that it finds in several project directories?
// Resolves assumption A23. Sets reads.skills[].dedupe on the Cursor target.
// Usage: node probes/b-cursor-dedupe.ts --out <file> [--scratch <dir>] [--model <id>] [--timeout <s>] [--runs <n>]
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
    runs: { type: 'string', default: '2' },
  },
});
const scratch = opt.scratch ?? fs.mkdtempSync(path.join(os.tmpdir(), 'rig-probe-b-'));
fs.mkdirSync(scratch, { recursive: true });
const timeoutMs = Number(opt.timeout) * 1000;
const runs = Number(opt.runs);
const DIRS = ['.cursor', '.agents', '.claude', '.codex'];
const KINDS = ['dup', 'diff', 'link', 'ctl'] as const;
type Kind = (typeof KINDS)[number];

const redact = (s: unknown) =>
  String(s)
    .replaceAll(scratch, '<scratch>')
    .replaceAll(os.homedir(), '~')
    .replaceAll(os.userInfo().username, '<user>')
    .replaceAll(opt.model, '<model>');

function skillMd(name: string, token: string) {
  return `---\nname: ${name}\ndescription: ${token} is the unique token of this probe skill.\n---\n\nThis skill exists only for a rig probe. Do nothing.\n`;
}

function writeSkill(ws: string, dir: string, name: string, token: string) {
  const d = path.join(ws, dir, 'skills', name);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'SKILL.md'), skillMd(name, token));
}

function makeWorkspaces() {
  const ws = {} as Record<Kind, string>;
  for (const kind of KINDS) {
    ws[kind] = path.join(scratch, `ws-${kind}`);
    fs.rmSync(ws[kind], { recursive: true, force: true });
    fs.mkdirSync(ws[kind], { recursive: true });
  }
  for (const d of DIRS) writeSkill(ws.dup, d, 'rigprobe-dup', 'ZQXDUP');
  for (const d of DIRS) writeSkill(ws.diff, d, 'rigprobe-diff', `ZQXDIFF${d.replace('.', '').toUpperCase()}`);
  writeSkill(ws.link, '.agents', 'rigprobe-link', 'ZQXLINK');
  for (const d of ['.cursor', '.claude', '.codex']) {
    fs.mkdirSync(path.join(ws.link, d, 'skills'), { recursive: true });
    fs.symlinkSync('../../.agents/skills/rigprobe-link', path.join(ws.link, d, 'skills', 'rigprobe-link'));
  }
  for (const d of DIRS) writeSkill(ws.ctl, d, `rigprobe-only${d.replace('.', '')}`, `ZQXONLY${d.replace('.', '').toUpperCase()}`);
  for (const d of DIRS.filter((x) => x !== '.cursor')) writeSkill(ws.ctl, d, 'rigprobe-prec', `ZQXPREC${d.replace('.', '').toUpperCase()}`);
  return ws;
}

const PROMPT =
  'List every available skill whose name starts with rigprobe, one per line, with how many times each appears in your skill list. Do not read files. ' +
  'Then, for machine reading, end your answer with one line per separate entry in your skill list, even when the name repeats, in the form: ' +
  'ENTRY | <name> | <path shown in the list> | <description token>. Do not merge duplicates.';

type CursorResult = { type?: string; result?: string; is_error?: boolean };
type CursorRun = { code: number | null; timedOut: boolean; ms: number; parsed: CursorResult | null; raw: string };

function runCursor(ws: string): Promise<CursorRun> {
  return new Promise<CursorRun>((resolve) => {
    const args = ['-p', '--output-format', 'json', '--mode', 'ask', '--trust', '--workspace', ws, '--model', opt.model, PROMPT];
    const t0 = Date.now();
    const child = spawn('cursor-agent', args, { cwd: ws, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let parsed: CursorResult | null = null;
    let timedOut = false;
    const finish = (code: number | null) => {
      clearTimeout(timer);
      resolve({ code, timedOut, ms: Date.now() - t0, parsed, raw: parsed ? '' : out.slice(0, 500) });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (b: Buffer) => {
      out += b;
      if (!parsed) {
        for (const line of out.split('\n')) {
          try {
            const j = JSON.parse(line);
            if (j.type === 'result') {
              parsed = j;
              child.kill('SIGTERM');
            }
          } catch {}
        }
      }
    });
    child.on('close', finish);
    child.on('error', () => finish(-1));
  });
}

// Keep only probe lines: the full answer would copy the user's own skill names into the record.
function probeLines(text: unknown) {
  return redact(
    String(text)
      .split('\n')
      .filter((l) => /rigprobe|ZQX/.test(l))
      .join('\n'),
  ).slice(0, 800);
}

function countEntries(text: unknown, name: string) {
  const entries: string[] = [];
  for (const line of String(text).split('\n')) {
    if (!/^\s*[-*]?\s*`?ENTRY\b/.test(line)) continue;
    if (!line.includes(name)) continue;
    entries.push(line.trim());
  }
  const tokens = new Set((entries.join('\n').match(/ZQX[A-Z]+/g) ?? []));
  const dirs = new Set(DIRS.filter((d) => entries.some((e) => e.includes(`${d}/`))));
  // The model sometimes repeats one entry. Distinct source directories are the count that matters.
  return { n: dirs.size || entries.length, rawEntryLines: entries.length, tokens: [...tokens], dirs: [...dirs], lines: entries.map(redact) };
}

function helpScan() {
  const cmds = [[], ['plugin'], ['agent'], ['about'], ['models'], ['rule'], ['mcp']];
  const hits = [];
  for (const c of cmds) {
    const r = spawnSync('cursor-agent', [...c, '--help'], { encoding: 'utf8', timeout: 20000 });
    const text = `${r.stdout}${r.stderr}`;
    const lines = text.split('\n').filter((l) => /skill/i.test(l));
    hits.push({ command: ['cursor-agent', ...c, '--help'].join(' '), exit: r.status, skillMentions: lines.map((l) => l.trim()) });
  }
  return hits;
}

const ws = makeWorkspaces();
const help = helpScan();
const listingCommand = help.some((h) => h.skillMentions.length > 0);

const cases: Array<{ kind: Kind; run: number }> = [];
for (const kind of KINDS) for (let i = 1; i <= runs; i++) cases.push({ kind, run: i });
type CaseResult = { kind: Kind; run: number; ok: boolean; timedOut: boolean; ms: number; answer: string } & ReturnType<typeof countEntries>;
const results: CaseResult[] = [];
const queue = [...cases];
await Promise.all(
  Array.from({ length: 3 }, async () => {
    while (queue.length) {
      const c = queue.shift();
      if (!c) break;
      const r = await runCursor(ws[c.kind]);
      const text = r.parsed?.result ?? '';
      const e = countEntries(text, c.kind === 'ctl' ? 'rigprobe-' : `rigprobe-${c.kind}`);
      results.push({ ...c, ok: Boolean(r.parsed) && !r.parsed?.is_error, timedOut: r.timedOut, ms: r.ms, ...e, answer: probeLines(text) });
    }
  }),
);
results.sort((a, b) => a.kind.localeCompare(b.kind) || a.run - b.run);

const ns = (kind: Kind) => results.filter((r) => r.kind === kind).map((r) => r.n);
const ctlRuns = results.filter((r) => r.kind === 'ctl');
const ctlOnly = ctlRuns.map((r) => DIRS.filter((d) => r.lines.some((l) => l.includes(`rigprobe-only${d.replace('.', '')}`))));
const controlReadsAllDirs = ctlOnly.length > 0 && ctlOnly.every((x) => x.length === DIRS.length);
const precedence = ctlRuns.map((r) => r.lines.filter((l) => l.includes('rigprobe-prec')).map((l) => l.match(/ZQXPREC[A-Z]+/)?.[0] ?? l));
const allOk = results.every((r) => r.ok && r.n > 0);
const stable = (kind: Kind) => new Set(ns(kind)).size === 1;
let verdict = 'INCONCLUSIVE';
let dedupe: string | null = null;
let reason = '';
if (!allOk) reason = 'at least one run failed, timed out or listed no entry';
else if (!controlReadsAllDirs) reason = 'control skills show that not all four project directories are read, so a missing copy could mean not read';
else if (!(['dup', 'diff'] satisfies Kind[]).every(stable)) reason = 'the two runs disagree on the entry count';
else {
  const dup = ns('dup')[0];
  const diff = ns('diff')[0];
  const diffTokens = Math.min(...results.filter((r) => r.kind === 'diff').map((r) => r.tokens.length));
  if (dup === 1 && diff === 1) dedupe = 'by-name';
  else if (dup === 1 && diff >= 2) dedupe = 'identical-bytes';
  else if (dup >= 2 && diff >= 2 && diffTokens >= 2) dedupe = 'none';
  else reason = `unexpected counts dup=${dup} diff=${diff}`;
}
if (dedupe) verdict = dedupe === 'none' ? 'PASS' : 'FAIL';

const report = {
  probe: 'b-cursor-dedupe',
  claim: 'A23: Cursor does not collapse a skill that it finds in several directories (PASS = no collapse, FAIL = some collapse)',
  verdict,
  evidence: {
    strength: 'model-reported: counts come from the model reading its own injected skill list, so they are weaker than a tool-level listing',
    listingCommandWithoutModelCall: listingCommand ? 'help mentions skills, inspect helpScan' : 'none found in help output of cursor-agent and its subcommands',
    helpScan: help,
    cursorAgentVersion: redact(spawnSync('cursor-agent', ['--version'], { encoding: 'utf8' }).stdout.trim()),
    runsPerCase: runs,
    reason: reason || undefined,
    controlReadsAllFourDirs: controlReadsAllDirs,
    controlDirsSeenPerRun: ctlOnly,
    precedenceEntriesPerRun: precedence,
    cases: results,
  },
  sets: { 'cursor.reads.skills[].dedupe': dedupe },
};
const json = JSON.stringify(report, null, 2);
if (opt.out) fs.writeFileSync(opt.out, `${json}\n`);
console.log(json);
