# Installation

Three ways to get Titan into a repo, in order of how most teams will
actually use them:

1. **CLI configurator** (`installer/titan-configure.py`) — scripted,
   headless-friendly, the fastest path for a single developer or CI.
2. **`deploy-harness.sh`** — the underlying deploy primitive the configurator
   calls; use it directly for scripted multi-repo rollouts, `--update`
   patches, or `--rollback`.
3. **Electron wizard** — a guided GUI for non-CLI-comfortable users (PO,
   designer, QA roles). Titan does **not** ship a pre-built/signed binary of
   this wizard — see "Building the Electron wizard yourself" below.

All three read the same `titan.config.json` — fill in the 9 minimum keys
first (`docs/ADOPTION.md`) before running any of them for real.

## 1. CLI configurator

```
python installer/titan-configure.py --check       # verify prerequisites without changing anything
python installer/titan-configure.py                # real run
python installer/titan-configure.py --skip-tools   # skip npm installs (Claude Code + MCPs already installed)
python installer/titan-configure.py --config path/to/titan.config.json
python installer/titan-configure.py --role developer   # skip the interactive role prompt
python installer/titan-configure.py --super        # request the toolkit-maintainer (super) role
```

`--check` runs every prerequisite/workspace verification step with no writes
— run this first on a new machine. `--super` does not silently grant the
role: it only succeeds if the operator (matched via `git config user.email`
/ `user.name`) is already listed in `titan.config.json`
`roles.definitions.super.holders`.

What it does, roughly in order: verifies prerequisites (Node, git, Claude
Code CLI), verifies/creates the workspace structure from `repos[].dir`,
deploys the harness (delegates to the same logic `deploy-harness.sh` uses),
registers the `azure-devops`/`github` MCP server per `platforms.scm.kind`,
and writes `settings.local.json` with any PAT/token values supplied via env
vars (never via `--config`, since that file lives on disk in plaintext).

## 2. `deploy-harness.sh` directly

Use this when you want to deploy into a repo that has its own `.git` and
wasn't the configurator's chosen workspace root (a nested repo scenario),
or for scripted rollouts across many repos:

```bash
bash harness/scripts/deploy-harness.sh <target-repo-path>
bash harness/scripts/deploy-harness.sh --update [--prune] <target-repo-path>
bash harness/scripts/deploy-harness.sh --rollback [--to <timestamp>] <target-repo-path>
```

First-time deploy is skip-if-exists (never clobbers an existing
`settings.local.json`, which holds PATs/tokens). `--update`, `--prune`, and
`--rollback` are for patching an already-deployed repo — see
`docs/HARNESS-UPDATE.md` for the full mechanics, including the render-overlay
step that runs before every deploy.

## 3. `titan-doctor.py` — post-install verification

```
python installer/titan-doctor.py
```

Checks prerequisites, verifies the MCP server registered correctly (via
`claude mcp list`), and verifies every file the deploy step is expected to
have written actually landed (`EXPECTED_FILES`, generated from the same
layout definition `deploy-harness.sh` uses, so a file rename in one can never
silently desync the other). Run this any time something feels wrong after an
install or update.

## Building the Electron wizard yourself

**Titan does not ship a signed installer binary.** The reference
implementation this harness was extracted from built and signed its `.exe`
internally against its own code-signing certificate; that certificate is
not — and cannot be — redistributed to third-party adopters.
`electron-builder.yml`'s signing configuration (`certificateFile` /
`certificateSubjectName` / notarization credentials for macOS) is left as
adopter-supplied and documented inline in that file, not hardcoded.

To build your own signed binary:

```
cd <this repo>
npm install
npm run build          # compiles src/ + electron/
npm run package         # electron-builder, using YOUR signing config
```

Without your own certificate configured, `electron-builder` will produce an
**unsigned** build — usable for local testing, but Windows SmartScreen /
macOS Gatekeeper will warn on it, and most corporate endpoint policies will
block it outright for anything beyond a single developer's own machine. Set
`branding.logo_path` / `branding.product_name` / `branding.accent` in
`titan.config.json` first (see `docs/CONFIG-REFERENCE.md`) so the build
carries your own visual identity, not the neutral Titan default mark.

## Prerequisites (all three paths)

- Node.js 18+ (20 LTS recommended) and git, on PATH.
- Python 3.9+ (used by the hooks, `titan-config.py`, `titan-render.py`, and
  the CLI configurator — zero third-party Python dependencies anywhere in
  this chain).
- Claude Code CLI installed and authenticated.
- An SCM PAT (`platforms.scm.kind: azure-devops` or `github`) with at least
  read access to the repos in `repos[]`, supplied via environment variable
  or the OS credential store — never via `titan.config.json` itself.
