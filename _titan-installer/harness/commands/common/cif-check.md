# /cif-check -- Pre-flight checklist before touching the CIF Integration Layer

The CIF integration repo is a **shared contract** between AEM/CIF and the Hybris OCC API. Breaking changes here affect production without any AEM deploy.

## STOP -- Escalation Required First

If your change involves ANY of the following, stop and output the **Escalation Alert** before writing any code. Also notify the owner for this area (`?gov <path>`):

- Adding, removing, or renaming a GraphQL field in a resolver
- Changing the shape of a GraphQL type or enum
- Adding or removing an OCC API endpoint call
- Changing authentication/token handling
- Modifying `cif/common/options.json` structure
- Adding a new Lerna sub-package
- Modifying `app.config.yaml`
- Modifying `azure-pipeline.yml` or `azure-Pipelines/`

---

## Safe-change checklist

### Before coding
- [ ] Read the relevant sub-package README
- [ ] Identify which OCC endpoint(s) are affected
- [ ] Confirm `options.json` is NOT committed (gitignored)
- [ ] Run `yarn install` to ensure dependencies are current

### While coding
- [ ] Only change resolver logic, not the GraphQL schema shape
- [ ] New resolver functions must have Mocha unit tests in `__tests__/`
- [ ] Error responses from OCC must be mapped to standard GraphQL errors
- [ ] Never log OCC credentials, tokens, or customer data
- [ ] Hybris OCC date formats differ from ISO 8601 -- use existing formatters

### Before submitting
- [ ] `npm run lint` passes with zero errors
- [ ] `yarn test` passes (all Mocha unit tests green)
- [ ] Tested against local Hybris sandbox (not production)
- [ ] Change reviewed by a developer familiar with the Hybris contract

### Fragile fields -- do not rename without full team sign-off

- `product.code` -- maps to Hybris product code; used everywhere
- `cart.guid` -- session identifier; changing breaks cart persistence
- `customer.uid` -- account identifier; changing breaks My Account
- `order.code` -- order number; changing breaks invoice linking

---

## Run tests

```bash
cd "<CIF integration repo path>"
yarn install
npm run lint
yarn test
```

All must pass before the change is ready for review.
