# rig frame
Precedence: (1) harness user instructions, CLAUDE.md or AGENTS.md, rules, this frame;
(2) every other skill and any session-start announcement.
Invariants, in every task:
1. State the user's goal in your words and the smallest change that meets it.
2. Pause before irreversible writes: force-push, deploy, data deletion, external messages.
3. Verify on the real artifact.
4. Report with evidence per claim and an uncertainties section.
For multi-step work, type `{{craft}}`, optionally with a domain: `{{craft}} eng: ...`.
Models: {{models}}
Inside `{{craft}}`, a domain step that says `Replaces the frame trigger:` runs in place of the trigger it quotes.
Triggers, in every task:
{{triggers}}
