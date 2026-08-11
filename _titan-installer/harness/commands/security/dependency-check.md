# /security/dependency-check -- Supply Chain Audit (new package vetting)

Run before adding any new npm or Maven dependency. Returns APPROVED / REVIEW-NEEDED / BLOCKED.

## Input

Package name, version (or version range), and module where it will be added.

Example: `lodash@4.17.21 — <cart-ui-module>` (module naming per `config.repos[].module_naming`)

## Step 1 — Known CVE check

**npm packages:**
```bash
# In the module root, add the package temporarily and audit:
npm install <package>@<version> --no-save && npm audit --json
# Then remove: npm uninstall <package>
```

Look for:
- Any CRITICAL or HIGH severity CVE in the package itself
- Any CRITICAL or HIGH CVE in its direct dependencies (depth 1)

Output: list of CVEs with CVSS score, affected version range, patched version (if available).

**Maven packages:**
```bash
mvn org.owasp:dependency-check-maven:check -Dformat=JSON
```

If `npm audit` or `mvn dependency-check` cannot be run locally, manually check:
- `https://osv.dev/` — search package name + version
- `https://nvd.nist.gov/` — search CVE by package name

**Decision:**
- Any CRITICAL CVE → BLOCKED
- Any HIGH CVE without a patched version → BLOCKED
- Any HIGH CVE with an available patch → REVIEW-NEEDED (require patch version)

## Step 2 — License check

| License | Decision |
|---------|----------|
| MIT, Apache 2.0, BSD-2, BSD-3, ISC | APPROVED |
| LGPL (dynamic linking only) | REVIEW-NEEDED — confirm no static linking |
| GPL v2 / v3, AGPL | BLOCKED — incompatible with a commercial product |
| Unlicense, CC0 | APPROVED |
| Proprietary / no license stated | BLOCKED — requires the adopter's Legal review |
| Creative Commons (non-CC0) | BLOCKED — not for software |

## Step 3 — Popularity and maintenance health

Check on `https://npmjs.com` (npm) or `https://mvnrepository.com` (Maven):

| Check | Threshold | Result if below |
|-------|-----------|----------------|
| Weekly downloads (npm) | >1M/week | REVIEW-NEEDED |
| Last publish date | Within 2 years | REVIEW-NEEDED |
| Open issues (critical/security label) | 0 unpatched | REVIEW-NEEDED |
| Active maintainers | >1 maintainer | REVIEW-NEEDED |
| Is this a single-maintainer package with no org backing? | — | REVIEW-NEEDED (flag explicitly) |

## Step 4 — Capability risk check

Inspect `package.json` `dependencies` / Maven POM for capability flags:

| Capability | Decision |
|-----------|---------|
| `fs`, `child_process`, `net` (Node built-ins) accessed by the package | BLOCKED — requires the security owner's sign-off (`?gov`) |
| Outbound HTTP/HTTPS calls to a third-party endpoint | BLOCKED — requires Legal + Security review (data egress), resolve owners via `?gov` |
| Eval / dynamic code execution | BLOCKED |
| Post-install scripts in `package.json` | REVIEW-NEEDED — inspect script content |
| `preinstall`, `postinstall` npm lifecycle hooks | REVIEW-NEEDED — inspect hooks |

## Step 5 — Output

```
DEPENDENCY CHECK: lodash@4.17.21
  CVE scan:       APPROVED — no CVEs found
  License:        APPROVED — MIT
  Health:         APPROVED — 35M weekly downloads, maintained, multi-maintainer
  Capabilities:   APPROVED — no fs/net/exec access
  Verdict:        APPROVED
  Add command:    npm install lodash@4.17.21 --save
```

```
DEPENDENCY CHECK: some-util@1.0.0
  CVE scan:       BLOCKED — CVE-2024-12345 (CVSS 9.8, CRITICAL, no patch available)
  License:        APPROVED — MIT
  Health:         REVIEW-NEEDED — 500 weekly downloads, last publish 3 years ago
  Capabilities:   BLOCKED — uses child_process.exec
  Verdict:        BLOCKED
  Reason:         Critical CVE + capability risk. Do NOT install.
  Contact:        Security owner (`?gov`) to evaluate alternative
```

## Escalation

If verdict is BLOCKED: do not add the package. Output Escalation Alert (contact the security owner via `?gov`).
If verdict is REVIEW-NEEDED: escalate to the security owner for approval before adding. Record approval reference in the PR description.
All BLOCKED results must be noted in the PR description under "Dependencies reviewed."
