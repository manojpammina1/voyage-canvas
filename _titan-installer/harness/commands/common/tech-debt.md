# /tech-debt -- Navigate the UI Technical Debt and Implementation Plan

## Instructions

1. Read `UI_TECHNICAL_DEBT_AND_IMPLEMENTATION_PLAN.md` from the repo root.
2. If the developer asks about a specific area, find the relevant section.
3. If the developer is about to implement something that conflicts with planned debt work, warn them.
4. Summarize relevant items in a short table: **Item | Priority | Affected Module | Notes**.

---

## How to use this during development

Before starting any significant refactor or new feature, ask:

- Is there a debt item that covers the same ground? (Avoid doing it twice)
- Does the new feature make a planned refactor harder? (Flag this to the lead per the Titan session header)
- Is this area flagged as "do not touch without architecture review"?

---

## Key principles from the debt plan (always apply)

- Prefer extracting to hooks over duplicating logic across components
- Replace `connect()` HOC with `useSelector`/`useDispatch` when you are already touching a component for another reason -- do not do it as a standalone change
- LESS -> SCSS migration: only convert files when you are already modifying them; do not do bulk conversions
- Dead code removal: confirm with git log and the lead before deleting

---

## Output

Provide a short summary of relevant debt items. Always end with:

> **Before starting any debt remediation that touches more than one module**, confirm the scope with the lead per the Titan session header. Output the Escalation Alert from CLAUDE.md if you are about to begin cross-module work without prior approval.
