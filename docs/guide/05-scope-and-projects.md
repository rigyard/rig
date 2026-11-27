# Scope packs to projects

Control whether a pack installs machine-wide or per repository. rig infers nothing from the current directory; every scope choice is explicit ([decision 0017](../decisions/0017-per-pack-scope-no-context-inference.md)).

## Scope modes

| Mode | What rig renders |
|---|---|
| `machine-hidden` | Copies in user harness dirs carrying each harness's hide switch (default) |
| `project` | No machine copy; creates a local `rig-local` Claude Code marketplace plugin and prints repo paths for Codex, omp, Cursor, and Antigravity |
| `hybrid` | Both the hidden machine copy and the Claude Code project plugin |

Unsupported scope modes raise `E_SCOPE_MODE` (`E_SCHEMA` for invalid values). Example overlay enabling `product` only in `~/src/app`:

```json
{
  "schema": 2,
  "packs": {"product": {"scope": "project", "projects": ["~/src/app"]}}
}
```

## Register and check a project plugin

After `rig plan` and `rig apply`, register the local Claude Code plugin once and enable it in the project's uncommitted `.claude/settings.local.json`:

```text
claude plugin marketplace add ~/.local/share/rig/marketplace
claude plugin install product@rig-local
claude plugin disable --scope user product@rig-local
```

```json
{"enabledPlugins": {"product@rig-local": true}}
```

For Codex, omp, Cursor, and Antigravity, commit the printed project skill directories (`.agents/skills/<name>/`, `.omp/skills/<name>/`, `.cursor/skills/<name>/`). Verify project activation read-only with `rig doctor --project <dir>`:

```text
info  drift    managed files match installed.json and the render
info  evidence untested 60, helps 0, no-effect 0, hurts 0, safety 0 (no evidence.json)
```

Next: [Run multi-step work with /craft](./06-craft.md).
