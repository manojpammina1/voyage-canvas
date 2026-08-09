import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip,
  CartesianGrid, ReferenceLine,
} from 'recharts';
import type { RoiMetrics } from '../../lib/types';

// S2c — ROI (leadership view). Presentation discipline (METR/DX/DORA-validated):
//   - every figure carries its basis + methodology on hover
//   - cost-per-PR is an INTERNAL TREND (no published benchmark exists)
//   - cost/dev/day is benchmarked against Anthropic's published ~$13 average
//   - savings are paired with a stability guardrail (DORA 2025: throughput
//     without a stability counter-metric is half a story)
//   - no self-reported speedup anywhere (METR RCT: felt +20%, measured −19%)

const usd = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const Badge = ({ text, cls }: { text: string; cls: string }) => (
  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-pill ${cls}`}>{text}</span>
);

// One horizontal bar in the net-value bridge. Width is relative to the largest
// magnitude in the bridge so savings / rework / net stay visually comparable on
// a single axis (dataviz rule: never a dual scale).
// NOTE: the scale prop is deliberately NOT named `ref` — `ref` is a reserved JSX
// attribute even on function components; passing one causes React to intercept
// it as an actual ref instead of a plain prop ("Function components cannot have
// string refs").
const BridgeRow = ({ label, val, color, sign, scale }: {
  label: string; val: number; color: string; sign: string; scale: number;
}) => (
  <div className="flex items-center gap-3 py-1">
    <div className="w-44 text-xs text-titan-gray-mid">{label}</div>
    <div className="flex-1 h-4 bg-titan-gray-light/40 rounded-pill overflow-hidden">
      <div className="h-full rounded-pill" style={{ width: `${Math.min(100, (Math.abs(val) / scale) * 100)}%`, background: color }} />
    </div>
    <div className="w-24 text-right text-sm font-semibold" style={{ color }}>
      {sign}{usd(Math.abs(val))}
    </div>
  </div>
);

export default function S2cRoi({ r }: { r: RoiMetrics }) {
  if (!r.hasActualData) {
    return (
      <div className="p-4 rounded-card bg-titan-warning/10 text-sm text-titan-gray-mid">
        ⚠ ROI needs exact usage data — the Stop hook must be capturing <code>_actual_usage</code> events.
      </div>
    );
  }

  const overBenchmark = r.costPerDevDay > r.anthropicBenchmarkUsd;

  return (
    <div className="space-y-6">
      {/* KPI tiles */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Cost per merged PR */}
        <div className="rounded-card p-5 bg-white ring-1 ring-titan-gray-light text-center cursor-help"
             title={'Cost per merged PR = cohort exact spend ÷ merged PRs (ADO, completed status).\nINTERNAL TREND ONLY — no published industry benchmark exists for this metric\n(closest published construct: DX "cost per task").\nList pricing; your org's contract rates may differ. PR counts via scripts/build-pr-stats.mjs.'}>
          <div className="text-xs uppercase tracking-wider text-titan-gray-mid">Cost per merged PR</div>
          {r.costPerPr != null ? (
            <>
              <div className="text-3xl font-bold text-titan-gray-dark mt-1">{usd(r.costPerPr)}</div>
              <div className="text-xs text-titan-gray-mid mt-1">{r.prCount} PRs merged this period</div>
            </>
          ) : (
            <>
              <div className="text-2xl font-bold text-titan-gray-mid mt-2">baseline pending</div>
              <div className="text-xs text-titan-gray-mid mt-1">run scripts/build-pr-stats.mjs (needs fresh ADO PAT)</div>
            </>
          )}
          <div className="mt-2"><Badge text="INTERNAL TREND" cls="bg-titan-blue-soft/40 text-titan-blue-main" /></div>
        </div>

        {/* Cost per dev per active day vs Anthropic benchmark */}
        <div className="rounded-card p-5 bg-white ring-1 ring-titan-gray-light text-center cursor-help"
             title={'Exact spend ÷ active user-days (a user-day = a hashed user with ≥1 exact-usage event that day).\nBenchmark: Anthropic-published Claude Code average — "around $13 per developer per active day,\nbelow $30/day for 90% of users" (code.claude.com/docs/en/costs).'}>
          <div className="text-xs uppercase tracking-wider text-titan-gray-mid">Cost / dev / active day</div>
          <div className={`text-3xl font-bold mt-1 ${overBenchmark ? 'text-titan-warning' : 'text-titan-success'}`}>
            {usd(r.costPerDevDay)}
          </div>
          <div className="text-xs text-titan-gray-mid mt-1">
            Anthropic avg ≈ {usd(r.anthropicBenchmarkUsd)} — this cohort is {overBenchmark ? 'above' : 'below'}
          </div>
          <div className="mt-2"><Badge text="FACT vs PUBLISHED AVG" cls="bg-titan-success/15 text-titan-success" /></div>
        </div>

        {/* Savings + discount — HARNESS-ONLY headline. Anthropic's automatic
            prompt-caching discount is deliberately excluded here: it required
            no Titan work, so it isn't "what the harness returned." */}
        <div className="rounded-card p-5 bg-white ring-1 ring-titan-gray-light text-center cursor-help"
             title={'Harness-attributable savings only: model routing + answer-cache + caveman + Copilot deflection\n(each labeled fact / assumption / estimate — see the Savings section for formulas).\nDeliberately EXCLUDES the Anthropic prompt-caching line — that fires automatically for any\nClaude Code user and required no Titan decision or code.\nHarness discount = harness savings ÷ (harness savings + exact spend).'}>
          <div className="text-xs uppercase tracking-wider text-titan-gray-mid">Savings — harness-attributable</div>
          <div className="text-3xl font-bold text-titan-success mt-1">{usd(r.harnessSavingsUsd)}</div>
          <div className="text-xs text-titan-gray-mid mt-1">
            {r.harnessDiscountPct.toFixed(0)}% harness discount · {r.cacheHitCount} zero-token cache hits
          </div>
          <div className="mt-2"><Badge text="WHAT TITAN BUILT" cls="bg-titan-success/15 text-titan-success" /></div>
        </div>

        {/* Annualized run-rate — harness-only */}
        <div className="rounded-card p-5 bg-white ring-1 ring-titan-gray-light text-center cursor-help"
             title={'Current period HARNESS-ATTRIBUTABLE savings run-rate × 365. A projection, not a booked figure.\n' +
                    `All-in (incl. Anthropic platform caching): ${usd(r.savingsRunRateUsd)}/yr — see Savings section.\n` +
                    'Finance sign-off required before any external ROI claim.'}>
          <div className="text-xs uppercase tracking-wider text-titan-gray-mid">Harness savings run-rate</div>
          <div className="text-3xl font-bold text-titan-blue-main mt-1">{usd(r.harnessRunRateUsd)}/yr</div>
          <div className="text-xs text-titan-gray-mid mt-1">{r.ticketsTouched} tickets touched this period</div>
          <div className="mt-2"><Badge text="PROJECTION" cls="bg-titan-warning/15 text-titan-warning" /></div>
        </div>
      </div>

      {/* Net-value bridge — facts only: harness savings − rework waste = net.
          Rework waste is real billed cost_usd (AI hallucinations the developer had
          to correct) — the single most defensible number on this page. */}
      <div className="bg-white rounded-card ring-1 ring-titan-gray-light p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold text-titan-gray-dark cursor-help"
               title={'Net harness value = harness-attributable savings − rework waste.\nRework waste = real billed cost_usd of correction turns — the exact money spent on AI output the\ndeveloper then had to fix (tool failures, corrections, spirals). Both are facts; rework waste is\nbilled reality, not a model. No hourly-rate assumption. Full detail + trend in the Correction-cost section.'}>
            Net harness value <span className="text-titan-gray-mid font-normal">(savings − rework waste)</span>
          </div>
          <Badge text="FACT" cls="bg-titan-success/15 text-titan-success" />
        </div>
        {(() => {
          const scale = Math.max(r.harnessSavingsUsd, r.reworkWasteUsd, Math.abs(r.netHarnessValueUsd), 1);
          return (
            <>
              <BridgeRow label="Harness savings" val={r.harnessSavingsUsd} color="#1F8B4C" sign="+" scale={scale} />
              <BridgeRow label="− Rework waste (measured)" val={r.reworkWasteUsd} color="#D62828" sign="−" scale={scale} />
              <div className="border-t border-titan-gray-light my-1" />
              <BridgeRow label="= Net harness value" val={r.netHarnessValueUsd} color="#1F5FBF"
                         sign={r.netHarnessValueUsd < 0 ? '−' : ''} scale={scale} />
            </>
          );
        })()}
        <div className="text-xs text-titan-gray-mid mt-3 flex flex-wrap gap-x-4 gap-y-1">
          <span className="cursor-help"
                title={'Rework token ratio = tokens spent on correction turns ÷ total tokens. The DORA quality\ncounter-metric — a stronger signal than raw block counts. Lower is better; watch the trend.'}>
            Rework ratio <b>{(r.reworkRatio * 100).toFixed(1)}%</b> of tokens <Badge text="QUALITY COUNTER-METRIC" cls="bg-titan-blue-soft/40 text-titan-blue-main" />
          </span>
          <span>Spirals contained: <b>{r.spiralsContained}</b></span>
        </div>
      </div>

      {/* Platform-baseline context — separate line, not a KPI tile, so it can't
          be mistaken for a harness result. Anthropic prompt caching lowers total
          spend for anyone using Claude Code; it isn't credited to Titan. */}
      <div className="text-xs text-titan-gray-mid px-1 cursor-help"
           title={'Anthropic prompt caching (platform feature, automatic, not built by Titan) additionally\nlowered exact spend this period. Shown for total-cost-of-ownership context only — see the\n"Platform baseline" row in the Savings section for the formula.'}>
        + {usd(r.platformInherentUsd)} additional platform-baseline discount this period (Anthropic prompt caching — automatic, not a Titan result; see Savings section)
      </div>

      {/* Effective-discount trend */}
      <div className="bg-white rounded-card ring-1 ring-titan-gray-light p-4">
        <div className="text-sm font-semibold text-titan-gray-dark mb-1 cursor-help"
             title={'Per-day effective discount from the two per-call levers (prompt cache — platform, fact;\nmodel routing — harness, assumption). Blended across tiers because both are exact per-call\ndata; period-level estimates (Copilot, answer cache, caveman) are excluded from the daily\ntrend so the curve stays defensible. This trend is all-in, NOT the harness-only headline above.'}>
          All-in discount per day <span className="text-titan-gray-mid font-normal">(cache + routing only — exact per-call data, includes platform tier)</span>
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={r.discountTrend} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E8E8E8" />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} unit="%" domain={[0, 100]} />
            <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} />
            <Line type="monotone" dataKey="pct" stroke="#1F8B4C" strokeWidth={2} dot={false} name="discount %" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Stability guardrail (DORA pairing) */}
      <div className="bg-white rounded-card ring-1 ring-titan-gray-light p-4">
        <div className="text-sm font-semibold text-titan-gray-dark mb-1 cursor-help"
             title={'DORA 2025: AI raises throughput AND instability — savings shown without a stability\ncounter-metric invite the obvious question. This is the v1 guardrail: governance hook-blocks\nper day (credential / PHI / hard-stop / Hybris interceptions). Flat-at-zero = guardrails quiet;\nspikes = review immediately (see Safety section).'}>
          Stability guardrail — governance blocks per day
        </div>
        {r.hookBlocksTrend.length ? (
          <ResponsiveContainer width="100%" height={120}>
            <LineChart data={r.hookBlocksTrend} margin={{ top: 8, right: 16, bottom: 0, left: -24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E8E8E8" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip />
              <ReferenceLine y={0} stroke="#1F8B4C" />
              <Line type="monotone" dataKey="count" stroke="#D62828" strokeWidth={2} dot={false} name="blocks" />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="text-xs text-titan-gray-mid py-4">
            {r.hookBlocksInstrumented
              ? 'Zero governance blocks this period — guardrails active and quiet. ✓'
              : 'Not instrumented — the governance hooks this trend tracks don’t emit blocking telemetry yet (see Safety, Operations view).'}
          </div>
        )}
      </div>

      {/* Methodology note */}
      <div className="text-xs text-titan-gray-mid">
        Methodology: every figure = baseline + delta + labeled basis. Headline savings/run-rate above are
        <b> harness-attributable only</b> — Anthropic's automatic prompt-caching discount is reported separately
        (see the line above the KPI tiles and the "Platform baseline" row in Savings) because it required no
        Titan decision or code. No self-reported speedup metrics anywhere (METR 2025 RCT: developers <i>felt</i>
        20% faster while <i>measured</i> 19% slower). Cost-per-PR has no published benchmark — tracked as an
        internal trend. Anthropic list pricing; your org's contract rates may differ — Finance confirms before external claims.
      </div>
    </div>
  );
}
