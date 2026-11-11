// The guarantees of evals/ (see evals/README.md): every history line fits the schema, every run has its files, the
// history only grows, and no committed file carries a private host, path, address or cluster name.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import {
  historyGitProblem, isAppendOnly, parseHistory, scanPrivacy, usableTrialsProblem, validateLine, validateSummary, type Cell, type Judge,
} from "../scripts/evals-history.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const EVALS = join(ROOT, "evals");
const HISTORY = join(EVALS, "history.jsonl");
const SHA = "b".repeat(64);

const sampleCell: Cell = {
  schema: 1, kind: "cell", run: "2026-11-01-sample", date: "2026-11-01", rig_commit: null, unit: "gstack/investigate@b406820", arm: "told",
  harness: "claude-code", harness_version: "2.1.322", model: "claude-opus-5-5", effort: "default", fixture: "fx3", fixture_sha256: SHA,
  grader_sha256: SHA, k: 4, n: 8, mean_cost_usd: 0.3, mean_turns: 12,
};
const sampleJudge: Judge = {
  schema: 1, kind: "judge", run: "2026-11-01-sample-judge", date: "2026-11-01", judge_set: "set", model: "pico", subset: "all", n: 48, pairs: 24,
  auc: 0.85, auc_ci95: [0.74, 0.94], pair_acc: 0.79, cases_sha256: SHA,
};

const files = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((rel) => join(dir, rel))
    .filter((path) => statSync(path).isFile())
    .sort();

const git = (args: string[]): string | null => {
  const run = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  return run.status === 0 ? run.stdout : null;
};

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.invalid",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.invalid",
};
const run = (cwd: string, args: string[]): void => {
  const out = spawnSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV });
  assert.equal(out.status, 0, out.stderr);
};

/** A throwaway repository whose evals/history.jsonl has one commit per entry of `versions`. */
function repoWithVersions(versions: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "evals-git-"));
  run(dir, ["init", "-q"]);
  mkdirSync(join(dir, "evals"));
  for (const [index, version] of versions.entries()) {
    writeFileSync(join(dir, "evals/history.jsonl"), version);
    run(dir, ["add", "."]);
    run(dir, ["commit", "-q", "-m", `v${index}`]);
  }
  return dir;
}


describe("history.jsonl schema", () => {
  test("every committed line is valid and none repeats a cell", () => {
    const lines = parseHistory(readFileSync(HISTORY, "utf8"));
    assert.ok(lines.length > 0);
    assert.ok(lines.some((l) => l.kind === "cell") && lines.some((l) => l.kind === "judge"));
  });

  test("the validator accepts the sample lines", () => {
    assert.deepEqual(validateLine(sampleCell), []);
    assert.deepEqual(validateLine(sampleJudge), []);
    assert.deepEqual(validateLine({ ...sampleCell, note: "a note" }), []);
  });

  test("the validator rejects each kind of bad line", () => {
    const bad: [unknown, RegExp][] = [
      [{ ...sampleCell, k: 9 }, /k is larger than n/],
      [{ ...sampleCell, n: 0 }, /bad value for n/],
      [{ ...sampleCell, k: 1.5 }, /bad value for k/],
      [{ ...sampleCell, grader_sha256: "abc" }, /bad value for grader_sha256/],
      [{ ...sampleCell, unit: "Not A Unit" }, /bad value for unit/],
      [{ ...sampleCell, date: "2026-13-40" }, /bad value for date/],
      [{ ...sampleCell, run: "2026-11-02-sample" }, /run must start with the date/],
      [{ ...sampleCell, extra: 1 }, /unknown field extra/],
      [{ ...sampleCell, schema: 2 }, /bad value for schema/],
      [{ ...sampleJudge, auc_ci95: [0.9, 0.7] }, /bad value for auc_ci95/],
      [{ ...sampleJudge, pairs: 5 }, /pairs must be n \/ 2/],
      [{ kind: "other" }, /kind must be cell or judge/],
      ["text", /kind must be cell or judge/],
    ];
    for (const [value, expected] of bad) assert.match(validateLine(value).join("; "), expected);
    const { harness, ...withoutHarness } = sampleCell;
    assert.match(validateLine(withoutHarness).join("; "), /missing field harness/);
  });

  test("parseHistory names the line of a bad or duplicate entry", () => {
    const one = JSON.stringify(sampleCell);
    assert.throws(() => parseHistory(`${one}\nnot json\n`), /history line 2: not valid JSON/);
    assert.throws(() => parseHistory(`${one}\n${one}\n`), /history line 2: duplicate/);
  });
});

