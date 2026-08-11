import Button from '../components/Button';
import { useWizard, type Role } from '../store/wizard-state';

// Screen 3 — Onboarding. Per-role pitch: "here's what Titan does for you".
// Three short bullets specific to the role + a single "Continue" CTA.
// No new technical decisions on this screen — purely orientation.

interface Bullet { title: string; body: string; }
interface RolePitch {
  headline: string;
  bullets: Bullet[];
}

// Each role gets ~3 bullets focused on the value they personally get.
// Copy is intentionally plain-English; no "MCP", no "guardrails", no "OSGi".
const PITCH: Record<Role, RolePitch> = {
  po: {
    headline: 'Titan for Product Owners',
    bullets: [
      {
        title: 'Stories the team can build from',
        body: 'Claude reads your Jira epic and drafts clear Given/When/Then acceptance criteria, sized S–M–L, ready to drop straight into the sprint.'
      },
      {
        title: 'Catch blockers before coding starts',
        body: 'It flags cross-team dependencies — a GraphQL field, an OCC endpoint, a PIM attribute — as sign-off blockers while there\'s still time to resolve them.'
      },
      {
        title: 'Plain English, always',
        body: 'No code, no jargon, no toolchain to install. Anything platform-specific gets defined the first time it appears.'
      }
    ]
  },
  manager: {
    headline: 'Titan for Managers',
    bullets: [
      {
        title: 'Your team\'s work on one screen',
        body: 'PR status, build health, and sprint progress in a single dashboard — no terminal, no chasing people for updates.'
      },
      {
        title: 'See problems before they block a merge',
        body: 'Governance flags and missing approvals surface early, while they\'re still cheap to fix — not at the point someone is waiting to ship.'
      },
      {
        title: 'Know where the spend goes',
        body: 'Token budget and usage are visible at a glance, so AI cost never turns into a surprise line item. Read-only, no toolchain.'
      }
    ]
  },
  lead: {
    headline: 'Titan for Tech Leads',
    bullets: [
      {
        title: 'A review panel, one verdict',
        body: 'Correctness, reliability, contract, and convention checks run in parallel over a PR and come back as one ranked summary — so no part of an offshore change gets skimmed.'
      },
      {
        title: 'Governance that enforces itself',
        body: 'Hard stops, escalation paths, and the cross-repo contract registry are applied automatically — nothing merges around a rule.'
      },
      {
        title: 'Review-safe by design',
        body: 'Review mode writes nothing to the repo — its output is copy-ready for the ADO PR thread. Your comments, your call.'
      }
    ]
  },
  architect: {
    headline: 'Titan for Architects',
    bullets: [
      {
        title: 'Decisions that stay crisp',
        body: 'Every design question comes back as Recommendation → Trade-off → Risks, with cross-repo impact weighed first — and full deploy authority when you\'re ready to act.'
      },
      {
        title: 'Breaking changes caught early',
        body: 'Titan knows who owns each GraphQL, OCC, PIM, and Coveo contract and flags a breaking change before the PR is ever raised.'
      },
      {
        title: 'Depth on demand',
        body: 'Hard reasoning auto-routes to the strongest model; routine work stays on a leaner one — top-tier thinking where it counts, without paying for it everywhere.'
      }
    ]
  },
  dev: {
    headline: 'Titan for Developers',
    bullets: [
      {
        title: 'Guardrails, not handrails',
        body: 'Your work stays inside its module and away from hard-stop files automatically — protection you notice only at the moment you\'d have hit a wall anyway.'
      },
      {
        title: 'Pick up exactly where you left off',
        body: 'Long features survive context switches and days away — the key decisions and file paths are carried forward, so there\'s no cold restart.'
      },
      {
        title: 'PRs that write themselves',
        body: '/pr-create turns your branch into a ready-to-paste ADO description — title, summary, risk, reviewers — before you leave the terminal.'
      }
    ]
  },
  qa: {
    headline: 'Titan for QA Testers',
    bullets: [
      {
        title: 'From Jira story to full test suite',
        body: 'Hand Claude a ticket and it turns the acceptance criteria into every functional case — happy path, edge, and negative — exported ready to import straight into Zephyr or Xray. No blank page, no manual re-typing.'
      },
      {
        title: 'Full coverage, zero blind spots',
        body: 'Every acceptance criterion is mapped to a case in a traceability matrix. Anything the story leaves uncovered is flagged back to the PO — never quietly assumed, never invented.'
      },
      {
        title: 'Safe test data, always',
        body: 'Fictional practice names and sandbox card numbers only. The PHI guardrail stops real customer data from ever reaching a fixture, a test, or a bug ticket — even when the source story wasn\'t careful.'
      }
    ]
  },
  security: {
    headline: 'Titan for Security Review',
    bullets: [
      {
        title: 'OWASP Top 10 on every diff',
        body: 'A read-only reviewer that walks injection, broken access control, secret exposure, and SSRF across the active PR — findings ranked by severity, and no write access to worry about.'
      },
      {
        title: 'Prove the harness itself is clean',
        body: '/mcp-audit checks every installed MCP server and hook against the approved registry by SHA — so a tampered hook or an unapproved server is caught before it ever runs.'
      },
      {
        title: 'Irrotatable secrets, physically sealed',
        body: 'The Hybris config holding DB passwords, CyberSource payment certs, and SAML keystores is hard-blocked at the file layer — reads included. Credentials that can never be rotated are never exposed in the first place.'
      }
    ]
  },
  sre: {
    headline: 'Titan for SRE & Cloud Managers',
    bullets: [
      {
        title: 'A safety net on every deploy',
        body: 'Titan understands your Cloud Manager release pipelines, Adobe I/O Runtime services, and rollback steps. It reads and explains them freely — but any change to pipeline or deploy config is gated behind owner approval, so nothing reaches production by accident.'
      },
      {
        title: 'Find the commit that made it slow',
        body: 'Point Titan at a slowdown window and it works back through the commits, ranking the likely causes by confidence — turning a multi-hour hunt into a short, evidence-backed shortlist.'
      },
      {
        title: 'Full clarity when it matters most',
        body: 'Switch into incident mode and Titan turns off its output compression and speaks in complete detail — maximum signal at exactly the moment the pressure is highest.'
      }
    ]
  },
  designer: {
    headline: 'Titan for Designers / Frontend',
    bullets: [
      {
        title: 'Figma to React in one step',
        body: 'Paste a Figma URL and Claude emits a matching component that honours your brand tokens — a real starting point, not a rough approximation.'
      },
      {
        title: 'The right stylesheet, automatically',
        body: 'LESS or SCSS per module — detected and matched per module, so conventions never drift.'
      },
      {
        title: 'Accessible from the first render',
        body: 'WCAG 2.1 AA checks on every component — keyboard paths, focus rings, contrast, ARIA — built in, not bolted on later.'
      }
    ]
  },
  prodsupport: {
    headline: 'Titan for Production Support',
    bullets: [
      {
        title: 'Runbook-driven from ticket one',
        body: 'A dozen runbooks cover the recurring incidents — order failures, search gaps, SAML loops, slow pages — so triage follows a proven path instead of guesswork.'
      },
      {
        title: 'Customer data never leaks',
        body: 'PHI and PII are redacted both when writing files and in the evidence shown on screen — nothing sensitive ever lands in a ticket.'
      },
      {
        title: 'Every fix has an owner',
        body: 'Each recommended action carries an ESCALATE-TO tag. You draft the ADO ticket; the right dev team takes the fix from there — read-only by design.'
      }
    ]
  }
};

