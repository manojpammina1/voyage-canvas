import type { SafetyMetrics } from '../../lib/types';

export default function S5Safety({ s }: { s: SafetyMetrics }) {
  const allZero = s.hybrisBlocked === 0 && s.credBlocked === 0
               && s.phiWarned === 0 && s.hardStopBlocked === 0;

  return (
    <div className={`rounded-card p-6 ring-1 ${!s.instrumented ? 'bg-titan-gray-light/40 ring-titan-gray-light' : allZero ? 'bg-titan-success/10 ring-titan-success' : 'bg-titan-warning/10 ring-titan-warning'}`}>
      <div className="flex items-center gap-3 mb-4">
        <span className="text-4xl">{!s.instrumented ? '⬜' : allZero ? '🛡️' : '⚠️'}</span>
        <div>
          <div className={`text-lg font-bold ${!s.instrumented ? 'text-titan-gray-mid' : allZero ? 'text-titan-success' : 'text-titan-warning'}`}>
            {!s.instrumented ? 'Not instrumented' : allZero ? 'ZERO incidents this period' : 'Incidents detected — review required'}
          </div>
          <div className="text-sm text-titan-gray-mid">
            {!s.instrumented
              ? 'These hooks don’t emit blocking telemetry yet — the 0s below are not a verified measurement.'
              : `${s.daysSinceIncident} days since last block event`}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Hybris secret reads blocked',  count: s.hybrisBlocked,    critical: true },
          { label: 'Credential leaks blocked',      count: s.credBlocked,      critical: s.credBlocked > 0 },
          { label: 'PHI redaction warnings',        count: s.phiWarned,        critical: false },
          { label: 'Hard-stop file edits blocked',  count: s.hardStopBlocked,  critical: s.hardStopBlocked > 0 },
        ].map(({ label, count, critical }) => (
          <div key={label} className="text-center">
            <div className={`text-3xl font-bold ${count > 0 && critical ? 'text-titan-danger' : count > 0 ? 'text-titan-warning' : 'text-titan-success'}`}>
              {count}
            </div>
            <div className="text-xs text-titan-gray-mid mt-0.5 leading-tight">{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
