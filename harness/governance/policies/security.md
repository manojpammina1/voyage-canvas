# Security and data handling (portable policy)

## Secrets

Never commit credentials, tokens, keys, or PEM blocks. Use placeholders (`TEST_TOKEN`, `${ENV_VAR}`, `@Value`) in code and tests.

**Control:** `secret-block` — same `hooks/credential-scan.py` logic under Claude PreToolUse and git pre-commit/CI.

## Customer / PHI / PII

No regulated personal data in code, tests, logs, or comments. Mock data must be fictional.

**Control:** `pii-redact` — Claude blocks on Write/Edit; Codex/Cursor enforce in CI (advisory in-editor for Codex).

## Sensitive prompts

Prompts containing protected-path fragments, PAT-like patterns, or private-key markers must be blocked before reaching the model (Claude: `cost-estimate.py` scan).

## Plugin and MCP policy

Only pre-approved plugins, skills, and MCP servers. Registry: `config.governance.plugin_policy`. Audit via `/common/mcp-audit` (Claude) or CI plugin-policy check (Codex/Cursor).
