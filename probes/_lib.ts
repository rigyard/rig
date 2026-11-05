import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const SCRATCH =
  process.env.RIG_PROBE_SCRATCH || path.join(os.tmpdir(), "rig-probes-claude");

export type RunResult = {
  status: number | null;
  timedOut: boolean;
  spawnError: string | null;
  stdout: string;
  stderr: string;
};

export function parseOut(argv: string[]): string | undefined {
  const i = argv.indexOf("--out");
  return i >= 0 ? argv[i + 1] : undefined;
}

export function freshDir(name: string): string {
  const dir = path.join(SCRATCH, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function run(
  cmd: string,
  args: string[],
  { cwd, timeoutMs = 120000, env }: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): RunResult {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    timeout: timeoutMs,
    input: "",
    env: { ...process.env, ...env },
  });
  const code = (r.error as NodeJS.ErrnoException | undefined)?.code;
  return {
    status: r.status,
    timedOut: code === "ETIMEDOUT",
    spawnError: r.error && code !== "ETIMEDOUT" ? String(code) : null,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

export function redact(text: string, pairs: Array<[string | null | undefined, string]>): string {
  let out = text;
  for (const [needle, label] of pairs) {
    if (needle) out = out.split(needle).join(label);
  }
  return out.split(os.homedir()).join("~");
}

export function finish(verdict: unknown, out: string | undefined): void {
  const json = JSON.stringify(verdict, null, 2);
  if (out) fs.writeFileSync(out, json + "\n");
  console.log(json);
}
