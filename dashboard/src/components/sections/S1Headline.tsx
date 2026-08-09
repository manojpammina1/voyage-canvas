import type { PilotSnapshot } from '../../lib/types';

const Tile = ({ label, value, delta }: { label: string; value: string | number; delta?: number | null }) => (
  <div className="bg-titan-blue-soft/40 rounded-card p-5 text-center">
    <div className="text-3xl font-bold text-titan-blue-main mb-1">{value}</div>
    <div className="text-xs text-titan-gray-mid uppercase tracking-wider">{label}</div>
    {delta != null && (
      <div className={`text-xs font-medium mt-1 ${delta >= 0 ? 'text-titan-success' : 'text-titan-danger'}`}>
        {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)} vs prior period
      </div>
    )}
  </div>
);

export default function S1Headline({ s }: { s: PilotSnapshot }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <Tile label="Active users"     value={s.activeUsers}  delta={s.deltaUsers} />
      <Tile label="Sessions (est.)"   value={s.sessions} />
      <Tile label="Prompts"          value={s.prompts.toLocaleString()} delta={s.deltaPrompts} />
      <Tile label="Avg session (min)" value={s.avgSessionMinutes} />
    </div>
  );
}
