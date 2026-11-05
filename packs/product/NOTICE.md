# Third-party notices

The product pack is a port of material from gstack. gstack is MIT licensed. The license text is in `licenses/MIT-gstack.txt`.

## gstack, MIT License

- Source: https://github.com/garrytan/gstack
- Commit: b244e6d11a6466650c5147cd7dc023859968c4b5
- License: `licenses/MIT-gstack.txt`, an unmodified copy of the gstack `LICENSE` file at that commit.
- Pinned at: b4068209809315ab1578c78e33e73512b29749ca. `rig pin check` found the port sources (`LICENSE`, `office-hours/SKILL.md`, `office-hours/sections`) unchanged since the port commit, so the port carries over with no edit.

Derived and modified:

- `skills/office-hours/SKILL.md`: from `office-hours/SKILL.md.tmpl`. Rewritten for rig: gstack binaries, state-root paths, telemetry, profile and brain steps removed; template placeholders resolved into text or `references/` files.
- `skills/office-hours/references/product-core.md`: from the preamble pieces in `scripts/resolvers/preamble.ts` (ask-user format, completeness, confusion protocol, claims need evidence, search before building, voice, writing style, completion status), condensed.
- `skills/office-hours/references/startup-diagnostic.md`: from `office-hours/sections/phase-2a-startup-diagnostic.md.tmpl`.
- `skills/office-hours/references/builder-brainstorm.md`: from `office-hours/sections/phase-2b-builder-brainstorm.md.tmpl`.
- `skills/office-hours/references/design-doc.md`: from `office-hours/sections/design-and-handoff.md.tmpl`. The design doc goes to `docs/designs/<slug>.md` in the user's repository. The closing ends with the design doc path.
