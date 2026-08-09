# /offshore-brief -- Offshore Developer Task Brief

Activate. Create a scoped task brief for an offshore developer. The brief contains only what they need to start coding -- no architectural context, no sensitive system details, no access to hard-stop files.

**Caveman intensity for this sub-context:** `lite`. The brief itself is read by a mid-level developer who needs clarity. Lite is the cap — never go higher. Acronyms (AEM, OCC, CIF, PIM) are always defined on first use regardless of intensity per CLAUDE.md content-level precedence.

**On activation (auto-engage caveman):** Immediately invoke the `caveman` skill via the Skill tool (`skill=caveman`), then ensure intensity is `lite` (`/caveman lite` if needed). **NEVER use `full` or `ultra` in this mode even if user asks** — the brief is read by a mid-level developer who needs clarity. If user requests higher intensity, refuse and remain at lite. Respect `stop caveman` if user issues it.

## Step 1 -- Gather task details

Ask for:
1. Feature name and ADO ticket number
2. Repo and module to work in
3. Files they should change
4. Files they must NOT touch (if any not already covered by hard stops)

### Step 1a -- Auto-populate from Jira (if MCP available)

If the Jira MCP server is connected (tools with `jira_` prefix are present):

1. Fetch the ticket using the provided ADO ticket number:
   - Title / summary
   - Description
   - Acceptance criteria
   - Story points and sprint
   - Comments (last 3, for context)

2. Pre-fill the brief:
   - **"What to build"** section: use the Jira description, condensed to 2-4 sentences
   - **Definition of done**: convert Jira acceptance criteria to checked items
   - **Estimated effort**: derive from story points (1-3 → S, 4-8 → M, 9-13 → L, 14+ → XL)

3. Present the pre-filled draft to the user and ask them to confirm or correct before writing the final brief.

4. If Jira MCP is unavailable or the ticket is not found, continue with manual input — ask the user for description and acceptance criteria directly.

## Step 2 -- Scan for hard stops

Check every file in scope against the CLAUDE.md Hard Stops section (or `?gov <path>` if unsure). For each hard-stop file found:
- Remove it from the "Files to change" list
- Add it to "Files not to touch" with reason: "Project lead approval required before modifying"
- Note in the brief that this must be escalated before coding begins

## Step 3 -- Write the brief

```
Task: [TICKET-123] -- [Feature name]
Repo: [repo name]
Branch: [branch name to create / work in]
Estimated effort: S (1-2 days) / M (3-5 days) / L (6-10 days)

---

## What to build
[2-4 sentences from the user's perspective. What should the feature do?
No implementation detail. No mention of internal systems beyond what the dev needs.]

## Files to change
| File | What to do |
|------|-----------|
| path/to/file.tsx | Add component / Modify handler / Implement reducer |

## Files NOT to touch
| File | Reason |
|------|--------|
| path/to/restricted | Project lead approval required before modifying |
| .cloudmanager/* | Escalate to the pipeline owner for this area -- see `?gov .cloudmanager/` |

## Conventions for this task
[Paste the relevant /check-conventions section for the repo:
module naming, React pattern (HOC or hooks), stylesheet rule (LESS or SCSS),
Redux pattern (sagas/slices/thunks -- match the file).]

## Definition of done
- [ ] Feature works as described above
- [ ] Unit tests written for new logic
- [ ] Build passes: [exact command]
- [ ] Tests pass: [exact command]
- [ ] No credentials, PHI, or options.json committed
- [ ] PR description includes ticket number and project lead assigned as reviewer

## Escalate before coding (do not start these without sign-off)
[List scope items requiring sign-off. Example: "GraphQL field change requires the contract owner's sign-off first -- resolve with `?gov`."]
If nothing: "None -- proceed."
```

## Guardrails

- Never include: platform credentials, OCC base URLs, system token values, `app.config.yaml` contents
- Never brief a hard-stop module without project lead approval already obtained and recorded
- Keep scope tight -- ambiguity leads to governance violations offshore
- All offshore PRs require project lead review before merge; state this explicitly in every brief
