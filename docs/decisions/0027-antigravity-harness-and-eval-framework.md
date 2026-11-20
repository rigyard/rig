# 0027. Antigravity harness support and automated evaluation framework

- Status: Accepted
- Date: 2026-11-19

## Context

rig previously configured four harnesses in `models/tiers.json`: Claude Code, Codex, Cursor, and omp. Target definitions and seed mirrors were missing support for the Antigravity CLI (`agy`), and test runs in isolated environments (such as sandboxes with custom host configurations) failed when git subprocesses read host configuration files.

In addition, `rig doctor` tracked an evidence ledger (`evidence.json`) which was absent from the repository root, reporting `(no evidence.json)` for all units. Evaluation runs in `evals/runs/` were analyzed and recorded manually without a declarative suite executor or statistical significance testing.

## Decision

- Add Antigravity as a supported harness across `models/tiers.json` and test helpers:
  - Configure `ladders.antigravity` (`low`, `medium`, `high`, `xhigh`, `max`), `passthrough.antigravity` (`auto`, `inherit`), and canonical tiers: `reason: "pro"`, `strong: "pro"`, `fast: "flash"`, `cheap: "flash_lite"`.
  - Add `agy` CLI argument formulation (`-p <prompt> --output-format json --model <model>`) and JSON/JSONL output parsing to `test/helpers/mirror.ts`.
  - Maintain alphabetical ordering of harness keys in configuration maps (`antigravity`, `claude`, `codex`, `cursor`, `omp`) as enforced by `encode("tiers", ...)`.
- Isolate git subprocess environments across all tests and tooling by setting `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_NOSYSTEM=1`.
- Initialize `evidence.json` at schema 1 with validated baseline evidence links for shipped pack units.
- Establish an automated evaluation framework:
  - Declarative suite files in `evals/suites/<slug>.json` defining units, arms, matrices (harness, model, effort), fixtures, and trial counts.
  - An evaluation runner script `scripts/eval-runner.ts` providing `--dry-run`, `--mock`, `--record`, `--promote`, and `--out <dir>`.
  - Statistical analysis computing Wilson 95% confidence intervals per arm, Newcombe hybrid score intervals for arm differences, and Fisher exact test p-values for significance.

## Consequences

- All 1,180+ tests run deterministically in sandboxed environments without git configuration permissions leaks.
- `rig doctor` reports validated units from `evidence.json` with zero errors and zero warnings.
- New evaluation runs can be defined declaratively and run headlessly across any subset of the five harnesses.
- Dry runs and unrecorded evaluations write to temporary directories or custom paths, preserving the invariant that `evals/runs/` matches `evals/history.jsonl` exactly.
