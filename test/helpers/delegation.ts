// Matchers for the live delegation lanes. They read tool names, call ids, tool arguments and status fields, never message text.

export const parseJsonl = (text: string): any[] => text.split("\n").flatMap((l) => {
  try {
    return [JSON.parse(l)];
  } catch {
    return [];
  }
});

const isObject = (v: unknown): v is Record<string, any> => v !== null && typeof v === "object" && !Array.isArray(v);

/** Codex rollout: a `spawn_agent` call and the `function_call_output` that shares its `call_id`. */
export type Spawn = { callId: string; ok: boolean };

/**
 * A spawn succeeds when its output is a JSON object with no `error` key: `{"agent_id":...}` or `{"task_name":...}`.
 * A refusal comes back as plain text, and a call with no output at all did not finish.
 */
export function codexSpawns(rollout: any[]): Spawn[] {
  const outputs = new Map<string, unknown>();
  for (const e of rollout) if (e?.payload?.type === "function_call_output") outputs.set(String(e.payload.call_id), e.payload.output);
  return rollout.filter((e) => e?.payload?.type === "function_call" && e.payload.name === "spawn_agent").map((e) => {
    const callId = String(e.payload.call_id);
    let out = outputs.get(callId);
    if (typeof out === "string") {
      try {
        out = JSON.parse(out);
      } catch {
        return { callId, ok: false };
      }
    }
    return { callId, ok: isObject(out) && !("error" in out) };
  });
}

/** One Cursor stream-json `tool_call` event holds one key per tool, such as `taskToolCall` or `readToolCall`. */
export function cursorCall(e: any): { name: string; call: Record<string, any> } | undefined {
  if (e?.type !== "tool_call" || !isObject(e.tool_call)) return undefined;
  const name = Object.keys(e.tool_call).find((k) => k.endsWith("ToolCall"));
  return name ? { name, call: isObject(e.tool_call[name]) ? e.tool_call[name] : {} } : undefined;
}

export const cursorToolNames = (events: any[]) => events.flatMap((e) => (e.subtype === "started" ? [cursorCall(e)?.name ?? "unknown"] : []));

const FAILED = ["error", "failure", "rejected"];

/** A Task call is done when its `completed` event carries a `result` that holds `success` and none of error, failure or rejected. */
export function cursorTaskOutcomes(events: any[]): { completed: number; failed: number } {
  let completed = 0;
  let failed = 0;
  for (const e of events) {
    const c = e?.subtype === "completed" ? cursorCall(e) : undefined;
    if (c?.name !== "taskToolCall") continue;
    const result = c.call.result;
    if (isObject(result) && "success" in result && !FAILED.some((k) => k in result)) completed++;
    else failed++;
  }
  return { completed, failed };
}

/** Whether a started Cursor call names `needle` in its own `args`. The result and the rest of the event are never read. */
export const cursorArgsMention = (events: any[], needle: string) => events.some((e) => {
  const c = e?.subtype === "started" ? cursorCall(e) : undefined;
  return c !== undefined && JSON.stringify(c.call.args ?? null).includes(needle);
});
