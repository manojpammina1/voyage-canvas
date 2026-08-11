# /check-conventions -- Audit code against project coding conventions

## Step 0 -- Validate branch name

Check the current branch name before reviewing any code. Run:

```bash
git -C <repo-path> rev-parse --abbrev-ref HEAD
```

### Required format

```
<type>/PROJ-<ID>/<TICKET>-<short-desc>
```

| Segment | Values | Example |
|---------|--------|---------|
| `<type>` | `feature`, `bugfix`, `hotfix`, `chore`, `refactor` | `feature` |
| `PROJ-<ID>` | Project ID from `.claude-projects/registry.json` | `PROJ-Q2-CHECKOUT` |
| `<TICKET>-<short-desc>` | ADO ticket + kebab-case description (max 40 chars) | `SHOPPURCH-12849-cart-minimum` |

### Examples

```
✓  feature/PROJ-Q2-CHECKOUT/SHOPPURCH-12849-cart-minimum-quantity
✓  bugfix/PROJ-Q2-CHECKOUT/TICKET-4421-session-expiry-cart-drop
✓  hotfix/PROJ-ACCOUNT-PORTAL/SHOPPURCH-12901-invoice-404
✓  chore/PROJ-Q2-CHECKOUT/SHOPPURCH-12850-cleanup-cart-reducer
✗  feature/SHOPPURCH-12849-cart-min          ← missing project segment
✗  feature/cart-minimum                       ← missing both project and ticket
✗  SHOPPURCH-12849-cart-min                   ← missing type and project
```

### Action on violation

- Flag as `[BRANCH-NAME] FAIL` in the audit report.
- If the branch has no project segment, suggest the correct rename:
  `git branch -m <current> feature/PROJ-<ID>/<TICKET>-<desc>`
- Do NOT block — this is a naming violation, not a hard stop. Record it and continue audit.

---

## Step 1 -- Identify the repo

Match the changed path against `config.repos[]` to determine which convention set applies (id / `role_in_stack` / path prefix). The four convention sets below correspond to: the DT ecommerce repo, the active production webapp repo, the migration repo, and the CIF integration repo.

---

## DT ecommerce repo -- Convention checklist

### Module naming and placement
- [ ] Module name follows the repo's `module_naming` pattern (see `config.repos[]`)
- [ ] File is inside the correct module suffix
- [ ] OSGi configuration is in `*-ui.config`, not in `*.apps` or hardcoded in Java
- [ ] No frontend logic placed inside `*.apps` or `*.content`
- [ ] Partial module sets respected -- do not add `-ui.frontend` to coveo/discover/dso/academy without Lead Architect approval

### React / frontend
- [ ] New code matches the surrounding pattern: HOC vs hooks -- no mixing
- [ ] LESS in `ds-ecom-webapp-dt-ui.frontend`; SCSS in Webpack modules
- [ ] No inline styles
- [ ] Props validated with PropTypes or TypeScript types -- match what the file already uses
- [ ] No hardcoded environment URLs, API base paths, or credentials

### State management (Redux)
- [ ] Sagas placed under `state/sagas/`
- [ ] Reducers placed under `state/reducers/`
- [ ] Actions are pure objects; side effects only in sagas

### AEM / Java
- [ ] OSGi `@Component` and `@Service` annotations used correctly
- [ ] No hardcoded Sling resource types
- [ ] Unit tests exist in `src/test/java` for new services

---

## Active production webapp repo -- Convention checklist

- [ ] Module naming: `shop-*` for shop-specific modules, `ui.*` for shared modules
- [ ] Redux pattern matched: this repo uses sagas (`state/`), slices (`slice/`), and thunks (`thunks/`) -- match whichever the file already uses, never mix in one file
- [ ] Stylesheets: LESS only -- no SCSS in this repo
- [ ] No `.cloudmanager/` files modified (escalate per `?gov .cloudmanager` — Cloud Manager owner + Cloud Manager admin)
- [ ] No pipeline files modified
- [ ] No credentials, tokens, or environment URLs hardcoded

---

## Migration repo -- Convention checklist

### Naming convention awareness

Migration-phase prefixes and their risk levels are defined in `config.repos[].module_naming` (legacy/Hybris-integration prefix = HIGHEST risk — touches backend contracts; intermediate prefix = MEDIUM; target-state prefix = LOWER). Resolve via `?gov <path>` if unsure which phase a path belongs to.

- [ ] Change is inside a single naming convention
- [ ] If touching the migration repo's Hybris API or Hybris impl modules: run `/common/migration-check` first
- [ ] `ci/`, `pipeline/`, `cd-deploy/` directories not modified
- [ ] No credentials or environment-specific URLs

### Frontend (ds-webapp-ui.frontend, ecom-webapp-ui.frontend)
- [ ] SCSS only (no LESS in migration frontend modules)
- [ ] No hardcoded credentials or environment URLs

---

## CIF integration repo -- Convention checklist

### Package and resolver conventions
- [ ] Change is in the correct sub-package: `cart`, `category`, `common`, `customer`, `order`, `product`, `utils`
- [ ] `hybris-system-token/` not modified
- [ ] `app.config.yaml` not modified
- [ ] `azure-pipeline.yml` and `azure-Pipelines/` not modified
- [ ] GraphQL schema shape unchanged

### Code conventions
- [ ] New resolver functions have Mocha unit tests in `__tests__/`
- [ ] Error responses from OCC mapped to standard GraphQL errors
- [ ] No OCC credentials or customer data in console output
- [ ] `npm run lint` passes with zero errors

---

## Security -- applies to ALL repos

- [ ] No credentials, tokens, or API keys in source code or comments
- [ ] No patient data, dental practice data, or PHI/PII anywhere
- [ ] `options.json` is not committed (gitignored)

---

## After the audit

Report a summary table of PASS / FAIL / WARNING items. For each FAIL, provide the exact line and a fix.

If any FAIL is a governance violation (credentials, PHI, pipeline file, hybris-api, hybris-system-token, app.config.yaml, .cloudmanager), stop immediately and output the **Escalation Alert** from CLAUDE.md.
