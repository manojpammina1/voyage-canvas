import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { ProductivityMetrics } from '../../lib/types';

const DAYS  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

export default function S6Productivity({ p }: { p: ProductivityMetrics }) {
  const maxHeat = Math.max(...p.heatmap.map((h) => h.count), 1);

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="bg-titan-gray-light rounded-card p-4 text-center">
          <div className="text-2xl font-bold text-titan-blue-main">{p.avgPromptsPerSession.toFixed(1)}</div>
          <div className="text-xs text-titan-gray-mid">Avg prompts/session</div>
        </div>
        <div className="bg-titan-gray-light rounded-card p-4 text-center">
          <div className="text-2xl font-bold text-titan-blue-main">{p.p50PromptsPerSession.toFixed(0)}</div>
          <div className="text-xs text-titan-gray-mid">Median prompts/session</div>
        </div>
        <div className="bg-titan-gray-light rounded-card p-4 text-center">
          <div className="text-2xl font-bold text-titan-blue-main">{p.topBashPrograms[0]?.program ?? '—'}</div>
          <div className="text-xs text-titan-gray-mid">Most used CLI tool</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Top bash programs */}
        <div>
          <div className="text-sm font-semibold text-titan-gray-dark mb-2">CLI tools invoked</div>
          {p.topBashPrograms.length > 0 ? (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={p.topBashPrograms}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E6E8EB" />
                <XAxis dataKey="program" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#2F6FED" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="text-sm text-titan-gray-mid h-40 flex items-center justify-center">No Bash data</div>}
        </div>

        {/* Activity heatmap */}
        <div>
          <div className="text-sm font-semibold text-titan-gray-dark mb-2">Activity heatmap (hour × weekday, UTC)</div>
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse">
              <thead>
                <tr>
                  <th className="w-8 text-titan-gray-mid pr-1" />
                  {HOURS.filter((h) => h % 3 === 0).map((h) => (
                    <th key={h} className="w-5 text-titan-gray-mid font-normal">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {DAYS.map((day, di) => (
                  <tr key={day}>
                    <td className="pr-1 text-titan-gray-mid whitespace-nowrap">{day}</td>
                    {HOURS.map((h) => {
                      const entry = p.heatmap.find((x) => x.day === di && x.hour === h);
                      const intensity = entry ? entry.count / maxHeat : 0;
                      const alpha = Math.round(intensity * 255).toString(16).padStart(2, '0');
                      return (
                        <td key={h} className="w-5 h-5 rounded-sm m-px"
                            style={{ backgroundColor: `#2F6FED${alpha}` }}
                            title={`${day} ${h}:00 — ${entry?.count ?? 0} events`} />
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
