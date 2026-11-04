#!/usr/bin/env node
// Probe (i-claude): which headless flags exist, by `--help` text and by one small run each where cheap.
import { finish, freshDir, parseOut, run } from "./_lib.mjs";

const probe = "i-claude-headless-flags";
const sets = "argv template of the claude-cli headless provider record";
const out = parseOut(process.argv);

const help = run("claude", ["--help"], { timeoutMs: 30000 }).stdout;
const flags = ["-p", "--output-format", "--model", "--plugin-dir", "--setting-sources", "--append-system-prompt", "--max-turns"];
const inHelp = Object.fromEntries(
  flags.map((f) => [f, new RegExp(`(^|[\\s,])${f}(\\s|,|$)`, "m").test(help)]),
);
const outputChoices = /--output-format[\s\S]*?\(choices: ([^)]*)\)/.exec(help)?.[1]
  .split(",").map((c) => c.trim().replace(/"/g, "")) ?? [];

const cwd = freshDir("i-project");
const small = (extra) => run("claude", ["-p", "--max-turns", "1", ...extra], { cwd, timeoutMs: 110000 });

const jsonRun = small(["--output-format", "json", "reply ok"]);
let jsonKeys = [];
try {
  const parsed = JSON.parse(jsonRun.stdout);
  jsonKeys = Object.keys(Array.isArray(parsed) ? parsed.at(-1) : parsed).sort();
} catch { /* leave empty */ }

const streamRun = small(["--output-format", "stream-json", "--verbose", "reply ok"]);
const streamTypes = [
  ...new Set(
    streamRun.stdout.split("\n").filter(Boolean).map((l) => {
      try { return JSON.parse(l).type; } catch { return null; }
    }).filter(Boolean),
  ),
].sort();
const streamWithoutVerbose = small(["--output-format", "stream-json", "reply ok"]);

const sourcesRun = small(["--setting-sources", "project", "reply ok"]);
const appendRun = small(["--append-system-prompt", "End every reply with the word zebra.", "reply ok"]);
const modelRun = small(["--model", "sonnet", "reply ok"]);
const bogus = run("claude", ["-p", "--rig-probe-no-such-flag", "reply ok"], { cwd, timeoutMs: 30000 });
const rejectsUnknownFlags = /unknown option/i.test(bogus.stderr);
const maxTurnsAccepted = rejectsUnknownFlags && !/unknown option/i.test(small(["reply ok"]).stderr);

const behaviour = {
  "--output-format json": jsonRun.status === 0 && jsonKeys.length > 0,
  "--output-format stream-json (with --verbose)": streamRun.status === 0 && streamTypes.length > 0,
  "--setting-sources": sourcesRun.status === 0,
  "--append-system-prompt": appendRun.status === 0 && /zebra/i.test(appendRun.stdout),
  "--model": modelRun.status === 0,
  "--max-turns": maxTurnsAccepted,
};
const controls = { cliRejectsUnknownFlags: rejectsUnknownFlags };

const exists = {
  "-p": inHelp["-p"],
  "--output-format": inHelp["--output-format"] && behaviour["--output-format json"],
  "--model": inHelp["--model"] && behaviour["--model"],
  "--plugin-dir": inHelp["--plugin-dir"],
  "--setting-sources": inHelp["--setting-sources"] && behaviour["--setting-sources"],
  "--append-system-prompt": inHelp["--append-system-prompt"] && behaviour["--append-system-prompt"],
  "--max-turns": behaviour["--max-turns"],
};
const allExist = Object.values(exists).every(Boolean);
finish({
  probe,
  verdict: allExist ? "PASS" : "FAIL",
  sets,
  evidence: {
    exists,
    listedInHelp: inHelp,
    outputFormatChoicesInHelp: outputChoices,
    jsonResultKeys: jsonKeys,
    streamJsonEventTypes: streamTypes,
    streamJsonWithoutVerbose: { exit: streamWithoutVerbose.status, errorMentionsVerbose: /verbose/i.test(streamWithoutVerbose.stderr) },
    behaviourChecks: behaviour,
    controls,
    note: "--max-turns is absent from --help in this version but the CLI accepts it; plugin-dir behaviour is covered by probe k",
  },
}, out);
