# Third-party notices

The product pack is a port of material from gstack. gstack is MIT licensed. The license text is in `licenses/MIT-gstack.txt`.

## gstack, MIT License

- Source: https://github.com/garrytan/gstack
- Commit: b244e6d11a6466650c5147cd7dc023859968c4b5
- License: `licenses/MIT-gstack.txt`, an unmodified copy of the gstack `LICENSE` file at that commit.
- Pinned at: 306ff23b9d2bd7951b7f6c408c7376f3237520c9. The port adds the upstream startup reality check, evidence ranking, discovery and pivot decision memos, customer privacy, and dated assignments and outcome tests. It keeps the rig document paths and same-model second opinion. gstack runtime, binaries, profiles, telemetry, brain storage, founder resources and visual design remain outside this port. Since `100e109`, upstream gave its shipping skill a prefixed name in the office-hours proactive skill list and in the shared preamble, so that the Claude Code `/ship` command no longer hides it, and moved the preamble id. The port carries neither the gstack preamble nor the proactive skill list, so neither change reaches the port text.

Derived and modified:

- `skills/office-hours/SKILL.md`: from `office-hours/SKILL.md.tmpl`. Rewritten for rig: gstack binaries, state-root paths, telemetry, profile and brain steps removed; template placeholders resolved into text or `references/` files.
- `skills/office-hours/references/product-core.md`: from the preamble pieces in `scripts/resolvers/preamble.ts` (ask-user format, completeness, confusion protocol, claims need evidence, search before building, voice, writing style, completion status), condensed.
- `skills/office-hours/references/startup-diagnostic.md`: from `office-hours/sections/phase-2a-startup-diagnostic.md.tmpl`.
- `skills/office-hours/references/builder-brainstorm.md`: from `office-hours/sections/phase-2b-builder-brainstorm.md.tmpl`.
- `skills/office-hours/references/design-doc.md`: from `office-hours/sections/design-and-handoff.md.tmpl`. The design doc goes to `docs/designs/<slug>.md` in the user's repository. The closing ends with the design doc path.

- `skills/office-hours/references/pivot-discovery.md`: from `office-hours/sections/phase-2c-pivot-discovery.md`. Adapted to repository decision memos and founder-approved commitments.
