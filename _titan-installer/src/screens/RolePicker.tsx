import Card from '../components/Card';
import { useWizard, type Role } from '../store/wizard-state';

// Screen 2 — Role picker. The wizard's branching point.
// PO + Manager get a stripped-down install (no Node/Java/Maven prereqs, no
// repo cloning, no ADO PAT). Lead/Architect/Developer get the full flow.
//
// Lemonade rule: each option has an icon + one-line description.
// No deep tech jargon — copy is written for non-technical staff.

interface RoleOption {
  id: Role;
  label: string;
  description: string;
  icon: JSX.Element;       // 24×24 SVG, currentColor
  hidden?: boolean;        // true = code preserved but not rendered (re-enable by removing flag)
}

// Tiny inline SVG icons — keeps the bundle small and avoids an icon-library
// dependency for v1. Each is 24×24 with stroke="currentColor".
const Icon = (path: string): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7" aria-hidden="true">
    <path d={path} />
  </svg>
);

// Order follows the product lifecycle: Plan → Design → Build → Test → Deploy → Operate.
// Row layout in a 3-col grid (7 visible roles after v2.1 sunset):
//   Row 1:  Architect     · Tech Lead        · Developer
//   Row 2:  QA Tester      · Security         · SRE / Cloud
//   Row 3:  Production Support
//
// QA Tester clones the Playwright repo ONLY (see DEFAULT_QA_REPOS,
// wizard-state.ts) — never the AEM/Hybris repos. Figma and full prereqs are
// kept (UI reference + Playwright browser install); see setRole() branching.
//
// Hidden roles (code preserved, hidden: true — re-enable by removing the flag):
//   po, manager, designer
const ROLES: RoleOption[] = [
  // ── Hidden — Plan (suspended in v2.1, code preserved for future re-enable) ──
  {
    id: 'po',
    label: 'Product Owner',
    description: 'Writing user stories, refining the backlog, no code.',
    icon: Icon('M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01'),
    hidden: true
  },
  {
    id: 'manager',
    label: 'Manager',
    description: 'Tracking work, reading PRs, no code.',
    icon: Icon('M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75'),
    hidden: true
  },
  {
    id: 'designer',
    label: 'Designer / Frontend',
    description: 'Figma → React, brand tokens, accessibility.',
    icon: Icon('M12 19l7-7 3 3-7 7-3-3zM18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5zM2 2l7.586 7.586M11 11a2 2 0 1 1-4 0 2 2 0 0 1 4 0z'),
    hidden: true
  },

  // ── Row 1 — Design + Build ────────────────────────────────────────────
  {
    id: 'architect',
    label: 'Architect',
    description: 'Cross-repo design, contracts, system-level decisions.',
    icon: Icon('M3 21v-4a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v4M12 7v6M9 10h6M5 7l7-4 7 4M5 21h14')
  },
  {
    id: 'lead',
    label: 'Tech Lead',
    description: 'Reviewing offshore PRs, governance, deploys.',
    icon: Icon('M9 12l2 2 4-4M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9 9 4.03 9 9z')
  },
  {
    id: 'dev',
    label: 'Developer',
    description: 'Writing code, fixing bugs, building features.',
    icon: Icon('M16 18l6-6-6-6M8 6l-6 6 6 6')
  },

  // ── Row 2 — Quality / Audit / Deploy ─────────────────────────────────
  {
    id: 'qa',
    label: 'QA Tester',
    description: 'Pull a Jira story, write functional test cases, export a CSV for manual import into Zephyr/Xray.',
    icon: Icon('M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11')
  },
  {
    id: 'security',
    label: 'Security Reviewer',
    description: 'AppSec, OWASP, secret scans, MCP audit (read-only).',
    icon: Icon('M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z')
  },
  {
    id: 'sre',
    label: 'SRE / Cloud Manager',
    description: 'Keep releases healthy — pipelines, cloud runtime, deploys, and performance triage.',
    icon: Icon('M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z')
  },

  // ── Row 3 — Operate ───────────────────────────────────────────────────
  {
    id: 'prodsupport',
    label: 'Production Support',
    description: 'L2/L3 ticket triage, runbook-driven, read-only.',
    icon: Icon('M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z')
  }
];

export default function RolePicker(): JSX.Element {
  const role = useWizard((s) => s.role);
  const setRole = useWizard((s) => s.setRole);
  const setScreen = useWizard((s) => s.setScreen);
  const nextScreen = useWizard((s) => s.nextScreen);
  const titanConfig = useWizard((s) => s.titanConfig);

  // config.roles.definitions[id].hidden overrides the static `hidden` flag
  // above when present — an adopter can re-enable a "hidden" role (po,
  // manager, designer) or hide one of the default-visible ones without a
  // code change. Falls back to the static flag when the role isn't in the
  // config's role definitions at all (fail open, matches pre-Titan UI).
  const isHidden = (r: RoleOption): boolean => {
    const override = titanConfig?.roles.definitions[r.id]?.hidden;
    return override !== undefined ? override : !!r.hidden;
  };

  // Single-click flow: picking a card commits the role AND advances.
  // No Continue button — Lemonade-style one-decision-per-screen.
  const pickAndAdvance = (r: Role): void => {
    setRole(r);
    setScreen(nextScreen());
  };

  return (
    <div>
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold text-titan-gray-dark mb-3 tracking-tight">
          What's your role?
        </h1>
        <p className="text-base text-titan-gray-mid max-w-xl mx-auto">
          Pick a card to continue. You can change this later from the Dashboard.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {ROLES.filter((r) => !isHidden(r)).map((r, idx) => {
          // Stagger float by column + row so icons drift in a gentle wave
          // rather than all bobbing in sync (which feels mechanical).
          const col = idx % 3;
          const row = Math.floor(idx / 3);
          const delay = (col * 0.18 + row * 0.09).toFixed(2);
          return (
            <Card
              key={r.id}
              clickable
              selected={role === r.id}
              onClick={() => pickAndAdvance(r.id)}
              aria-label={`Select role: ${r.label}`}
              aria-pressed={role === r.id}
            >
              <div className="flex flex-col items-start gap-3">
                <div
                  className="w-12 h-12 rounded-pill bg-titan-blue-soft flex items-center justify-center text-titan-blue-main animate-float"
                  style={{ animationDelay: `${delay}s` }}
                >
                  {r.icon}
                </div>
                <div>
                  <h3 className="text-lg font-bold text-titan-gray-dark mb-1">{r.label}</h3>
                  <p className="text-sm text-titan-gray-mid leading-relaxed">{r.description}</p>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
