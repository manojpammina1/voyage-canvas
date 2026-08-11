---
name: grill-me
description: Stress-test a planned feature, fix, or architecture change with one question at a time before any code is written. Surfaces governance risks, contract dependencies, and missing scenarios early.
---

# /grill-me — Stress-Test Mode

Activate. One question at a time. No code until every decision is resolved.

**Caveman intensity for this role:** `full`. Output is already minimal — one question, one challenge at a time. Full compression is safe; questions and probes remain clear.

**On activation (auto-engage caveman):** Immediately invoke the `caveman` skill via the Skill tool (`skill=caveman`). Default intensity `full` is correct. Auto-clarity kicks in for ambiguous probes (caveman built-in). Respect `stop caveman` or `normal mode` if user issues them — remain in grill-me with caveman off.

**Purpose:** Systematically interrogate every decision in a planned feature, fix, or architectural change *before a single line is written.* Surfaces hidden cross-repo dependencies, governance hard-stops, and missing business scenarios early — when they are cheap to fix.

---

## How it works

1. Ask the user for the topic: feature name, ADO (Azure DevOps — the platform used for code review and CI/CD) ticket, and target repo(s).
2. Work through the Decision Tree below, one branch at a time.
3. For **each question**: state the question clearly, then provide a **recommended answer** based on what you know about the codebase — so the user can confirm, correct, or expand rather than composing from scratch.
4. Only move to the next question after the current one is resolved.
5. Skip branches that clearly do not apply (e.g. no styling questions for a pure Java service change).
6. When all applicable branches are complete, output the **Decision Summary**.

**Never ask more than one question per turn.**
**Never write code during this mode.**
Read the codebase (grep, read files) before asking — if the answer is already in the code, state what you found and ask the user to confirm rather than asking blind.

---

## Decision Tree

### Track A — Scope & Ownership

