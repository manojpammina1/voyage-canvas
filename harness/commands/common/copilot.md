# /copilot -- Redirect Prompt to MS Copilot Enterprise

One-click hand-off when your prompt does not need Claude. Copies your current draft prompt to the system clipboard and opens **Microsoft Copilot Enterprise** in your default browser. Paste and continue there — free per org policy.

## When to use

You see a Titan cost notice that says `Cost: $0.05 – $0.07` for a simple Q&A. You ask yourself: "Does this need Claude's code-understanding, or would a general AI assistant do?" If the latter, invoke this skill.

Per `CLAUDE.md`:
> General questions, chat, explanations, documentation lookups → **Copilot**.
> Use Microsoft Copilot Enterprise directly — do not burn Claude tokens on Q&A.

Examples that should go to Copilot, not Claude:

| Prompt | Route |
|---|---|
| "Explain how OAuth refresh tokens work" | Copilot |
| "Write a TypeScript regex for email validation" | Copilot |
| "Summarise our quarterly release branch naming convention" (from memory) | Claude (project-specific) |
| "What does the OnInit hook in Vue do?" | Copilot |
| "Review this React component for project guardrail violations" | Claude (`/dev-mode`) |
| "Plan a cross-repo refactor for the cart saga" | Claude (`/arch-mode`) |
| "What is a Sling resource resolver?" | Copilot |
| "Where is the cart-add OCC call made in this codebase?" | Claude (`/dev-mode`) |

## How to invoke

```
/common/copilot
```

Or with explicit text:

```
/common/copilot what is OAuth?
```

## What happens

1. Skill captures: explicit text if passed, OR the last user prompt in the active session (best-effort), OR clipboard contents (last fallback).
2. Copies that text to the system clipboard (Windows `clip.exe`).
3. Opens `https://copilot.microsoft.com` in the default browser.
4. You paste (Ctrl+V) inside Copilot, hit Enter, and continue there.

## Rules

- Does NOT submit anything to Anthropic / Claude.
- Does NOT send the prompt to MS Copilot directly — it just opens the browser and hands you the clipboard. You paste manually so you can review / edit before sending.
- Privacy: clipboard content stays local to your Windows session.
- Telemetry: records `_copilot_redirect` event (no prompt content) so the dashboard can show "you avoided ~$X this week".

## Implementation note (for Claude when running this skill)

1. Resolve the text to redirect (arg → last prompt → clipboard).
2. Pipe to `clip.exe` (Windows) via Bash:
   ```bash
   echo "<text>" | clip
   ```
3. Open browser:
   ```bash
   start "" "https://copilot.microsoft.com"
   ```
4. Emit telemetry event:
   ```python
   {
     "v": 1,
     "ts": "<utc-iso>",
     "tool": "_copilot_redirect",
     "role": "<active>",
     "meta": {"text_length": <int>}
   }
   ```
5. Confirm to user:
   > "Copied to clipboard. Copilot opened in your browser — paste with Ctrl+V."

## Ownership

| Area | Owner |
|---|---|
| Routing rules (what should go where) | the owner for this area (see the Titan session header; `?gov <path>` for a specific file) — refine quarterly from telemetry |
| Copilot tenancy / SSO | internal IT — Copilot Enterprise is org-provided |
| Redirect telemetry → savings dashboard | the owner for this area (see the Titan session header; `?gov <path>` for a specific file) |
