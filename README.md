# rig

rig is a version-pinned agent-skill stack and a seeder for coding-agent harnesses.
It composes packs of skills, commands, agents and rules, runs one gate over them,
and writes pinned copies into each harness. It is one Node ESM CLI with no npm
dependencies.

Status: v0 in progress. The CLI parses all seven commands (`plan`, `apply`,
`doctor`, `stats`, `models`, `pack`, `pin`); the modules behind them are stubs
that throw `not implemented`.

## Tests

Node 22.18.0 or later: it runs the `.ts` files directly, with no build step. From the repo root:

    npm test

Tests that call real harness CLIs are opt-in: set `RIG_LIVE=1`.

Design, decisions and research live in [docs/](docs/).
