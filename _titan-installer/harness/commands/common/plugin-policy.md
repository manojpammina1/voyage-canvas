# /plugin-policy — Approved Plugins, Skills & MCP Servers (Authoritative Registry)

This file describes the **process** for approving what may be installed in the Titan harness. The actual registry — approved / pending / blocked items — is data, not prose: it lives in `config.governance.plugin_policy` (`approved[]`, `pending[]`, `blocked[]`) inside `titan.config.json`, and is the single source of truth. This file was moved out of `CLAUDE.md` so the always-loaded context stays small; the same separation now applies here — the process is generic and reusable, the verdicts are project-specific data.

Only the items listed in `config.governance.plugin_policy` are approved. **Do NOT install other Claude Code plugins, skills, or MCP servers without `super`-role approval and a security/compliance review.** This applies to all team members, including offshore developers.

## Reading the registry

When this skill is invoked, read `config.governance.plugin_policy` from `titan.config.json` (or the deployed `.claude/titan.config.json`) and present the relevant section:

```bash
python .claude/scripts/titan-config.py --get governance.plugin_policy.approved
python .claude/scripts/titan-config.py --get governance.plugin_policy.pending
python .claude/scripts/titan-config.py --get governance.plugin_policy.blocked
```

- **Approved** — currently installed and permitted. Each entry should record what it is, where it's configured (`.mcp.json`, a connector, a skill directory), and its purpose. If an approved entry lacks that detail, flag it as a data-quality gap rather than filling in a guess.
- **Pending / under review** — proposals awaiting a security/compliance decision. Do not treat a pending item as usable.
- **Blocked** — audited and permanently rejected. If anyone proposes installing a blocked item, point them at the config entry and its recorded reason — quote it verbatim, do not paraphrase or soften it.

Do not hardcode any project's specific approved/pending/blocked entries into this file. If `config.governance.plugin_policy` is missing or empty, say so plainly and stop — do not fall back to reciting a remembered list from a prior project.

## How to propose a new plugin / MCP server

This process is stack-agnostic and applies regardless of what is currently in the registry:

1. Open a request with the toolkit maintainer (`config.roles.governance_owner`, resolved to a name via `contacts.people` — the only role permitted to edit `.claude/` and `CLAUDE.md`).
2. Provide: vendor name, what data flows out of the organization, license, free tier vs paid, business case, and whether an existing approved skill/plugin already covers the use case.
3. The governance owner runs the organization's own security / legal / compliance review for any external SaaS dependency.
4. Once approved, the governance owner adds the entry to `config.governance.plugin_policy.approved` (and `.mcp.json` or the skill manifest as applicable), removes it from `pending` if it was there, and re-renders the deployed config.

Adding a plugin without going through this process is a governance violation. Check the current `approved[]` list first — most use cases are already covered by an existing entry.

## Governance

- This file lives under the governance file lock: only the `super` / governance-owner role edits it.
- `titan.config.json`'s `governance.plugin_policy` block is likewise part of the governance file lock — the same edit restriction applies to the data, not just this prose file.
- When invoked as a skill, output the relevant section (approved / pending / blocked / proposal process) sourced live from config — do not paraphrase blocked-item reasons; quote the `why`/reason field verbatim as recorded in the config entry.
- `/common/mcp-audit` audits installed servers against this same `config.governance.plugin_policy` data.
