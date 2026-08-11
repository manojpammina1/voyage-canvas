import { useState } from 'react';
import './styles/globals.css';
import { useTelemetry }   from './hooks/useTelemetry';
import Header, { type DashboardView } from './components/chrome/Header';
import Footer             from './components/chrome/Footer';
import SectionCard        from './components/chrome/SectionCard';
import S1Headline         from './components/sections/S1Headline';
import S2Cost             from './components/sections/S2Cost';
import S2bSavings         from './components/sections/S2bSavings';
import S2cRoi             from './components/sections/S2cRoi';
import S2dRisk            from './components/sections/S2dRisk';
import S2eAdoptionSparkline from './components/sections/S2eAdoptionSparkline';
import S2fCorrection      from './components/sections/S2fCorrection';
import S3Adoption         from './components/sections/S3Adoption';
import S4Skills           from './components/sections/S4Skills';
import S5Safety           from './components/sections/S5Safety';
import S6Productivity     from './components/sections/S6Productivity';
import S7Users            from './components/sections/S7Users';
import S8Trend            from './components/sections/S8Trend';
import { DISCLAIMER }     from './lib/pricing';

const SAS_URL = import.meta.env.VITE_TELEMETRY_READ_SAS as string ?? '';

const PERIODS = [
  { label: 'Last 24 hours', daysBack: 1   },
  { label: 'Last 7 days',   daysBack: 7   },
  { label: 'Last 30 days',  daysBack: 30  },
  { label: 'All time',      daysBack: 365 },
];

const VIEW_STORAGE_KEY = 'titan-dashboard-view';

function initialView(): DashboardView {
  const fromUrl = new URLSearchParams(window.location.search).get('view');
  if (fromUrl === 'leadership' || fromUrl === 'operations') return fromUrl;
  const fromStorage = window.localStorage.getItem(VIEW_STORAGE_KEY);
  if (fromStorage === 'leadership' || fromStorage === 'operations') return fromStorage;
  return 'operations';   // default — unchanged behavior for anyone not using the toggle
}

