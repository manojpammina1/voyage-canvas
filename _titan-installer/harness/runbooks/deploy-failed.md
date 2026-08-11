# Runbook: Deploy Failed

Use when a deployment fails at any of the 4 pipeline stages (CIF → Migration → Webapp → DT).

## Step 1 — Identify the failure stage

| Stage | How to identify |
|-------|----------------|
| CIF Layer | `aio app deploy` exits non-zero; Adobe I/O console shows action error |
| the migration repo | Maven build fails; AEM package manager shows INSTALLED (not ACTIVE) or FAILED |
| the AEM webapp repo | Maven build fails; AEM dispatcher returns 5xx on cached pages |
| the storefront/ecommerce repo | Maven build fails; cart/checkout/product pages return 5xx or blank |

## Step 2 — Stop the deploy sequence

**Do not proceed to subsequent stages.** A broken producer (e.g. CIF) will cause cascading failures in consumers (Migration, Webapp, DT).

Notify the release owner immediately: the architecture owner (`?gov who owns architecture`) for frontend/CIF; the AEM/pipeline owner (`?gov who owns aem`) for AEM/pipeline.

## Step 3 — Identify the broken contract

Run the appropriate diff check for the failed stage:

**CIF failure:**
```bash
git -C "the CIF integration layer repo" log --oneline origin/main..HEAD
git -C "the CIF integration layer repo" diff origin/main...HEAD -- "*.graphql" app.config.yaml
```
Look for: GraphQL field removal, `app.config.yaml` environment mismatch, expired Adobe I/O token.

**Migration failure:**
```bash
git -C "the migration repo" log --oneline origin/main..HEAD
# Check AEM error.log on target server for OSGi bundle failures
```
Look for: missing OSGi service dependency, Hybris API class mismatch, JCR content conflict.

**Webapp or DT failure:**
```bash
# Check AEM error.log for bundle wiring errors
# Check clientlib compiler errors in /libs/granite/ui/content/shell/clientlibs/
```
Look for: clientlib category mismatch with DT, Webpack/Gulp compile error, HTL use-object class missing.

## Step 4 — Rollback decision

Rollback if **any** of the following is true:
- Production traffic is affected (5xx rate above 1%)
- Cart or checkout is broken
- Authentication (login/logout) is broken
- P0 alert firing in monitoring

Do NOT rollback for:
- Failure in a non-prod environment (fix forward)
- Cosmetic or content-only issues
- Failure limited to Author environment only

## Step 5 — Rollback commands (reverse order)

Rollback DT first, then Webapp, then Migration, then CIF.

**Step 4 rollback — DT Ecommerce (revert to previous release tag):**
```bash
git -C "the storefront/ecommerce repo" checkout <previous-release-tag>
mvn -PautoInstallSinglePackagePublish clean install -f the storefront/ecommerce repo/pom.xml
```
Approver: the architecture owner (`?gov who owns architecture`)

**Step 3 rollback — Webapp:**
```bash
git -C "the AEM webapp repo" checkout <previous-release-tag>
mvn -PautoInstallSinglePackagePublish clean install -f the AEM webapp repo/pom.xml
```
Approver: the AEM/pipeline owner (`?gov who owns aem`)

**Step 2 rollback — Migration:**
```bash
git -C "the migration repo" checkout <previous-release-tag>
mvn -PautoInstallSinglePackagePublish clean install -f the migration repo/pom.xml
```
Approver: the architecture owner (`?gov who owns architecture`) + the AEM/pipeline owner (`?gov who owns aem`)

**Step 1 rollback — CIF:**
```bash
git -C "the CIF integration layer repo" checkout <previous-release-tag>
aio app deploy --workspace <stage|prod>
```
Approver: the commerce/CIF owner (`?gov who owns commerce`)

## Step 6 — Post-failure communication

Use this template within 15 minutes of a production deploy failure:

```
Subject: [Platform] Deploy rollback in progress — [DATE TIME]

We have rolled back the [STAGE/PROD] deployment due to [SYMPTOM CATEGORY].
Impact: [brief customer-visible description, no technical detail, no error codes]
Status: Rollback complete as of [TIME] / Rollback in progress, ETA [TIME]
Root cause: Under investigation
Next update: [NOW + 1 HOUR]
ADO ticket: [ticket number]
Contact: the architecture owner (`?gov who owns architecture`) / the AEM/pipeline owner (`?gov who owns aem`) / the commerce/CIF owner (`?gov who owns commerce`) (per area)
```

## Step 7 — Post-mortem

After recovery, open an ADO ticket tagged `post-mortem` with:
1. Timeline (deploy start → failure detected → rollback complete)
2. Root cause (which contract broke and why)
3. Fix (what code change prevents recurrence)
4. Process improvement (was `/sre/deploy-sequence` contract check run? If not, why?)

Assign to the architecture owner (`?gov who owns architecture`) for review within 2 business days.
