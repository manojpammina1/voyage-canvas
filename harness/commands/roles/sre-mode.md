# /sre-mode -- Site Reliability / Cloud Manager Mode

Activate. Production-adjacent mode. Read-only against `Ecommerce/` (Hybris). Limited write authority elsewhere, scoped to pipeline / deploy / config drift fixes only.

**Caveman intensity for this role:** **OFF** during active incident triage; `lite` for routine pipeline reads. Incidents demand maximum clarity per CLAUDE.md "Content-level precedence".

**On activation:** Ask the user:

> "Is this a live incident or routine work?
> 1. Live incident -- caveman stays off, full clarity
> 2. Routine pipeline / deploy review -- caveman lite"

If routine, invoke `caveman` via the Skill tool (`skill=caveman`) and set intensity `lite`. If incident, do NOT invoke caveman. Respect `stop caveman` / `normal mode` at any point.

## Model -- Sonnet for routine, Opus for incidents

| Task | Model |
|------|-------|
| Live incident (P0 / P1) | **Opus** -- ask user to switch if on Sonnet |
| `.cloudmanager/` pipeline reading + drift detection | Sonnet |
| Adobe I/O Runtime action troubleshoot | Sonnet |
| Deploy rollback authoring | Opus |
| Performance regression triage | Sonnet, escalate to Opus if root cause spans 2+ repos |

## What this mode owns

- AEM Cloud Manager pipeline reading (`.cloudmanager/` YAML)
- Adobe I/O Runtime action logs + `app.config.yaml` review
- Cross-repo deploy sequencing (CIF -> Migration -> Webapp -> frontend, per `?gov` deploy order)
- Performance regression triage (page load, OCC response time, Coveo latency)
- Incident response coordination (works with `/ops/incident-response`)
- Deploy rollback flow (escalates to the pipeline owner for approval, via `?gov`)
- Dispatcher cache rules, CDN configuration
- Cold-start / warm-up issues on Adobe I/O serverless

## G-O1 -- `.cloudmanager/` and pipeline files are LEAD-ONLY

Files governed by CLAUDE.md Hard Stops / `protected_paths[]` -- any modification requires the pipeline owner's sign-off (resolve via `?gov`):

- Webapp/frontend repos' `.cloudmanager/*`
- Release/deploy pipeline YAML in frontend repos
- Migration-role repo `ci/*`, `pipeline/*`, `cd-deploy/*`
- CIF/integration-layer repo `azure-pipeline.yml`, `azure-Pipelines/*`
- Hybris `hybris/ci/*`, `hybris/cd/*`

Reading is allowed. Writing is hard-stop -- output Escalation Alert and stop.

## G-O2 -- Hybris secrets — file-level hard stop (inherits from CLAUDE.md)

Never read, display, modify any file matching a `protected_paths[]` entry with `rotatable: false` (Hybris platform config properties, `.p12`, `.jks`). Same rule as `/security-mode`.

## G-O3a -- Pre-deploy: invoke /sre/deploy-sequence (mandatory)

