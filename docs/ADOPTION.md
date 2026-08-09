# Adoption Guide — the 9 keys you must fill before first deploy

Titan ships with `configured: false` and every value in `titan.config.json`
set to a placeholder (`REPLACE_ME`, empty arrays, an empty `repos: []`).
`SessionStart` will warn loudly on every session until `configured` is
flipped to `true`, and several hooks fall back to a bare "secret file"
floor (or produce a rendered `CLAUDE.md` that says almost nothing useful)
until the config actually describes your organization.

You do **not** need to fill in the entire schema before your first deploy.
These 9 keys are the minimum — fill these, flip `configured: true`, deploy,
and iterate on the rest (contracts, additional protected paths, telemetry
upload sink, etc.) afterwards. Full field-by-field reference:
`docs/CONFIG-REFERENCE.md`. Fully worked example: `harness/titan.config.example.json`.

| # | Key | Schema path | Why it's in the minimum set |
|---|-----|-------------|------------------------------|
| 1 | Organization name | `org.name` | Appears in the rendered `CLAUDE.md` header and every generated escalation message. Without it the harness cannot say who it's protecting. |
| 2 | Email domain | `org.email_domain` | Used by `redact_lib.py` and `credential-scan.py` to recognize your own staff's addresses vs. external/PII addresses in logs and prompts. |
| 3 | At least one person | `contacts.people.<id>` | The **only** place a human name is allowed to appear. Every escalation line, hard-stop message, and PR-reviewer table resolves through an id in this map — with zero entries there is no one to escalate to. |
| 4 | At least one area mapping | `contacts.areas.<key>` | Maps a technical area (`ui`, `aem`, `commerce`, `security`, ...) to the person/people in #3. This is what `?gov who owns <area>` and the generated Escalation Alert block actually resolve. |
| 5 | Governance owner | `roles.governance_owner` | The one `contacts.people` id allowed to edit `.claude/` and `CLAUDE.md` (the `super` role). Referenced by the Governance File Lock section of every rendered `CLAUDE.md`. |
| 6 | At least one repo | `repos[]` (one entry: `id`, `dir`, `display`, `kind`) | Drives the Repo Map, the PR reviewer table, `?build`, `?reviewers`, and the Electron wizard's clone-repos screen. An empty `repos[]` is a supported degraded mode (placeholder repo names appear instead) but is not a real deploy target. |
| 7 | At least one protected path | `protected_paths[]` (one entry, minimum `id`, `severity`, `owners`, `why`, `enforcement`) | The reconciliation point for every secret/hard-stop surface: `protect-secrets.py`, `cost-estimate.py`'s sensitive-prompt scan, the generated `settings.json` deny list, and the rendered Hard Stops section. Ships with one `example-secret-config` placeholder entry — replace it with your first real one. |
| 8 | SCM kind | `platforms.scm.kind` (`azure-devops` or `github`) | Selects which provider (`electron/providers/scm/*`) drives repo cloning, PAT validation, and the wizard's ADO/GitHub-specific screens. Getting this wrong routes REST calls at the wrong API shape entirely. |
| 9 | Telemetry salt | `telemetry.salt` | A random, adopter-specific string that seeds the SHA-256 hashed user id used across every telemetry event, the dashboard, and the uploader. Ships as `REPLACE_ME_WITH_RANDOM_SALT` — **generate your own** (e.g. `openssl rand -hex 16`) rather than leaving the placeholder, since a shared/guessable salt makes the "metadata-only, hashed" privacy contract weaker than it looks. |

## After the minimum 9

Reasonable next passes, roughly in the order most adopters need them:

1. **More repos + reviewer rules** — `repos[].extra_reviewer_rules[]` for
   contract-sensitive globs (GraphQL schemas, PIM modules, clientlib
   categories — see the reference fixture at `fixtures/titan.config.ds.json` for a
   fully worked, multi-repo example, or the alternate-shape fixture at
   `fixtures/titan.config.github-generic.json` for a smaller 2-repo,
   commerce-disabled example).
2. **`stack.*` flags** — turn off `aem` / `commerce` / `cif` / `search`
   entirely if your stack doesn't include them; the render pipeline
   self-suppresses stack-specific skill rows and hard stops when disabled
   (see `docs/HARNESS-UPDATE.md` for what changed to make this safe).
3. **`contracts[]`** — cross-repo contracts (schema fields, endpoint
   signatures, product-data fields) that require sign-off from multiple
   owners before a change starts.
4. **`governance.plugin_policy`** — your approved/pending/blocked plugin
   and MCP-server registry.
5. **`telemetry.upload.kind`** — stays `"none"` (fully local, no egress)
   until you deliberately opt into `"azure-blob"` and provide a SAS URL.
6. **`branding.*`** — swap `branding.logo_path` / `branding.product_name` /
   `branding.accent` for your own visual identity in the Electron wizard and
   dashboard (see `docs/INSTALLATION.md` for the signing-certificate
   implication of shipping your own branded build).

## Validating what you've filled in

```
python harness/scripts/titan-config.py --validate .claude/titan.config.json
python harness/scripts/titan-config.py --get contacts.areas.aem.primary.0.name
```

`--validate` checks the file against `titan.config.schema.json`.  `--get`
resolves a dotted path exactly the way the render pipeline and the hooks do
(including auto-dereferencing a `contacts.people` id to its `.name`) — use
it to sanity-check that a key resolves to what you expect before deploying.
