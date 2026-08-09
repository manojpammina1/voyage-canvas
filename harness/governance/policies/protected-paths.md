# Protected paths (portable policy)

Paths declared in `titan.config.json` → `protected_paths[]` are read-only without escalation. Severity, owners, and globs are org-specific and rendered from config.

## Enforcement by agent

| Agent | Mechanism |
|-------|-----------|
| Claude Code | `settings.json` deny-list + `protect-secrets.py` PreToolUse hook |
| Codex / Cursor | Git pre-commit + CI path-guard (`scripts/path-guard.py`) |

## Escalation

Touching a protected path without approval is a hard stop. Record escalation approval reference in the PR description before merge.
