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

/**
 * Build a bare repo from a list of commits. A commit is a map of path -> string | {content, mode} | {symlink}.
 * Returns the file:// URL, the bare path and the full sha of each commit.
 * @param base scratch dir
 */
export function makeRepo(base: string, commits: Record<string, any>[], opts: {allowAnySha?: boolean} = {}) {
  const work = mkdtempSync(join(base, "work-"));
  const bare = mkdtempSync(join(base, "bare-")) + ".git";
  git(work, "init", "-q", "-b", "main");
  const shas = [];
  for (const files of commits) {
    for (const [path, v] of Object.entries(files)) {
      const abs = join(work, path);
      mkdirSync(dirname(abs), { recursive: true });
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

/** A world with a scratch repo root and a writer that records each call. */
export function makeWorld(base, extra = {}) {
  const repo = join(base, "config-repo");
  const overlay = join(base, "config-overlay");
  mkdirSync(repo, { recursive: true });
  mkdirSync(overlay, { recursive: true });
  const calls = [];
  const writeConfig = (root, rel, bytes, mode = 0o644) => {
    calls.push({ root, rel, mode });
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, bytes);
    chmodSync(abs, mode);
  };
  return { roots: { repo, overlay }, writeConfig, calls, env: { home: join(base, "home") }, ...extra };
}