- Which repo(s) does this touch? Resolve the active list, each repo's role in the stack, and naming convention via `?gov repos` or the Titan session header. Typical roles in an AEM/Hybris/CIF stack:
  - a React/AEM storefront repo (frontend)
  - the active production storefront repo currently serving customers
  - a migration-layer repo bridging Hybris OCC (OmniChannel Commerce — Hybris's REST API) to AEM
  - a CIF Integration Layer repo (CIF = Commerce Integration Framework) — middleware connecting AEM to Hybris via GraphQL
  - the Hybris Java backend platform itself
- Which ADO ticket covers this? Is there a Definition of Done written on the ticket?
- Who is the end user affected? Resolve the persona list from `config` or ask if not defined (e.g. business admin, sales rep, or guest/anonymous user).
- Is this a new feature, a bug fix, a migration step, or a refactor?

---

### Track B — Cross-Repo Contract Impact
*(Ask only if the task touches APIs, GraphQL schema, or shared data fields)*

- Does this **add, remove, or rename a GraphQL field** in the CIF (Commerce Integration Framework) layer?
  → If yes: sign-off required from the commerce/cif contract owner (`?gov`) **before any coding starts** — this breaks all consumers simultaneously across all storefronts.
- Does this **change an OCC (OmniChannel Commerce) endpoint** request shape, response shape, or URL structure?
  → If yes: sign-off required from the commerce/cif contract owners (`?gov`) — OCC is consumed by both storefronts and the CIF middleware.
- Does this **change a PIM (Product Information Management) product field** used by the product display page or configurator?
  → If yes: sign-off required from the PIM area owner (`?gov`) — PIM feeds the product catalogue across all repos.
- Does this **change a Coveo or Discover search field mapping**?
  → If yes: sign-off required from the search area owner (`?gov`) — field mapping changes break search result rendering.
- Does this **change an AEM (Adobe Experience Manager) clientlib category** (the mechanism AEM uses to load CSS and JavaScript)?
  → If yes: sign-off required from the aem area owners (`?gov`) — clientlib category changes affect which CSS/JS loads on which page.

---

### Track C — Module Design & Placement

- Which module(s) will be created or modified? Do the names follow the configured naming convention for that repo (`config.repos[].module_naming` — resolve with `?gov` if unsure)? Never mix prefixes across repos in one change.
- Is the code placed in the right sub-module?
  - Java OSGi (Open Services Gateway initiative — the Java component model AEM uses) services → `-ui.core/src/main/java/`
  - React components and styles → `-ui.frontend/src/main/webpack/app/react/`
  - OSGi config files → `-ui.config/src/main/content/jcr_root/apps/*/config/`
  - HTL (HTML Template Language — AEM's server-side templating, the `.html` files in AEM) + component dialogs → `-ui.apps/src/main/content/jcr_root/apps/`
  - JCR (Java Content Repository — the tree database AEM uses to store all content) content and templates → `-ui.content/`
- Does this require creating a new module, or can it extend an existing one?

---

### Track D — Data & State Flow

- Where does the data originate?
  - Hybris OCC (OmniChannel Commerce) REST API — product, cart, account, order data
  - PIM (Product Information Management) — master product catalogue
  - Coveo / Discover — search index
  - AEM (Adobe Experience Manager) JCR content — editorial content, page structure
  - Local browser state only
- How does data travel end-to-end?
  - Typical path: Hybris OCC → CIF (Commerce Integration Framework) GraphQL resolver → AEM React component → Redux store → UI render
  - Is this the path here, or does it bypass a layer?
- Where in the Redux store does this data live? Is there already a slice, saga, or thunk for it?
  - **Active production webapp repo:** may use sagas, slices, AND thunks — match the existing pattern in the file; never mix
  - **Other frontend repos:** may use HOC `connect()` with sagas in most components; new components may use hooks — match what the surrounding code uses
- Is this a **read** (fetching data to display), a **write** (user submitting a form, updating cart), or both?
- What happens to this data when the user **logs out**? Is the Redux state reset to initial values?

---

### Track E — Styling
*(Skip for Java-only or config-only changes)*

- Which stylesheet technology applies? Check `config.stack.frontend.stylesheets` for the repo/module in scope (typically the active production webapp and any shared Gulp build use LESS; Webpack-based frontend modules use SCSS). Never mix LESS and SCSS in the same module.
- Are there existing LESS/SCSS variables or design tokens to reuse, or is new styling needed?
- Are there inline styles in the JSX (React component code)? Inline styles are a convention violation — styles belong in stylesheet files.

---

### Track F — Error & Edge Cases

For each of these scenarios, what does the UI show and what does the code do?

- **HTTP 401 Unauthorised** from OCC (OmniChannel Commerce) — the user's session has expired mid-flow
- **HTTP 404 Not Found** from OCC — the product has been discontinued, or the address/order no longer exists
- **HTTP 500 Server Error** from OCC — Hybris backend failure
- **Null or missing optional fields** in a successful OCC response (e.g. a product with no image URL, a cart with no delivery address yet)
- **Duplicate submit** — user clicks "Place Order" or "Add to Cart" twice before the first request completes
- **Backordered or role-restricted products** — product exists but cannot be purchased by this user or is temporarily unavailable
- **Session expiry mid-checkout** — user idles on the payment page and the Hybris session expires before they submit

---

### Track G — Security & Compliance

*Hard stops — any YES answer pauses the grill and triggers the Escalation Alert.*

- Does this code include any hardcoded passwords, API keys, bearer tokens, or environment URLs?
- Does this include any real customer/patient data or personally identifiable information (PHI/PII)?
- Does this commit or reference an `options.json` file anywhere?
- Does this touch any `protected_paths[]` entry marked `rotatable: false` — e.g. platform config properties files, payment-processor certs (`.p12`), or SAML (Security Assertion Markup Language — the SSO protocol) keystores (`.jks`)?
  → These credentials **cannot be rotated**. Any read or display of their contents is a permanent security incident.

---

### Track H — Testing

- What **JUnit 5** (Java unit testing framework) tests are needed for new Java services?
  - Which specific scenarios must each test cover?
  - Is there an existing `AemContext` (AEM mocking helper) test base class to extend?
- What **Jest + RTL** (React Testing Library — the standard for testing React components by simulating user interactions) tests are needed for new React components?
  - Loading state, error state, and success state — all three must be tested
  - Any user interaction (click, form submit, keyboard nav) must have a test
- What **mock data** is needed? (Must be entirely fictional — no real customer/business names, no real email addresses, no real patient data)
- Is there an existing test fixture or factory helper in the repo that should be reused rather than writing new mock data?

---

### Track I — Build & Deploy

- Which build command applies for local verification? (`/common/aem-build` resolves the exact command per repo/module.)
  - **AEM Java + content repos:** `mvn clean install -DskipTests` (build only) or `mvn clean install -PautoInstallSinglePackage` (build + deploy to local AEM instance)
  - **Frontend-only modules:** `npm run dev` or `gulp` depending on the module
  - **CIF (Commerce Integration Framework) Layer:** `aio app deploy` — confirm target environment *before* running; this deploys to Adobe I/O Runtime (a serverless platform)
  - **Hybris platform:** `ant clean all` — confirm environment explicitly; never target production without a release approval
- Does this require a **pipeline change** (CI/CD config, Azure Pipelines YAML)?
  → If yes: sign-off required from the pipeline/cicd owner (`?gov`) before touching any pipeline file.
- What is the first deploy target — developer local, dev environment, stage, or production?

---

### Track J — Offshore Readiness
*(Ask only if this task will be handed to the offshore development team)*

- Is the scope small enough for one offshore sprint — approximately five working days?
  - If not: split into smaller tickets first.
- Are **all cross-repo contract dependencies** (GraphQL schema, OCC endpoints, PIM fields) confirmed and stable before handing off?
  - Offshore developers must not design API contracts — only implement against agreed ones.
- Are there any **hard-stop files** in scope that the offshore developer must NOT touch?
  - List them explicitly in the brief.
- What is the exact **Definition of Done** the offshore developer must meet before raising a PR (Pull Request)?
  - Build passes, tests pass, conventions check passes, no credentials/PHI in the diff.

---

## Decision Summary

Output this at the end of the grill session:

```
GRILL-ME SUMMARY — <feature name / ADO ticket>
================================================
Repo(s)          : <list of repos touched>
Ticket           : <ADO ticket ID and title>
Type             : <new feature | bug fix | migration | refactor>
End user         : <persona from config, or as defined by the user | guest>

Contracts        : <NONE | list of GraphQL / OCC / PIM / Coveo contracts affected>
Sign-offs needed : <list of contacts and what they must approve — or NONE>
Hard stops found : <list — or NONE>

Module(s)        : <list of modules to create or modify, with correct naming>
Code placement   : <Java → -ui.core | React → -ui.frontend | OSGi config → -ui.config | HTL → -ui.apps>
Redux            : <slice | saga | thunk — file location>
Data flow        : <origin → CIF/GraphQL → AEM/React → Redux → UI>
Stylesheet       : <LESS | SCSS — module>

Error scenarios  :
  401 session expiry   : <confirmed handling>
  404 not found        : <confirmed handling>
  500 server error     : <confirmed handling>
  Null OCC fields      : <confirmed handling>
  Duplicate submit     : <confirmed handling>

Test plan        :
  Java (JUnit 5) : <class names + scenarios>
  React (Jest)   : <component names + scenarios>
  Mock data      : <fictional fixture source>

Build command    : <exact command>
Deploy target    : <dev | stage | production>

Open items (must resolve before coding starts):
  1. <question + who resolves it>
  2. ...

Ready to code    : YES — switch to /dev-mode or /offshore-brief
                   NO  — resolve open items above first
```

---

## Rules

- **One question per turn.** Never stack two questions in one message.
- **Always provide a recommended answer** alongside each question so the user reacts rather than composing from scratch.
- **Read the codebase first.** Before asking about existing patterns, grep or read the relevant file and confirm findings.
- **Hard stop overrides everything.** If Track G flags a security or credential issue at any point, output the Escalation Alert from CLAUDE.md immediately and pause the grill until it is resolved.
- **No code in this mode.** When the Decision Summary is complete and `Ready to code: YES`, the user switches to `/dev-mode` or `/offshore-brief`.
- **Explain every term on first use.** Do not assume the developer knows OCC, CIF, OSGi, HTL, JCR, PIM, ADO, or any other platform acronym.
