export type DashboardView = 'leadership' | 'operations';

interface Props {
  period:     { label: string; daysBack: number };
  onPeriod:   (p: { label: string; daysBack: number }) => void;
  onRefresh:  () => void;
  loading:    boolean;
  lastUpdated: Date | null;
  view:       DashboardView;
  onView:     (v: DashboardView) => void;
}

const PERIODS = [
  { label: 'Last 24 hours', daysBack: 1   },
  { label: 'Last 7 days',   daysBack: 7   },
  { label: 'Last 30 days',  daysBack: 30  },
  { label: 'All time',      daysBack: 365 },
];

export default function Header({ period, onPeriod, onRefresh, loading, lastUpdated, view, onView }: Props) {
  return (
    <header className="bg-white shadow-sm mb-8 sticky top-0 z-30">
      <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <img src="/titan-mark.svg" alt="" className="h-7 w-auto" />
          <div>
            <div className="font-bold text-titan-gray-dark tracking-tight">Titan Analytics</div>
            <div className="text-xs text-titan-gray-mid">Internal · Harness usage dashboard</div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex rounded-pill border border-titan-gray-light overflow-hidden"
               title="Leadership = savings/ROI/risk-posture summary only. Operations = full telemetry (adoption, skills, per-user, trends).">
            {(['leadership', 'operations'] as const).map((v) => (
              <button
                key={v}
                onClick={() => onView(v)}
                className={`px-3 py-1 text-sm capitalize transition-colors ${
                  view === v
                    ? 'bg-titan-gray-dark text-white font-medium'
                    : 'text-titan-gray-mid hover:bg-titan-gray-light'
                }`}
              >
                {v}
              </button>
            ))}
          </div>

          <div className="flex rounded-pill border border-titan-gray-light overflow-hidden">
            {PERIODS.map((p) => (
              <button
                key={p.daysBack}
                onClick={() => onPeriod(p)}
                className={`px-3 py-1 text-sm transition-colors ${
                  period.daysBack === p.daysBack
                    ? 'bg-titan-blue-main text-white font-medium'
                    : 'text-titan-gray-mid hover:bg-titan-gray-light'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {lastUpdated && (
            <span className="text-xs text-titan-gray-mid hidden sm:block">
              Updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}

          <button
            onClick={onRefresh}
            disabled={loading}
            className={`w-8 h-8 flex items-center justify-center rounded-pill bg-titan-gray-light hover:bg-titan-blue-soft text-titan-blue-main transition-colors ${loading ? 'animate-spin' : ''}`}
            title="Refresh now"
          >
            ↻
          </button>
        </div>
      </div>
    </header>
  );
}
