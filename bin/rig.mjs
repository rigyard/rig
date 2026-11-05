#!/usr/bin/env node
// bin/rig.mjs — the command table. Parser, help and dispatch derive from it. No policy here.

import { parseArgs } from "node:util";
import { applyCmd, dispatch, doctorCmd, modelsCmd, packAddCmd, pinCmd, planCmd, statsCmd } from "../lib/commands.mjs";

/** @typedef {import("../lib/commands.mjs").ParsedArgs} ParsedArgs */

/**
 * One flag. value: takes a value (shown as <arg>). choices: the only values allowed. No flag may skip the gate.
 * @typedef {{value: boolean, arg?: string, choices?: string[], required?: boolean, repeat?: boolean}} Flag
 */

/**
 * One row per command form. A command with a row that has no `sub` may run bare; a command whose rows all
 * set `sub` needs a subcommand. Rows of one command share its handler.
 * @typedef {{name: string, sub?: string, args?: string[], flags: Record<string, Flag>,
 *            run: (a: ParsedArgs, env: NodeJS.ProcessEnv) => Promise<0|1|2>, help: string}} Command
 */

/** @type {Command[]} */
const COMMANDS = [
  { name: "plan", flags: {}, run: planCmd, help: "compose, render, gate, diff against disk and state; writes nothing" },
  { name: "apply", flags: { "--undo": { value: true, arg: "run-id" } }, run: applyCmd, help: "plan, then the journaled write; the only writer into ~" },
  { name: "doctor", flags: { "--project": { value: true, arg: "dir" } }, run: doctorCmd, help: "read-only diagnosis of the machine, or of one project" },
  {
    name: "stats",
    flags: {
      "--since": { value: true, arg: "dur" },
      "--harness": { value: true, arg: "h" },
      "--suggest": { value: false },
      "--record": { value: false },
      "--session": { value: true, arg: "id" },
    },
    run: statsCmd,
    help: "metrics from transcripts; --suggest adds a proposed diff; --record records one session (hook mode, or --session <id> by hand)",
  },
  { name: "models", flags: {}, run: modelsCmd, help: "effective model table per harness, with the source of each value" },
  {
    name: "models",
    sub: "set",
    args: ["tier", "model"],
    flags: { "--harness": { value: true, arg: "h", required: true } },
    run: modelsCmd,
    help: "swap the model of one tier in models/tiers.json; rig apply renders it",
  },
  {
    name: "pack",
    sub: "add",
    args: ["repo"],
    flags: {
      "--sha": { value: true, arg: "sha", required: true },
      "--path": { value: true, arg: "path", required: true, repeat: true },
      "--into": { value: true, choices: ["overlay"] },
    },
    run: packAddCmd,
    help: "vendor a pack at a commit, gate it, print ack stanzas",
  },
  { name: "pin", sub: "check", args: ["name"], flags: { "--sha": { value: true, arg: "sha" } }, run: pinCmd, help: "gate a native plugin tree at a commit, record a candidate" },
  { name: "pin", sub: "set", args: ["name"], flags: {}, run: pinCmd, help: "promote the candidate when the installed commit matches" },
];

const NAMES = [...new Set(COMMANDS.map((c) => c.name))];

class UsageError extends Error {}

/** @param {Command} c @returns {string} */
function synopsis(c) {
  const parts = ["rig", c.name];
  if (c.sub) parts.push(c.sub);
  for (const a of c.args ?? []) parts.push(`<${a}>`);
  for (const [name, f] of Object.entries(c.flags)) {
    let s = name;
    if (f.value) s += f.choices?.length === 1 ? ` ${f.choices[0]}` : ` <${f.arg ?? name.slice(2)}>`;
    if (f.repeat) s += "...";
    parts.push(f.required ? s : `[${s}]`);
  }
  return parts.join(" ");
}

/** @param {Command[]} rows @returns {string} */
function helpText(rows) {
  const col = 46; // a longer synopsis puts its help on the next line
  const lines = rows.map((c) => {
    const s = synopsis(c);
    return s.length < col ? `  ${s.padEnd(col)} ${c.help}` : `  ${s}\n  ${" ".repeat(col)} ${c.help}`;
  });
  return [
    "rig: a version-pinned agent-skill stack and a seeder for coding-agent harnesses.",
    "",
    "Usage:",
    ...lines,
    "",
    "Every command takes --help. No flag skips the gate.",
    "Exit codes: 0 done, 1 blocked or failed, 2 usage or config error.",
    "",
  ].join("\n");
}

