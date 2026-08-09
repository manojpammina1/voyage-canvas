# Escalation (portable policy)

When a hard-stop, governance violation, or unclear ownership is detected:

1. **Stop work** immediately.
2. **Identify area** — file, module, or contract.
3. **Contact** area owner from `config.contacts.areas` (rendered in CLAUDE.md / AGENTS.md).
4. **Get approval** before proceeding.
5. **Record** approval reference in PR description.

Escalation alert format is rendered from config contacts at deploy time.

Governance file changes require `super` role (toolkit maintainer per `config.roles.governance_owner`).
