# Preregistration H-P: does pstack's /create-formal-verification-skill help fix implicit-state-machine bugs?

Written 2026-11-10T22:20Z, before any trial. No `claude` process has run for this hypothesis. Throwaway experiment. All paths are under `.../scratchpad/rig-runner-proto/hyp/`.

## Claim and testable form

Claim (Lauren Tan, pstack, quoting Steve Ruiz's prompt "find all of the implicit state machines in my app"): "use /create-formal-verification-skill to model these state machines, one skill per subsystem."

Testable form. On one subsystem with implicit-state-machine bugs, a TOLD arm (the pstack skill `create-formal-verification-skill` installed as a project skill, prompt starts with `/create-formal-verification-skill `) fixes more of the planted bugs than a NONE arm (same prompt without the slash command, no skill).

Limit of this test, stated up front. The skill's own text says to leave product code alone unless the user asks, and its main product is a verification skill, not a fix. This test grades only the fixes. A "not supported" result says the skill does not raise the number of bugs fixed in this setup. It does not say the skill fails to find or model the state machine.

## The skill and what it needs to run standalone

Source: `<pstack-clone>/skills/create-formal-verification-skill/SKILL.md`, byte-identical copy in `skills/create-formal-verification-skill/SKILL.md` (sha256 30ef0ac27612ecd16fdc081112113221d673053cef3f8603db11932193861211). Plugin repo HEAD de8ee15dd1194627d21eb5fcd41cb1873208dabb; last commit that touched the skill 34b1b7c96f09f81a21a6c78f65b7833f7dcb5b24; the path has no local changes.

- It is a single file of prose. It calls no bin, no script and no hook. It has `disable-model-invocation: true`, so only the slash command can start it. The `Skill` tool path is closed, and delivery is by slash expansion.
- Dangling references, kept as shipped. `../statechart/SKILL.md`, `/statechart` and `/maintain-formal-verification-skill` are not installed, because the brief names one skill. `/statechart` would install TLC and Java through mise over the network. The told arm cannot follow those two references.
- Tooling on this machine. `java -version` works (OpenJDK 25.0.3 Temurin, 2026-04-21 LTS). No `tlc`, `tla2tools.jar` or `apalache-mc` was found on PATH, in Homebrew's Cellar, in `~/.vscode/extensions` or in `~/Library/Application Support`. A full-disk search was not completed. So the skill may choose TLA+, and then the agent must download `tla2tools.jar` itself. Both arms get `Bash(java *)` and `Bash(curl *)` so that this path is open in the told arm and symmetric in the none arm.

## Arms

Both arms use the same flags, the same fixture copy and the same work-dir layout. Only the skill folder and the prompt prefix differ.

- told: `.claude/skills/create-formal-verification-skill/` is present. Prompt = `/create-formal-verification-skill ` + task text.
- none: no skill folder. Prompt = task text.

`.claude/` is in each work dir's `.git/info/exclude`. The told prompt is built in code as the prefix plus the none prompt and `selfcheck` asserts it.

## Prompt, verbatim (task text)

`Orders in our shop sometimes end up in states that should be impossible, and support is cleaning them up by hand. Please make the order lifecycle correct.`

The told prompt is the same text with the prefix `/create-formal-verification-skill ` (one space). The text has no eval words and no bug list. It asks for a correct lifecycle, so a product-code change is requested.

## Model and flags

`--model sonnet`. One-line argument for Sonnet. The fixture is new and uncalibrated, Sonnet is the cheaper model that the earlier calibration used, and the told arm may use many turns; Opus would triple the cost and the result may not transfer to Sonnet. `--max-turns 30`, `--permission-mode acceptEdits`, `--no-session-persistence`, `--setting-sources project,local --strict-mcp-config`, subscription login (API key variables removed). Allowed tools, identical in both arms: `Bash(node *)`, `git`, `ls`, `cat`, `grep`, `find`, `java`, `curl`, `mkdir`, `cp`, `mv`, `chmod`, `sed`, `echo`, `head`, `tail`, `wc`, `diff`, `sort`, `which`. Per-trial timeout 900 s. Work dirs are under `scratchpad/wh/`.

## Fixture: `fixtures/order-pipeline` (frozen)

Tree sha256 77eba9e5c797e5231b447b2d40d7b94424b8b068e0b456d0762ffa159a3d03e3 (method: `find . -type f -not -path './.git/*' | sort | xargs shasum -a 256 | shasum -a 256`). TypeScript, `node >=22.18`, no dependencies, 5 source files and 222 lines (`types.ts`, `services.ts`, `handlers.ts`, `app.ts`, `demo.ts`), plus README and package.json. No comments in the code.

The implicit state machine. An order is four booleans (`paid`, `shipped`, `cancelled`, `refunded`) plus a status derived from them by priority. Five events (`order.placed`, `payment.captured`, `ship.requested`, `order.cancelled`, `refund.requested`) arrive from independent services. The bus gives each handler three attempts per event and handles one order's events one at a time. Entry point for the grader is `createApp()`, `app.deliver(event)`, `app.status(id)`, `app.carrier.shipments`, `app.payments.refunds`, and `app.store.dropNextWrites(n)`. The README documents the events, the delivery model and these entry points. It says events can arrive in any order and be delivered more than once. It does not name any bug.

Three planted bugs, of rising subtlety. This section is for the grader only. The candidate never sees it.

1. Double ship on a retried event (`src/handlers.ts:18`). `ship` calls `carrier.createShipment(order.id)` without the idempotency key that every refund call passes. If the write after the dispatch fails, the bus retries and the carrier ships again. Duplicate delivery after success is handled by the `shipped` guard, so only a partial failure shows it.
2. Refund after cancel (`src/handlers.ts:60` and `:65`). Cancelling a paid order refunds the customer but never sets `refunded`. A later `refund.requested` passes the `!order.refunded` guard and pays again, each with its own event id as the key.
3. Lost transition on out-of-order events (`src/handlers.ts:50`). A `ship.requested` that arrives before `payment.captured` is dropped with a bare `return`. The event is sent once, so the paid order never ships.

Other paths were audited for a fourth bug of the same kinds (side effect then write, drop on a missing precondition). Late payment on a cancelled order, cancel after refund, refund after ship, duplicate events and blips on the payment and cancel writes are handled correctly and are covered by the regression test.

## Grader (frozen)

`graders/orders-service/check.ts`, sha256 199200d1a6011cfdf0150e7cbf7a1de47a4141914b82b504523e69b6fe21ef8b. Four `node --test` tests that use only `app.deliver`, `app.status` and the carrier and payment ledgers, never the order record's fields. A rewrite of the record into an explicit status therefore still grades.

- `bug1` a retried ship request creates one shipment (store drops 2 writes).
- `bug2` a cancelled paid order is paid back once even if a refund is requested later, and a later ship request does nothing.
- `bug3` a ship request before the payment still ships after it, and the same request followed by a cancel and then the payment ships nothing and refunds once.
- `regression` nine ordinary paths: happy path, duplicate events, cancel before pay then late pay, return after ship then cancel, refund then cancel, double cancel, a blip on the payment write, a blip on the cancel write, ship request on an unpaid order.

Score = bugs fixed (0 to 3, the passing `bug` tests). Full pass = 3 bugs fixed and `regression` passing.

Validation (`validation-HP.txt`; 20 repeats of every variant; all 11 variants gave the same result every time):

| Variant | bug1 | bug2 | bug3 | regression | Bugs fixed |
| --- | --- | --- | --- | --- | --- |
| no change | fail | fail | fail | pass | 0 |
| fix1 only (idempotency key) | pass | fail | fail | pass | 1 |
| fix2a only (cancel sets refunded) | fail | pass | fail | pass | 1 |
| fix2b only (refund skips cancelled) | fail | pass | fail | pass | 1 |
| fix3 only (remember the early request) | fail | fail | pass | pass | 1 |
| full fix (1 + 2a + 3) | pass | pass | pass | pass | 3 |
| full fix, other shape (1 + 2b + 3) | pass | pass | pass | pass | 3 |
| full rewrite to an explicit status field | pass | pass | pass | pass | 3 |
| mutant: early ship request throws (dead-letter) | pass | pass | fail | fail | 2 |
| mutant: no retries | fail | pass | pass | fail | 2 |
| mutant: refunds disabled | pass | fail | fail | fail | 1 |

## Design

- n = 8 per arm, 1 fixture, 2 arms = 16 trials. Order: for n = 1..8 the two arms of the pair are queued together and the within-pair order alternates (odd n: told first). Up to 3 trials run at once.
- Run cap `RUN_CAP=20` in the command environment, counted in `results/HP/runs.log`: 16 planned trials, 2 stop-at-init probes and 2 retries. The runner's built-in default of 60 is not used.
- Infra rules are the same as in `prereg-HG.md`.

## Exposure check and delivery gate

Same structure and the same two extensions of the brief's definition as in `prereg-HG.md`. The brief defines exposure as a Skill tool call or a read under the skill folder. This skill has `disable-model-invocation: true`, so a Skill tool call cannot occur, and the skill has no other files to read. A slash expansion may leave nothing in the event stream. So `exposedFinal` is true when any of these holds.

1. `skillCall`. Kept for completeness.
2. `skillRead`. A tool call input contains `skills/create-formal-verification-skill`.
3. `markerSeen`. The string `A test checks the cases that someone thought to write` appears in the event stream (extension 1).
4. Token excess. The first assistant turn's input tokens exceed the none median by at least 703 tokens, half of the SKILL.md size (5626 bytes) divided by 4 (extension 2). This skill is not in the model-visible skill listing, so no listing text can trigger it.

Recorded but not part of `exposedFinal`: `initHasSkill`. Whether a `disable-model-invocation` skill is listed in the init event is unverified. The probe therefore does not require it for H-P.

Gate. Fewer than 6 of 8 told trials with `exposedFinal`, or any none trial with `exposedFinal` or the skill in init, means delivery failed. No verdict, no fallback delivery.

Permission denials. Every trial records `permissionDenials`. The count per arm is reported. The told arm writes under `.claude/skills/` and runs `java` and `curl`, so it may hit the allowlist more than the none arm. A told-arm excess means the allowlist may explain a gap.

## Primary metrics and analysis

All usable trials, as assigned.

1. Mean bugs fixed per arm. Difference told minus none. 95% percentile bootstrap CI (10,000 resamples, seed 20261110, mulberry32).
2. Full-pass rate per arm. Difference, bootstrap CI and two-sided Fisher exact p.

Frozen code is `analyze-hyp.mjs` (`node analyze-hyp.mjs HP`). Per-protocol (told trials with `exposedFinal`, plus all none trials) is a sensitivity analysis.

## Decision rule (written before data)

- H-P SUPPORTED if the CI of the mean-bugs difference (told minus none) lies entirely above 0.
- H-P CONTRADICTED if it lies entirely below 0.
- Otherwise H-P NOT SUPPORTED, meaning no detected difference at n = 8.
- Turn-limit reading rule. If the told arm ends in `error_max_turns` in at least half of its runs and fixes fewer bugs, the finding is "the told arm does not finish inside 30 turns in this setup". It is not a claim about the value of model checking at a larger budget. A second run at a larger turn limit is outside this preregistration.
- Descriptive only, no claims. Share of runs that changed product code, that generated a project skill, that wrote `.tla` files, that ran `java` or `curl`, turns, cost, and mean bugs among runs that finished inside the turn limit (a selected sample).
- No delivery, no verdict.

## Power statement

With 8 per arm and a bug count that has a standard deviation of about 1 (an assumption, there is no pilot), a two-sided test at 80% power detects only a difference of about 1.4 bugs or more. With 8 per arm a full-pass difference is only detectable if it is very large. Smaller real effects are invisible here. A null is weak evidence. One fixture is a very small sample of subsystems.

## Threats and open risks

- The skill is not built to fix bugs, and the told arm may spend its 30 turns on a model and a generated skill. This is the largest threat and the reason for the turn-limit reading rule.
- TLC is not installed. Downloading the jar is a turn cost and a network dependency in the told arm only in practice.
- The `/statechart` and `/maintain-formal-verification-skill` references dangle.
- `claude -p "/create-formal-verification-skill ..."` may not expand a `disable-model-invocation` skill as a user sees it. The delivery gate guards this.
- The README and the carrier and payment APIs describe delivery and idempotency. These facts make the bugs findable, as in a real repo, and they name no bug.
- The grader checks behavior through `createApp` and `app.status`. A fix that renames them fails the grader. The prompt does not forbid it, so this is a risk. Fixes that rewrite the record shape are covered by the validation row "full rewrite".
- The fixture is new and uncalibrated. The none arm could sit near 3 of 3 or 0 of 3.

## Uncertainties and assumptions

| Assumption | Score (1-10) | Why | Blast radius | Falsification probe, resolution |
| --- | --- | --- | --- | --- |
| The slash command delivers a `disable-model-invocation` skill in `-p` mode | 5 | Not run yet | Whole H-P is void | Stop-at-init probe and the first told trial's exposure signals |
| 30 turns are enough for the told arm to also fix code | 3 | The skill asks for a model, a break check and a verify skill | Told arm penalised by budget | Max-turns share per arm, reading rule above |
| The three bugs are of rising difficulty for Sonnet | 5 | Judged from the code, not measured | Floor or ceiling in the none arm | Read none-arm bug distribution after 4 pairs |
| The grader accepts reasonable fix shapes | 8 | 3 fix shapes plus a rewrite validated, 20 repeats | A correct fix scores less than 3 | Review the failed tests of any told or none run that fixed the code in a new shape |
| Sonnet is a fair model for this claim | 5 | Argued above | Result may not transfer | None, stated as a limit |

Overall confidence that this design tests the stated claim fairly: 4 of 10. The main gap is the mismatch between the skill's purpose and the graded outcome. It is pre-declared and the descriptive measures show what the told arm did instead.

## Frozen code and files (sha256, taken before any trial)

| File | sha256 |
| --- | --- |
| `run-hyp.ts` (runner, derived from `../run2.ts`) | 71e7e907cb0ce00bc894ac12094d5957daea21cc978c5aa2aa8d6642d97a0637 |
| `analyze-hyp.mjs` (preregistered analysis) | c8277749a484ba018a18ccaa685016df29cbd16241b9e733952200cd14a77c0c |
| `validate-hp.mjs` (grader validation, no claude) | ad007e0be69a06c25f8868c87f5033784996c4d2d52a5329bcfa1a59c1f973eb |
| `stub-claude.mjs` (plumbing check only, no model) | 5ef7a372e4b5d04591f619612d8c0c45a668636d35fef5658588530c0a32dc7e |

`SHA256SUMS` in this folder lists every frozen file, including both preregistrations. Edit nothing after the first trial. A change after that point is a deviation and is reported as one.