export default function App() {
  const [period, setPeriod] = useState(PERIODS[1]);   // default: last 30 days
  const [view, setViewState] = useState<DashboardView>(initialView);
  const { data, loading, error, partialWarning, lastUpdated, refresh } = useTelemetry(SAS_URL, period);

  const setView = (v: DashboardView) => {
    setViewState(v);
    window.localStorage.setItem(VIEW_STORAGE_KEY, v);
    const url = new URL(window.location.href);
    url.searchParams.set('view', v);
    window.history.replaceState(null, '', url.toString());
  };

  return (
    <div className="min-h-screen bg-titan-gray-bg font-sans">
      <Header
        period={period}
        onPeriod={setPeriod}
        onRefresh={refresh}
        loading={loading}
        lastUpdated={lastUpdated}
        view={view}
        onView={setView}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 pb-12">
        {/* Error banner — nothing rendered */}
        {error && (
          <div className="mb-6 p-4 rounded-card bg-titan-danger/10 ring-1 ring-titan-danger text-sm text-titan-danger">
            <span className="font-semibold">Failed to load telemetry: </span>{error}
            {!SAS_URL && <p className="mt-1 text-xs">Set <code>VITE_TELEMETRY_READ_SAS</code> in <code>dashboard/.env</code> (read-only SAS from Azure Storage).</p>}
          </div>
        )}

        {/* Partial-data warning — some blobs failed but data still rendered
            below. Distinct from the error banner above, which means nothing
            rendered at all. */}
        {!error && partialWarning && (
          <div className="mb-6 p-3 rounded-card bg-titan-warning/10 ring-1 ring-titan-warning/40 text-xs text-titan-gray-dark">
            ⚠ {partialWarning}
          </div>
        )}

        {/* Loading skeleton */}
        {loading && !data && (
          <div className="space-y-4">
            {[1,2,3].map((i) => (
              <div key={i} className="bg-white rounded-card shadow-card p-6 h-40 animate-pulse" />
            ))}
          </div>
        )}

        {/* Actual content */}
        {data && (
          <>
            {/* Cost disclaimer banner */}
            <div className="mb-6 p-3 rounded-card bg-titan-warning/10 text-xs text-titan-gray-mid">
              ⚠ {DISCLAIMER}
            </div>

            <SectionCard
              title="Pilot snapshot"
              takeaway={`${data.snapshot.activeUsers} active users · ${data.snapshot.sessions} sessions · ${data.snapshot.prompts.toLocaleString()} prompts processed in ${period.label.toLowerCase()}`}
            >
              <S1Headline s={data.snapshot} />
            </SectionCard>

            {view === 'operations' && (
              <SectionCard
                title="Cost"
                takeaway={`${data.cost.hasActualData ? '$' : '~$'}${data.cost.totalEstUsd.toFixed(2)} ${data.cost.hasActualData ? 'exact' : 'estimated'} spend this period${data.cost.hasActualData ? ` · ${data.cost.totalOutputTokens.toLocaleString()} output tokens` : ''}`}
              >
                <S2Cost c={data.cost} />
              </SectionCard>
            )}

            <SectionCard
              title="Savings"
              takeaway={data.savings.hasActualData
                ? `$${data.savings.harnessAttributableUsd.toFixed(2)} harness-attributable savings this period (${data.savings.harnessDiscountPct.toFixed(0)}% discount) · +$${data.savings.platformInherentUsd.toFixed(2)} platform baseline (Anthropic, not harness-built) · every figure itemized with its basis`
                : 'Savings compute once exact usage data is captured (Stop hook).'}
            >
              <S2bSavings s={data.savings} />
            </SectionCard>

            <SectionCard
              title="ROI"
              takeaway="What the harness returns per dollar — every figure labeled fact, assumption, or estimate."
            >
              <S2cRoi r={data.roi} />
            </SectionCard>

            <SectionCard
              title="Correction cost"
              takeaway={data.correction.hasData
                ? `$${data.correction.wastedCostUsd.toFixed(2)} measured rework waste · ${(data.correction.reworkTokenRatio * 100).toFixed(1)}% rework ratio · ${data.correction.spiralsContained} spirals contained — all facts, no assumption`
                : 'No correction signals this period.'}
            >
              <S2fCorrection c={data.correction} view={view} />
            </SectionCard>

            {view === 'leadership' && (
              <>
                <SectionCard
                  title="Risk posture"
                  takeaway="Governance guardrails reframed as value: each intercept is an exposure avoided before it reached a PR."
                >
                  <S2dRisk s={data.safety} />
                </SectionCard>

                <SectionCard
                  title="Adoption"
                  takeaway="Is the investment being used — full role/skill breakdown lives in Operations view."
                >
                  <S2eAdoptionSparkline t={data.trend} snapshot={data.snapshot} />
                </SectionCard>
              </>
            )}

            {view === 'operations' && (
              <>
                <SectionCard
                  title="Adoption by role"
                  takeaway={`Top mode: ${data.adoption.byRole[0]?.role ?? '—'} (${data.adoption.byRole[0]?.count ?? 0} sessions)`}
                >
                  <S3Adoption a={data.adoption} />
                </SectionCard>

                <SectionCard
                  title="Top skills"
                  takeaway={`Most used: ${data.skills.top10[0]?.skill ?? '—'} · ${data.skills.dead.length} skills with zero usage this period`}
                >
                  <S4Skills s={data.skills} />
                </SectionCard>

                <SectionCard
                  title="Safety — governance guardrails"
                  takeaway="Zero = guardrails working. Any non-zero count in Hybris or hard-stop column requires immediate review."
                >
                  <S5Safety s={data.safety} />
                </SectionCard>

                <SectionCard
                  title="Productivity signals"
                  takeaway={`Avg ${data.productivity.avgPromptsPerSession.toFixed(1)} prompts/session · top CLI: ${data.productivity.topBashPrograms[0]?.program ?? '—'}`}
                >
                  <S6Productivity p={data.productivity} />
                </SectionCard>

                <SectionCard
                  title="Per-user activity"
                  takeaway="User IDs are one-way hashes — not reversible to real names. Hashes are stable per machine."
                >
                  <S7Users users={data.users} />
                </SectionCard>

                <SectionCard
                  title="30-day trends"
                  takeaway="Rising curves = Titan is sticking. Flat = adoption stalled — target outreach."
                >
                  <S8Trend t={data.trend} />
                </SectionCard>
              </>
            )}

            <div className="text-xs text-titan-gray-mid text-right mt-2">
              {data.eventCount.toLocaleString()} events · generated {new Date(data.generatedAt).toLocaleString()}
            </div>
          </>
        )}
      </main>

      <Footer />
    </div>
  );
}
