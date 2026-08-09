# /release-notes -- Release Notes Generator

Activate. Generate release notes for a sprint or release across this ecommerce workspace's repos. Produces both a technical version (for developers) and a stakeholder version (for product / business).

## Step 1 -- Gather inputs

Ask for:
1. Release label (e.g. "Sprint 42", "v2.4.0", "May release")
2. Date range OR git tag range (e.g. `--after="2026-04-28" --before="2026-05-09"`)
3. Repos to include (default: all configured repos, `config.repos[]`)
4. Project filter (optional): a project ID from `.claude-projects/registry.json` to restrict notes to commits matching that project's ticket list. Leave blank for full date-range release notes (default behaviour unchanged).

## Step 2 -- Read commits from each repo

**If no project filter was given** (default), query by date range for each configured repo:

```bash
git -C <repo-dir> log --oneline --after="YYYY-MM-DD" --before="YYYY-MM-DD" --no-merges
```

**If a project filter was given**, replace the date-range queries with per-ticket grep queries. Read the ticket list from `.claude-projects/registry.json` for the given project ID, then for each repo:

```bash
git -C "<repo>" log --oneline --no-merges --all --regexp-ignore-case \
  --grep="TICKET-A" --grep="TICKET-B"
```

Deduplicate commits by SHA (a commit matching multiple tickets should appear once). Then categorise as normal (Step 3 is unchanged). Add to the summary header:

```
Project filter : PROJ-Q2-CHECKOUT  (18 of 34 total commits matched)
```

Workspace root has no .git -- always use `git -C <repo-path>`.

## Step 3 -- Categorise commits

| Category | Match patterns |
|----------|---------------|
| Features | `feat:`, `add `, `implement`, `new `, `[TICKET-*]` prefix with new behaviour |
| Bug fixes | `fix:`, `bug:`, `hotfix`, `resolve`, `patch` |
| Performance | `perf:`, `optimise`, `cache`, `speed` |
| Infrastructure | `chore:`, `ci:`, `build:`, `tooling`, `upgrade`, `bump`, `deps:` |
| Security | `security:`, `cve`, `vulnerability`, `credential` |

**Exclude always:**
- Merge commits (`Merge branch`, `Merge pull request`)
- WIP commits (`WIP`, `wip:`, `DO NOT MERGE`)
- Formatting-only (`prettier`, `lint fix`, `whitespace`)
- Version bumps with no behaviour change

## Step 4 -- Guardrails before writing

- Do NOT include commit messages that reference credentials, PHI, internal system tokens, or customer data
- Do NOT expose Azure DevOps ticket titles that contain regulated customer/patient data
- Flag any commit that looks like a P1 hotfix -- stakeholders may need a separate incident communication
- If a commit touches a `protected_paths[]` entry (e.g. integration system-token directory, `app.config.yaml`), omit the detail and note "Security update"

## Step 5 -- Generate two outputs

### Technical release notes (developers, PR descriptions, Azure DevOps wiki)

```markdown
## [Release label] -- YYYY-MM-DD

### Features
- [TICKET-1234] Cart minimum order quantity enforcement — <frontend-repo>
- [TICKET-1235] Invoice 404 handling in My Account — <webapp-repo>

### Bug fixes
- [TICKET-1240] Session expiry no longer drops cart during checkout — <cif-repo>
- [TICKET-1241] Product image fallback shown when PIM asset is missing — <frontend-repo>

### Infrastructure
- Upgraded frontend clientlib React 17 → 18 — <webapp-repo>
- CIF resolver Mocha test coverage increased to 90% — <cif-repo>

### Security
- Dependency update (details omitted)
```

### Stakeholder release notes (product owner, business stakeholders, email)

```markdown
## Release [label] -- YYYY-MM-DD

### What's new
- Customers now see minimum order quantities before checking out,
  preventing rejected orders from Hybris.
- My Account shows a clear message when an invoice PDF is not yet available.

### What's fixed
- Customers no longer lose their cart if they are inactive during checkout.
- Products with missing images now display a fallback image instead of a broken icon.

### Under the hood
- Performance and reliability improvements. No changes to user-facing features.
```

## Output

Produce both versions. If only one is needed, ask which.

Summarise at the top:
```
Release  : [label]
Period   : YYYY-MM-DD to YYYY-MM-DD
Repos    : [which repos had changes]
Commits  : [total count]
Features : N  |  Fixes : N  |  Infra : N  |  Security : N
```
