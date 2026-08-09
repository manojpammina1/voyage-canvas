# /new-module -- Scaffold a new feature module

Ask the user for the feature name if not provided (e.g., "notifications", "promotions"). Ask which repo (`config.repos[]` entry) this module belongs to if not already clear from context — use the repo's declared `module_naming` pattern and package namespace rather than a hardcoded prefix.

Then create the following directory stubs under the target repo, substituting the repo's own module-naming prefix (`<prefix>`) and Java package root (`<package-root>`) from `config.repos[]`:

```
<repo>/
+-- <prefix>-<feature>-core/
|   +-- src/
|       +-- main/java/<package-root>/<feature>/
|       +-- test/java/<package-root>/<feature>/
|
+-- <prefix>-<feature>-ui.apps/
|   +-- src/main/content/jcr_root/apps/<app-namespace>/<feature>/
|
+-- <prefix>-<feature>-ui.content/
|   +-- src/main/content/jcr_root/content/<app-namespace>/<feature>/
|
+-- <prefix>-<feature>-ui.config/
|   +-- src/main/content/jcr_root/apps/<app-namespace>/config/
|
+-- <prefix>-<feature>-ui.frontend/
    +-- src/main/webpack/app/
        +-- react/
        |   +-- views/
        |   +-- client/
        |   +-- hooks/
        |   +-- state/
        +-- assets/
```

### Checklist before completing

- [ ] Feature name uses only lowercase letters and hyphens
- [ ] `pom.xml` entries added to root -- remind the user to do this manually
- [ ] OSGi config files go in `*-ui.config`
- [ ] Frontend uses SCSS (not LESS) unless this is the shared Gulp framework
- [ ] No credentials or environment URLs hardcoded
- [ ] Remind user that CIF/Hybris connections require sign-off from the owner of that contract — resolve via `?gov <path>` / `data/reviewer-map.json`

**This scaffolding is local only.** Do NOT push or deploy without lead review per the Titan session header. Run `/common/check-conventions` after adding code.
