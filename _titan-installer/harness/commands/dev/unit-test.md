# /unit-test -- Unit Test Developer Mode

Activate. Write tests for this platform. No untested code ships.

**Caveman intensity for this sub-context:** `lite`. Test code blocks and per-test explanations are protected by G0 (inherited from `/dev-mode`). Lite compresses only the narrative around the tests.

**On activation (auto-engage caveman):** Immediately invoke the `caveman` skill via the Skill tool (`skill=caveman`), then ensure intensity is `lite` (`/caveman lite` if needed). G0 from parent `/dev-mode` continues to override caveman for test code and per-test explanations. Respect `stop caveman` if user issues it.

## Step 1 -- Identify the framework

| Repo / module | Framework | Test location |
|--------------|-----------|---------------|
| React repos (`stack.frontend.react`) | Jest + React Testing Library | `src/__tests__/` or alongside component |
| Java repos (AEM `*-core`, migration modules) | JUnit 5 + AEM Mocking Framework | `src/test/java/` |
| CIF / integration-layer repos | Mocha + Chai | `__tests__/` next to source file |

---

## React / Redux tests (Jest + RTL)

### Component tests
- Test user-observable behaviour: what renders, what appears on interaction
- Do NOT test implementation details: Redux action names, internal state, HOC wiring
- Use `screen.getBy*` not `container.querySelector`
- Mock only external services (API calls); use a real Redux store with test data for components

### Redux tests
- **Sagas:** test with `redux-saga-test-plan`; assert effects, not implementation sequence
- **Slices:** test reducer logic directly with a known starting state
- **Thunks:** mock `dispatch`; assert dispatch calls and resulting state

### HOC pattern (`connect()`)
- Wrap component in `<Provider store={testStore}>` -- never mock `connect`
- Test rendered output and interactions, not Redux internals

### Hooks pattern (`useSelector` / `useDispatch`)
- Use `renderHook` from RTL; wrap with `<Provider>`
- Test the hook's output and side effects, not internal implementation

### What NOT to test
- LESS / SCSS styles
- Snapshot tests for markup -- they break on every style change
- Auto-generated pom.xml or AEM `.content.xml` files

---

## CIF / integration layer (Mocha + Chai)

- One `__tests__/` file per resolver file in the same directory
- Cover: OCC happy path, OCC error response, null / missing fields, Hybris date format edge case
- Run: `yarn test` or `npm run unit`
- Never log or hardcode OCC credentials in fixtures -- use placeholder `"TEST_TOKEN"`

---

## Java / AEM tests (JUnit 5)

- Use `AemContext` from AEM Mocking Framework for all Sling / AEM dependencies
- Test class naming: `<ClassName>Test.java` in `src/test/java/` matching the source package
- Cover: null JCR properties, missing Sling models, correct response mapping
- Mock only external HTTP calls to OCC -- do not mock the internal AEM framework

---

## Coverage standards

| Code type | Must cover |
|-----------|-----------|
| React component | Happy path + error state + empty / loading state |
| Redux saga | All effect branches + error path |
| CIF resolver | OCC happy path + OCC error + null field handling |
| Java service | Happy path + exception thrown + null input |

---

## Guardrails

- **G1:** Never mock the module under test -- only its external dependencies
- **G2:** No PHI / PII in test fixtures -- use fictional dental practice names (e.g. "Oakview Dental")
- **G3:** No real OCC credentials or tokens -- use placeholder `"TEST_TOKEN"`
- **G4:** Test file must be in the correct directory for the framework (see table above)
- **G5:** Every `describe` and `it` must have a clear, readable description

---

## Run commands

```bash
# React repo
npx jest --coverage

# CIF / integration layer repo
cd <config.repos[].dir for the CIF-role repo>
yarn test

# Java -- specific module
cd <config.repos[].dir for the AEM-role repo>
mvn test -pl :<module-name>

# Java -- full migration repo
cd <config.repos[].dir for the migration-role repo>
mvn test
```
