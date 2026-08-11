import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { TrendMetrics } from '../../lib/types';

const Spark = ({ data, dataKey, color, label, formatter }: {
  data: object[]; dataKey: string; color: string; label: string; formatter: (v: number) => string;
}) => (
  <div>
    <div className="text-sm font-semibold text-titan-gray-dark mb-1">{label}</div>
    {data.length > 0 ? (
      <ResponsiveContainer width="100%" height={120}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E6E8EB" />
          <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={(d: string) => d.slice(5)} />
          <YAxis tick={{ fontSize: 9 }} tickFormatter={formatter} width={45} />
          <Tooltip formatter={(v: number) => formatter(v)} />
          <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    ) : (
      <div className="h-24 flex items-center justify-center text-sm text-titan-gray-mid">No trend data yet</div>
    )}
  </div>
);

export default function S8Trend({ t }: { t: TrendMetrics }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <Spark data={t.promptsPerDay}     dataKey="count" color="#2F6FED" label="Prompts / day"
             formatter={(v) => String(v)} />
      <Spark data={t.costPerDay}        dataKey="usd"   color="#1F8B4C" label="Est. cost / day (USD)"
             formatter={(v) => `$${v.toFixed(2)}`} />
      <Spark data={t.activeUsersPerDay} dataKey="count" color="#E89110" label="Active users / day"
             formatter={(v) => String(v)} />
    </div>
  );
}
