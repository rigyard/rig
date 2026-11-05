// Shared helpers for the omp probes in this directory. Node built-ins only.
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Optional model override for runs that call a model. The id never goes into evidence.
let modelOverride: string | null = null;
export function setModel(id: string | null | undefined): void {
  modelOverride = id || null;
}
export const modelOverrideUsed = () => modelOverride !== null;

export const FALLBACK_MODEL = '<fallback-model>';
const RUN_TIMEOUT_MS = 100_000;

export type OmpArgs = { out: string | null; scratch: string | null; model: string | null };

export function parseArgs(argv: string[]): OmpArgs {
  const args: OmpArgs = { out: null, scratch: null, model: process.env.RIG_PROBE_OMP_MODEL ?? null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--scratch') args.scratch = argv[++i];
    else if (argv[i] === '--model') args.model = argv[++i];
    else {
      console.error(`unknown argument: ${argv[i]}`);
      process.exit(2);
    }
  }
  return args;
}

export function randomHex(n = 6) {
  return crypto.randomBytes(n).toString('hex');
}

export function sha256(buf: crypto.BinaryLike) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function createScratch(base?: string | null) {
  const parent = base ?? os.tmpdir();
  fs.mkdirSync(parent, { recursive: true });
  return fs.realpathSync(fs.mkdtempSync(path.join(parent, 'rig-probe-omp-')));
}

// One isolated omp world: agent dir, HOME, and a git-initialised project dir.
export type Isolated = { root: string; agentDir: string; home: string; proj: string; scratch: string };

export function newIsolated(scratch: string, name: string): Isolated {
  const root = path.join(scratch, name);
  const iso: Isolated = {
    root,
    agentDir: path.join(root, 'agent'),
    home: path.join(root, 'home'),
    proj: path.join(root, 'proj'),
    scratch,
  };
  for (const d of [iso.agentDir, iso.home, iso.proj]) fs.mkdirSync(d, { recursive: true });
  spawnSync('git', ['init', '-q'], { cwd: iso.proj, stdio: 'ignore' });
  return iso;
}

function inside(child: string, parent: string) {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export function isolatedEnv(iso: Isolated): NodeJS.ProcessEnv {
  const env = { ...process.env };
  // These variables relocate or opt in user-level discovery. Drop them.
  for (const k of ['OMP_PROFILE', 'PI_PROFILE', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'COPILOT_HOME']) delete env[k];
  env.PI_CODING_AGENT_DIR = iso.agentDir;
  env.HOME = iso.home;
  return env;
}

// Throws unless the agent dir and HOME of this run resolve inside the scratch root.
export function assertIsolated(iso: Isolated, env: NodeJS.ProcessEnv, { allowProfile = false }: { allowProfile?: boolean } = {}) {
  const scratch = fs.realpathSync(iso.scratch);
  if (!env.PI_CODING_AGENT_DIR) throw new Error('isolation: PI_CODING_AGENT_DIR is not set');
  if (!allowProfile && (env.OMP_PROFILE || env.PI_PROFILE)) throw new Error('isolation: a profile variable is set');
  const agent = fs.realpathSync(env.PI_CODING_AGENT_DIR);
  const home = fs.realpathSync(env.HOME as string);
  const realOmp = path.join(fs.realpathSync(os.homedir()), '.omp');
  for (const [label, p] of [['agent dir', agent], ['HOME', home]]) {
    if (!inside(p, scratch)) throw new Error(`isolation: ${label} is outside the scratch dir`);
    if (p === realOmp || inside(p, realOmp)) throw new Error(`isolation: ${label} is inside the real ~/.omp`);
  }
}

// Runs omp with a closed stdin (an open stdin pipe makes `omp -p` hang, see probe i).
export type OmpRun = {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnError?: string;
  ms: number;
};

export type RunOmpOptions = {
  cwd?: string;
  timeoutMs?: number;
  stdin?: 'ignore' | 'pipe' | 'inherit';
  env?: NodeJS.ProcessEnv;
  allowProfile?: boolean;
};

export function runOmp(
  iso: Isolated,
  args: string[],
  { cwd = iso.proj, timeoutMs = RUN_TIMEOUT_MS, stdin = 'ignore', env: envOverride, allowProfile }: RunOmpOptions = {},
): Promise<OmpRun> {
  const env = envOverride ?? isolatedEnv(iso);
  assertIsolated(iso, env, { allowProfile });
  if (modelOverride && args.includes('-p')) args = ['--model', modelOverride, ...args];
  return new Promise<OmpRun>((resolve) => {
    const t0 = Date.now();
    const child = spawn('omp', args, { cwd, env, stdio: [stdin, 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout?.on('data', (d: Buffer) => (stdout += d));
    child.stderr?.on('data', (d: Buffer) => (stderr += d));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr, timedOut, spawnError: error.code ?? String(error), ms: Date.now() - t0 });
    });
    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut, ms: Date.now() - t0 });
    });
  });
}

