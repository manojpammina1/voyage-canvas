# Agent-neutral artifact map (T12)

Single source of truth: `governance/`. Adapters render L2 bindings and wire L3 enforcement per agent.

## Layer definitions

| Layer | What | Location | Agent-specific? |
|-------|------|----------|-----------------|
| L1 Policy | Rules, semantics, hook logic, reviewer specs | `governance/` | No |
| L2 Binding | How the agent is told | `CLAUDE.md`, `AGENTS.md`, `.cursor/rules/*.mdc` | Yes — thin templates |
| L3 Enforcement | What blocks | Claude `settings.json`; Codex/Cursor pre-commit + CI + hooks | Yes — re-wired triggers |

## Artifact map (spec §3)

| Titan artifact (today) | Layer | Claude target | Codex target | Cursor target |
|------------------------|-------|---------------|--------------|---------------|
| `CLAUDE.md` role matrix | L1 → `governance/roles/` | rendered into `CLAUDE.md` | personas in `AGENTS.md` | `.cursor/rules/governance.mdc` |
| Model routing | L1 → `governance/model-tiers.yaml` | Claude bindings | provider-neutral tiers | same as Codex |
| Hard stops / protected paths | L1 → `policies/hard-stops.md`, `protected-paths.md` | prose + `settings.json` | prose + CI path-guard | rules + CI |
| Security / secret / PII | L1 → `policies/security.md` | prose + hooks | prose + pre-commit/CI | rules + hooks + CI |
| Review standards + 15 reviewers | L1 → `governance/reviewers/` + `orchestration.yaml` | subagents + `/orchestrate-review` | `.codex/review.mjs` | same + rules |
| Contract registry, escalation | L1 → policies + config | rendered | rendered | rendered |
| DoD, testing | L1 → `policies/definition-of-done.md`, `testing.md` | rendered | rendered | rendered |
| `hooks/*.py` logic | L1 logic / L3 trigger | `settings.json` events | pre-commit + CI | `.cursor/hooks.json` |
| `settings.json` deny-list | L1 → `controls.yaml` | Claude settings | CI path-guard | CI + hooks |
| 66 slash commands | L2 Claude-only | `.claude/commands` | parity note in AGENTS.md | parity note |
| `.mcp.json` / plugin policy | L1 → `controls.yaml` | `.mcp.json` + `/mcp-audit` | AGENTS.md + CI | rules + CI |
| `providers/{scm,tracker,telemetry}` | already neutral | unchanged | unchanged | unchanged |
| Telemetry/cost dashboard | already neutral | unchanged (illustrative) | unchanged | unchanged |

## Control catalog

See [`governance/controls.yaml`](../governance/controls.yaml). Controls with `trigger: none` for Codex/Cursor render as **advisory** in `AGENTS.md` — never overclaim enforcement.

## Render pipeline

```
titan.config.json + governance/
        │
        ▼  titan-render.py --target {claude|codex|cursor|all}
   ┌────────────┬──────────────┬──────────────┐
   │ Claude     │ Codex        │ Cursor       │
   │ .claude/   │ AGENTS.md    │ .cursor/     │
   │ CLAUDE.md  │ .codex/      │ AGENTS.md    │
   └────────────┴──────────────┴──────────────┘
        └── governance-manifest.json (--target all)
```

## Verification

- Claude back-compat: `bash scripts/verify-claude-snapshot.sh`
- Generic lint: `bash scripts/lint-generic.sh` (from `titan/` root)
- Secret block demo: same `credential-scan.py` under Claude PreToolUse and git pre-commit
