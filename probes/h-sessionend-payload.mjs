#!/usr/bin/env node
// Probe (h): does a project SessionEnd hook fire in `claude -p`, and what keys does its payload carry?
import fs from "node:fs";
import path from "node:path";
import { finish, freshDir, parseOut, run } from "./_lib.mjs";

const probe = "h-sessionend-payload";
const sets = "claude hooks.session_end";
const out = parseOut(process.argv);

const project = freshDir("h-project");
const payloadFile = path.join(project, "payload.json");
fs.mkdirSync(path.join(project, ".claude"));
fs.writeFileSync(
  path.join(project, ".claude", "settings.json"),
  JSON.stringify({
    hooks: {
      SessionEnd: [
        { hooks: [{ type: "command", command: `cat > '${payloadFile}'` }] },
      ],
    },
  }, null, 2),
);

const started = Date.now();
const r = run("claude", ["-p", "--max-turns", "1", "reply ok"], { cwd: project, timeoutMs: 110000 });
const elapsedMs = Date.now() - started;

let fired = fs.existsSync(payloadFile);
let keys = [];
let types = {};
let enums = {};
let parseError = null;
let transcriptPathExists = null;
if (fired) {
  try {
    const payload = JSON.parse(fs.readFileSync(payloadFile, "utf8"));
    keys = Object.keys(payload).sort();
    types = Object.fromEntries(keys.map((k) => [k, typeof payload[k]]));
    transcriptPathExists = typeof payload.transcript_path === "string" && fs.existsSync(payload.transcript_path);
    for (const k of ["hook_event_name", "reason"]) {
      if (typeof payload[k] === "string") enums[k] = payload[k];
    }
  } catch (e) {
    parseError = "payload is not valid JSON";
  }
}

const cliOk = r.status === 0 && !r.timedOut;
const hasLocators = keys.includes("session_id") && keys.includes("transcript_path") && transcriptPathExists === true;
const verdict = !cliOk ? "INCONCLUSIVE" : fired && !parseError && hasLocators ? "PASS" : "FAIL";
finish({
  probe,
  verdict,
  sets,
  evidence: {
    claudeExit: r.status,
    timedOut: r.timedOut,
    elapsedMs,
    replyContainedOk: /\bok\b/i.test(r.stdout),
    hookFiredInPrintMode: fired,
    payloadKeys: keys,
    transcriptPathExists,
    payloadValueTypes: types,
    enumValues: enums,
    parseError,
    note: "values other than the two enum fields are not recorded",
  },
}, out);