describe("run directories", () => {
  const lines = parseHistory(readFileSync(HISTORY, "utf8"));
  const runs = [...new Set(lines.map((l) => l.run))];
  const dirs = readdirSync(join(EVALS, "runs"));

  test("every run id has a directory and every directory has history lines", () => {
    assert.deepEqual([...dirs].sort(), [...runs].sort());
  });

  for (const run of runs) {
    test(`${run}: summary, analysis and prereg agree with the history`, () => {
      const dir = join(EVALS, "runs", run);
      const summary = JSON.parse(readFileSync(join(dir, "summary.json"), "utf8"));
      assert.deepEqual(validateSummary(summary), []);
      assert.equal(summary.run, run);
      const own = lines.filter((l) => l.run === run);
      assert.equal(summary.lines, own.length);
      assert.equal(usableTrialsProblem(summary, own), null);
      assert.ok(own.every((l) => l.date === summary.date));
      assert.equal(summary.kind, own[0]!.kind === "cell" ? "experiment" : "judge");
      assert.ok(existsSync(join(dir, summary.analysis.file)));
      if (summary.prereg === null) assert.equal(existsSync(join(dir, "prereg.md")), false);
      else {
        const stored = createHash("sha256").update(readFileSync(join(dir, "prereg.md"))).digest("hex");
        assert.equal(stored, summary.prereg.stored_sha256);
        assert.equal(summary.prereg.original_sha256 === summary.prereg.stored_sha256, summary.prereg.redactions.length === 0);
      }
    });
  }
});

describe("usable_trials", () => {
  const cells = [{ ...sampleCell, n: 8 }, { ...sampleCell, arm: "none", n: 7 }];
  const summary = { usable_trials: 15 } as { usable_trials: number | null };

  test("equals the sum of n over the experiment lines", () => {
    assert.equal(usableTrialsProblem(summary as never, cells), null);
    assert.match(usableTrialsProblem({ usable_trials: 16 } as never, cells) ?? "", /usable_trials is 16, the lines sum to 15/);
    assert.match(usableTrialsProblem({ usable_trials: null } as never, cells) ?? "", /usable_trials is null, the lines sum to 15/);
  });

  test("is null for a judge run, whose subsets overlap", () => {
    assert.equal(usableTrialsProblem({ usable_trials: null } as never, [sampleJudge]), null);
    assert.match(usableTrialsProblem({ usable_trials: 48 } as never, [sampleJudge]) ?? "", /usable_trials is 48, a judge run must say null/);
  });
});

