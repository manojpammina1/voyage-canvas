import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { SkillsMetrics } from '../../lib/types';

export default function S4Skills({ s }: { s: SkillsMetrics }) {
  return (
    <div className="space-y-5">
      <div>
        <div className="text-sm font-semibold text-titan-gray-dark mb-2">Top 10 skills by usage</div>
        {s.top10.length > 0 ? (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={s.top10} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#E6E8EB" />
              <XAxis type="number" tick={{ fontSize: 10 }} />
              {/* interval={0} forces EVERY category tick to render. Recharts'
                  default (preserveEnd) thins labels from the start when it
                  estimates crowding, which silently drops the top bar's label
                  once there are ~10 skills — that's why the #1 skill (caveman)
                  appeared unlabeled while the shorter list in S3Adoption did not. */}
              <YAxis dataKey="skill" type="category" width={150} tick={{ fontSize: 10 }} interval={0} />
              <Tooltip />
              <Bar dataKey="count" fill="#2F6FED" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="text-sm text-titan-gray-mid h-40 flex items-center justify-center">No skill invocations recorded yet</div>
        )}
      </div>

      {s.dead.length > 0 && (
        <div>
          <div className="text-sm font-semibold text-titan-warning mb-2">
            ⚠ {s.dead.length} skill{s.dead.length === 1 ? '' : 's'} with 0 uses this period
          </div>
          <div className="flex flex-wrap gap-2">
            {s.dead.slice(0, 20).map((sk) => (
              <span key={sk} className="px-2 py-0.5 rounded-pill bg-titan-gray-light text-titan-gray-mid text-xs font-mono">
                /{sk}
              </span>
            ))}
            {s.dead.length > 20 && (
              <span className="text-xs text-titan-gray-mid self-center">+{s.dead.length - 20} more</span>
            )}
          </div>
          <p className="text-xs text-titan-gray-mid mt-2">
            These skills exist in the harness but weren't invoked. Candidates for training or deprecation.
          </p>
        </div>
      )}
    </div>
  );
}
