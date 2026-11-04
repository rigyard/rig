# 0022. A generic telemetry check in the gate

- Status: Accepted
- Date: 2026-11-04

## Context

Some providers and CLIs send usage telemetry by default. OpenSpec sends the command name, version, surface and an anonymous id, with IP collection off. It honours `OPENSPEC_TELEMETRY=0` and `DO_NOT_TRACK=1`. Draft v3 had a check for OpenSpec only. The user sets `DO_NOT_TRACK=1` in their own shell profile.

## Decision

- The `telemetry` check reads every provider and pin record with a non-null `telemetry` field.
- It warns when that tool's telemetry is on and none of the record's `optout_env` variables is set.
- The warning prints `export DO_NOT_TRACK=1` when the record lists it, else the tool's own variable.
- With a listed variable set, the check passes and needs no ack.
- rig does not edit the user's shell profile. Mechanism: the writer accepts only paths declared in target records, and no record declares a shell profile.

## Consequences

- A tool that ignores `DO_NOT_TRACK` must not list it in `optout_env`. The record author verifies that per tool.
- A tool with telemetry but no record is invisible to the check.
