// telemetry (decision 0022): warn when a provider or pin record has telemetry on and no opt-out variable is set.

/** `NAME=value` is set when the env holds exactly that value; a bare `NAME` is set when non-empty. */
function isSet(spec, vars) {
  const eq = spec.indexOf("=");
  const name = eq < 0 ? spec : spec.slice(0, eq);
  const v = vars?.[name];
  return eq < 0 ? v !== undefined && v !== "" : v === spec.slice(eq + 1);
}

export function runTelemetry(ctx: object) {
  const records = new Map();
  for (const p of ctx.stack?.providers ?? []) records.set(p.name, p);
  for (const name of ctx.world.config?.pins ?? []) {
    const p = ctx.world.providers?.get(name);
    if (p) records.set(p.name, p);
  }
  const out = [];
  for (const rec of records.values()) {
    const t = rec.telemetry;
    if (!t || t.default_on !== true) continue;
    const optouts = t.optout_env ?? [];
    if (optouts.some((spec) => isSet(spec, ctx.world.vars))) continue;
    const line = optouts.includes("DO_NOT_TRACK=1") ? "DO_NOT_TRACK=1" : optouts[0];
    out.push({
      severity: "warn",
      pack: rec.name,
      path: `providers/${rec.name}.json`,
      evidence: line
        ? `${rec.name} sends telemetry by default. Add to your shell profile: export ${line}`
        : `${rec.name} sends telemetry by default and its record lists no opt-out variable`,
      idBytes: `${rec.name}\0${optouts.join(",")}`,
    });
  }
  return out;
}