export type OmpContent = { type: string; text?: string };
export type OmpEvent = {
  type: string;
  cwd?: string;
  message?: { role?: string; content: OmpContent[]; usage?: { cost?: { total?: unknown }; [key: string]: unknown } };
};

export function jsonEvents(stdout: string): OmpEvent[] | null {
  const events: OmpEvent[] = [];
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      return null;
    }
  }
  return events;
}

export function lastAssistantText(events: OmpEvent[]): string | null {
  const msgs = events.filter((e) => e.type === 'message_end' && e.message?.role === 'assistant');
  const last = msgs.at(-1)?.message;
  if (!last) return null;
  return last.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
}

export function firstUserText(events: OmpEvent[]): string | null {
  const msg = events.find((e) => e.type === 'message_end' && e.message?.role === 'user');
  const content = msg?.message?.content;
  if (!content) return null;
  return content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
}

export function toolCallCount(events: OmpEvent[]): number {
  let n = events.filter((e) => /^tool_execution/.test(e.type)).length;
  for (const e of events) {
    if (e.type === 'message_end' && e.message?.role === 'assistant') {
      n += e.message.content.filter((c) => c.type === 'toolCall' || c.type === 'tool_use').length;
    }
  }
  return n;
}

export function writeFile(file: string, content: string, mode?: number) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  if (mode !== undefined) fs.chmodSync(file, mode);
}

export function writeSkill(dir: string, name: string, description: string, body: string = `Body for ${name}`) {
  writeFile(path.join(dir, name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n${body}\n`);
}

// Strip machine-specific text from anything that goes into evidence.
export function redact(text: unknown, scratch: string) {
  let s = String(text);
  for (const base of new Set([scratch, fs.realpathSync(scratch)])) s = s.split(base).join('<scratch>');
  s = s.split(os.homedir()).join('<home>');
  s = s.replace(/Using \S+/g, `Using ${FALLBACK_MODEL}`);
  return s;
}

export function realConfigState() {
  const file = path.join(os.homedir(), '.omp', 'agent', 'config.yml');
  try {
    return { exists: true, mtime_ms: Math.trunc(fs.statSync(file).mtimeMs) };
  } catch {
    return { exists: false, mtime_ms: null };
  }
}

export type FinishInput = {
  probe: string;
  verdict: string;
  derived: unknown;
  evidence: Record<string, unknown>;
  sets: unknown;
  args: { out: string | null };
  scratch?: string;
  realBefore: { exists: boolean; mtime_ms: number | null };
};

export function finish({ probe, verdict, derived, evidence, sets, args, realBefore }: FinishInput) {
  const realAfter = realConfigState();
  const result: { probe: string; verdict: string; evidence: Record<string, unknown>; sets: unknown } = {
    probe,
    verdict,
    evidence: {
      ...evidence,
      real_omp_config_mtime_ms: { before: realBefore.mtime_ms, after: realAfter.mtime_ms, unchanged: realBefore.mtime_ms === realAfter.mtime_ms },
    },
    sets,
  };
  if (realBefore.mtime_ms !== realAfter.mtime_ms) {
    result.verdict = 'INCONCLUSIVE';
    result.evidence.isolation_breach = 'real omp config mtime changed during the probe';
  }
  const text = JSON.stringify(result, null, 2) + '\n';
  if (args.out) writeFile(args.out, text);
  console.log(`${result.verdict} ${probe} ${derived}`);
  console.log(text);
  return result;
}

export const SCRATCH_NOTE = 'Every omp run uses a fresh PI_CODING_AGENT_DIR and HOME under a mkdtemp scratch dir. Paths in evidence are shown as <scratch>.';
