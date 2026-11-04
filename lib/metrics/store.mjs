// The metrics store: the last line per (harness, session_id). Writes go through the injected writer
// (lib/metrics.mjs defaults it to lib/fs.mjs appendState and log); this file only reads.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const STORE_FILE = "metrics.jsonl";

export const keyOf = (harness, sessionId) => `${harness}\u0000${sessionId}`;

/** The last line per (harness, session_id). A torn or foreign line is skipped. */
export function readStore(stateRoot) {
  const latest = new Map();
  let text;
  try {
    text = readFileSync(join(stateRoot, STORE_FILE), "utf8");
  } catch {
    return latest;
  }
  for (const raw of text.split("\n")) {
    if (!raw) continue;
    let line;
    try {
      line = JSON.parse(raw);
    } catch {
      continue;
    }
    if (line?.schema === 1 && typeof line.harness === "string" && typeof line.session_id === "string") {
      latest.set(keyOf(line.harness, line.session_id), line);
    }
  }
  return latest;
}
