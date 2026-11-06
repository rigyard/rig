// Which installed skill dirs does a piece of transcript text name? A model reaches a hidden skill by reading
// <skills>/<name>/SKILL.md (or a file inside that dir), not through a skill tool, so the transcript carries a path
// where a harness with a skill tool carries a name. The resolver is the only place a raw path or command is looked
// at: it returns directory names that exist under the harness's own skill roots, a closed set, and nothing else.
import { statSync } from "node:fs";
import { join } from "node:path";

/** Names of the installed unit dirs that `text` points into. */
export type UnitRefs = (text: string) => string[];

export const NO_REFS: UnitRefs = () => [];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** The spellings of an absolute dir in a command: itself, `~/..`, `$HOME/..` and `${HOME}/..` when it sits under home. */
function spellings(root: string, home: string): string[] {
  const out = [root];
  if (root.startsWith(`${home}/`)) {
    const rest = root.slice(home.length);
    out.push(`~${rest}`, `$HOME${rest}`, "${HOME}" + rest);
  }
  return out;
}

/**
 * @param roots absolute skill roots of one harness, such as `<home>/.claude/skills` (a plugin cache that rig does not write is excluded)
 * @param home the HOME of the run
 */
export function unitRefs(roots: string[], home: string): UnitRefs {
  const exists = new Map<string, boolean>();
  const isDir = (dir: string) => {
    let known = exists.get(dir);
    if (known === undefined) {
      known = statSync(dir, { throwIfNoEntry: false })?.isDirectory() === true;
      exists.set(dir, known);
    }
    return known;
  };
  const scanners = roots.map((root) => ({
    root,
    re: new RegExp(`(?<![\\w.~$/-])(?:${spellings(root, home).map(escape).join("|")})/([A-Za-z0-9][A-Za-z0-9._-]*)`, "g"),
  }));
  return (text) => {
    const names = new Set<string>();
    for (const { root, re } of scanners) {
      for (const m of text.matchAll(re)) if (isDir(join(root, m[1]))) names.add(m[1]);
    }
    return [...names];
  };
}
