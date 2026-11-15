// lib/state/observe.ts — internal to state. Read-only: hashes, observed files, installed.json, the fs context.

import crypto from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { writeHome } from "../fs.ts";
import { declaredDirs } from "../world.ts";

export const hex = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
export const sha = (bytes) => `sha256:${hex(bytes)}`;

/** JSON with sorted object keys, for digests. */
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

/** Digest of cell values: sha256 of the canonical list [[surface, key, element, value], ...], sorted. */
export function cellsDigest(values) {
  const rows = values.map((c) => [c.surface, c.key, c.element, c.value]);
  rows.sort((a, b) => (canonical(a) < canonical(b) ? -1 : canonical(a) > canonical(b) ? 1 : 0));
  return sha(Buffer.from(canonical(rows)));
}
export const blockDigest = (bytes) => sha(bytes);
export const jsonDigest = (value) => sha(Buffer.from(canonical(value)));

/** The fs context for one world. never_write, read-set and declared dirs come from the target records. */
export function fsCtx(world) {
  const neverWrite = [];
  const readSets = [];
  const keepDirs = [];
  for (const t of world.targets?.values?.() ?? []) {
    for (const d of declaredDirs(t)) if (!keepDirs.includes(d)) keepDirs.push(d);
    neverWrite.push(...(t.reads?.never_write ?? []));
    for (const d of t.reads?.skills ?? []) readSets.push(d.path);
  }
  return { home: world.env.home, state: world.env.state, neverWrite, readSets, keepDirs };
}

/**
 * Observe one HOME path. Never throws for containment: the error comes back as a value.
 */
export function observe(p, ctx): {abs: string, tilde: string, rel: string, bytes: Buffer | null, sha: string | null, mode: number | null} | {error: {code: string, message: string, path: string}} {
  let r;
  try {
    r = writeHome(p, null, undefined, ctx, { check: true });
  } catch (e) {
    if (!e.code?.startsWith?.("E_")) throw e;
    return { error: { code: e.code, message: e.message, path: String(p) } };
  }
  let bytes = null;
  let mode = null;
  try {
    bytes = readFileSync(r.abs);
    mode = statSync(r.abs).mode & 0o7777;
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  return { ...r, bytes, sha: bytes ? sha(bytes) : null, mode };
}

/** Current whole-file signature, used by the executor and the recovery classifier. */
export function sigOf(o) {
  return { sha: o.sha, mode: o.sha === null ? null : o.mode };
}
export const sameSig = (a, b) => a.sha === b.sha && (a.sha === null || a.mode === b.mode);

export const INSTALLED = "installed.json";

export function readInstalled(world): {schema: 1, entries: Record<string, object>} {
  let text;
  try {
    text = readFileSync(path.join(world.env.state, INSTALLED), "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return { schema: 1, entries: {} };
    throw e;
  }
  let v;
  try {
    v = JSON.parse(text);
  } catch {
    v = null;
  }
  if (!v || v.schema !== 1 || typeof v.entries !== "object" || v.entries === null || Array.isArray(v.entries)) {
    const e = new Error(`${INSTALLED} is not a valid schema 1 record; move it away to start over`);
    e.code = "E_INTERNAL";
    throw e;
  }
  return v;
}

export function encodeInstalled(inst) {
  const entries = {};
  for (const k of Object.keys(inst.entries).sort()) entries[k] = inst.entries[k];
  return Buffer.from(`${JSON.stringify({ schema: 1, entries }, null, 2)}\n`);
}
