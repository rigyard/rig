// lib/targets/providers.ts — internal to targets. The text that core templates take from provider records, target
// records, slot fillers and the lock: {{providers}}, {{entries}}, {{slots}}, {{models}} and {{slot_body}}; and the
// rows of the one derived term {{rig:intake}}, which pack text uses.
// Pure. Every value is plain text; a missing input is a clear line or a coded error, never a guess.

import { frontmatterValue } from "./formats.ts";

const decoder = new TextDecoder();

/** The command that /craft is on every harness (decision 0016). */
const CRAFT = "/craft";

/** The doc's "slot empty" line per v0 slot (draft section 8). Another slot gets the generic line. */
const SLOT_EMPTY = {
  "doc-review": "Slot empty: ask the user to review <path>.",
  "second-opinion": "Slot empty: say that no second opinion is configured.",
};

/**
 * The locked current state of a pin, looked up as the gate's pin check does: the repo lock entry, else the overlay's.
 */
export function lockedPin(locks: {repo?: object, overlay?: object | null}, name: string): {plugin: string | undefined, version: string | null} {
  const entry = locks?.repo?.pins?.[name] ?? locks?.overlay?.pins?.[name];
  return { plugin: entry?.plugin, version: entry?.current?.version ?? null };
}

/** "<plugin>@<marketplace>" split at the last "@". */
function pluginSpec(spec) {
  const at = spec.lastIndexOf("@");
  return at > 0 ? { plugin: spec.slice(0, at), marketplace: spec.slice(at + 1) } : null;
}

const fail = (code, message, harness) => ({ error: { code, message, ...(harness ? { harness } : {}) } });

/**
 * The entry of one workflow provider on one harness.
 * `read` entries name a scheme: `plugin-cache:<rest>` resolves under the harness's plugin cache dir at the locked
 * version, `plugin-local:<rest>` under the harness's local plugins dir.
 */
export function entryOf(provider, harness, target, locks): {kind: "none"} | {kind: "command", command: string} | {kind: "read", path: string} | {kind: "unlocked"} | {error: object} {
  const entry = provider.entry?.[harness] ?? null;
  if (entry === null) return { kind: "none" };
  if (entry.command) return { kind: "command", command: entry.command };
  const m = /^([a-z-]+):(.+)$/.exec(entry.read ?? "");
  const where = `provider ${provider.name}: entry.${harness}.read "${entry.read}"`;
  if (!m) return fail("E_INTERNAL", `${where} has no scheme`, harness);
  const [, scheme, rest] = m;
  const pin = lockedPin(locks, provider.name);
  const spec = pluginSpec(pin.plugin ?? provider.pin?.plugin ?? "");
  if (!spec) return fail("E_INTERNAL", `${where} needs pin.plugin of the form <plugin>@<marketplace>`, harness);
  if (scheme === "plugin-cache") {
    const cache = target.reads?.skills?.find((d) => d.plugin && !d.writable)?.path;
    if (!cache) return fail("E_INTERNAL", `${where}: the ${harness} record declares no read-only plugin dir`, harness);
    if (pin.version === null) return { kind: "unlocked" };
    return { kind: "read", path: `${cache}/${spec.marketplace}/${spec.plugin}/${pin.version}/${rest}` };
  }
  if (scheme === "plugin-local") {
    // plugin_manifest.path is <local plugins dir>/<rig plugin>/<manifest dir>/<manifest file>.
    const manifest = target.plugin_manifest?.path;
    if (!manifest) return fail("E_INTERNAL", `${where}: the ${harness} record declares no local plugin`, harness);
    return { kind: "read", path: `${manifest.split("/").slice(0, -3).join("/")}/${spec.plugin}/${rest}` };
  }
  return fail("E_INTERNAL", `${where}: unknown scheme ${scheme}`, harness);
}

const workflows = (providers) => providers.filter((p) => p.kind === "workflow");

/**
 * {{providers}}: one line per workflow provider with an entry on this harness, in rig.json order.
 */
export function providerLines(providers, harness, target, locks): string | {error: object} {
  const lines = [];
  for (const p of workflows(providers)) {
    const e = entryOf(p, harness, target, locks);
    if (e.error) return e;
    if (e.kind === "none") continue;
    const enter = e.kind === "command" ? e.command : CRAFT;
    const phases = p.phases?.length ? ` Phases: ${p.phases.join(", ")}.` : "";
    const artifacts = p.artifacts ? ` Artifacts: ${p.artifacts}.` : "";
    lines.push(`- ${p.name}: enter with ${enter}.${phases}${artifacts}`);
  }
  return lines.length ? lines.join("\n") : "- none: no workflow provider has an entry on this harness.";
}

