# Titan

Titan is a company-neutral Claude Code governance harness: slash commands,
hooks, subagents, and runbooks for a team building on AEM, a commerce
platform (OCC-style), a GraphQL integration layer, and a search/discovery
provider — extracted from a real production deployment so the engineering
patterns are proven, not theoretical.

**What makes it "company-neutral":** every company-specific fact — org
name, people's names and emails, repo names, SCM/issue-tracker URLs,
protected-path rules — lives in exactly one place, `titan.config.json`, and
everything else (`CLAUDE.md`, `data/*.json`, the `settings.json` deny list,
hook pattern lists, the Electron wizard, the usage dashboard) is generated
or read from that file. The stack choices (AEM, a commerce platform, CIF,
Coveo/Discover-style search) stay first-class — only company *identity* was
removed. See `docs/CONFIG-REFERENCE.md` for the full schema and
`docs/ADOPTION.md` for the minimum keys to fill in first.

## What's in here

| Path | What |
|---|---|
| `harness/` | The deployable harness: 68 slash commands, hooks, subagents, runbooks, and the render pipeline (`titan-render.py`, `titan-config.py`) that turns `titan.config.json` into a deployed `.claude/`. |
| `installer/` | `titan-configure.py` (CLI installer) and `titan-doctor.py` (post-install verification). |
| `electron/`, `src/` | The guided GUI installer (wizard) — config-driven screens, provider abstraction for SCM/issue-tracker/telemetry-sink. |
| `dashboard/` | A local, JSONL-driven usage analytics dashboard for the toolkit maintainer. |
| `tools/ota/` | Signed-manifest tooling for a future auto-update channel (dev/test keys only today — see `docs/HARNESS-UPDATE.md`). |
| `fixtures/` | Config fixtures used to prove the schema is expressive enough for more than one adopter shape. `titan.config.ds.json` (gitignored, real reference data) and `titan.config.github-generic.json` (a smaller, commerce-disabled, GitHub-based shape) — neither ships. |
| `docs/` | This documentation set. |
| `scripts/lint-generic.sh` | The de-branding completion gate — fails if any company-identity residue from the reference implementation this harness was extracted from is found anywhere outside `fixtures/**`. |

## Quickstart

1. Copy `harness/titan.config.example.json` to your own config and fill in
   at minimum the 9 keys in `docs/ADOPTION.md` (org name, email domain, one
   contact, one area mapping, the governance owner, one repo, one protected
   path, your SCM kind, and a real telemetry salt). Validate it:
   ```
   python harness/scripts/titan-config.py --validate path/to/your-config.json
   ```
2. Deploy into a target repo:
   ```
   python installer/titan-configure.py --config path/to/your-config.json
   ```
   or, for scripted/multi-repo rollouts, call the underlying primitive
   directly — see `docs/INSTALLATION.md`:
   ```
   bash harness/scripts/deploy-harness.sh <target-repo-path>
   ```
3. Verify: `python installer/titan-doctor.py`.
4. Start a Claude Code session in the deployed repo. `SessionStart` injects
   a live governance header (org, active repos, escalation-by-area) so the
   session is grounded in your config even before any file is read.

Full documentation: `docs/INSTALLATION.md` (all three install paths, and
why Titan does not ship a pre-signed Electron binary),
`docs/CONFIG-REFERENCE.md` (generated, full schema reference),
`docs/HARNESS-UPDATE.md` (`--update` / `--rollback` / `--prune` mechanics
and their one documented residual risk).
