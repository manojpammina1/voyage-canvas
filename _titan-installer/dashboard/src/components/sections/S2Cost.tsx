import {
  LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import type { CostMetrics } from '../../lib/types';

const COLORS = ['#2F6FED', '#1E4FBF', '#1F8B4C', '#E89110', '#D62828'];

// Recharts positions each pie label along a fixed radial line from the slice's
// own midpoint — with several small adjacent slices (2-7%), those anchor
// points land close enough in angle that the text collides (the original bug).
// Rather than switching to a legend, keep the on-chart labels but only render
// them for slices with enough angular room to not collide; tiny slices are
// still visible (color + tooltip on hover), just not text-labeled.
const MIN_LABEL_PCT = 4;

export default function S2Cost({ c }: { c: CostMetrics }) {
  const prefix = c.hasActualData ? '$' : '~$';
  const labelSuffix = c.hasActualData ? '' : ' (est.)';

  return (
    <div className="space-y-6">
      {/* Data source badge */}
      <div className={`flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-pill w-fit ${
        c.hasActualData
          ? 'bg-titan-success/15 text-titan-success'
          : 'bg-titan-warning/15 text-titan-warning'
      }`}>
        <span>{c.hasActualData ? '✓ Exact — from Claude Code API response' : '~ Pre-flight estimates only'}</span>
        {!c.hasActualData && <span className="font-normal">(Stop hook not yet receiving data)</span>}
      </div>

      {/* Token counts row — only shown when exact data exists */}
      {c.hasActualData && (
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Input tokens',       value: c.totalInputTokens.toLocaleString()  },
            { label: 'Output tokens',      value: c.totalOutputTokens.toLocaleString() },
            { label: 'Cache read tokens',  value: c.totalCacheRead.toLocaleString()    },
          ].map(({ label, value }) => (
            <div key={label} className="bg-titan-blue-soft/30 rounded-card p-3 text-center">
              <div className="text-xl font-bold text-titan-blue-main font-mono">{value}</div>
              <div className="text-xs text-titan-gray-mid mt-0.5">{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* KPI row — spend only; savings live in the dedicated Savings section */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { label: `Spend (period)${labelSuffix}`,  value: `${prefix}${c.totalEstUsd.toFixed(2)}`  },
          { label: `Spend (7 days)${labelSuffix}`,  value: `${prefix}${c.last7dEstUsd.toFixed(2)}` },
          { label: `Spend (today)${labelSuffix}`,   value: `${prefix}${c.todayEstUsd.toFixed(2)}`  },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-card p-4 text-center bg-titan-gray-light">
            <div className="text-2xl font-bold text-titan-gray-dark">{value}</div>
            <div className="text-xs text-titan-gray-mid mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Daily cost line */}
        <div>
          <div className="text-sm font-semibold text-titan-gray-dark mb-2">Daily cost (USD)</div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={c.dailyCost}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E6E8EB" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d: string) => d.slice(5)} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => `$${v.toFixed(2)}`} />
              <Tooltip formatter={(v: number) => [`$${v.toFixed(4)}`, 'Est. cost']} />
              <Line type="monotone" dataKey="usd" stroke="#2F6FED" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Model donut */}
        <div>
          <div className="text-sm font-semibold text-titan-gray-dark mb-2">Spend by model</div>
          {c.byModel.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={c.byModel} dataKey="usd" nameKey="model" cx="50%" cy="50%" outerRadius={70}
                    label={({ model, usd, pct }) => (pct >= MIN_LABEL_PCT ? `${model} $${usd.toFixed(2)} (${pct}%)` : '')}
                    // Custom leader line WITH an arrowhead pointing at the label —
                    // Recharts' default is a plain line with no arrow marker.
                    // Recharts' own declared type for this prop is (props: any) =>
                    // ReactElement<SVGElement, ...>, so `any` here matches the
                    // library's own type, not a shortcut around it.
                    labelLine={(props: any) => {
                      const { points, stroke, pct } = props;
                      if (pct < MIN_LABEL_PCT || !points || points.length < 2) return <g />;
                      const [start, end] = points;
                      const angle = Math.atan2(end.y - start.y, end.x - start.x);
                      const len = 6;
                      const a1 = { x: end.x - len * Math.cos(angle - Math.PI / 6), y: end.y - len * Math.sin(angle - Math.PI / 6) };
                      const a2 = { x: end.x - len * Math.cos(angle + Math.PI / 6), y: end.y - len * Math.sin(angle + Math.PI / 6) };
                      const lineColor = stroke || '#8A94A6';
                      return (
                        <g>
                          <polyline points={`${start.x},${start.y} ${end.x},${end.y}`} stroke={lineColor} fill="none" />
                          <polygon points={`${end.x},${end.y} ${a1.x},${a1.y} ${a2.x},${a2.y}`} fill={lineColor} />
                        </g>
                      );
                    }}
                  >
                    {c.byModel.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: number, _n, entry) => [`$${v.toFixed(4)}`, entry?.payload?.model ?? 'model']} />
                </PieChart>
              </ResponsiveContainer>
              {/* Full model list — independent of the pie's own label suppression,
                  so slices too small to label on-chart (< MIN_LABEL_PCT) are still
                  represented here. Built directly from c.byModel, not Recharts'
                  <Legend>, which doesn't reliably type the Pie datum through. */}
              <div className="flex flex-wrap gap-x-4 gap-y-1 justify-center mt-1">
                {c.byModel.map((m, i) => (
                  <div key={m.model} className="flex items-center gap-1.5 text-xs text-titan-gray-mid">
                    <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                    <span>{m.model} — ${m.usd.toFixed(2)} ({m.pct}%)</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="text-sm text-titan-gray-mid h-48 flex items-center justify-center">No model data yet</div>
          )}
        </div>
      </div>

      {!c.hasActualData && (
        <div className="p-3 rounded-card bg-titan-warning/10 text-xs text-titan-gray-mid">
          ⚠ Upgrade to exact numbers: restart Claude Code — the Stop hook will capture real token counts from the next session onward.
          Or check <a href="https://console.anthropic.com" target="_blank" rel="noreferrer" className="text-titan-blue-main underline">console.anthropic.com</a> for verified billing.
        </div>
      )}

    </div>
  );
}
