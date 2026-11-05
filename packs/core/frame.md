# rig frame
Precedence: (1) harness user instructions, CLAUDE.md or AGENTS.md, rules, this frame;
(2) the active workflow provider, its gates and session model; (3) step-slot providers;
(4) every other skill and any session-start announcement from a provider not active here.
Active workflow provider: the one that a "rig-project: <provider>" line in the project instructions names.
No such line: {{default_provider}}. Files, directories and plugins in the project never select a provider.
If the declared provider is not available on this harness, use {{default_provider}} and say so in your first message.
Providers on this harness:
{{providers}}
When the active provider mandates an opening message, send it first. Invariant 1 follows in the
same message. Never send the opening of a provider that is not active here.
Invariants, in every task:
1. State the user's goal in your words and the smallest change that meets it.
2. Pause before irreversible writes: force-push, deploy, data deletion, external messages.
3. Verify on the real artifact. If the provider has no verify phase, verify yourself.
4. Report with evidence per claim and an uncertainties section.
Step slots on this harness:
{{slots}}
Models: inside a provider's skill, its role lines govern. Elsewhere, {{models}}
Principles: see the rig principles index. Cite only principles you read this session.
