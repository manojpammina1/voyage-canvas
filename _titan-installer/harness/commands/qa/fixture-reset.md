# /qa/fixture-reset -- Test Fixture Teardown Patterns

Reference for correct teardown per framework. Isolated tests do not share state between runs.

## JUnit 5 + AemContext (Java OSGi)

```java
@ExtendWith(AemContextExtension.class)
class CartServiceImplTest {

    private final AemContext ctx = new AemContext(ResourceResolverType.RESOURCERESOLVER_MOCK);

    @BeforeEach
    void setUp() {
        ctx.addModelsAdaptables(SlingHttpServletRequest.class, Resource.class);
        ctx.registerService(HybrisClient.class, mockHybrisClient);
        // load fixture JSON
        ctx.load().json("/fixtures/cart.json", "/content/ds/en");
    }

    @AfterEach
    void tearDown() {
        // AemContext auto-closes ResourceResolver — no manual cleanup needed
        // Reset mocks explicitly if using Mockito:
        Mockito.reset(mockHybrisClient);
    }
}
```

**Rules:**
- Never share `AemContext` instances across test methods — declare one per class, let `@AfterEach` reset mocks
- Fixture JSONs must use fictional practice names from the approved list (see G-Q2 in qa-mode)
- Never load real JCR node paths from an AEM instance — use `ctx.load().json()`

## Jest + React Testing Library (React)

```typescript
import { cleanup, render } from '@testing-library/react';

afterEach(() => {
  cleanup();               // unmounts components; RTL auto-calls this in v13+ with jest-environment-jsdom
  jest.clearAllMocks();    // resets .mock.calls, .mock.instances, mock.results
  jest.resetModules();     // clears module registry — use only when module-level side effects leak
});
```

**Rules:**
- `cleanup()` is automatic in RTL v13+ if `@testing-library/jest-dom` is configured — include it explicitly anyway for clarity
- `jest.clearAllMocks()` after every test — prevents call-count bleedover
- Never use `jest.resetAllMocks()` (resets implementations) unless the test explicitly tests a mock's default behaviour
- Redux store: create a fresh store per test using `configureStore()` — never share a store instance

## Hybris OCC / CIF integration tests

```typescript
// Correct — use TEST_TOKEN placeholder, never a real session token
const mockOccClient = {
  getCart: jest.fn().mockResolvedValue({ entries: [], totalPrice: { value: 0 } }),
  addEntry: jest.fn().mockResolvedValue({ statusCode: 200 }),
};

beforeEach(() => {
  // Re-assign fresh mock for each test
  mockOccClient.getCart.mockResolvedValue({ entries: [], totalPrice: { value: 0 } });
});

afterEach(() => {
  jest.clearAllMocks();
});
```

**Hard rules:**
- `TEST_TOKEN` is the ONLY acceptable OCC session token in tests — never a real PAT or real session ID
- Never call a live OCC endpoint from a unit or integration test
- Never import `hybris/config/*.properties` or derive tokens from it
- If a test requires a real Hybris session to verify a flow end-to-end, that is an E2E test — run it in the QA environment, not in CI unit test suite

## Coveo / Discover search tests

```typescript
import { executeSearch } from '@coveo/headless';

jest.mock('@coveo/headless');

beforeEach(() => {
  (executeSearch as jest.Mock).mockReturnValue({
    results: [],
    totalCount: 0,
    queryExecutionTime: 0
  });
});

afterEach(() => {
  jest.clearAllMocks();
});
```

**Hard rules:**
- Never call the live Coveo index from a unit test — mock `executeSearch()` and `buildSearchEngine()` return values
- Field mapping assertions must use the field names from the Coveo schema document, not hardcoded strings — reference the schema constant from `coveo-field-mapping.ts`

## G-Q3 violation detection

Flag the following as violations when reviewing test code:

| Pattern | Violation |
|---------|-----------|
| `fetch('https://*.commercecloud.salesforce.com/...')` in a test | Real OCC call — G-Q3 |
| `import token from '../config/hybris.config'` | Credential reference — G-Q3 + G-S1 |
| `coveo.buildSearchEngine({ accessToken: '...' })` with a real token | Real Coveo call — G-Q3 |
| `new ResourceResolver()` without AemContext | JCR leak — causes test pollution |
| `sharedStore` across multiple `it()` blocks | Redux state leak — G-Q3 |

Output: `G-Q3 VIOLATION -- <file>:<line> -- <reason> -- <fix>`
