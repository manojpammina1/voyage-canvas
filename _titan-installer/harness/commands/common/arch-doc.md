# /arch-doc — Architecture Document Writer

Produce two structured architecture documents for a new feature or module: a **Boundary Document** (system context, external interfaces, data contracts) and a **Building Blocks Document** (internal decomposition, component responsibilities, key data flows). Invoke from within `/arch-mode` after a design decision is made.

Output is Markdown — commit to `docs/arch/<feature-name>/` in the affected repo. These documents are the primary reference for offshore developers implementing the feature.

---

## Step 1 — Gather feature context

Ask the user for:
1. Feature name and ticket (per `config.platforms.issue_tracker`)
2. Repos involved — offer the list from `config.repos[]`, do not assume names
3. New modules being created — resolve the type vocabulary from the relevant `config.repos[].kind` (e.g. `aem-maven` repos use ui.apps / ui.frontend / ui.config / ui.core / ui.content; `node-lerna` repos use package names)
4. External systems this feature calls or is called by (cross-reference `config.contracts[]`)
5. New or changed fields/endpoints against any contract in `config.contracts[]` (GraphQL, REST/OCC-style, PIM, or whatever this stack defines)
6. React components to build and their state-management shape (if `config.stack.frontend.react`)
7. Backend services to build (OSGi if `config.stack.aem.enabled`, otherwise the stack's own service pattern)
8. Any existing modules being extended (not created fresh)

If a ticket is provided and the tracker MCP is connected, fetch the story description and acceptance criteria to pre-fill the "What this feature does" section.

---

## Step 2 — Write the Boundary Document

Write `docs/arch/<feature-slug>/boundary.md`:

```markdown
# Boundary Document — <Feature Name>

**Ticket:** <link>
**Date:** <YYYY-MM-DD>
**Status:** DRAFT
**Author:** <architect, resolved from config.roles.definitions.architect.holders / contacts.people — do not hardcode a name>
**Repos:** <list, from config.repos[]>

---

## What this feature does
<2–4 sentences from the user's perspective. What can the end user (resolve the persona from the project's own domain — do not assume dental/healthcare unless config.org / docs say so) do that they could not do before?>

## System context diagram

```
[Client]
    │
    │ (renders via the frontend framework in config.stack.frontend)
    ▼
[<frontend repo, from config.repos[]>]
    │
    │ (query/call shape per config.stack.cif / config.stack.commerce)
    ▼
[<integration layer repo, if config.stack.cif.enabled>]   ──── resolves ────▶  [<commerce platform, config.stack.commerce.platform>]
    │                                                          │
    │ (if PIM data needed, config contracts with owner_repo = pim)            │
    ▼                                                          ▼
[<PIM-owning repo>]                                      [<commerce backend>]
```

*(Update this diagram to match the actual data flow for this feature and this stack. Remove unused rows — e.g. drop the CIF/PIM rows entirely if `config.stack.cif.enabled` / a PIM contract is absent.)*

## External interfaces

### Interfaces this feature CALLS

| System | Interface | Type | Fields used / params | Owner (resolve from config.contracts[].owners) |
|--------|-----------|------|----------------------|-------|
| <commerce platform> | `<endpoint>` | REST | `field1`, `field2` | *(resolve)* |
| <integration layer> | `<QueryName>` | GraphQL | `field1`, `field2` | *(resolve)* |
| PIM | `<pim-field>` | adapter | `<field>` | *(resolve)* |
| Search platform | `<index-field>` | search | `<field>` | *(resolve)* |

### Interfaces that CALL this feature

| Caller | How it calls | What it expects |
|--------|-------------|-----------------|
| CMS/authoring surface (if applicable) | component dialog / config | `<dialog fields>` |
| Analytics | data layer event | `<event shape>` |

## Data contracts

### New or changed contract fields

For each `config.contracts[]` entry touched by this feature:

| Field | Type | Nullable | Breaking change? | Sign-off (`contracts[].owners`) |
|-------|------|----------|-----------------|---------|
| `<type>.<field>` | String | Yes | No (additive) | N/A |

## Security boundary

| Concern | How it is addressed |
|---------|-------------------|
| Authentication | <session/token mechanism for this stack> |
| Authorisation | Role check enforced server-side, not client-side |
| Data sensitivity | Contains PII / payment data / regulated data: Yes / No |
| CSRF | <framework's CSRF mechanism, if applicable> |

## Authoring / runtime boundary (only if `config.stack.aem.enabled`)

| Aspect | Author | Publish |
|--------|--------|---------|
| Component visible | Yes — with placeholder if no content | Yes — full render |
| Dialog fields | `<list>` | N/A |
| Clientlib category | `<category>` | Same |
| Required authored content | `<list of required properties>` | — |

## What is NOT in scope
<List explicitly what this feature does not handle, to prevent scope creep in offshore implementation.>
```

---

## Step 3 — Write the Building Blocks Document

Write `docs/arch/<feature-slug>/building-blocks.md`:

```markdown
# Building Blocks — <Feature Name>

**Ticket:** <link>
**Date:** <YYYY-MM-DD>
**Status:** DRAFT
**Author:** <architect, resolved from config — do not hardcode a name>

---

## Module structure

Resolve module types from the relevant `config.repos[].kind`. For an `aem-maven` repo:

| Module | Repo | Type | Responsibility |
|--------|------|------|---------------|
| `<module-name>-ui.apps` | <repo id> | authoring content | Templates, component definition, dialog |
| `<module-name>-ui.frontend` | <repo id> | React / stylesheet | React components, state, styles |
| `<module-name>-ui.config` | <repo id> | runtime config | Environment-specific config |
| `<module-name>-ui.core` | <repo id> | backend service | Service implementations |

For a `node-lerna` or other repo kind, list the actual packages/modules instead — do not force the four-module AEM shape onto a non-AEM repo.

## React component hierarchy (if `config.stack.frontend.react`)

```
<FeatureRoot>             ← connected to app state, fetches data on mount
  ├── <FeatureHeader>     ← presentational, receives props
  ├── <FeatureBody>       ← presentational
  │     └── <FeatureItem> ← map over list, key = item.id
  └── <FeatureFooter>     ← presentational, dispatches actions
```

*(Replace with actual component tree. Mark connected components with ← connected to app state)*

## State shape

```typescript
// New slice/module: <featureName>
interface <FeatureName>State {
  items: <ItemType>[];
  status: 'idle' | 'loading' | 'succeeded' | 'failed';
  error: string | null;
}

// Actions dispatched by this feature:
// fetch<FeatureName>()  — triggers the async flow
// set<FeatureName>Items(items: <ItemType>[])
// clear<FeatureName>()  — dispatched on logout
```

**Pattern in this repo:** resolve from `config.stack.frontend.redux_patterns[]` (sagas / slices / thunks, or another pattern this stack uses) — match the existing pattern in the module, do not introduce a new one.

**Logout reset:** The `clear<FeatureName>()` action (or equivalent) must be dispatched from the logout flow.

## Backend services

| Service interface | Implementation | Responsibility | Injects |
|-------------------|---------------|---------------|---------|
| `<IService>` | `<ServiceImpl>` | <what it does> | `<dependency>` |

## Integration-layer resolver chain (only if `config.stack.cif.enabled` and this feature touches it)

```
Query: <QueryName>
  └── <ResolverName>
        └── calls commerce backend: <endpoint>
              └── transforms response → schema type
```

## Key data flow

User action → to final state:

```
1. User clicks <action>
2. Frontend dispatches <actionCreator>()
3. Async handler intercepts, calls the backend via the configured integration path
4. Backend responds with <ResponseShape>
5. Handler maps to state: <StateShape>
6. UI re-renders <Component> with new props
7. On error: dispatches setError(message), shows <ErrorComponent>
8. On logout: dispatches clear<FeatureName>() — state reset
```

## Component structure (only if `config.stack.aem.enabled`)

```
<component-name>/
  ├── <component-name>.html        ← template (renders the frontend root)
  ├── _cq_dialog/
  │     └── .content.xml          ← Author dialog definition
  ├── _cq_editConfig.xml          ← Author edit behaviour
  └── .content.xml                 ← Component definition (group, title)
```

## Files to create — offshore implementation checklist

Generate this section from the actual module structure resolved in Step 1 / "Module structure" above — do not paste a fixed AEM+Java tree if the target repo is `node-lerna` or another kind. Example shape for an `aem-maven` repo:

```
<module>-ui.apps/src/main/content/jcr_root/apps/<path>/
  components/<component-name>/
    <component-name>.html
    _cq_dialog/.content.xml
    _cq_editConfig.xml
    .content.xml

<module>-ui.frontend/src/main/webpack/app/react/
  components/<ComponentName>/
    <ComponentName>.tsx
    <ComponentName>.test.tsx        ← Required: Jest + RTL

<module>-ui.config/src/main/content/jcr_root/apps/<path>/config/
  <package>.<ServiceImpl>.cfg.json

<module>-ui.core/src/main/java/<package>/
  <IService>.java
  impl/<ServiceImpl>.java

<module>-ui.core/src/test/java/<package>/
  impl/<ServiceImplTest>.java       ← Required: JUnit 5
```

## Files NOT to touch

Generate from `config.protected_paths[]` filtered to this repo — every row must resolve to a real config entry, never an invented path:

| File / path | Reason |
|------|--------|
| *(resolve from config.protected_paths[] matching this repo)* | *(entry's `why`, owners from `owners[]`)* |
```

---

## Step 4 — Output files

Write both documents to:
```
<repo>/docs/arch/<feature-slug>/boundary.md
<repo>/docs/arch/<feature-slug>/building-blocks.md
```

If `docs/arch/<feature-slug>/` does not exist:
```bash
mkdir -p <repo>/docs/arch/<feature-slug>
```

Output:
```
Architecture documents written:
  docs/arch/<feature-slug>/boundary.md
  docs/arch/<feature-slug>/building-blocks.md

Next steps:
  1. Commit both files and include links in the PR description and offshore brief.
  2. Run /common/arch-decision if any open design choices remain.
  3. Run /dev/offshore-brief — reference building-blocks.md as the implementation guide.
```

---

## Guardrails

- Do NOT include credentials, tokens, base URLs, or environment-specific secrets in these documents.
- Mark Status as DRAFT until the architect/lead has reviewed and confirmed the design is correct.
- The "Files NOT to touch" table in building-blocks.md must always be generated from the live `config.protected_paths[]` for the repo, not a remembered or hardcoded list.
- Do not commit either document until the user confirms the content is accurate.
