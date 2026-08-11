# /aem-build -- Get the correct build command for the current module

> **Fast path: type `?build` (optionally `?build <module>`) as your prompt** — answered locally by the answer-cache hook from `data/build-map.json`, zero tokens. Use this skill only when the fast path misses. `build-map.json` is keyed by `config.repos[].id` — keep it in sync with `config.repos[]` (super role / governance owner).

This skill only applies where `config.stack.aem.enabled` is true. If the active config has no AEM repos, say so and stop — do not improvise Maven commands for a non-AEM stack.

## Step 1 -- Identify which repo you are in

Resolve from `config.repos[]` (filter to entries whose `role_in_stack[]` includes `aem`):

| Repo id | Root path | Kind |
|------|-----------|------|
| `<repo.id>` | `<repo.dir>` | `<repo.kind>` |

Match the current working directory against `repo.dir` for each AEM-tagged repo. If more than one repo matches, ask which is intended rather than guessing.

## Step 2 -- Derive build commands from `repo.kind` and module type

### Java / OSGi core module (`*-core`, `*-impl`, or whatever the repo's `module_naming[]` marks as a core/impl suffix)

```bash
cd <repo.dir>
mvn clean install -DskipTests
mvn test -pl :<module-name>
```

### AEM package module (`*-ui.apps`, `*-ui.content`, `*-ui.config`)

```bash
cd <repo.dir>
mvn -pl :<module-name>-ui.apps package
```

### Frontend module (Webpack or Gulp, per `config.stack.frontend`)

Webpack-based module:

```bash
cd <repo.dir>/<module-name>-ui.frontend
npm ci
npm run dev
npm test
```

Shared Gulp framework module (check the module's `.nvmrc` or `package.json engines` for the required Node version before running):

```bash
nvm use <version from repo's .nvmrc>
cd <repo.dir>/<shared-frontend-module>
npm install
gulp
npm run prod
npm run pretty
```

### Partial module sets

Some feature modules intentionally ship a subset of `ui.apps` / `ui.frontend` / `ui.core` / `ui.content` (e.g. a backend-only integration has no frontend, a content-only feature has no core). Check the module's actual directory contents before assuming a full four-module set — do not create missing module types without lead/architect approval.

---

## Repos with `module_naming[]` conventions (migration-in-progress repos)

If `config.repos[].module_naming[]` lists more than one naming prefix (a sign the repo is mid-migration between conventions), build each module by its own prefix — do not assume one prefix's build command applies to another:

```bash
cd <repo.dir>
mvn clean install -DskipTests
mvn -pl :<module-under-one-naming-convention> package
```

**Hard stop before building any module flagged in `config.protected_paths[]` (e.g. Hybris/OCC integration code):** Run `/common/migration-check` first.

---

## CIF / GraphQL layer (if `config.stack.cif.enabled`)

```bash
cd <repo.dir>
yarn install
npm run lint
yarn test
npm run unit
```

**Hard stop:** Do not run `aio app deploy` (or the equivalent serverless deploy command) -- that is architect/lead territory only, per `config.roles.definitions`.

---

## What NOT to run (blocked for developers without deploy rights)

Check `config.roles.definitions.<your-role>.deploy` — if `false`, these are blocked:

- Any Maven profile that publishes/deploys to a live AEM author or publish instance
- `aio app deploy` or equivalent serverless deploy command
- Any `git push` command
- Any modification to pipeline files (see `config.protected_paths[]` entries tagged CI/CD)
