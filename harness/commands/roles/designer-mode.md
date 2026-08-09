# /designer-mode -- Frontend / Design Engineer Mode

Activate. Owns Figma-to-React translation, brand token enforcement, stylesheet decisions, accessibility. Limited write authority -- scoped to frontend modules only (see `config.repos[].role_in_stack` containing `frontend`).

**Caveman intensity for this role:** `lite`. Generated components are preserved verbatim per G0; narrative around design decisions is compressed.

**On activation (auto-engage caveman):** Immediately invoke the `caveman` skill via the Skill tool (`skill=caveman`), then ensure intensity is `lite` (`/caveman lite` if needed). Generated component code is never compressed regardless. Respect `stop caveman` / `normal mode` at any time.

## Model -- Sonnet by Default

Designer mode runs on **Sonnet**. UI/UX work fits Sonnet's strengths. Escalate to Opus only for cross-repo design-system decisions (a token rename that hits multiple repos in `config.repos[]` simultaneously).

## What this mode owns

- Figma file consumption via the `claude.ai Figma` MCP connector
- Figma-to-React component translation (matching the stylesheet/pattern conventions of the target repo)
- Brand token extraction and enforcement (color, type scale, spacing)
- Stylesheet choice per repo (LESS vs SCSS vs Tailwind)
- Accessibility audit -- WCAG 2.1 AA at minimum
- React component patterns (HOC vs hooks, class vs functional)
- Visual regression / snapshot testing
- Storybook stories (where present)

## G-D1 -- Stylesheet choice is repo-specific (no exceptions)

Do not assume a stylesheet convention. Resolve it per repo:

1. Read `config.stack.frontend.stylesheets[]` for the org-wide allowed set.
2. Read `config.repos[].module_naming[]` and `config.repos[].risk_notes[]` — an adopter may pin a specific stylesheet to a specific module-naming pattern (e.g. one naming convention uses LESS, another uses SCSS) as part of a migration phase. If the config does not spell this out for the target module, fall back to step 3.
3. `git -C <repo> log -- <file>` on sibling files in the same module to see what convention is already in use, and match it.

Wrong stylesheet introduction is a hard stop. Stop, verify with git history what the surrounding files use, and match — never introduce a second stylesheet convention into an existing module without an explicit lead/architect decision.

## G-D2 -- React component pattern consistency

- Match the existing pattern in the module — HOC (`connect()` from react-redux) or hooks (`useSelector`/`useDispatch`) — never mix within the same module. Check sibling components first.
- Redux pattern (sagas / slices / thunks, per `config.stack.frontend.redux_patterns[]`) is per-file — match the file, do not mix.
- Class vs functional component: do NOT convert existing class components to functional without lead/architect direction. New components are functional + hooks by default.
- Component size: extract to a hook in `react/hooks/` once a component crosses ~300 lines.

## G-D3 -- Figma workflow (uses claude.ai Figma MCP)

Before consuming a Figma file:

1. Confirm the MCP is connected -- `claude.ai Figma` will OAuth in browser on first call. If the user has no OAuth set up, ask them to open any Figma file in the browser to seed the cookie.
2. Get the file key + node id from the URL: `figma.com/design/:fileKey/...?node-id=:nodeId`
3. Use `get_design_context` for the node -- returns layout, tokens, typography, spacing.
4. Use `get_screenshot` if the user needs a visual reference -- DO NOT generate code from the screenshot alone, always combine with `get_design_context`.
5. Verify tokens against the project's brand source of truth before hardcoding any color hex / spacing / font-size. Ask the user to point to the design-token source file for the target repo/module if it is not already known (e.g. a canonical `_colors.scss`, `tailwind.config.ts`, or design-tokens JSON) — do not assume a filename or path.

## G-D4 -- Accessibility (WCAG 2.1 AA minimum)

Every generated component must meet:

- All interactive elements reachable by keyboard (Tab / Shift+Tab) -- no `onClick` on a `<div>` without `role="button"`, `tabIndex={0}`, and `onKeyDown` handler
- Color contrast ≥ 4.5:1 for normal text, ≥ 3:1 for large text and UI components -- verify against the project's palette
- Form inputs have `<label>` associated via `htmlFor` / `id`
- Buttons have a visible focus ring (use the project's documented focus-ring token; ask if none is known)
- `<img>` always has `alt`. Decorative images use `alt=""` not omitted.
- Modal / dialog uses `role="dialog"`, `aria-labelledby`, traps focus, restores on close
- No motion that violates `prefers-reduced-motion`
- Page has a logical heading hierarchy (one `<h1>`, no skipped levels)

Run `/common/check-conventions` for the wider accessibility audit on a finished component.

## G-D5 -- Brand tokens (never hardcode)

Color, type scale, spacing must come from tokens, not literal values:

- ❌ `style={{ color: '#003a70' }}` — a hardcoded hex value
- ✓ Tailwind: `text-brand-primary` (or the project's actual token name)
- ✓ SCSS: `color: $brand-primary;`
- ✓ LESS: `color: @brand-primary;`

Stop and verify with the user before writing any new hardcoded hex / rem / px in production code.

## G-D6 -- Hard-stop modules

Inherits `CLAUDE.md` Hard Stops, rendered from `config.protected_paths[]` where `enforcement.hard_stop: true`. Resolve the current list and owners via the Titan session header or `?gov <path>` rather than assuming a fixed table — designer-mode never has write access to protected paths regardless of what the lookup returns.

## Figma-to-React translation output format

```
Figma source:   <file URL> + node id
Component:      <PascalCase name>
File:           <repo>/<module>/src/.../components/<ComponentName>.tsx
Style file:     <ComponentName>.scss | .less | (none if Tailwind)
Pattern:        functional + hooks | HOC + connect | (matched to module)
Tokens used:    <list of brand tokens>
A11y notes:     <focus order, aria attributes, contrast verified>
```

Then the component code (with G0 line-by-line explanation for offshore devs).

## Permissions

Allowed: write inside frontend modules only (per `config.repos[].role_in_stack`), `npm run dev`, `yarn dev`, `gulp build`, `yarn storybook`, read-only git, `npx jest` for component tests.
Blocked: `git push`, `mvn install`, writes to any `config.protected_paths[]` match, any file outside a frontend module. Stylesheet conversions (LESS->SCSS or vice versa) without lead/architect direction.

## Reminders

- Before code: *"Confirm stylesheet for this module — match siblings, do not introduce a new convention."*
- After Figma fetch: *"Verify tokens against the project's brand source. Do not hardcode hex / px / rem."*
- After component: *"Run `/common/check-conventions` and an a11y manual pass (Tab navigation, screen reader)."*
- New component > 300 lines: *"Extract to a hook in `react/hooks/` first."*

## Ownership

Resolve every row below via `config.contacts.areas` (or the Titan session header / `?gov`) rather than a fixed name:

| Area | Owner (resolve via config) |
|------|-------|
| Brand tokens / design-token source | `contacts.areas.ui` (or `frontend`, if the config uses that key) |
| Accessibility standards | `contacts.areas.ui` |
| React / Redux patterns | `contacts.areas.ui` |
| Template / markup consistency (HTL, JSP, etc.) | `contacts.areas.aem` (if `config.stack.aem.enabled`) |
| Figma file source of truth | project design/brand team, per config |
| Storybook (if/when adopted) | `contacts.areas.ui` |
