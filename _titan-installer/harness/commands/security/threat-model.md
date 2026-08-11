# /security/threat-model -- STRIDE Threat Model (pre-sprint)

Run this **before coding starts** for any new feature that touches authentication, payment, PII, session handling, or cross-repo data flows. Output a STRIDE table and required mitigations.

## When to invoke

- New feature touches: login/auth, cart/checkout, payment (payment processor), My Account, admin roles, session tokens, PIM data, Coveo search personalisation
- GraphQL schema field added that returns user data
- New OCC endpoint or CIF resolver introduced
- Any Adobe I/O Runtime action that handles personal data

## Step 1 — Gather context

Ask for:
1. Feature name and ADO ticket
2. Data flow: User → [React UI] → [Redux/GraphQL] → [CIF Layer] → [Hybris OCC] → [DB/PIM/Coveo]
3. Actors: per `config` persona list — e.g. authenticated professional buyer / guest / org admin / internal service / sales rep
4. New data handled: what PII/PHI fields, if any

## Step 2 — STRIDE analysis per component

Apply each STRIDE threat category to each component in the data flow:

| STRIDE | Threat type | Questions to ask |
|--------|------------|-----------------|
| **S** Spoofing | Identity forgery | Can an attacker impersonate a user or system? Is the session token validated server-side? |
| **T** Tampering | Data modification | Can input be modified in transit? Are GraphQL inputs sanitised? Is Redux state writeable client-side in a way that bypasses server checks? |
| **R** Repudiation | Deny an action occurred | Are security-relevant actions logged? Is there an audit trail for order placement, address changes, account updates? |
| **I** Information Disclosure | Data leakage | Does the response include fields the user shouldn't see? Are error messages revealing internal paths, stack traces, or Hybris model names? |
| **D** Denial of Service | Availability | Can this endpoint be called in a tight loop? Is rate limiting in place? Does the CIF resolver cache aggressively enough? |
| **E** Elevation of Privilege | Unauthorised access | Can a guest access a trade-price endpoint? Can an org-admin user access another organisation's data? Is role enforcement server-side only (correct) or client-side only (violation)? |

## Step 3 — Output threat model table

For each finding:

```
| Threat | Component | Attack vector | Current mitigation | Residual risk | Owner |
|--------|-----------|--------------|-------------------|---------------|-------|
| S — Session fixation | CIF /cart resolver | Attacker reuses session token from URL param | OCC validates session server-side | LOW | Commerce/CIF owner (`?gov`) |
| I — Price disclosure | GraphQL productQuery | Guest queries trade price field | Field resolver checks role | MED — needs test | Commerce/CIF owner + architecture owner |
| E — Admin escalation | My Account React | DOM manipulation of role flag | Role enforced by OCC endpoint | LOW | Architecture owner (`?gov`) |
```

Residual risk scale: **HIGH** (must fix before sprint starts) / **MED** (must fix before merge) / **LOW** (document and monitor)

## Step 4 — Escalation triggers

Output Escalation Alert per CLAUDE.md and stop sprint planning for:
- Any **HIGH** residual risk finding
- Any finding involving a payment-cert protected path → security owner (`?gov`), immediate
- Any finding involving SAML SSO or LDAP → security owner + commerce/cif owner (`?gov`)
- Any finding that requires a new GraphQL field returning PII → commerce/cif contract owner sign-off (`?gov`)

## Step 5 — Required mitigations

For each MED or HIGH finding, output a required action:

```
REQUIRED BEFORE SPRINT START:
  [ ] THREAT-001 (MED): Add server-side role check in productQuery resolver before trade price is returned
      Owner: Commerce/CIF owner (`?gov`) | Verify: integration test asserting guest receives 403 on trade price field
  [ ] THREAT-002 (HIGH): Rate-limit /checkout/order OCC endpoint at CIF layer
      Owner: Commerce/CIF owner (`?gov`) | Verify: load test shows 429 after N requests/min
```

## Notes on platform-specific risks

- **OCC session tokens**: never logged, never in URL params, always in Authorization header
- **Payment processor integration**: threat model must explicitly address PCI DSS scope — any new field that touches card data is automatically HIGH + security escalation (`?gov`)
- **Coveo personalisation**: user query history is PII — threat model must include I and R categories for search logging
- **AEM author**: author-environment threats are out of scope for this skill (handled by the AEM platform team)