export default function Onboarding(): JSX.Element {
  const role = useWizard((s) => s.role);
  const setScreen = useWizard((s) => s.setScreen);
  const nextScreen = useWizard((s) => s.nextScreen);

  // If a user lands here without a role (unlikely — guarded by the picker),
  // fall back to dev-mode pitch so the screen isn't blank.
  const pitch = role ? PITCH[role] : PITCH.dev;

  const advance = (): void => {
    setScreen(nextScreen());
  };

  // Per-role hero accent. Two flavours: "no-code" roles get a checklist
  // motion; code-touching roles get a code-bracket pulse.
  const noCodeRoles = ['po', 'manager', 'prodsupport'];
  const isNoCode = role ? noCodeRoles.includes(role) : false;

  return (
    <div>
      <div className="flex flex-col items-center text-center mb-8">
        <div className="w-24 h-24 mb-4 rounded-card bg-titan-blue-soft flex items-center justify-center relative overflow-hidden">
          {isNoCode ? (
            /* Checklist animation — three lines drawing in, sequentially */
            <svg viewBox="0 0 60 60" className="w-14 h-14 text-titan-blue-main" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
              <path d="M15 18 l5 5 l10 -10"  className="animate-draw-line" style={{ strokeDasharray: 200, animationDelay: '0s'   }} />
              <path d="M15 32 l5 5 l10 -10"  className="animate-draw-line" style={{ strokeDasharray: 200, animationDelay: '0.4s' }} />
              <path d="M15 46 l5 5 l10 -10"  className="animate-draw-line" style={{ strokeDasharray: 200, animationDelay: '0.8s' }} />
            </svg>
          ) : (
            /* Code-brackets pulse — < / > with floating motion */
            <svg viewBox="0 0 60 60" className="w-14 h-14 text-titan-blue-main animate-float" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 18 L10 30 L22 42" />
              <path d="M38 18 L50 30 L38 42" />
              <path d="M35 14 L25 46" strokeWidth="3" opacity="0.6" />
            </svg>
          )}
        </div>
        <h1 className="text-3xl font-bold text-titan-gray-dark mb-3 tracking-tight">
          {pitch.headline}
        </h1>
        <p className="text-base text-titan-gray-mid">
          Three things you'll get out of Titan.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-10">
        {pitch.bullets.map((b, idx) => (
          <div
            key={b.title}
            className="rounded-card bg-titan-white p-6 shadow-card"
          >
            <div className="w-10 h-10 rounded-pill bg-titan-blue-soft text-titan-blue-main
                            flex items-center justify-center font-bold mb-4">
              {idx + 1}
            </div>
            <h3 className="text-lg font-bold text-titan-gray-dark mb-2">{b.title}</h3>
            <p className="text-sm text-titan-gray-mid leading-relaxed">{b.body}</p>
          </div>
        ))}
      </div>

      <div className="flex justify-center gap-3">
        <Button variant="secondary" size="lg" onClick={() => setScreen('role-picker')}>
          ← Back
        </Button>
        <Button size="lg" onClick={advance}>
          Continue
        </Button>
      </div>
    </div>
  );
}
