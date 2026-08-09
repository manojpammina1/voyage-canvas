# /ops/ship-check -- Pre-Production Ship Gate (Harness Installer)

Full-application verification gate. Run **before packaging and distributing** an adopter's Titan-based harness installer exe to developer laptops. Produces a single GO / NO-GO verdict with every finding classified as a **ship-blocker** or a **warning**.

**Scope:** the harness installer application (Electron renderer + main + harness) in whichever repo hosts it for this adopter (`config.repos[]`, `kind: "installer"` or equivalent — resolve with `?gov` if unsure). This is a toolkit-maintainer (`super`) activity, run from the installer repo root. For the adopter's own product repos (AEM/Maven apps, etc.), the analogous gate is `/ops/release-review` + `/common/aem-build` — not this skill.

**Caveman:** OFF. Ship decisions and security findings demand full clarity.

**Read-only until the package step.** Steps 1–8 make no changes. Step 9 packages. If any step produces a ship-blocker, STOP and report — do not package.

---

## Step 0 — Environment preflight (do this first — it is the most common failure)

Vite 5 + electron-builder require **Node 18+**. A stale default (e.g. Node 16) fails mid-build with `crypto$2.getRandomValues is not a function` — a misleading error that is really "Node too old."

```bash
node -v          # must be >= 18. If not, locate an installed 18/20/22:
nvm list         # (nvm-for-Windows) or: fnm list
```

If the default is < 18, do NOT change the machine default silently. Prepend an installed Node 20 to PATH for the build commands only, e.g.:
```bash
export PATH="/c/node/nvm/v20.18.0:$PATH" && node -v   # confirm >= 18
```

Blocker if no Node 18+ is available on the machine.

## Step 1 — Version consistency

All three must agree. `package.json` `version` drives the exe name via electron-builder `${version}`.

```bash
grep '"version"' package.json
grep -n "Setup-[0-9]" README.md
```

- Confirm `package.json` version == README references == intended release number.
- Blocker if `package.json` still says a dev version (e.g. `0.1.0`) while README/branch claim a real release.

## Step 2 — Lint / typecheck

```bash
npm run lint          # tsc --noEmit
```
Blocker on any TypeScript error. (Common trap: `import.meta.env` usage without `src/vite-env.d.ts` — typechecks fail even though the app runs.)

## Step 3 — Build (renderer + electron main)

```bash
npm run build         # sync:install && tsc && vite build && tsc -p electron/tsconfig.json
```
Blocker on any build failure. Confirm `dist/` and `dist-electron/` are produced.

## Step 4 — Unit tests

```bash
# Run the test script IF one exists:
npm run 2>&1 | grep -qE '^\s*test' && npm test || echo "NO TEST SCRIPT — report honestly, do not fabricate a pass"
```
- If tests exist: blocker on any failure.
- If none exist: state that plainly in the report. Do NOT report a passing test run that did not happen.

## Step 5 — Dependency audit (classify by ship scope)

The distinction is critical: **only runtime deps ship** to laptops. Build-tooling vulns (electron-builder, app-builder-lib, tmp, shell-quote) do not.

```bash
echo "=== RUNTIME (ships — blocker scope) ==="; npm audit --omit=dev
echo "=== FULL (incl. build tooling — warning scope) ==="; npm audit
```
- **Runtime (`--omit=dev`) HIGH/CRITICAL → ship-blocker.**
- Build-time-only HIGH/CRITICAL → **warning** (fix post-ship with `npm audit fix`, then re-package + re-run this gate). Do NOT `npm audit fix` right before a ship — it can bump electron-builder and break a working build.

## Step 6 — Secret / credential / SAS scan

