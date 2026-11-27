// Fixtures for lock tests: local bare git repos reached through file:// URLs, a scratch config root, a recording writer.
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const GIT_ENV = {
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_"))),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  GIT_AUTHOR_NAME: "fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.invalid",
  GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
  GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
};

const git = (cwd, ...args) => execFileSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

export const scratch = () => mkdtempSync(join(tmpdir(), "rig-lock-test-"));
export const cleanup = (dir) => rmSync(dir, { recursive: true, force: true });

export const MIT_TEXT = `MIT License

Copyright (c) 2026 Example Author

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction.
`;

export const GPL_TEXT = `                    GNU GENERAL PUBLIC LICENSE
                       Version 3, 29 June 2007

 Copyright (C) 2007 Free Software Foundation, Inc. <https://fsf.org/>
`;

export const APACHE_TEXT = `                                 Apache License
                           Version 2.0, January 2004
`;

/**
 * Build a bare repo from a list of commits. A commit is a map of path -> string | {content, mode} | {symlink} | null,
 * where null deletes the path. A value replaces whatever is at the path, a folder included.
 * Returns the file:// URL, the bare path and the full sha of each commit.
 * @param base scratch dir
 */
export function makeRepo(base: string, commits: Record<string, any>[], opts: {allowAnySha?: boolean} = {}) {
  const work = mkdtempSync(join(base, "work-"));
  const bare = join(mkdtempSync(join(base, "bare-")), "upstream.git");
  git(work, "init", "-q", "-b", "main");
  const shas = [];
  for (const files of commits) {
    for (const [path, v] of Object.entries(files)) {
      const abs = join(work, path);
      mkdirSync(dirname(abs), { recursive: true });
      rmSync(abs, { recursive: true, force: true });
      if (v === null) continue;
      if (v.symlink) symlinkSync(v.symlink, abs);
      else {
        writeFileSync(abs, typeof v === "string" ? v : v.content);
        if (v.mode) chmodSync(abs, v.mode);
      }
    }
    git(work, "add", "-A");
    git(work, "commit", "-q", "-m", `commit ${shas.length + 1}`);
    shas.push(git(work, "rev-parse", "HEAD"));
  }
  git(base, "clone", "-q", "--bare", work, bare);
  if (opts.allowAnySha) git(bare, "config", "uploadpack.allowAnySHA1InWant", "true");
  return { url: pathToFileURL(bare).href, bare, shas };
}

/**
 * Build a bare repo whose one commit holds exactly these path -> text files, written with git plumbing. A working
 * tree cannot hold a `.git` entry, so makeRepo cannot build a tree that names one; mktree can.
 * Returns the file:// URL and the sha of the commit.
 * @param base scratch dir
 */
export function makeRawRepo(base: string, files: Record<string, string>) {
  const bare = join(mkdtempSync(join(base, "raw-")), "upstream.git");
  git(base, "init", "-q", "--bare", bare);
  const run = (input: string, ...args: string[]) => execFileSync("git", args, { cwd: bare, env: GIT_ENV, input, encoding: "utf8" }).trim();
  const tree = (level: Record<string, any>): string => {
    const lines = Object.entries(level).map(([name, v]) =>
      typeof v === "string" ? `100644 blob ${run(v, "hash-object", "-w", "--stdin")}\t${name}` : `040000 tree ${tree(v)}\t${name}`);
    return run(lines.join("\n") + "\n", "mktree");
  };
  const root: Record<string, any> = {};
  for (const [path, text] of Object.entries(files)) {
    const segs = path.split("/");
    let at = root;
    for (const s of segs.slice(0, -1)) at = at[s] ??= {};
    at[segs[segs.length - 1]] = text;
  }
  const sha = run("raw\n", "commit-tree", tree(root), "-m", "raw");
  git(bare, "update-ref", "refs/heads/main", sha);
  return { url: pathToFileURL(bare).href, bare, sha };
}

/** A world with a scratch repo root and a writer that records each call. Null bytes remove the file. */
export function makeWorld(base, extra = {}) {
  const repo = join(base, "config-repo");
  const overlay = join(base, "config-overlay");
  mkdirSync(repo, { recursive: true });
  mkdirSync(overlay, { recursive: true });
  const calls = [];
  const writeConfig = (root, rel, bytes, mode = 0o644) => {
    calls.push({ root, rel, mode, removed: bytes === null });
    const abs = join(root, rel);
    if (bytes === null) return rmSync(abs, { force: true });
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, bytes);
    chmodSync(abs, mode);
  };
  return { roots: { repo, overlay }, writeConfig, calls, env: { home: join(base, "home") }, ...extra };
}