describe("append-only history", () => {
  test("isAppendOnly accepts added lines and rejects an edited, removed or reordered line", () => {
    assert.equal(isAppendOnly("a\nb\n", "a\nb\nc\n"), true);
    assert.equal(isAppendOnly("a\nb\n", "a\nb\n"), true);
    assert.equal(isAppendOnly("a\nb\n", "a\nB\nc\n"), false);
    assert.equal(isAppendOnly("a\nb\n", "a\n"), false);
    assert.equal(isAppendOnly("a\nb\n", "b\na\n"), false);
  });

  test("every git version of history.jsonl is a prefix of the next one and of the working tree", (t) => {
    if (git(["rev-parse", "--git-dir"]) === null) return t.skip("not a git checkout");
    assert.equal(historyGitProblem(ROOT, "evals/history.jsonl"), null);
  });

  test("the git check accepts appended lines", () => {
    const dir = repoWithVersions(["a\n", "a\nb\n", "a\nb\nc\n"]);
    writeFileSync(join(dir, "evals/history.jsonl"), "a\nb\nc\nd\n");
    assert.equal(historyGitProblem(dir), null);
  });

  test("the git check rejects a committed edit and an uncommitted edit", () => {
    const edited = repoWithVersions(["a\nb\n", "a\nB\nc\n"]);
    assert.match(historyGitProblem(edited) ?? "", /edited or removed an earlier history line/);
    const dirty = repoWithVersions(["a\nb\n"]);
    writeFileSync(join(dirty, "evals/history.jsonl"), "a\nx\n");
    assert.match(historyGitProblem(dirty) ?? "", /working tree edited or removed/);
  });

  test("the git check fails, and names fetch-depth, on a shallow clone that shows one commit", () => {
    const origin = repoWithVersions(["a\n", "a\nb\n"]);
    const clone = join(mkdtempSync(join(tmpdir(), "evals-shallow-")), "clone");
    run(origin, ["clone", "-q", "--depth", "1", `file://${origin}`, clone]);
    assert.equal(spawnSync("git", ["rev-parse", "--is-shallow-repository"], { cwd: clone, encoding: "utf8" }).stdout.trim(), "true");
    assert.match(historyGitProblem(clone) ?? "", /shallow clone.*fetch-depth: 0/);
  });

  test("the git check passes on a full clone of the same repository", () => {
    const origin = repoWithVersions(["a\n", "a\nb\n"]);
    const clone = join(mkdtempSync(join(tmpdir(), "evals-full-")), "clone");
    run(origin, ["clone", "-q", `file://${origin}`, clone]);
    assert.equal(historyGitProblem(clone), null);
  });

  test("CI checks out the full history", () => {
    const workflow = readFileSync(join(ROOT, ".github/workflows/test.yml"), "utf8");
    const checkouts = workflow.split("\n").filter((l) => l.includes("actions/checkout"));
    assert.ok(checkouts.length > 0);
    for (const line of checkouts) {
      const at = workflow.indexOf(line);
      const next = workflow.indexOf("- ", at + line.length);
      const step = workflow.slice(at, next === -1 ? undefined : next);
      assert.match(step, /fetch-depth:\s*0/, "every actions/checkout step needs fetch-depth: 0 so the append-only test compares history");
    }
  });
});

