import { type ReactNode } from 'react';
import { useWizard, type Screen } from '../store/wizard-state';

// Outer chrome that wraps every wizard screen.
// Provides:
//   - Titan mark + product wordmark (top-left)
//   - Step indicator dots (top-right, lemonade-style)
//   - Page surface containing the screen content
//   - Subtle gradient background
//
// Dashboard screen renders WITHOUT this chrome (see App.tsx).

interface WizardChromeProps {
  children: ReactNode;
}

// Stepper segments. Hide internal-only screens (workspace-location, install-progress
// — these are transient steps where showing them is more noise than help).
// "Visible" steps are the ones that mean something to a non-technical user.
//
// Fixed in the 2.4.1 pre-ship audit: atlassian-setup, telemetry-setup, and
// figma-info were added to SCREEN_ORDER (wizard-state.ts) after this list
// was written and never added here, so the stepper silently rendered those
// three screens at index 0 ("welcome" active) — every dot looked wrong for
// three real, user-facing steps most installs pass through.
const VISIBLE_STEPS: Screen[] = [
  'welcome',
  'role-picker',
  'onboarding',
  'atlassian-setup',
  'telemetry-setup',
  'figma-info',
  'prereq-check',
  'ado-pat',
  'clone-repos',
  'done'
];

function StepDots({ current }: { current: Screen }): JSX.Element {
  // Resolve current step index against VISIBLE_STEPS. If current is one of the
  // "hidden" steps (workspace-location, install-progress), find the previous
  // visible step and treat it as active. This keeps the dots stable.
  let activeIdx = VISIBLE_STEPS.indexOf(current);
  if (activeIdx === -1) {
    // Hidden step — show the most recent visible step as still active.
    const hiddenStepFallback: Partial<Record<Screen, Screen>> = {
      'workspace-location': 'ado-pat',
      'install-progress':   'clone-repos'
    };
    const fallback = hiddenStepFallback[current];
    activeIdx = fallback ? VISIBLE_STEPS.indexOf(fallback) : 0;
  }

  return (
    <div className="flex items-center gap-2" aria-label="Setup progress">
      {VISIBLE_STEPS.map((step, idx) => {
        const completed = idx < activeIdx;
        const active = idx === activeIdx;
        return (
          <span
            key={step}
            aria-current={active ? 'step' : undefined}
            className={[
              'h-2 rounded-pill transition-all duration-200',
              active ? 'w-8 bg-titan-blue-main' : '',
              completed ? 'w-2 bg-titan-blue-main/60' : '',
              !active && !completed ? 'w-2 bg-titan-gray-light' : ''
            ].join(' ')}
          />
        );
      })}
    </div>
  );
}

export default function WizardChrome({ children }: WizardChromeProps): JSX.Element {
  const currentScreen = useWizard((s) => s.currentScreen);

  // `currentScreen` is persisted, and a completed install is additionally
  // pinned to the Dashboard on rehydrate, so reopening always resumes where
  // the user left off. A "Start over" already existed — but only on the
  // Dashboard, and only for the architect role, which is unreachable for
  // anyone stuck partway through the wizard. Recovering meant deleting
  // %APPDATA%\titan-installer\Local Storage by hand. Chrome wraps
  // every wizard screen, so putting it here makes the escape hatch reachable
  // from the exact place people get stuck. Not role-gated: the reset only
  // clears app state, and being mid-wizard is precisely when it is needed.
  const onStartOver = (): void => {
    if (!confirm(
      'Start over? This clears the saved setup progress and returns to the first screen.\n\n'
      + 'Your codebase, cloned repos, and stored credentials are NOT deleted — only the '
      + 'Titan wizard state is reset.'
    )) return;
    void window.api.app.resetWizard();
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-titan-gray-bg via-titan-blue-soft/30 to-titan-gray-bg">
      <header className="flex items-center justify-between px-10 pt-8 pb-6">
        <div className="flex items-center gap-3">
          {/* Titan mark + wordmark — replaces the reference implementation's logo removed in the
              Titan de-branding pass. Swap via branding.logo_path in
              titan.config.json for an adopter-supplied asset. */}
          <img src="/assets/titan-mark.svg" alt="" className="h-8 w-auto" />
          <span className="font-medium text-titan-gray-dark text-lg tracking-tight">
            Titan
          </span>
        </div>
        <div className="flex items-center gap-5">
          {/* Pointless on the first screen — you are already at the start. */}
          {currentScreen !== 'welcome' && (
            <button
              type="button"
              onClick={onStartOver}
              title="Clear saved setup progress and return to the first screen"
              className="text-xs text-titan-gray-mid hover:text-titan-danger underline underline-offset-2 transition-colors"
            >
              Start over
            </button>
          )}
          <StepDots current={currentScreen} />
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-10 pb-10">
        <div className="w-full max-w-4xl">{children}</div>
      </main>
    </div>
  );
}