```bash
# Secrets, keys, tokens, passwords (exclude node_modules):
grep -rnE 'sig=[A-Za-z0-9%]{20,}|BEGIN [A-Z ]*PRIVATE KEY|password\s*[:=]\s*['"'"'"][^'"'"'"$]{3,}|pat_[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|figd_[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9-]{20,}' --include='*.*' --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=dist-electron .
# Azure SAS: any REAL token or write-enabled SAS is a blocker:
grep -rnE 'blob\.core\.windows\.net.*(sig=[A-Za-z0-9%]{10,}|sp=rwl|sp=racw)' --exclude-dir=node_modules .
# .env.example must be a placeholder only:
cat dashboard/.env.example
```
- Any real secret, real SAS token, or write-enabled SAS (`sp=rwl…`) committed → **blocker**. Escalate to the security owner immediately (`?gov`).
- Placeholders (`<account>`, `sv=...&sig=...`), validation strings, and pattern-documentation are clean.

## Step 7 — Git-tracked secrets + PHI/PII

```bash
git ls-files | grep -iE 'settings\.local\.json|/\.env$|options\.json|storageState\.json|\.pfx$|\.p12$|\.jks$' && echo "TRACKED SECRET — BLOCKER" || echo "none tracked — clean"
# PHI/PII (real patient/customer data — NOT the allowed sandbox test PANs 4111.../4242...):
grep -rniE '\b\d{3}-\d{2}-\d{4}\b|patient[_ ]?name\s*[=:]' harness src --include='*.*'
```
- Any tracked secret/keystore → **blocker**.
- Real PHI/PII (patient names, SSNs, real customer emails) → **blocker**, escalate to the security owner + adopter's privacy/legal team (`?gov`). Guardrail rules and sandbox test PANs are clean.

## Step 8 — Harness integrity (what the installer deploys)

```bash
# MCP config: no unapproved servers (Playwright etc. must be governance-approved first):
[ -f .mcp.json ] && cat .mcp.json || echo "no .mcp.json — clean"
# Skill/runbook files present + well-formed (spot-check the release's new skills):
for f in $(git diff --name-only HEAD~1 HEAD | grep 'harness/commands\|harness/runbooks'); do [ -f "$f" ] && head -1 "$f" || echo "MISSING $f"; done
```
- Any MCP server not on the CLAUDE.md approved list → **blocker**.
- Any referenced skill/runbook path that does not resolve → **blocker** (broken deploy).

## Step 9 — Package + verify artifact (only if Steps 1–8 are clean)

```bash
npm run package       # build + electron-builder (CSC_IDENTITY_AUTO_DISCOVERY=false)
ls -lh release/*.exe
```
- Confirm the exe at the **intended version** exists (e.g. `<Product Name>-Setup-<version>.exe`, per `branding.product_name`).
- **Stale-artifact check:** if older-version exes remain in `release/`, flag them so the wrong file isn't distributed. Recommend deleting stale exe + `.blockmap`.

## Verdict output

```
SHIP-CHECK — Harness Installer v<version>
─────────────────────────────────────────
Env (Node >=18)      : PASS / FAIL
Version consistency  : PASS / FAIL
Lint / typecheck     : PASS / FAIL
Build                : PASS / FAIL
Unit tests           : PASS / FAIL / NONE
Dep audit (runtime)  : N vulns  (blocker if HIGH/CRIT)
Dep audit (build)    : N vulns  (warning only)
Secret / SAS scan    : CLEAN / BLOCKER
Git-tracked secrets  : NONE / BLOCKER
PHI / PII scan       : CLEAN / BLOCKER
Harness integrity    : PASS / FAIL
Artifact             : release/<Product Name>-Setup-<version>.exe (size)
Stale artifacts      : none / <list>

VERDICT: 🟢 GO  |  🔴 NO-GO — <blocker list>
Warnings (non-blocking): <list>
```

## Limitations (state these honestly in the report)

- This gate verifies **build, packaging, static security, and harness wiring**. It does NOT behaviorally test each Claude skill against a live scenario (that needs interactive sessions), nor does it exercise the installed exe on a clean machine.
- A GO verdict means "safe to distribute the artifact," not "every skill's runtime behavior is validated."

## Escalation

Any blocker in Steps 6–7 (secret, SAS, PHI) → Escalation Alert per CLAUDE.md, contact the security owner immediately (`?gov`), do not package.
