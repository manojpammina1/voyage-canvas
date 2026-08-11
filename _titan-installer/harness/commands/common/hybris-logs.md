# /common/hybris-logs — Triage a Hybris (Ecommerce) log symptom

Structured log-triage flow for Hybris/OCC/CIF backend symptoms. Locates the right log source, redacts every excerpt before display, classifies the signature to an owner, and hands off to `/common/debug` for the actual fix. Use inside any role — most often `/dev-mode` or `/prodsupport-mode`.

**Caveman intensity for this skill:** `lite`. Trace output must stay readable for whoever continues the triage.

**On activation (auto-engage caveman):** Immediately invoke the `caveman` skill via the Skill tool (`skill=caveman`), then ensure intensity is `lite`. Redaction warnings and escalation alerts (Step 0) are never compressed regardless of caveman state.

## Hard rules (read before Step 1 — these are not suggestions)

1. **NEVER read, open, cat, tail, grep, or display anything under `hybris/config/**`.** That tree holds irrotatable secrets (DB passwords, OCC credentials, CyberSource certs, SAML keystores, GlobalLink API keys) — this is enforced by `protect-secrets.py` as a hard PreToolUse block on Read/Write/Edit/Bash/Grep, but this skill must never even attempt it. If a log points you toward a config value, name the file path only — never its content.
2. **Every log excerpt is piped through `redact_lib.py` before it is shown to the user.** No exceptions, no roles skipped:
   ```bash
   python .claude/hooks/redact_lib.py < excerpt.txt
   ```
   Only the **stdout** (masked text) may be displayed or pasted into chat. `redact_lib.py`'s **stderr** findings summary contains a plaintext sample of the matched value for hook-debugging purposes — it must NEVER be shown to the user, quoted in chat, or included in a PR/known-issues entry.
3. **`CLAUDE_ROLE=prodsupport` → refuse to display any excerpt that still shows redaction findings after masking looks wrong** (e.g. a pattern the regex missed). When in doubt, describe the shape of the data ("an email-like string appeared here") instead of pasting it.
4. **Claude never holds or requests ELK/Kibana/Dynatrace credentials.** For any environment beyond local, this skill gives the user the query to run themselves; they paste back the (still-to-be-redacted) result.

## When to use

- A Hybris/OCC error, cronjob failure, stack trace, or 4xx/5xx from the storefront web-services extension needs triage before a fix.
- Customer-reported symptom with no known-issue match yet (run `?ki <keyword>` first — see Step 5).

Do NOT use for: AEM/frontend-only symptoms (`/common/aem-logs`), or once the root cause is already known (go straight to `/common/debug`).

## Step 1 — Capture the symptom + environment

Same discipline as `/common/debug` Step 1 — quote verbatim, do not paraphrase:
1. Exact error message / stack trace (as reported — will be redacted before you look at it, not before capturing that it exists).
2. Expected behaviour, one sentence.
3. **Environment:** `local` / `dev1`–`dev3` / `qa1`–`qa3` / `staging1` / `prod` (names from the Hybris repo's `hybris/cd/environments/`).
4. First seen, or "used to work" — if the latter, what changed (deploy, content update, OCC/PIM change).

## Step 2 — Locate the log source (branches by environment)

| Environment | Source | How |
|---|---|---|
| **local** | `hybris/log/tomcat/console-*.log`, `hybris/bin/platform/tomcat/logs/*.log` (in the Hybris/Ecommerce repo) | Read directly — these are dev-machine files, not the protected config tree. |
| **dev1-3 / qa1-3 / staging1** | ELK (Filebeat → Elasticsearch, per the repo's `elk/` directory) | Claude does not query Elastic directly (no stored credentials). Give the user a Kibana query (index pattern, time range, `sourcelog`/`severity` filter) to run themselves. Event shape: `{"@timestamp", "severity", "sourcelog", "message"}` — multiline stack traces are already reassembled by the Filebeat AWK pipeline, so `message` is the full trace. |
| **prod** | Dynatrace (per the repo's `hybris/cd/scripts/Dynatrace_Deployment_Event_Prod.ps1`) | Guided lookup only — give the user the Dynatrace query/dashboard to check; if this could be a customer-impacting incident, escalate per `/ops/incident-response` in parallel, don't wait on log triage alone. |

Paste-back contract: whatever the user pastes back from Kibana/Dynatrace goes through Step 3 redaction before you look at it further — treat pasted server logs exactly like local file content.

## Step 3 — Collect + redact

```bash
# Local file, grep the exact signature with context lines (multiline-aware: -A/-B on the
# error line usually captures the full stack since Tomcat indents continuation lines)
grep -n -B2 -A20 "<exact error signature from Step 1>" hybris/log/tomcat/console-*.log > /tmp/excerpt.txt

# Redact before you or the user ever sees it
python .claude/hooks/redact_lib.py < /tmp/excerpt.txt
```

Only show the masked stdout. If findings appear on stderr, summarize as a count in your own words ("2 email-like values were masked") — never echo the stderr text itself.

## Step 4 — Classify the signature → owner

Resolve the owner for each signature pattern via `?gov <area>` / `data/reviewer-map.json` rather than a hardcoded table — the underlying extension names are project-specific (custom OCC web-services extension, search extension, payment-gateway extension, SSO extension, ERP-integration extension, translation-sync extension, etc.). Typical pattern → area mapping to look up:

| Signature pattern | Likely area |
|---|---|
| `FlexibleSearchException`, SQL/DB timeout | Query / DB layer |
| Cronjob `ABORTED` / `FAILED` in job log | Batch job |
| 4xx/5xx from the storefront web-services extension | OCC contract |
| Search-extension / Coveo-related signatures | Search |
| Payment-gateway extension errors | Payment — **treat as immediate**, per Hard Stops |
| SSO/SAML extension | SSO/SAML — see `saml-login-fails.md` runbook |
| ERP/S4HANA integration extension | ERP integration |
| `JGroups` clustering errors | Clustering — CD scripts already have `delete_JGroups_rows.ps1`, this is a known operational fix |
| Translation-sync extension | Translation sync |

## Step 5 — Known-issue fast path

Before deep triage, check the registry: type `?ki <keyword>` (zero-token fast path via `answer-cache.py`), or invoke `/prodsupport/known-issues` for fuzzy matching. Cross-reference matching runbooks: `order-not-completed.md`, `price-wrong.md`, `tax-wrong.md`, `saml-login-fails.md`, `email-not-sent.md`, `search-zero-results.md`.

## Step 6 — Hand off to a fix

This skill is **triage-only**. Once the log points at a specific layer/extension, switch to `/common/debug` (inside `/dev-mode`) for the test-first fix flow — do not patch code from within this skill.

## Step 7 — Codify

After resolution, append a known-issues registry entry (same format as `/prodsupport/known-issues` Step 5) — symptom description only, **never** customer identifiers, emails, or order numbers, even redacted ones.

## Anti-patterns to refuse

- Pasting a raw log excerpt "just this once" without running it through `redact_lib.py` first.
- Reading anything under `hybris/config/` "to check a setting" — name the file, don't open it.
- Asking the user for their Kibana/Dynatrace password so Claude can "just check itself."

## Permissions

Allowed: read local log files, `grep`/`tail`/`redact_lib.py`, read (not query) ELK config under the Hybris/Ecommerce repo's `elk/` directory for documentation purposes, `?ki` lookups.
Blocked: reading `hybris/config/**` (hard-blocked by `protect-secrets.py` regardless), displaying unredacted excerpts, writing/editing code (use `/common/debug`), holding or requesting any log-platform credentials.
