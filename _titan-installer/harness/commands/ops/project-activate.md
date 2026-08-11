# /ops/project-activate -- Set Active Project for This Session

Set which business initiative (project) is active for this Claude Code session. When a project is active, `/roles/pr-create` will stamp the project ID into PR descriptions, enabling cross-repo traceability.

## Step 1 -- List available projects

Read `.claude-projects/registry.json` from the workspace root. List all projects with status `active`:

```
ID                    | Name                    | Owner                                                                 | Tickets
PROJ-Q2-CHECKOUT      | Q2 Checkout Redesign    | the owner for this area (see the Titan session header; `?gov <path>` for a specific file) | SHOPPURCH-12849, SHOPPURCH-12850, TICKET-4421
```

If no `registry.json` exists, output:

```
No project registry found at .claude-projects/registry.json.
Run: mkdir -p .claude-projects && echo '{"_schema_version":"1.0","projects":[]}' > .claude-projects/registry.json
Then add your projects and run /ops/project-activate again.
```

If the file exists but has no active projects, say so and suggest checking status field.

## Step 2 -- Resolve project

Accept project selection by:
- Exact ID (e.g. `PROJ-Q2-CHECKOUT`)
- Name fragment (e.g. `checkout` matches "Q2 Checkout Redesign", case-insensitive)
- If only one active project exists, suggest it; confirm before activating.

Confirm full details before activating:

```
Project to activate:
  ID          : PROJ-Q2-CHECKOUT
  Name        : Q2 Checkout Redesign
  Status      : active
  Owner       : the owner for this area (see the Titan session header; `?gov <path>` for a specific file)
  Tickets     : SHOPPURCH-12849, SHOPPURCH-12850, TICKET-4421
  Repos       : <repo ids from config.repos[]>
  Description : Minimum order quantity, session expiry, payment flow redesign.
Confirm? [y/N]
```

## Step 3 -- Output activation commands

Output the exact shell command the user must run to write `current.json`. **Do NOT write the file yourself** — output it for the user to run in their terminal.

Substitute the real `project_id` and the current timestamp (`YYYY-MM-DDTHH:MM:SSZ`).

```bash
# Git Bash / Mac / Linux:
mkdir -p .claude/projects && echo '{"project_id":"PROJ-Q2-CHECKOUT","activated_at":"2026-05-07T14:00:00Z"}' > .claude/projects/current.json

# PowerShell:
New-Item -ItemType Directory -Force .claude\projects | Out-Null
'{"project_id":"PROJ-Q2-CHECKOUT","activated_at":"2026-05-07T14:00:00Z"}' | Set-Content .claude\projects\current.json
```

For **parallel Claude Code agent sessions** (multiple instances running simultaneously on the same machine), use an env var instead — agents share the filesystem and would overwrite each other's `current.json`:

```bash
# Git Bash / Mac / Linux:
export CLAUDE_PROJECT=PROJ-Q2-CHECKOUT

# PowerShell:
$env:CLAUDE_PROJECT = "PROJ-Q2-CHECKOUT"
```

The env var takes priority over `current.json` when both are present.

## Step 4 -- Show activation summary

After the user confirms they have run the command, show the activation card:

```
Active project  : PROJ-Q2-CHECKOUT
Display name    : Q2 Checkout Redesign
Tickets in scope: SHOPPURCH-12849, SHOPPURCH-12850, TICKET-4421
Session context : .claude/projects/current.json  (gitignored, this machine only)
PR stamp ready  : "Project: PROJ-Q2-CHECKOUT" will appear in your next /roles/pr-create output
```

## Notes

- `current.json` is gitignored — it is local to this machine and this session only.
- To deactivate: delete `.claude/projects/current.json` or unset `CLAUDE_PROJECT`.
- To switch projects: re-run `/ops/project-activate` and run the new shell command.
- To add a new project: edit `.claude-projects/registry.json` (committed, shared with team).
