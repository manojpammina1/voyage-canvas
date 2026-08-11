# /security-check — AEM Security Review

Run an AEM-specific security review against changed files. Covers OCC session auth, XSS vectors in HTL and React, CSRF, payment data exposure, PHI-adjacent risks, and dependency CVEs. Invoke before `/pr-create` for any PR touching auth, checkout, account, or CIF integration repo code.

**This skill runs in the current session — no subagents spawned. Output is a security report.**

---

## Step 0 — Collect the diff

```bash
git -C "<repo-path>" diff origin/<base>...HEAD --name-only
git -C "<repo-path>" diff origin/<base>...HEAD
```

Store `FILES_CHANGED` and `DIFF`.

If `FILES_CHANGED` is empty: "No changes detected. Nothing to review."

---

## Step 1 — Automated pattern scan

Run these grep commands against the diff. Flag every match.

### 1a — Credential and token exposure

```bash
# Hardcoded tokens, keys, passwords
grep -n "token\s*=\s*['\"][A-Za-z0-9+/=]\{20,\}" <changed files>
grep -n "password\s*=\s*['\"]" <changed files>
grep -n "apiKey\s*=\s*['\"]" <changed files>
grep -n "Authorization:\s*['\"]Bearer" <changed files>

# OCC session token patterns
grep -n "hybris-system-token\|HYBRIS_TOKEN\|X-HYBRIS-TOKEN" <changed files>

# options.json committed
git -C "<repo>" diff origin/<base>...HEAD --name-only | grep "options.json"
```

### 1b — Dangerous React patterns

```bash
grep -n "dangerouslySetInnerHTML" <changed files>
grep -n "innerHTML\s*=" <changed files>
grep -n "eval(" <changed files>
grep -n "document\.write(" <changed files>
```

### 1c — Client-side storage of sensitive data

```bash
grep -n "localStorage\.setItem" <changed files>
grep -n "sessionStorage\.setItem" <changed files>
grep -n "cookie\s*=" <changed files>
```

### 1d — Console logging (data leakage)

```bash
grep -n "console\.log\|console\.error\|console\.warn" <changed files>
```

### 1e — Payment data patterns

```bash
grep -n "cardNumber\|cvv\|cvv2\|cardCvv\|pan\b\|creditCard" <changed files> -i
grep -n "cybersource\|CyberSource" <changed files>
```

### 1f — PHI-adjacent patterns

```bash
grep -n "patientId\|patient_id\|treatmentPlan\|dentalRecord" <changed files> -i
```

### 1g — npm / Maven dependency check (if dependency files changed)

```bash
# If package.json changed:
npm audit --audit-level=high --json 2>/dev/null | head -50

# If pom.xml changed (if OWASP plugin available):
mvn org.owasp:dependency-check-maven:check -DfailBuildOnCVSS=7 -DskipTests 2>/dev/null | tail -20
```

Run npm audit only if `package.json` or `package-lock.json` is in `FILES_CHANGED`. Run Maven check only if a `pom.xml` is in `FILES_CHANGED`.

---

## Step 2 — Manual review by category

Work through the diff manually for each applicable category. Only report findings you can prove from the diff.

### Auth / OCC session

- [ ] New OCC API call: is it behind authentication? Does it handle 401 (session expiry) with re-auth redirect, not just an error message?
- [ ] New Redux state slice: does it contain session token, user identity, or account data? Is it cleared in a logout reducer?
- [ ] New `useEffect` or saga: does it store auth state in `localStorage`? (Should be in-memory Redux only)
- [ ] New AEM component: is it gated by CUG (Closed User Group) where required, or does it render restricted content to anonymous users?

### XSS — HTL / Sightly

- [ ] New `${variable}` in HTL: what is the output context? Default (`html`) is unsafe for user-generated content — must use `@ context='text'` or `@ context='attributeName'` for dynamic values.
- [ ] New HTL expression uses `@ context='unsafe'`: flag as CRITICAL.
- [ ] HTL rendering CIF/GraphQL response data directly: must be escaped.

### XSS — React

- [ ] `dangerouslySetInnerHTML` detected: what is the source? If from OCC/CIF response, flag as HIGH (server-controlled but not user-controlled). If from user input, flag as CRITICAL.
- [ ] User input from form fields rendered into JSX without sanitisation.

### CSRF

- [ ] New AEM form submission (POST): does it include a CSRF token from `CQCoreUtils.getCsrfToken()`?
- [ ] New OCC POST/PUT/DELETE call: is the origin validated by the CIF Layer / AEM Dispatcher?
- [ ] New state-changing operation triggered by a GET request.

### Role-based access

- [ ] New React component renders DSO-admin-only or sales-rep-only data: is the role check done server-side (OCC/CIF) or only client-side?
- [ ] New GraphQL query returns role-restricted fields: does the CIF resolver enforce the role check?
- [ ] Role check done only with `if (userRole === 'admin')` in React — this is UI-only and insufficient.

### Checkout / Payment

- [ ] Payment-related state (card details, payment token) stored anywhere beyond the current request lifecycle?
- [ ] CyberSource payment token logged in any error handler or analytics event?
- [ ] Cart or order data including price transmitted over a non-HTTPS channel?

---

## Step 3 — Output security report

```
AEM SECURITY REVIEW — <repo> | <branch>
Reviewed: <YYYY-MM-DD>

CRITICAL (exploitable — must fix before PR is raised)
──────────────────────────────────────────────────────
  [CREDENTIAL]    <file>:<line> — <description> — escalate immediately per the Titan session header
  [XSS-CRITICAL]  <file>:<line> — <user input rendered unsanitised>
  [PHI-RISK]      <file>:<line> — <patient-linked data exposed>

HIGH (significant risk — fix before merge)
──────────────────────────────────────────────────────
  [SESSION-LEAK]  <file>:<line> — <session token in localStorage or URL>
  [AUTH-BYPASS]   <file>:<line> — <unauthenticated access to restricted resource>
  [CSRF-MISSING]  <file>:<line> — <state-changing form/request without CSRF token>
  [ROLE-BYPASS]   <file>:<line> — <role check enforced client-side only>

MEDIUM (fix or justify in PR description)
──────────────────────────────────────────────────────
  [XSS-MEDIUM]    <file>:<line> — <server-controlled content in dangerouslySetInnerHTML>
  [CONSOLE-LOG]   <file>:<line> — <sensitive data potentially in log output>
  [DEP-CVE]       <package>@<version> — CVSS <score> — <description>

PASS (no issues found)
  Credentials / tokens   : PASS
  OCC session handling   : PASS
  XSS (HTL)              : PASS
  XSS (React)            : PASS
  CSRF                   : PASS
  Role-based access      : PASS
  Payment data           : PASS
  Dependency CVEs        : PASS (or SKIPPED — dependency files unchanged)

VERDICT: BLOCK | HIGH-RISK | MEDIUM-RISK | CLEAN
```

---

## Escalation rules

| Finding | Action |
|---------|--------|
| CRITICAL credential / PHI | Stop work immediately. Output Escalation Alert. Contact the owner for this area (`?gov <path>`). |
| Payment data (CyberSource) | Stop work. Contact the owners for this area (`?gov <path>`). |
| HIGH severity | Do not raise PR until resolved. |
| MEDIUM severity | Raise PR with explicit justification in PR description. |
| CLEAN | Proceed to `/dev/pr-create`. |
