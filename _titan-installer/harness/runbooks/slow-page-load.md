# Runbook -- Slow Page Load / Intermittent Slowness

**Symptoms:** "Page TTFB > 3s", "site feels sluggish", "homepage loads but PDP times out", "intermittent slowness across the site".

**Severity:** P1 if site-wide. P2 if one page family. P3 if one customer / one geography.

## Step 1 -- Collect

- Page URL / type (homepage / PDP / cart / checkout)
- Customer geography (US East / EMEA / APAC)
- Browser + first-paint vs full-load slow
- Approximate UTC start time of slowness
- Customer ISP if known (some ISPs route badly to specific CDN POPs)

## Step 2 -- Localise the slowness

| Symptom | Most likely layer |
|---|---|
| All pages slow, every user | CDN / origin / AEM Cloud Manager |
| One page slow, every user | AEM component / dispatcher cache miss |
| Slow for one geography | CDN edge / network |
| Slow only after login | Hybris session / OCC bottleneck |
| Slow only on PDP / configurator | PIM call latency / search latency |
| Slow only on checkout | Hybris OCC / tax service / shipping service |

## Step 3 -- Read evidence

| Layer | Where | Look for |
|---|---|---|
| 1. AEM Cloud Manager metrics | Cloud Manager UI -> metrics | P95 page response time, error rate |
| 2. AEM dispatcher | `/var/log/dispatcher/` | Cache hit ratio for the slow page family |
| 3. AEM access log | Cloud Manager logs | Response times per URL |
| 4. Hybris OCC | `Ecommerce/hybris/log/access.log` | OCC response time per endpoint |
| 5. Adobe I/O Runtime activations | `aio rt activation list --limit 50` | Activation duration outliers |
| 6. Browser DevTools | Customer paste or repro | Network waterfall, slow request |
| 7. CDN / WAF | CDN provider console (no Claude tool) | Edge cache state, WAF rule latency |

## Step 4 -- Common causes (ranked by frequency)

| # | Cause | How to confirm | Recommended action |
|---|---|---|---|
| 1 | Dispatcher cache miss rate spiked (recent invalidation) | Dispatcher log shows < 80% hit ratio for the page family | ESCALATE TO the AEM owner: dispatcher rule review / cache warm-up |
| 2 | AEM origin instance under-provisioned for current traffic | Cloud Manager metrics: CPU > 80% on publish | ESCALATE TO the AEM owner + Cloud Manager admin: scale publish tier |
| 3 | OCC slow (Hybris bottleneck) | OCC access.log: response time > 1s on multiple endpoints | ESCALATE TO the commerce owner: Hybris capacity / query investigation |
| 4 | PIM call slow (configurator / PDP) | PimProductService log shows slow query | ESCALATE TO the commerce owner + PIM team: PIM query / index investigation |
| 5 | Coveo / Discover slow | Coveo admin console shows slow query / index lag | ESCALATE TO Search team: Coveo capacity |
| 6 | Adobe I/O cold start (low-traffic action invoked first time in a while) | Activation duration outlier on first call after idle | ESCALATE TO the commerce owner: cold-start mitigation (memory bump / warm-up cron) |
| 7 | Tag manager / 3rd-party script blocking page | Browser waterfall shows long blue bar before paint | ESCALATE TO the architecture owner (frontend): defer / async script audit |
| 8 | CDN edge issue in one POP | Geography correlates with one POP | ESCALATE TO the AEM owner + CDN admin: POP investigation |
| 9 | Database query degradation (Hybris or AEM) | DB metrics from monitoring | ESCALATE TO the commerce owner (Hybris) or the AEM owner (AEM) -- DBA collaboration |
| 10 | Recent deploy regression | Slowness started right after build N deployed | ESCALATE TO the AEM owner: rollback candidate |

## Step 5 -- ADO ticket draft template

```
Title: [P?] Slow page load -- <page type> in <geography>

Customer impact: <count of reports, blast radius>
Severity:        P1 / P2 / P3
Layer:           <CDN / AEM / dispatcher / Hybris / Adobe I/O / 3rd-party>
Confidence:      <%>

Symptom:
  - Page: <URL or type>
  - Geography: <region>
  - TTFB / full-load: <observed times>
  - Time window: <UTC start -- now>

Reproducer (in stage):
  1. Open <URL> from <geography> (use VPN / tester in region)
  2. DevTools network waterfall
  3. Observe <slow request / slow render>

Evidence:
  - AEM Cloud Manager metrics: <P95 etc.>
  - Dispatcher cache hit ratio: <ratio>
  - Hybris OCC times: <if relevant>
  - Recent deploys: <build IDs in window>

Suggested next step:
  ESCALATE TO <owner> for <reason>

Approval needed:
  - Cache rule change: the AEM owner
  - Scaling / capacity: the AEM owner + Cloud Manager admin
  - Rollback: Tech Lead + the AEM owner
```

## Hard stop reminders

- Capacity / scaling decisions go through the AEM owner + Cloud Manager admin -- production support never scales directly
- Recent deploy correlated with slowness = candidate rollback, but rollback decision is the AEM owner's
- 3rd-party scripts (tag managers, chat widgets) may belong to Marketing -- coordinate with Marketing Ops before disabling
- A deploy-correlated slowness is a strong P1+ signal, even if not yet site-wide