describe("privacy gate", () => {
  const colon = ":";
  const sample = (parts: string[]): string[] => scanPrivacy(parts.join(""));
  const has = (parts: string[], label: string | RegExp): void => {
    const found = sample(parts);
    assert.ok(found.some((f) => (typeof label === "string" ? f === label : label.test(f))), `${parts.join("")} -> ${JSON.stringify(found)}`);
  };

  test("URLs: github.com passes, every other host is flagged", () => {
    assert.deepEqual(sample(["see https", colon, "//github.com/org/repo/pull/1"]), []);
    assert.deepEqual(sample(["see https", colon, "//example.org/x"]), ["URL host example.org"]);
    assert.deepEqual(sample(["see http", colon, "//raw.githubusercontent.com/x"]), ["URL host raw.githubusercontent.com"]);
    assert.deepEqual(sample(["see https", colon, "//huggingface.co/x"]), ["URL host huggingface.co"]);
    assert.deepEqual(sample(["see https", colon, "//arxiv.org/abs/1"]), ["URL host arxiv.org"]);
    has(["see ssh", colon, "//user@git.example.net:22/x"], "URL host git.example.net");
  });

  test("host and port: a dotted host or localhost followed by digits", () => {
    has(["call git.example.net", colon, "8080"], /^host:port git\.example\.net/);
    has(["call api.example.org", colon, "443/v1"], /^host:port api\.example\.org/);
    has(["call local", "host", colon, "3000"], "localhost");
    has(["call local", "host", colon, "3000"], /^host:port localhost/);
    has(["user@box.example.net", colon, "22"], /^host:port box\.example\.net/);
  });

  test("the loopback name, private top-level names and cluster names", () => {
    has(["serve on local", "host"], "localhost");
    has(["serve on LOCAL", "HOST."], "localhost");
    for (const tld of ["local", "lan", "internal", "home", "corp", "intra"]) has([`build-box.${tld}`], `private host build-box.${tld}`);
    has(["see build-box.corp.", "\n"], "private host build-box.corp");
    has(["cluster k3", "s-node"], "cluster name");
    has(["node.ho", "me.example"], "cluster name");
  });

  test("IPv4 addresses, with and without a port", () => {
    has(["host 10.0", ".4.7"], "IP address");
    has(["host 192.168", ".1.20", colon, "22"], "IP address");
    has(["host 255.255", ".255.255"], "IP address");
    has(["(127.0", ".0.1)"], "IP address");
  });

  test("IPv6 addresses in full, compressed, loopback and link-local form", () => {
    has(["host fe80:0:0:0", ":1:2:3:4"], "IP address");
    has(["host 2001:db8:85a3:0:0:8a2e:370:7334"], "IP address");
    has(["host 2001:db8::8a2e:370:7334"], "IP address");
    has(["loopback ", "::1", " and"], "IP address");
    has(["link-local fe80", "::", " scope"], "IP address");
    has(["url http", colon, "//[", "::1", "]:80/x"], "IP address");
    has(["addr fe80", "::1%en0"], "IP address");
  });

  test("absolute local paths on macOS, Linux and Windows", () => {
    for (const root of ["/Us" + "ers/someone/work", "/pri" + "vate/var/x", "/t" + "mp/x", "/ho" + "me/someone", "/var/fol" + "ders/zz/T/x", "/Vol" + "umes/Disk/x"])
      has([`at ${root}`], "absolute local path");
    has(["cd /t", "mp"], "absolute local path");
    has(["\"/Us", "ers/x\""], "absolute local path");
    has(["C:\\Us", "ers\\someone"], "absolute local path");
    has(["C:\\\\Us", "ers\\\\someone"], "absolute local path");
    has(["D:/Us", "ers/someone"], "absolute local path");
  });

  test("home paths: ~/ is flagged unless it names a generic tool or OS directory", () => {
    has(["see ~/r", "nd/project"], "home path");
    has(["see ~/Doc", "uments/x"], "home path");
    has(["see ~/.s", "sh/config"], "home path");
    has(["see ~/.claude-private/x"], "home path");
    for (const dir of [".claude", ".codex", ".agents", ".cursor", ".config", ".cache", ".vscode", "Library"]) {
      assert.deepEqual(sample([`see ~/${dir}/rules/x.md`]), [], dir);
      assert.deepEqual(sample([`in ~/${dir}`]), [], dir);
    }
  });

  test("the scanner does not flag versions, times, units, file references or relative paths", () => {
    const clean = [
      "claude code 2.1.322 at 2026-11-10T22:44:53+0100 in evals/runs/x/summary.json",
      "unit rule:bug-fix-callers and fixture fx3: four tests",
      "gstack/investigate@b406820 on node 22.18.0, 3.14.159, v1.2.3.4",
      "see scripts/evals-history.ts:211 and evals/README.md:58 and history.jsonl:15:3",
      "AUC 0.8458049886621315 CI [0.7231121281464531, 0.9444444444444444]",
      "settings.local.json and CLAUDE.local.md are files",
      "relative src/home/page.ts, docs/tmp/x, ./tmp/x and a/private/b",
      "Foo::Bar, std::vector, key: value, 12:30:45 and 10:22:44:53",
      "email-free text with a/b and 1/2 and 2026-11-10",
      "version 1.2.3.256 and 1.2.3 and 300.1.1.1",
    ];
    for (const text of clean) assert.deepEqual(scanPrivacy(text), [], text);
  });

  test("the scanner reports each class once per text", () => {
    assert.deepEqual(sample(["10.0", ".0.1 and 10.0", ".0.2"]), ["IP address"]);
  });

  test("no file under evals/ carries a private host, path, address or cluster name", () => {
    const all = files(EVALS);
    assert.ok(all.length > 0);
    const problems = all.flatMap((path) => scanPrivacy(readFileSync(path, "utf8")).map((finding) => `${path.slice(ROOT.length)}: ${finding}`));
    assert.deepEqual(problems, []);
  });
});
