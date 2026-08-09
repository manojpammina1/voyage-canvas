import type { SafetyMetrics } from '../../lib/types';

// S2d — Risk posture (leadership view). Reframes the same SafetyMetrics data
// S5Safety shows operations (raw incident counts, "review required" framing)
// as VALUE: each intercept is an exposure avoided BEFORE it reached a PR or a
// customer. No aggregation changes needed — this is presentation only.
//
// No dollar proxy in v1 — ROI-ROADMAP allows "hook blocks × labeled per-incident
// proxy" later, but that needs Finance sign-off first (same discipline as the
// savings/ROI sections: never invent a number without a labeled basis).

const Badge = ({ text, cls }: { text: string; cls: string }) => (
  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-pill ${cls}`}>{text}</span>
);

export default function S2dRisk({ s }: { s: SafetyMetrics }) {
  const totalIntercepted = s.hybrisBlocked + s.credBlocked + s.phiWarned + s.hardStopBlocked;
  const quiet = totalIntercepted === 0;
  const notInstrumented = !s.instrumented;

  const tiles = [
    { label: 'Credential leaks intercepted before merge', count: s.credBlocked,
      hover: 'PreToolUse hook blocked a Write/Edit/Bash containing a PAT-like or credential pattern. Each one is a leak that never reached a diff, a PR, or a log.' },
    { label: 'PHI redaction warnings', count: s.phiWarned,
      hover: 'redact-customer-data.py flagged customer-data-like patterns (email/PAN/SSN/phone/IP) in a non-test write. prodsupport role blocks outright; other roles warn.' },
    { label: 'Hybris secret-access blocks', count: s.hybrisBlocked,
      hover: 'protect-hybris-secrets.py hard-blocked a Read/Write/Edit/Bash/Grep targeting hybris/config/** — irrotatable credentials (DB passwords, payment certs, SAML keystores) that were never displayed.' },
    { label: 'Hard-stop file edits blocked', count: s.hardStopBlocked,
      hover: 'A governance hard-stop module (.cloudmanager/, pipeline files, hybris-api/impl, app.config.yaml) was touched without the required escalation — blocked before it could ship.' },
  ];

  return (
    <div className="space-y-4">
      <div className={`rounded-card p-5 ring-1 flex items-center gap-3 ${notInstrumented ? 'bg-titan-gray-light/40 ring-titan-gray-light' : quiet ? 'bg-titan-success/10 ring-titan-success' : 'bg-titan-blue-soft/30 ring-titan-blue-main'}`}>
        <span className="text-3xl">{notInstrumented ? '⬜' : '🛡️'}</span>
        <div>
          <div className={`text-lg font-bold ${notInstrumented ? 'text-titan-gray-mid' : quiet ? 'text-titan-success' : 'text-titan-blue-main'}`}>
            {notInstrumented
              ? 'Not instrumented'
              : quiet
                ? 'Guardrails active and quiet ✓'
                : `${totalIntercepted} exposure(s) avoided before reaching a PR this period`}
          </div>
          <div className="text-sm text-titan-gray-mid">
            {notInstrumented
              ? 'These hooks don’t emit blocking telemetry yet — the counts below are not a verified measurement.'
              : `${s.daysSinceIncident} days since the last guardrail intercept — full detail in Safety (Operations view)`}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {tiles.map(({ label, count, hover }) => (
          <div key={label} className="rounded-card p-4 bg-white ring-1 ring-titan-gray-light text-center cursor-help" title={hover}>
            <div className={`text-3xl font-bold ${count > 0 ? 'text-titan-blue-main' : 'text-titan-success'}`}>{count}</div>
            <div className="text-xs text-titan-gray-mid mt-1 leading-tight">{label}</div>
          </div>
        ))}
      </div>

      <div className="text-xs text-titan-gray-mid px-1">
        Each intercept is a hard technical control firing before code shipped — not a proxy dollar figure (no $ value
        assigned to a blocked leak without Finance sign-off, per ROI-ROADMAP).{' '}
        {notInstrumented
          ? <><Badge text="NOT INSTRUMENTED" cls="bg-titan-gray-light text-titan-gray-mid" /> these four hooks don't emit `_hook_block` telemetry yet — the tiles above cannot be nonzero regardless of real guardrail activity.</>
          : <><Badge text="FACT" cls="bg-titan-success/15 text-titan-success" /> counts are exact from `_hook_block` telemetry.</>}
      </div>
    </div>
  );
}
