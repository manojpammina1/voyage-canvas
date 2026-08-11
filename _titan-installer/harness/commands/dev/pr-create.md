# /pr-create -- PR Creation Mode

Activate. Prepare an Azure DevOps PR description from the current branch. **Output text only -- no git push, no branch creation. User copies to ADO manually.**

**Caveman intensity for this sub-context:** `lite`. PR descriptions go directly to human reviewers in ADO — clarity must beat compression. The PR Summary, Changes, Test plan, and Risk sections stay readable. Skill-internal narrative (status updates while assembling the PR) may be compressed.

**On activation (auto-engage caveman):** Immediately invoke the `caveman` skill via the Skill tool (`skill=caveman`), then ensure intensity is `lite` (`/caveman lite` if needed). The PR body (Summary, Changes, Test plan, Risk, Dependencies, Checklist sections) must remain readable for human reviewers — caveman compresses only Claude's internal narrative, NOT the PR body content. Respect `stop caveman` if user issues it.

## Step 1 -- Read the branch

Ask for the source and target branches if not already known. Then:

```bash
git -C <repo-path> fetch origin <source-branch> <target-branch>
git -C <repo-path> log origin/<target>..origin/<source> --oneline
git -C <repo-path> diff origin/<target>...origin/<source> --name-only
```

Workspace root has no .git -- always use `git -C <repo-path>`.

Local paths for each configured repo are `<workspace>/<config.repos[].dir>`. Resolve the active repo list with `?gov repos` or the Titan session header.

## Step 1a -- Validate branch name and extract project

Parse the source branch name against the required format:

```
<type>/PROJ-<ID>/<TICKET>-<short-desc>
```

| Outcome | Action |
|---------|--------|
| Branch matches format | Extract `PROJ-<ID>` as the **branch project ID** and `<TICKET>` as the ticket number. Use these in Step 3 and Step 3a. |
| Branch has no `PROJ-` segment | Add `[BRANCH-NAME] WARNING` to the PR description. Suggest the corrected branch name. Do not block. |
| Branch is `develop`, `main`, `release/*` | Skip validation — these are integration branches. |

**Branch project ID priority** (used in Step 3a if no env var or `current.json` exists):

```
CLAUDE_PROJECT env var  →  current.json  →  branch name PROJ-<ID>  →  none
```

This means developers do not need to run `/ops/project-activate` if their branch already encodes the project — the PR tool extracts it automatically.

**Flag in PR description when branch name is non-conforming:**

```
⚠ Branch naming: 'feature/SHOPPURCH-12849-cart-min' does not follow the project convention.
  Suggested rename: git branch -m feature/SHOPPURCH-12849-cart-min feature/PROJ-Q2-CHECKOUT/SHOPPURCH-12849-cart-min
```

## Step 2 -- Pre-PR checklist

Verify all items before writing the description. Hard stop if any are red.

| Check | Verify |
|-------|--------|
| `/common/check-conventions` passed | No FAIL items |
| `/common/missing-scenarios` run | All findings triaged or have tickets |
| Build passes | `mvn clean install -DskipTests` or `npm run dev` |
| Tests pass | `mvn test` or `npx jest` |
| CIF touched: `yarn test` green | Only if CIF files changed |
| Migration hybris-* touched: `mvn test` green | Only if hybris-api/impl changed |
| No credentials / PHI / `options.json` committed | Hard stop if found |
| Escalation approvals recorded | Required if any hard-stop module was changed |

## Step 3 -- Extract ticket number

Look for the configured ticket pattern (`platforms.issue_tracker.ticket_regex`, e.g. `SHOPPURCH-XXXXX`) or an ADO work item number in branch name or commit messages. Ask the user if not found.

## Step 3c -- Check for existing ADO PR (if Azure DevOps MCP available)

If the Azure DevOps MCP server is connected (tools with `azure-devops` prefix are present):

1. Search for an existing PR from the source branch in the relevant ADO project:
   - Project name matches the repo being worked in (see `config.repos[].display`)
   - Source branch matches the current branch name

2. If an existing PR is found, surface:
   - PR URL, title, current status (Active / Completed / Abandoned)
   - Reviewer assignments and their vote status (Approved / Waiting / Rejected)
   - Linked work items
   - Any active build policy results

3. If no PR exists: confirm no duplicate — proceed to write the description normally.

4. If Azure DevOps MCP is unavailable, skip and continue.

## Step 3b -- Enrich from Jira (if MCP available)

If the Jira MCP server is connected (tools with `jira_` prefix are present in the session):

1. Fetch the ticket using the extracted ID:
   - Ticket title / summary
   - Description (first 200 words)
   - Acceptance criteria (from the "Acceptance Criteria" field or description sub-section)
   - Story points
   - Current status and assignee

2. Use these to auto-populate the PR description:
   - PR **Title**: use the Jira ticket summary if shorter than 72 chars, otherwise shorten it
   - **Summary** section: seed with Jira description bullet points, then let the diff add code context
   - **Test plan** section: seed with Jira acceptance criteria as a checklist

3. If Jira MCP is unavailable or the ticket is not found, continue with existing behaviour — write the description from the diff and commit messages only. Do not error or stop.

## Step 3a -- Check for active project context

1. Read `CLAUDE_PROJECT` env var. If set, use that value as the project ID.
2. Else read `.claude/projects/current.json`. Use the `project_id` field.
3. If neither exists, skip — no project stamp will be added.
4. If a project is active: read `.claude-projects/registry.json` and verify the extracted ticket is in the project's `tickets` list. If the ticket is **not** in the list, warn:
   ```
   WARNING: Ticket SHOPPURCH-12849 is not registered under project PROJ-Q2-CHECKOUT.
   This PR may belong to a different initiative. Proceeding without project stamp.
   ```
   Only add the stamp when the ticket matches the project.

## Step 4 -- Write the PR description

Output in Azure DevOps Markdown. User copies this to ADO.

```
Title: [TICKET-123] Short imperative description (max 72 chars)

## Summary
<!-- What changed and why. 2-4 bullet points. Business reason, not just code changes. -->
<!-- Project: PROJ-Q2-CHECKOUT   ← include this line only when a project is active; omit if none -->

## Changes
<!-- File-level summary grouped by area: Frontend / Backend / Config / Tests -->

## Test plan
<!-- What was tested: unit tests, manual steps, local sandbox. -->

## Risk
<!-- What could break. Adjacent features. Hybris / CIF contract impact. -->
<!-- Write "None identified" only if truly no risk. -->

## Dependencies
<!-- PRs that must merge first. Escalation approvals (name + date). -->
<!-- Write "None" if standalone. -->

## Checklist
- [ ] Conventions audit passed (/common/check-conventions)
- [ ] Missing scenarios triaged (/common/missing-scenarios)
- [ ] Build green
- [ ] Tests green
- [ ] No credentials / PHI committed
- [ ] Project lead assigned as reviewer
- [ ] Project context active if working under a business initiative (run /ops/project-activate if needed)
```

## Reviewer table

Required reviewers are derived from `config.repos[].default_reviewers[]` and `config.repos[].extra_reviewer_rules[]` (e.g. commerce-platform modules touched, pipeline modules touched). Resolve with `?gov reviewers <repo>` or the Titan session header rather than hardcoding names here.

## Hard blocks

- Escalation was triggered but no approval ref in description -- do not raise PR
- PHI or credentials found anywhere -- escalate to the security owner for this area immediately (see `?gov`), do not raise PR
- Pipeline/deploy files modified -- add the pipeline owner as required reviewer
- Cross-repo contract files (GraphQL schema, integration config) changed -- add the contract owner as required reviewer
