# /check-version -- Check installed harness version

Check the version of the Titan harness deployed in the current workspace and determine whether an update is available.

**Fixed in the 2.4.1 pre-ship audit:** this command used to read `TOOLKIT_VERSION=` from `<workspace>/setup-claude-toolkit.sh` — a file that does not exist anywhere in this repo (a leftover from a pre-Titan delivery model). It always reported nothing useful. The harness now writes its version to `.claude/.harness-version` on every deploy (`electron/main.ts` `writeHarnessVersion()`, `harness/scripts/deploy-harness.sh`), sourced from `harness/VERSION` — that pair is the real signal.

## Step 1 -- Read installed version

```bash
cat <workspace-path>/.claude/.harness-version
```

- **File present:** report the version number found.
- **File absent:** the workspace was deployed before this fix, or the harness has never been deployed here. Report `"Unknown (pre-2.4.1 install or harness not deployed) — run the installer's update or deploy-harness.sh --update --prune to record a version"`. Do not guess a version number.

## Step 2 -- Check for updates against the source repo

The harness ships inside the harness source repo (`harness/` directory), not as a standalone script repo. Compare against that repo's `harness/VERSION`:

```bash
git -C <path-to-harness-source-repo> fetch origin
git -C <path-to-harness-source-repo> show origin/main:harness/VERSION
git -C <path-to-harness-source-repo> log HEAD..origin/main --oneline -- harness/
```

- If you don't have a local clone of the harness source repo to check against, say so plainly and stop at Step 1's installed-version report — do not invent a "latest version."
- **Versions match:** harness is up to date.
- **`origin/main`'s `harness/VERSION` is newer:** update available. Show the commit list touching `harness/`.

## Step 3 -- Report and advise

### Up to date

```
Harness version : 4.0.0
Status          : Up to date
```

### Update available

```
Harness version : 3.0.0  (installed)
Latest          : 4.0.0  (origin/main)
Status          : Update available
Commits ahead   : [list touching harness/]

To upgrade (harness content only — no reinstall needed):
  bash <harness-source-repo>/harness/scripts/deploy-harness.sh --update --prune <workspace-path>

To upgrade the installer app itself (Start Over / connector / dashboard fixes,
anything under src/ or electron/): reinstall the .exe — the installer detects
an existing harness and runs the same update+prune path automatically.
```

### Version unknown (pre-2.4.1 install)

```
Harness version : Unknown (pre-2.4.1 install or harness not deployed)
Status          : Cannot compare — no recorded version

Run once to establish a baseline:
  bash <harness-source-repo>/harness/scripts/deploy-harness.sh --update --prune <workspace-path>
```

## Version history

Source of truth for the current number: `harness/VERSION` in the harness source repo. Bump that file alongside adding a row here.

| Version | What changed |
|---------|-------------|
| 4.1.0 | 2.4.1 pre-ship audit (harness-side): session-ID truncation standardized to [:32] (stop-usage-capture.py), total_tokens includes cache_read, tool-output-crush.py exempts Atlassian Rovo from string masking, Zephyr CSV copy corrected across qa-mode/CLAUDE.md/session-start.sh, deploy-harness.sh gains --prune, cost-tracking/projects added to the managed set, harness/VERSION + .harness-version introduced, stale plugin-policy/CLAUDE.md pointers fixed |
| 4.0.0 | Cross-project traceability: registry.json, project-activate/status/audit skills, PR stamping, project filter for release-notes, protect-skills.py EXEMPT_PATHS |
| 3.0.0 | Titan rebrand; role hierarchy (developer/lead/architect/super); skills reorganized into roles/, common/, ops/; protect-skills.py hook; 4-role settings templates |
| 2.3.3 | ADO MCP auth fix: mcp-ado-launch.cjs wrapper reads PAT from settings.local.json + normalizes org URL (fixes TF400813/null-identity + 401 doubled-collection); doctor/mcp-audit expect the wrapper |
| 2.3.2 | Installer Phase 3b per-repo harness deploy (all 5 repos plug-and-play) + git-exclude protection + jira MCP fix (dead npm package removed; Rovo is the Jira path) + doctor mcp-registry check |
| 2.3.1 | Leadership dashboard view, Ecommerce (Hybris) harness deploy, /common/hybris-logs + /common/aem-logs, redact_lib.py, protect-hybris-secrets Grep-coverage hardening |
| 2.3.0 | ROI uplift: answer-cache hook (?build/?reviewers/?ki), session→ticket attribution, dashboard ROI section, CLAUDE.md diet, cost-report fix |
| 2.2.0 | Phase 2: seamless no-admin install, post-install doctor, telemetry write-token onboarding |
| 2.1.0 | P1: check-version, incident-response, release-notes, settings.local.json.template |
| 2.0.0 | P0: 7-role toolkit, PreToolUse credential scan, .gitattributes |
| 1.0.0 | Initial 3-role toolkit (arch-mode, lead-review, dev-mode) |
