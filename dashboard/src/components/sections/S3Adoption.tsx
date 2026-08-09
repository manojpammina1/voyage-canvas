import {
  BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import type { AdoptionMetrics } from '../../lib/types';

const ROLE_COLORS: Record<string, string> = {
  'dev-mode':        '#2F6FED',
  'lead-review':     '#1E4FBF',
  'arch-mode':       '#1F8B4C',
  'po-mode':         '#E89110',
  'grill-me':        '#8B5CF6',
  'qa-mode':         '#06B6D4',
  'security-mode':   '#D62828',
  'sre-mode':        '#64748B',
  'designer-mode':   '#EC4899',
  'prodsupport-mode':'#F59E0B',
};

export default function S3Adoption({ a }: { a: AdoptionMetrics }) {
  const allRoles = [...new Set(a.dailyByRole.flatMap((d) => Object.keys(d).filter((k) => k !== 'date')))];
  const WORK_COLORS: Record<string, string> = {
    'Architecture work': '#1F8B4C',
    'Code generation':   '#2F6FED',
    'Code review':       '#1E4FBF',
    'Refactor':          '#8B5CF6',
    'Q&A / lookup':      '#E89110',
    'General':           '#64748B',
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Role bar */}
        <div>
          <div className="text-sm font-semibold text-titan-gray-dark mb-2">Activations by role</div>
          {a.byRole.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={a.byRole} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#E6E8EB" />
                <XAxis type="number" tick={{ fontSize: 10 }} />
                {/* interval={0}: force every role label — see S4Skills note.
                    Latent here too (up to 10 roles), fixed pre-emptively. */}
                <YAxis dataKey="role" type="category" width={115} tick={{ fontSize: 10 }} interval={0} />
                <Tooltip />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {a.byRole.map((e, i) => (
                    <rect key={i} fill={ROLE_COLORS[e.role] ?? '#2F6FED'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-sm text-titan-gray-mid h-48 flex items-center justify-center">No role data yet</div>
          )}
        </div>

        {/* Stacked area */}
        <div>
          <div className="text-sm font-semibold text-titan-gray-dark mb-2">Daily usage by role</div>
          {a.dailyByRole.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={a.dailyByRole}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E6E8EB" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d: string) => d.slice(5)} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                {allRoles.map((role) => (
                  <Area key={role} type="monotone" dataKey={role}
                        fill={ROLE_COLORS[role] ?? '#2F6FED'}
                        stroke={ROLE_COLORS[role] ?? '#2F6FED'}
                        stackId="1" fillOpacity={0.6} />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-sm text-titan-gray-mid h-48 flex items-center justify-center">No daily data yet</div>
          )}
        </div>
      </div>
      {/* Work type breakdown (proxy from prompt class) */}
      {a.byWorkType.length > 0 && (
        <div className="mt-4 pt-4 border-t border-titan-gray-light">
          <div className="text-sm font-semibold text-titan-gray-dark mb-3">
            Work type breakdown <span className="font-normal text-titan-gray-mid">(derived from prompt classification)</span>
          </div>
          <div className="flex flex-wrap gap-3">
            {a.byWorkType.map(({ label, count }) => (
              <div key={label} className="flex items-center gap-2 text-sm">
                <span className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: WORK_COLORS[label] ?? '#64748B' }} />
                <span className="text-titan-gray-dark">{label}</span>
                <span className="text-titan-gray-mid">({count})</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
