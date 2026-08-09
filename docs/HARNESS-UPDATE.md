# Harness Update, Rollback, and Prune

Titan does not (yet) have a signed, auto-pulled OTA update channel — see
`tools/ota/README.md` for the signed-manifest tooling that exists today
(dev/test keypair only; production key custody in Azure Key Vault / an HSM
is explicitly deferred). Until that lands, `harness/scripts/deploy-harness.sh`
is the update mechanism: an unsigned but hash-verified patch, meant for a
maintainer pushing to a small number of machines they already trust — not
an unattended auto-update.

## Render-overlay step (every deploy, every mode)

Before any files are copied, `deploy-harness.sh` runs `titan-render.py`
against the target's `titan.config.json`, producing `CLAUDE.md`,
`data/*.json`, and `settings.json` filled in from config. It then builds an
**effective source** overlay — a full copy of the raw harness source with
the rendered files copied on top — and points the rest of the script
(including the hash-verify step below) at that overlay instead of the raw
template tree. This is why a `--update` run's hash check compares against
*rendered* content, not the pre-render `{{ }}` placeholders: comparing
against the raw template would fail on every deploy once rendering is live.

If rendering fails (bad config, `titan-render.py` not found), the script
falls back to deploying the **raw, unrendered** harness source and prints a
loud warning that `CLAUDE.md` / `data/*.json` may contain unfilled
placeholder markers. It never silently produces a half-rendered file.

## `--update [--prune]`

```bash
bash harness/scripts/deploy-harness.sh --update [--prune] <target-repo-path>
```

Default (no-flags) deploy is skip-if-exists: it never overwrites a file
that's already there, specifically so `settings.local.json` (PATs, tokens)
is always preserved. That also means a plain re-run does nothing once the
harness is already deployed — by design, not a bug. `--update` is the
opposite: it force-overwrites every file in the managed harness content set
(commands, hooks, scripts, subagents, data, runbooks, agents/skills, root
files) so an already-deployed repo actually receives changed files.
`settings.local.json` is never touched by `--update`, even if
`SETTINGS_LOCAL_SRC` is set — the script refuses to honor that env var in
update mode, as a code-level guarantee rather than relying on caller
discipline.

`--prune` (must be combined with `--update`) additionally removes files
that exist at the target but no longer exist in the current harness source
— e.g. a script deleted upstream that would otherwise stay orphaned on
every already-deployed repo forever.

After copying, the script hash-verifies the target against the effective
(rendered) source via `tools/ota/manifest.js` + `verify.js --files-only`.
This proves "the files you now have match the harness source tree this ran
from" — it is not a substitute for the signed OTA path once that lands, and
does not prove provenance.

## `--rollback [--to <timestamp>]`

```bash
bash harness/scripts/deploy-harness.sh --rollback [--to <timestamp>] <target-repo-path>
```

Every `--update` run snapshots whatever it's about to overwrite into
`.claude/update-backups/<UTC-timestamp>/` **before** touching anything —
files that existed are backed up byte-for-byte; files the update
*introduced* are recorded separately so a rollback can delete them instead
of "restoring" something that never existed. `--rollback` with no `--to`
picks the most recent snapshot; list `.claude/update-backups/` to see all
of them. The snapshot is left in place after a rollback, so you can roll
forward again or repeat the rollback — nothing is consumed by rolling back.

**Do not run `--update` against a workspace root whose `settings.json`
intentionally uses absolute (not relative) hook paths** — force-overwriting
it would silently revert that convention and break the session. `--update`
is meant for nested per-repo checkouts, each with its own `.git` and the
standard relative-path `settings.json`.

## Residual Risk #2 — the `.git/info/exclude` idempotency-key rename

`deploy-harness.sh` detects "have I already added my exclude block to this
repo" by grepping `.git/info/exclude` for a literal marker string
(`"Titan harness"`). That marker was renamed during the Titan extraction —
the reference implementation this harness was extracted from used a
different marker string.

**Known, accepted consequence:** any repo that was deployed by that older,
pre-extraction installer will not match the new marker string, so the next
`--update` (or even a plain first-time deploy re-run) appends a **second,
duplicate** exclude block to `.git/info/exclude`. This is a one-time,
harmless cosmetic duplication — duplicate `.claude/` / `CLAUDE.md` / etc.
ignore lines have no functional effect on git — but it is worth knowing
about before you go spelunking through `.git/info/exclude` wondering why a
repo has two near-identical Titan blocks. Do not rename the marker string
again without expecting this same one-time duplication for every repo
already deployed under the *current* string — this is documented in
`deploy-harness.sh`'s own IDEMPOTENCY KEY comment for exactly that reason.

This is a real, load-bearing consequence of the de-branding pass, not a
theoretical one — `electron/main.ts`'s own repo-deploy code path had to be
updated to the same new marker string as part of the Phase 7 completion
pass, because it had an independent copy of this same idempotency check
that the initial extraction missed.

## Stack-conditional rendering (why an update can change what CLAUDE.md says)

`titan-render.py`'s generated blocks (hard stops, PR reviewers, the
cross-cutting-skills table, etc.) are computed from the *current*
`titan.config.json` every time you render — including `stack.*` flags. If
you disable `stack.commerce.enabled` after previously having it on, the
next `--update` will remove the commerce/CIF-specific rows from the
rendered `CLAUDE.md` (e.g. the `/common/hybris-logs` skill row
self-suppresses) rather than leaving stale references to a part of the
stack you no longer have. This is intentional — see the second fixture
(`fixtures/titan.config.github-generic.json`) for a config shape that
exercises this path end-to-end.
