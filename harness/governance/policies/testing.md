# Testing standard (portable policy)

- Tests must not contain real credentials or PHI/PII.
- New production code paths require corresponding tests unless explicitly waived in PR.
- Test impact analysis: use `/common/test-impact` (Claude) or run targeted test suites in CI.
- QA environment context is compiled to `data/qa-env.json` from `config.environments.qa`.
