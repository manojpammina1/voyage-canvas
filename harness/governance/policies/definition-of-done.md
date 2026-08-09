# Definition of Done (portable policy)

Before marking work complete:

1. **Mode confirmed** — active role/mode selected for the session (Claude: slash command; Codex/Cursor: AGENTS.md operating mode).
2. **Governance clear** — no hard-stop or secret/PII violations in the diff.
3. **Tests** — relevant tests run or CI gate passed.
4. **Review** — AI first-pass review completed; human reviewer assigned per repo defaults.
5. **PR metadata** — title format `[TICKET-123] Short imperative description`; escalation ref if hard-stop paths touched.
6. **Contracts** — cross-repo contract owners signed off before breaking changes (see contract registry).