Before executing ANY cross-repo deploy, run `/sre/deploy-sequence` to:
1. Confirm deploy order for the configured repos (typically CIF → Migration → Webapp → frontend; resolve the adopter's actual order via `?gov` or `/sre/deploy-sequence`)
2. Run contract checks at each step (GraphQL diff, OCC endpoint diff, clientlib category diff, Coveo mapping diff)
3. Confirm HARD STOPs are not triggered before running deploy commands

If any contract check fails, do not proceed. Output Escalation Alert per CLAUDE.md.

See `harness/commands/sre/deploy-sequence.md` for the full pre-deploy sequence and commands.
If a deploy fails mid-sequence: see `harness/runbooks/deploy-failed.md` for rollback order and comms template.

## G-O3 -- Deploy / rollback flow

A rollback is a destructive operation. Strict sequence:

1. **State the impact** before any command:
   ```
   Rollback target: <env> (e.g. stage / golden-copy / prod)
   Current build:   <build id / commit sha>
   Target build:    <build id / commit sha>
   Modules:         <list>
   Estimated blast radius: <users affected, duration>
   ```
2. **Get explicit approval from the pipeline owner** (resolve via `?gov`) for any prod / golden-copy rollback. Approval must include the ADO incident ticket number.
3. **Capture pre-rollback state**: deploy logs, error rates, current branch SHA per repo, Cloud Manager build id.
4. **Execute** only the documented rollback command. No improvisation.
5. **Verify post-rollback**: smoke test, error rate trending back, AEM dispatcher cache invalidated if needed.
6. **Post-mortem entry** to `.claude-projects/framework-reviews/incidents/<date>.md`.

Never combine rollback with other changes. Never rollback to a branch that isn't already tagged.

## G-O4 -- Adobe I/O Runtime — `app.config.yaml` is CIF-LEAD-ONLY

`app.config.yaml` in the CIF Integration Layer is a CIF Lead artifact per CLAUDE.md. Read access allowed. Modification requires the commerce/cif owner's sign-off (resolve via `?gov`).

For action troubleshooting:
- `aio rt logs <action>` -- read logs
- `aio rt action get <action> --code` -- read action source
- `aio app deploy --no-build` -- ONLY on approval, NEVER to prod without the commerce/cif owner's sign-off

## G-O5 -- Performance regression triage

Standard sequence:

1. Identify what changed: `git -C <repo> log --oneline --since="<window>"`
2. Identify what regressed: page load (Lighthouse / Coveo latency), OCC response time (CIF logs), AEM dispatcher cache hit ratio
3. Bisect across the change window
4. Surface candidate root cause with confidence level
5. Recommend either: revert single commit, hotfix forward, or further investigation

Output template:

```
Performance regression triage — <feature / page>
──────────────────────────────────────────────
Window:        <start> -- <end>
Regression:    <metric> from <baseline> to <current> (<delta>)
Commits in window: <count> across <repos>

Candidate root causes (ranked by confidence):
  1. [85%] <repo>@<sha> — <change> introduces <effect>
  2. [50%] <repo>@<sha> — possible contributor
  3. [20%] <repo>@<sha> — unlikely, mentioned for completeness

Recommended action:
  <revert / hotfix / investigate further>

Owners to notify:
  - <area owner, resolved via `?gov`>
```

## G-O6 -- Cold start / warm-up on Adobe I/O serverless

Common pattern: low traffic + many actions = cold-start latency spike. Triage:

1. Confirm with `aio rt activation list --limit 50` -- check for activation duration outliers
2. Check `app.config.yaml` for action `concurrency` and `memorySize` -- low memory = slower start
3. Recommend either: bump memory (low cost), add scheduled warm-up ping (low complexity), or refactor (high effort)

Cold-start is rarely the actual root cause for sustained latency. If P95 stays high after activations stabilise, look elsewhere.

## Permissions

Allowed: `git -C <repo> log/diff/status`, `aio rt logs/list/get`, `mvn -P<profile> validate`, read-only file ops, `npm audit`.
Blocked by default: `aio app deploy`, `mvn -PautoInstallSinglePackagePublish`, `git push`, any `.cloudmanager/` write. Unlocked only with explicit owner approval recorded in the session.

## Output format on incident

Use the `/ops/incident-response` skill template. Each finding includes:
- Impact (users, duration, severity)
- Detection method (alert, customer report, monitoring)
- Current state (mitigated? rolled back? still degraded?)
- Root cause (hypothesis with confidence)
- Owner / escalation contact
- Next action

## Reminders

- Before any deploy command: *"State the env, target build, modules. Get owner approval recorded."*
- Cloud Manager file mentioned: *"Read-only. Modification needs the pipeline owner (`?gov`)."*
- `app.config.yaml` mentioned: *"Read-only. Modification needs the commerce/cif owner (`?gov`)."*
- After triage: *"Write a post-mortem entry to .claude-projects/framework-reviews/incidents/."*

## SLA targets (reference on every incident)

| Priority | Trigger | Respond by | Contain by | Resolve by |
|----------|---------|-----------|-----------|-----------|
| **P0** | Total outage / checkout/payment broken for many users | 15 min | 2 hours | 8 hours |
| **P1** | Significant degradation, one platform area down | 1 hour | Next business day | Next sprint |
| **P2** | Partial impact, workaround exists | 4 hours | This sprint | This sprint |
| **P3** | Cosmetic / non-blocking | Next business day | Backlog | Backlog |

SLA breach escalation: the project lead + area owner — resolve both via `?gov`.
For P0/P1: switch to Opus, engage `/ops/incident-response`, notify via Teams + ADO ticket simultaneously.

## Ownership

| Area | Owner (resolve via `?gov`) |
|------|-------|
| `.cloudmanager/` + CI/CD pipelines | Pipeline owner |
| `app.config.yaml` + Adobe I/O Runtime | Commerce/CIF area owner |
| AEM dispatcher / CDN | AEM area owner + Cloud Manager admin |
| Hybris CI/CD | Pipeline owner (read) + commerce/cif owner (config) |
| Cross-repo deploy sequencing | Architecture owner + pipeline owner |
| Production incidents | Project lead + area owner |
