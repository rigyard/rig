// The one check table. The check list, the docs table (section 10) and the plan output derive from it.
import { runBudget } from "./budget.ts";
import { runCve } from "./cve.ts";
import { runExec } from "./exec.ts";
import { runLicense } from "./license.ts";
import { runLinks } from "./links.ts";
import { runModeNames } from "./mode.ts";
import { runPin } from "./pin.ts";
import { runSecret } from "./secret.ts";
import { runTelemetry } from "./telemetry.ts";
import { runUnicode } from "./unicode.ts";

/**
 * `runsOn`, `finds`, `severity` and `ackNote` are the doc-table cells, verbatim. `inputs` says what `run` reads. `mode`
 * is the composed mode skill files, `stack.mode.files`.
 * `ackable` is what the gate enforces. `run(ctx)` returns raw findings `{severity, pack, path, evidence, idBytes?}`.
 */
export type CheckRow = {
  id: string;
  runsOn: string;
  inputs: ("lock"|"sources"|"rendered"|"records"|"mode")[];
  finds: string;
  severity: string;
  ackable: boolean;
  ackNote: string;
  run: (ctx: object) => object[];
};

/** @type {readonly CheckRow[]} */
export const REGISTRY = Object.freeze([
  {
    id: "pin", runsOn: "lock, sources", inputs: ["lock", "sources"],
    finds: "lock tree mismatch, pack with no lock entry, port not reviewed (`E_PORT_STALE`), core seal mismatch, an install of a seeded upstream made outside rig: a Claude Code, Cursor, Codex, omp or Antigravity plugin, a clone or link with the upstream name, or an unmanaged skill dir with a left-out name (`E_FOREIGN_INSTALL`)",
    severity: "block", ackable: false, ackNote: "never", run: runPin,
  },
  {
    id: "exec", runsOn: "sources", inputs: ["sources"],
    finds: "exec bit, shebang, script extension, binary magic, `hooks.json`, `.mcp.json`, `package.json` scripts, symlinks in a pack",
    severity: "block", ackable: true, ackNote: "yes", run: runExec,
  },
  {
    id: "secret", runsOn: "sources, rendered", inputs: ["sources", "rendered"],
    finds: "secret patterns. Sub-rule `private_terms`: an overlay term inside a repo pack.",
    severity: "block", ackable: true, ackNote: "yes", run: runSecret,
  },
  {
    id: "unicode", runsOn: "sources, rendered", inputs: ["sources", "rendered"],
    finds: "hidden Unicode (zero-width, bidi), pipe-to-shell, eval of fetched data (block). Injection phrases (warn)",
    severity: "block, warn", ackable: true, ackNote: "yes", run: runUnicode,
  },
  {
    id: "links", runsOn: "rendered", inputs: ["rendered"],
    finds: "a relative Markdown link in an owned `.md` file that does not resolve to an owned path of the same harness",
    severity: "block", ackable: true, ackNote: "yes", run: runLinks,
  },
  {
    id: "mode", runsOn: "the hub and the playbooks of the mode skill", inputs: ["mode"],
    finds: "a unit name (`**x** skill`, `` `/x` ``, bare /x) that no kept unit has and the allowlist does not hold (`E_MODE_NAME`). A name of a unit that `disable` removed is an info line",
    severity: "block, info", ackable: true, ackNote: "yes", run: runModeNames,
  },
  {
    id: "license", runsOn: "sources", inputs: ["sources"],
    finds: "missing or disallowed license",
    severity: "block", ackable: true, ackNote: "yes", run: runLicense,
  },
  {
    id: "cve", runsOn: "packs with a dependency manifest", inputs: ["sources"],
    finds: "high or critical advisory in the OSV cache. No scanner and no cached result (block, see open questions)",
    severity: "block", ackable: true, ackNote: "yes", run: runCve,
  },
  {
    id: "telemetry", runsOn: "pack.json", inputs: ["records"],
    finds: "`default_on` and neither `DO_NOT_TRACK` nor a listed opt-out var set",
    severity: "warn", ackable: false, ackNote: "no: set the var", run: runTelemetry,
  },
  {
    id: "budget", runsOn: "rendered bytes plus always-on files rig can read", inputs: ["rendered"],
    finds: "description above the harness cap (block), above 300 chars (warn), always-on tokens, listing chars, body size, co-load, cache-bust lint, reference depth, instruction file above the harness limit (block)",
    severity: "block, warn", ackable: false, ackNote: "no", run: runBudget,
  },
]);

/** The section 10 table, as Markdown. The boundary test compares it with the doc. */
export function checkTable() {
  const rows = REGISTRY.map((r) => `| \`${r.id}\` | ${r.runsOn} | ${r.finds} | ${r.severity} | ${r.ackNote} |`);
  return ["| Check | Runs on | Finds | Severity | Ackable |", "|---|---|---|---|---|", ...rows].join("\n");
}