/**
 * {{rig:intake}}: the product-role handoff (draft sections 5 and 9), one line per workflow provider with an intake on
 * this harness, in rig.json order. The line names the provider; the reader takes the active one from the frame.
 */
export function intakeLines(providers, harness): string {
  const lines = [];
  for (const p of workflows(providers)) {
    const intake = p.intake?.[harness] ?? null;
    if (intake !== null) lines.push(`- ${p.name}: Next: ${intake}`);
  }
  return lines.length ? lines.join("\n") : "- none: no workflow provider has an intake on this harness.";
}

/**
 * {{entries}}: the /craft body, one line per workflow provider, in rig.json order.
 */
export function entryLines(providers, harness, target, locks): string | {error: object} {
  const lines = [];
  for (const p of workflows(providers)) {
    const e = entryOf(p, harness, target, locks);
    if (e.error) return e;
    const head = `If it names ${p.name}:`;
    if (e.kind === "command") lines.push(`${head} run ${e.command}.`);
    else if (e.kind === "read") lines.push(`${head} read ${e.path} and follow it.`);
    else if (e.kind === "unlocked") {
      lines.push(`${head} rig.lock.json holds no locked ${p.name} version, so its path is unknown. Tell the user to run "rig pin check ${p.name}", then stop.`);
    } else lines.push(`${head} ${p.name} is not available on this harness. Say so in your first message, then follow the frame.`);
  }
  return lines.join("\n");
}

/** The first sentence of a skill description. */
function firstSentence(text) {
  const m = /^.*?\.(?=\s|$)/.exec(text);
  return m ? m[0] : text;
}

/**
 * {{slots}}: one line per slot stub that renders on this harness, with its filler or "empty".
 * @param fillers   stack.slots: slot -> provider record
 */
export function slotLines(stubs: {name: string, harnesses: string[], files: Map<string, {bytes: Uint8Array}>}[], fillers: Record<string, {name: string} | null>, harness) {
  const lines = [];
  for (const u of stubs) {
    if (!u.harnesses.includes(harness)) continue;
    const skill = u.files.get("SKILL.md");
    const description = skill ? frontmatterValue(decoder.decode(skill.bytes), "description") : undefined;
    const filler = fillers?.[u.name.slice("rig-".length)]?.name ?? "empty";
    lines.push(`- ${u.name} (filler: ${filler})${description ? `: ${firstSentence(description)}` : "."}`);
  }
  return lines.length ? lines.join("\n") : "- none.";
}

/** {{models}}: where model choices live on this harness, from the target record's `models`. */
export function modelsLine(target) {
  const m = target.models;
  const where = m?.source ?? "the session model";
  const raise = m?.effort_table ? "Raise effort per the effort-table conditions or after a verified failure." : "Raise effort after a verified failure.";
  return `${where}. ${raise} Change the model only for a new dispatch.`;
}

/**
 * {{slot_body}}: the stub body from its filler. Harness-independent, so one copy serves every dir.
 * @param tiers   models/tiers.json
 */
export function slotBody(slot: string, provider: object | null, filler: {provider: string, tier?: string} | null, tiers: {tiers?: Record<string, Record<string, string | {id: string}>>}): string | {error: object} {
  if (!provider) return SLOT_EMPTY[slot] ?? `Slot empty: say that no ${slot} provider is configured.`;
  if (provider.kind !== "headless") {
    return fail("E_INTERNAL", `slot ${slot}: a ${provider.kind} filler (${provider.name}) does not render in this version`);
  }
  let argv = provider.argv.join(" ");
  if (argv.includes("{model}")) {
    const cell = filler?.tier ? tiers?.tiers?.[filler.tier]?.[provider.model_harness] : undefined;
    const model = typeof cell === "string" ? cell : cell?.id;
    if (!model) return fail("E_INTERNAL", `slot ${slot}: ${provider.name} needs {model}, and tiers.json has no ${filler?.tier ?? "(no tier)"} model for ${provider.model_harness}`);
    argv = argv.replaceAll("{model}", model);
  }
  argv = argv.replaceAll("{prompt}", '"<prompt>"');
  return `Provider: ${provider.name}. Run \`${argv}\`, where <prompt> is the input above. Its output is the output above.`;
}
