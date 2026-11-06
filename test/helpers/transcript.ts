// Reads a Claude stream-json transcript for tool names and Bash command strings only, never message text.

export type ToolCall = { name: string; command?: string };

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const WRITES_PACK = /packs\/fixture\/pack\.json/;
const WRITE_VERB = /(^|[^>])>>?(?!&)|\btee\b|\bsed\s+-\S*i|\bmv\b|\bcp\b|\bperl\s+-\S*i/;
const ATTEST = /^rig pin set fixture --ported\b/;
const READ_ONLY_RIG = /^rig (plan|pin check)\b/;

/** The tool_use blocks of the assistant messages, in order. Lines that are not JSON are skipped. */
export function toolCalls(stream: string): ToolCall[] {
  return stream.split("\n").flatMap((line) => {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return [];
    }
    if (event?.type !== "assistant") return [];
    return (event.message?.content ?? [])
      .filter((c: {type?: string}) => c.type === "tool_use")
      .map((c: {name: string, input?: {command?: unknown}}) => (c.name === "Bash" ? { name: c.name, command: String(c.input?.command ?? "") } : { name: c.name }));
  });
}

const isEdit = (c: ToolCall) => EDIT_TOOLS.has(c.name) || (c.name === "Bash" && WRITES_PACK.test(c.command ?? "") && WRITE_VERB.test(c.command ?? ""));
const isRig = (c: ToolCall) => c.name === "Bash" && /^rig /.test(c.command ?? "");

/**
 * Whether the run ends the way the rig-port skill says: the data edits first, then `rig pin set fixture --ported`
 * as the last write, followed only by read-only rig calls (`rig plan`, `rig pin check`).
 */
export function attestedLast(calls: ToolCall[]): { ok: boolean; reason: string } {
  const attest = calls.findLastIndex((c) => c.name === "Bash" && ATTEST.test(c.command ?? ""));
  if (attest < 0) return { ok: false, reason: "no `rig pin set fixture --ported` call" };
  const edit = calls.findLastIndex(isEdit);
  if (edit < 0) return { ok: false, reason: "no file-edit tool call: the port data never changed" };
  if (edit > attest) return { ok: false, reason: `the last --ported call (#${attest}) comes before the last edit (#${edit})` };
  const after = calls.slice(attest + 1).filter(isRig).find((c) => !READ_ONLY_RIG.test(c.command ?? ""));
  if (after) return { ok: false, reason: `a rig call that is not read-only follows the attest: ${after.command}` };
  return { ok: true, reason: "" };
}
