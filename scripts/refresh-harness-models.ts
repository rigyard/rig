// scripts/refresh-harness-models.ts — rewrites the snapshot test/fixtures/harness-models/listed.json from the model
// lists of the three harness CLIs: `cursor-agent --list-models`, `codex debug models` and `omp models`. None of them
// opens a model session. test/models-harness-ids.test.ts checks tiers.json and the rendered tables against the
// snapshot; this script is how the snapshot follows a harness release.
//
// Usage: node scripts/refresh-harness-models.ts [out.json]   default out: the fixture. Review the diff before you commit it.

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures", "harness-models", "listed.json");
/** The omp providers whose models tiers.json may name. */
const OMP_PROVIDERS = ["google-antigravity", "openai-codex"];

const run = (cmd: string, args: string[]): string => execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
const first = (text: string): string => text.trim().split("\n")[0].trim();
/** The efforts that every model of the list supports, in the order of the first model. */
const common = (rows: string[][]): string[] => (rows[0] ?? []).filter((e) => rows.every((r) => r.includes(e)));

type Cursor = { source: string; ids: string[] };
type Listed = { source: string; ids: string[]; efforts: string[] };

function cursor(): Cursor {
  const ids: string[] = [];
  for (const line of run("cursor-agent", ["--list-models"]).split("\n")) {
    const m = line.match(/^(\S+) - .+$/);
    if (m) ids.push(m[1]);
  }
  return { source: `cursor-agent --list-models, ${first(run("cursor-agent", ["--version"]))}`, ids };
}

function codex(): Listed {
  const { models } = JSON.parse(run("codex", ["debug", "models"])) as { models: { slug: string; visibility: string; supported_reasoning_levels: { effort: string }[] }[] };
  const listed = models.filter((m) => m.visibility === "list");
  return {
    source: `codex debug models (visibility list), ${first(run("codex", ["--version"]))}`,
    ids: listed.map((m) => m.slug),
    efforts: common(listed.map((m) => m.supported_reasoning_levels.map((l) => l.effort))),
  };
}

function omp(): Listed {
  const ids: string[] = [];
  const efforts: string[][] = [];
  let provider = "";
  for (const line of run("omp", ["models"]).split("\n")) {
    const head = line.match(/^(\S+) \(\d+\)$/);
    if (head) provider = head[1];
    const row = line.match(/^│ (\S+)\s+│[^│]*│[^│]*│ ([^│]*?)\s*│/);
    if (!row || !OMP_PROVIDERS.includes(provider) || row[1] === "model") continue;
    ids.push(`${provider}/${row[1]}`);
    if (row[2] !== "-") efforts.push(row[2].split(","));
  }
  return { source: `omp models (${OMP_PROVIDERS.join(" and ")} providers), ${first(run("omp", ["--version"])).replace(/^omp\//, "")}`, ids, efforts: common(efforts) };
}

const out = {
  captured: new Date().toISOString().slice(0, 10),
  cursor: cursor(),
  codex: codex(),
  omp: omp(),
};
for (const [h, v] of Object.entries(out)) if (typeof v === "object" && v.ids.length === 0) throw new Error(`${h}: the CLI listed no models; the output format may have changed`);
writeFileSync(process.argv[2] ?? FIXTURE, `${JSON.stringify(out, null, 2)}\n`);
process.stdout.write(`cursor ${out.cursor.ids.length} ids, codex ${out.codex.ids.length} ids, omp ${out.omp.ids.length} ids\n`);
