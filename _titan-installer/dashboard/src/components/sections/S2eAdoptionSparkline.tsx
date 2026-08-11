import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import type { TrendMetrics, PilotSnapshot } from '../../lib/types';

// S2e — Adoption sparkline (leadership view). Reuses the existing
// trend.activeUsersPerDay (already computed by aggregations.ts for the
// Operations "30-day trends" section) — no new aggregation logic. Answers
// the one adoption question leadership actually needs: is the investment
// being used, not the full productivity/heatmap detail Operations gets.

export default function S2eAdoptionSparkline({ t, snapshot }: { t: TrendMetrics; snapshot: PilotSnapshot }) {
  return (
    <div className="bg-white rounded-card ring-1 ring-titan-gray-light p-4">
      <div className="flex items-center justify-between mb-1">
        <div className="text-sm font-semibold text-titan-gray-dark cursor-help"
             title={'Distinct hashed users per day with any telemetry event. Same data as the Operations\n"30-day trends" section — reused here as the single adoption signal leadership needs:\nis the pilot cohort actually using the harness.'}>
          Adoption — active users per day
        </div>
        <div className="text-xs text-titan-gray-mid">{snapshot.activeUsers} active users this period</div>
      </div>
      <ResponsiveContainer width="100%" height={100}>
        <LineChart data={t.activeUsersPerDay} margin={{ top: 4, right: 8, bottom: 0, left: -24 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E8E8E8" />
          <XAxis dataKey="date" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
          <Tooltip />
          <Line type="monotone" dataKey="count" stroke="#2F6FED" strokeWidth={2} dot={false} name="active users" />
        </LineChart>
      </ResponsiveContainer>
      <div className="text-[10px] text-titan-gray-mid mt-1">Rising = adoption growing. Flat = stalled — target outreach (full skill/role detail in Operations view).</div>
    </div>
  );
}
