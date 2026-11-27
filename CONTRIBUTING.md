# Contributing to rig

## Prerequisites

Install Node 22.18.0 or later. rig runs `.ts` files directly through Node's native type stripping, with no build step and no runtime dependencies. `test/package.test.ts` fails if `package.json` declares `dependencies`, `optionalDependencies`, `peerDependencies`, `bundleDependencies`, or `bundledDependencies`.

## Verify your changes

Run the offline test suite from the repository root without installing packages:

```sh
npm test
```

Tests run inside a temporary `HOME` and do not modify your harness configuration files. Opt-in live harness tests require `RIG_LIVE=1`.

Run the strict TypeScript ratchet check with dev dependencies installed:

```sh
npm ci --ignore-scripts && npm run typecheck
```

`npm run typecheck` compares the strict `tsc` error count against `tsc-baseline.json` and fails if the count increases.

## Repository contracts

- `packs/core/` is sealed in `rig.lock.json`. If you change any file under `packs/core/`, update the seal with `rig pin check core` and `rig pin set core`.
- `test/docs.test.ts` checks every relative link and every fenced `rig` command in `README.md`, `docs/README.md`, `docs/harnesses.md`, and `docs/guide/*.md` against `rig --help`.
- `test/evals-history.test.ts` requires `evals/history.jsonl` to stay append-only across git history and checks `evals/` for private hosts and local paths.
- Keep the repository generic. Do not commit personal file paths, account names, or private setup details. Put personal packs and overrides in your local overlay under `~/.config/rig`.