/**
 * Strict parse of one command's argv against its rows.
 * @param {string} name @param {string[]} argv @returns {{row: Command, parsed: ParsedArgs}}
 */
function parse(name, argv) {
  const rows = COMMANDS.filter((c) => c.name === name);
  const subs = rows.filter((c) => c.sub).map((c) => c.sub);
  let row = rows.find((c) => c.sub !== undefined && c.sub === argv[0]);
  const rest = row ? argv.slice(1) : argv;
  row ??= rows.find((c) => c.sub === undefined);
  if (!row) {
    throw new UsageError(argv[0] === undefined || argv[0].startsWith("-")
      ? `rig ${name} needs a subcommand: ${subs.join(", ")}`
      : `unknown subcommand "${argv[0]}" for rig ${name}; expected: ${subs.join(", ")}`);
  }

  const options = {};
  for (const [flag, f] of Object.entries(row.flags)) options[flag.slice(2)] = { type: f.value ? "string" : "boolean" };
  // strict: false, because every token is validated below, with messages that name the flag.
  const { tokens } = parseArgs({ args: rest, options, strict: false, allowPositionals: true, tokens: true });

  const where = `rig ${name}${row.sub ? ` ${row.sub}` : ""}`;
  /** @type {Record<string, string | boolean | string[]>} */
  const flags = {};
  const positionals = [];
  for (const t of tokens) {
    if (t.kind === "positional") {
      positionals.push(t.value);
      continue;
    }
    if (t.kind !== "option") continue; // the "--" terminator
    const f = t.rawName.startsWith("--") ? row.flags[t.rawName] : undefined;
    if (!f) throw new UsageError(`unknown flag ${t.rawName} for ${where}`);
    let value = true;
    if (f.value) {
      if (t.value === undefined || (!t.inlineValue && t.value.startsWith("-"))) throw new UsageError(`${t.rawName} needs a value`);
      if (f.choices && !f.choices.includes(t.value)) throw new UsageError(`${t.rawName} accepts only: ${f.choices.join(", ")}`);
      value = t.value;
    } else if (t.value !== undefined) {
      throw new UsageError(`${t.rawName} takes no value`);
    }
    if (f.repeat) flags[t.name] = [...(flags[t.name] ?? []), value];
    else if (t.name in flags) throw new UsageError(`${t.rawName} given more than once`);
    else flags[t.name] = value;
  }

  for (const [flag, f] of Object.entries(row.flags)) {
    if (f.required && !(flag.slice(2) in flags)) throw new UsageError(`${where} needs ${flag}`);
  }
  const names = row.args ?? [];
  if (positionals.length !== names.length) {
    throw new UsageError(names.length
      ? `${where} takes ${names.map((a) => `<${a}>`).join(" ")}, got ${positionals.length} argument(s)`
      : `${where} takes no arguments, got "${positionals[0]}"`);
  }
  const args = Object.fromEntries(names.map((a, i) => [a, positionals[i]]));
  return { row, parsed: { cmd: name, sub: row.sub ?? null, args, flags } };
}

/** @param {string[]} argv @returns {Promise<number>} exit code */
async function main(argv) {
  const [first, ...rest] = argv;
  if (first === undefined) throw new UsageError("missing command; run rig --help");
  if (first === "--help" || first === "help") {
    if (rest.length > 1 || (first === "--help" && rest.length)) throw new UsageError("help takes at most one command: rig help [<command>]");
    if (rest.length && !NAMES.includes(rest[0])) throw new UsageError(`unknown command "${rest[0]}"; run rig --help`);
    process.stdout.write(helpText(rest.length ? COMMANDS.filter((c) => c.name === rest[0]) : COMMANDS));
    return 0;
  }
  if (!NAMES.includes(first)) throw new UsageError(`unknown command "${first}"; run rig --help`);
  // --help wins before validation, so "rig <cmd> ... --help" always prints that command's help.
  if (rest.includes("--help")) {
    process.stdout.write(helpText(COMMANDS.filter((c) => c.name === first)));
    return 0;
  }
  const { row, parsed } = parse(first, rest);
  // Exit codes: dispatch maps a typed error to 2 (usage, config) or 1, and a non-exit-code result to E_INTERNAL.
  return dispatch(first, row.run, parsed, process.env);
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (err) {
  if (!(err instanceof UsageError)) throw err;
  process.stderr.write(`rig: E_USAGE ${err.message}\n`);
  process.exitCode = 2;
}
