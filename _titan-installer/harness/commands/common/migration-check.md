# /migration-check -- Pre-flight checklist before touching a migration-phase repo

This skill applies to any repo in `config.repos[]` whose `module_naming[]` lists more than one naming prefix — the signal that the repo is mid-migration between phases (e.g. a legacy-integration naming convention, an intermediate one, and a target-state one). Such repos typically contain live commerce/OCC integration code, PIM interfaces, and CI/CD pipeline definitions, and carry the highest risk of any repo in the workspace.

If the current repo has only one naming convention in `config.repos[].module_naming[]`, this skill does not apply — say so and point to `/common/aem-build` or the repo's own build docs instead.

---

## STOP -- Immediate escalation required for these modules

Output the **Escalation Alert** from `CLAUDE.md` AND notify the relevant team before writing a single line of code. Resolve the table below from `config.protected_paths[]` (filter to entries whose glob matches this repo) rather than a hardcoded list — every entry's `owners[]` resolves to real names via `config.contacts.people`:

| Module (from `protected_paths[].globs`) | Contact (`protected_paths[].owners` → `contacts.people`) | Reason (`protected_paths[].why`) |
|--------|---------|--------|
| *(resolve at runtime — do not hardcode)* | *(resolve at runtime)* | *(resolve at runtime)* |

Use `?gov <path>` or the Titan session header to look up any specific module before assuming it is safe.

---

## Understanding the repo's naming conventions

Read `config.repos[].module_naming[]` for this repo — each entry names one migration-phase prefix. Where `config.repos[].risk_notes[]` annotates a prefix's risk level (e.g. "most coupled to the legacy platform" vs. "aligned with target architecture"), surface that note verbatim rather than inventing a risk ranking.

**Never move code across naming conventions without lead/architect approval** (`config.roles.definitions.architect` / `.lead`).

---

## Safe-change checklist

### Before coding
- [ ] Identify the naming convention of the module (`config.repos[].module_naming[]`)
- [ ] Confirm your change stays within one naming convention
- [ ] Read the module's `pom.xml` (or equivalent manifest) to understand dependencies
- [ ] Check whether the module path matches any `config.protected_paths[]` glob — if so, stop and follow the escalation above before proceeding

### While coding
- [ ] OSGi annotations correct (`@Component`, `@Service`, `@Reference`) — if `config.stack.aem.enabled`
- [ ] New services have unit tests in `src/test/java`
- [ ] No hardcoded integration-platform endpoint URLs (OCC or equivalent, per `config.stack.commerce`)
- [ ] No credentials or environment URLs in code
- [ ] Frontend changes use the stylesheet convention documented for this naming prefix in `config.stack.frontend.stylesheets[]` / repo risk notes — do not assume without checking

### Before submitting
- [ ] The repo's documented build command passes (see `/common/aem-build` or `?build`)
- [ ] Tests pass for the specific module changed
- [ ] No pipeline files modified (paths tagged CI/CD in `config.protected_paths[]`)

---

## Module directory reference

Do not hardcode a directory tree — list the actual module directories under `config.repos[].dir` for this repo via `ls`/`Glob`, and annotate each one against `config.protected_paths[]`:

```
<repo.dir>/
+-- <module>/     <- flag HARD STOP if it matches a protected_paths[] glob with enforcement.hard_stop: true
+-- <module>/     <- flag ESCALATE if it matches a protected_paths[] glob without hard_stop
+-- <module>/     <- otherwise unflagged
```
