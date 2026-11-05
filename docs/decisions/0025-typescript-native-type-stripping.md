# 0025. TypeScript through Node native type stripping

- Status: Accepted
- Date: 2026-11-05

## Context

The code base was JavaScript (`.mjs`) with JSDoc types. Nothing checked those types. Parallel agents write separate modules, and the contracts between the modules drift without a check. The user chose TypeScript.

rig has these limits: no runtime npm dependencies, no build step, and a generic repository. Node 22.18.0 and later run `.ts` files directly. Node removes the type syntax before it runs the file, and it accepts only syntax that it can erase.

## Decision

- Source, tests and probes are `.ts` files. Node runs them directly through native type stripping. There is no build step and no emitted JavaScript.
- Use erasable syntax only: no `enum`, no `namespace`, no parameter properties, no decorators that emit code. `tsconfig.json` sets `erasableSyntaxOnly` and `verbatimModuleSyntax`, so `tsc` rejects other syntax. Type-only imports use `import type`.
- CI runs `tsc --noEmit` in strict mode through a ratchet (`scripts/tsc-ratchet.ts`). The job fails when the error count rises above `tsc-baseline.json`. An equal or lower count passes and prints the delta. Lower the baseline as the types get fixed.
- `typescript` and `@types/node` are devDependencies, pinned to exact versions, with a committed `package-lock.json` that holds the integrity hashes. `@types/node` follows the lowest supported Node major.
- rig has no runtime dependencies. A test fails if `package.json` declares a `dependencies` field or one of its variants.
- `engines.node` is the lowest version on which CI ran the type-stripping check.

## Consequences

- Install from a checkout with `npm link`. Do not use `npm i -g` from a git URL. Node does not strip types in files under `node_modules`, so `bin/rig.ts` fails there.
- Tests run with no install step. Only the typecheck job runs `npm ci`.
- Relative imports name the `.ts` file, for example `./world.ts`.
- `scripts/migrate-to-ts.mjs` did the one-time move from `.mjs` and JSDoc. It stays in the repository, because a branch from before the move can run it again.
- The baseline starts high, because most JSDoc-only code has no annotations. Follow-up work lowers it one directory at a time.
