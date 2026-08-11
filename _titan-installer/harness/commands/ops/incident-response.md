# /incident-response -- Production Incident Response

Activate. You are helping triage a live production incident on this ecommerce platform. Think clearly, move methodically. **Do not make any code or config change without logging it first.**

## Step 1 -- Classify severity

| Severity | Definition | Examples |
|----------|-----------|---------|
| P1 — Critical | Platform down or checkout broken for all users | AEM publish down, commerce-platform OCC 500 on all cart calls, CIF layer unreachable |
| P2 — Major | Key feature broken, significant user impact | My Account inaccessible, search returning no results, invoice download broken |
| P3 — Minor | Non-critical degradation | Slow image loading, single product 404, PDF generation failing |

## Step 2 -- Identify the failing layer

Work top-down. Each layer failing produces different symptoms.

| Layer | Symptoms | First check |
|-------|---------|-------------|
| AEM Publish | Page 503 / blank, component missing | Cloud Manager → Environments → Publish logs |
| AEM Author | Authors cannot edit | Cloud Manager → Author service logs |
| CIF Integration Layer | Cart/checkout GraphQL errors | Adobe I/O Runtime logs (`aio app logs`) |
| Hybris OCC | 401 / 403 / 500 on API calls | Hybris admin → API logs; resolve owner via `?gov` (area: commerce/cif) |
| PIM | Products missing / wrong data | PIM team dashboard; resolve owner via `?gov` (area: pim) |
| Coveo/Discover | Search blank / wrong results | Coveo admin console; resolve owner via `?gov` (area: search) |

## Step 3 -- Escalate immediately

Do not wait to be certain before calling. Resolve the current owner for each area with `?gov` or the Titan session header — do not rely on a name cached from a previous session.

| Symptom | Area to resolve via `?gov` | Contact second |
|---------|--------------------------|----------------|
| AEM author or publish down | aem | Cloud Manager admin |
| Checkout / cart broken | commerce/cif | Hybris team |
| CIF layer errors | commerce/cif | |
| OCC 401 / 403 | commerce/cif | Hybris team |
| Product data missing or wrong | pim | PIM team |
| Search broken | search | Search team |
| UI layout broken, JS errors | ui | |
| Credentials or customer data exposed | security — **contact IMMEDIATELY** | Security team |

## Step 4 -- Safe investigation commands

Read-only commands only. No changes until the cause is confirmed.

```bash
# AEM logs via Cloud Manager (browser) -- do not SSH directly

# CIF layer logs
aio app logs  # Lead Architect only

# Check recent deploys across configured repos (see config.repos[] / Titan session header)
git -C <repo-dir> log --oneline -10

# Check what changed in the last deploy window
git -C <repo> log --oneline --since="2 hours ago"
```

## Step 5 -- Rollback options (Lead Architect only)

Run only after confirming the bad change with the area owner (`?gov` — aem or commerce/cif).

### AEM package rollback
```bash
# Redeploy a previous package via Cloud Manager pipeline
# Do NOT run -PautoInstallSinglePackage in production without Lead Architect approval
```

### CIF layer rollback
```bash
cd <cif-repo-dir>
git -C . log --oneline -10          # identify last known good commit
git -C . checkout <good-commit>     # local only -- do NOT push yet
aio app deploy                      # confirm with the commerce/cif owner first (`?gov`)
```

### AEM restart
Only via Cloud Manager console → Environments → Restart. Do not SSH.

## Hard stops during an incident

- `git push --force` -- permanently blocked
- `git commit --amend` after any push -- permanently blocked
- Hybris OCC config changes -- the commerce/cif owner must be present (`?gov`)
- `.cloudmanager/` changes -- the aem/pipeline owner must approve (`?gov`)
- Blind package reinstalls without checking what changed

## Post-incident checklist

- [ ] Root cause identified and documented
- [ ] Timeline written (detected at, mitigated at, resolved at)
- [ ] Follow-up fix tickets created with incident reference
- [ ] CloudWatch / alerting gaps identified
- [ ] PR raised for the permanent fix with incident ref in description
- [ ] Retrospective scheduled (P1 mandatory, P2 recommended)

## Output format

```
Incident  : [one-line description]
Severity  : P1 / P2 / P3
Layer     : AEM / CIF / OCC / PIM / Search / Frontend
Contacts  : [alerted names + time]
Actions   : [numbered, timestamped list]
Status    : Investigating / Mitigation applied / Resolved
```
