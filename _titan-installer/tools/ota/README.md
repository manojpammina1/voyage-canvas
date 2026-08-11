# Titan OTA — publish tooling (M1)

Maintainer-only (`super` role). Design: `../../docs/HARNESS-UPDATE.md`.
Progress tracking: `.claude/progress/SLING-PHASE2.json`, milestone 12.

Deliberately kept **outside** `harness/` — this tooling generates and holds
signing key material; it must never be part of the content that gets
deployed to a developer's machine.

## What M1 covers

- `keygen.js` — dev/test EC P-256 keypair (**not production key custody**)
- `manifest.js` — walks the harness content set, hashes every file, emits an unsigned manifest
- `pack-and-sign.js` — builds the matching tarball, hashes it, signs the manifest
- `verify.js` — checks a signed manifest's signature + (optionally) an extracted directory's file hashes against it. Written as a reusable module because M2's client updater needs the identical logic — see the comment at the top of that file.

## What M1 does NOT cover (deferred)

- **Uploading to Azure Blob** (`harness-releases` container, per design sec 3b). Requires a write-SAS/key that only the maintainer holds — this repo's tooling does not automate cloud writes to infrastructure it doesn't provision. Once the container + write key exist, a thin `publish.js` wrapping `az storage blob upload` is the natural next step.
- **Auto-reading the last-published `sequence`** from Blob before minting a new manifest. Until Blob wiring exists, `--sequence` is supplied manually by the maintainer (increment from whatever you last published). Sequence, not the version string, is what makes rollback and replay-rejection work (design sec 5, 7) — get this right by hand until it's automated.
- **Production key custody.** `keygen.js` output is for building/testing this tooling only. The real signing key must live in Azure Key Vault / HSM before any real release ships (design sec 3a, 7 — signing-key compromise is called out as the single biggest residual risk). Owner: the toolkit maintainer + Security.
- **The M2 client updater** (`harness-update.js`, scheduled-task polling, atomic apply, rollback, settings.json merge). Not started — `verify.js` is written to be reused there, everything else here is publish-side only.
- **The plugin-marketplace decision gate** on milestone 12 is now resolved (see progress file note, 2026-07-08): native Claude Code plugins give partial overlap only (no signing, no staged rollout, no CLAUDE.md distribution) — this custom OTA build is confirmed as the right approach, not superseded.

## Resolved: design doc inconsistency (was Ed25519 vs EC P-256)

the design doc's milestone-10 table heading for M1 said
**"Azure Key Vault EC P-256 signing"**, but the doc's own body said
**Ed25519** in three places (sec 3a, manifest schema in sec 6, threat table
in sec 7). Resolved 2026-07-08: confirmed via Microsoft Learn +
`Azure/azure-cli#26898` that Key Vault does not support Ed25519 at all
(supported curves: P-256/P-384/P-521/P-256K, standard or Managed HSM) — the
table heading was correct, the body's Ed25519 references were the error.
`lib/crypto.js` now implements EC P-256 with `dsaEncoding: 'ieee-p1363'`
(matches Key Vault's ES256 raw-signature output format). Switched before any
real manifest shipped, so no back-compat cost. Doc body (sec 3a/6/7) still
needs a follow-up edit to say P-256 instead of Ed25519 — tooling and README
are now the source of truth until that's done.

## Round-trip test (dev keys, local only — no Blob, no real release)

```bash
cd titan

# 1. Generate a dev/test keypair (once)
node tools/ota/keygen.js

# 2. Build an unsigned manifest from the current harness/ tree
node tools/ota/manifest.js \
  --harness-src harness \
  --version 0.0.0-devtest \
  --sequence 1 \
  --channel canary \
  --out tools/ota/manifest.unsigned.json

# 3. Pack + sign
node tools/ota/pack-and-sign.js \
  --manifest tools/ota/manifest.unsigned.json \
  --harness-src harness \
  --key tools/ota/.devkeys/dev-signing.private.key \
  --pubkey tools/ota/.devkeys/dev-signing.public.pem \
  --out-dir tools/ota/dist-ota

# 4. Verify the signature stands alone
node tools/ota/verify.js \
  --manifest tools/ota/dist-ota/manifest.json \
  --pubkey tools/ota/.devkeys/dev-signing.public.pem

# 5. Verify against an actually-extracted copy (proves per-file hashing works)
tar -xzf tools/ota/dist-ota/harness-0.0.0-devtest.tar.gz -C <some-scratch-dir>
node tools/ota/verify.js \
  --manifest tools/ota/dist-ota/manifest.json \
  --pubkey tools/ota/.devkeys/dev-signing.public.pem \
  --artifact-dir <some-scratch-dir>
```

Tamper tests worth running once before trusting this: flip one byte in
`manifest.json`'s `files[0].sha256` (step 4 should now FAIL), and edit one
extracted file after step 5's extract (re-running step 5 should now report
that file as a mismatch).

## Unsigned patch mode (interim, added 2026-07-08)

Signed OTA (above) needs Key Vault, which is stuck with DevOps on a
resource-group permission. Rather than block all distribution on that,
`harness/scripts/deploy-harness.sh --update <target-repo>` force-overwrites
every file in the managed harness content set into an **already-deployed**
repo, then verifies the copy landed correctly via a per-file hash check
(reusing `manifest.js` + `verify.js --files-only` — no signature, no key
needed). Default (no `--update`) mode is unchanged: skip-if-exists, for
first-time deploys only.

```bash
cd titan
bash harness/scripts/deploy-harness.sh --update "../workspace/migration-repo"
```

What this is NOT: a substitute for signed OTA once Key Vault lands. It
proves "the files you now have match the harness/ source tree I ran this
from" — it does not prove provenance (anyone with write access to the
harness source and a shell on the target machine can run this). Fine for a
maintainer manually pushing a patch to a small number of known machines
they already trust; not fine as an unattended, auto-pulled update
mechanism — that's exactly the gap M1/M2 close. `settings.local.json` is
never touched in either mode, including if `SETTINGS_LOCAL_SRC` is set —
`--update` refuses to honor it, as a code-level guarantee rather than
caller discipline.

**Do not run `--update` against the outer `ecom-webapp` workspace root.**
That `settings.json` intentionally uses absolute hook paths (its own
convention, not the canonical relative-path template every nested per-repo
`.claude/` uses) — force-overwriting it would silently revert that and
break the session. `--update` is for the 5 nested per-repo checkouts only
(each has its own `.git` and the standard relative-path `settings.json`).

### Rollback

Every `--update` run snapshots whatever it's about to overwrite into
`.claude/update-backups/<UTC-timestamp>/` **before** touching anything —
already covered by the `.git/info/exclude` entries (it lives inside
`.claude/`), so it can never get committed by accident.

```bash
# Undo the most recent --update run on this repo:
bash harness/scripts/deploy-harness.sh --rollback "../workspace/migration-repo"

# Or a specific snapshot:
bash harness/scripts/deploy-harness.sh --rollback --to 20260709T170610Z "../workspace/migration-repo"
```

Files that existed before the update are restored byte-for-byte; files the
update *introduced* (didn't exist beforehand) are deleted instead of
"restored" — a rollback returns the repo to the exact pre-update state, not
a mix of old-and-new. The snapshot itself is left in place afterward, so
you can roll forward again (`--update`) or repeat the rollback — nothing is
consumed or deleted by rolling back. `--rollback` with no `--to` picks the
most recent snapshot; list `.claude/update-backups/` to see all of them.

Tested 2026-07-09: applied a one-line change, confirmed it landed, rolled
back, confirmed the exact original content returned (0 unintended
changes), then re-applied to leave the repo at the correct current state.
