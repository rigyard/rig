import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const SCRATCH =
  process.env.RIG_PROBE_SCRATCH || path.join(os.tmpdir(), "rig-probes-claude");

export function parseOut(argv) {
  const i = argv.indexOf("--out");
  return i >= 0 ? argv[i + 1] : undefined;
}

export function freshDir(name) {
  const dir = path.join(SCRATCH, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function run(cmd, args, { cwd, timeoutMs = 120000, env } = {}) {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    timeout: timeoutMs,
    input: "",
    env: { ...process.env, ...env },
  });
  return {
    status: r.status,
    timedOut: r.error?.code === "ETIMEDOUT",
    spawnError: r.error && r.error.code !== "ETIMEDOUT" ? String(r.error.code) : null,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

export function redact(text, pairs) {
  let out = text;
  for (const [needle, label] of pairs) {
    if (needle) out = out.split(needle).join(label);
  }
  return out.split(os.homedir()).join("~");
}

export function finish(verdict, out) {
  const json = JSON.stringify(verdict, null, 2);
  if (out) fs.writeFileSync(out, json + "\n");
  console.log(json);
}
