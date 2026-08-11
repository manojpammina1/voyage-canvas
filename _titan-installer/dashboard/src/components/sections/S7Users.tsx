import { useEffect, useState } from 'react';
import type { UserRow } from '../../lib/types';

// Per-user view. Blob nodes are anonymous SHA-256 hashes. If the maintainer has
// placed a PRIVATE hash->name map at /user-map.json (gitignored, dashboard-only,
// built via scripts/build-user-map.mjs), we overlay display names here — WITHOUT
// any name ever being stored in the telemetry blob.
export default function S7Users({ users }: { users: UserRow[] }) {
  const [nameMap, setNameMap] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    fetch('/user-map.json')
      .then((r) => (r.ok ? r.json() : {}))
      .then((m) => { if (!cancelled) setNameMap(m || {}); })
      .catch(() => { /* no map present — stay anonymous */ });
    return () => { cancelled = true; };
  }, []);

  const hasMap = Object.keys(nameMap).length > 0;

  if (!users.length) {
    return <div className="text-sm text-titan-gray-mid">No user data in this period.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-titan-gray-light">
            {['User', 'Sessions', 'Prompts', 'Prompts/Session', 'Top role', 'Top skill', 'Est. spend', 'Cost/Session', 'Cost/Prompt'].map((h) => (
              <th key={h} className="text-left text-xs text-titan-gray-mid font-medium py-2 pr-4 uppercase tracking-wide">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {users.map((u, i) => {
            const name = nameMap[u.hash];
            return (
              <tr key={u.hash} className={`border-b border-titan-gray-light last:border-b-0 ${i === 0 ? 'font-medium' : ''}`}>
                <td className="py-2 pr-4">
                  {name
                    ? <span className="text-titan-gray-dark">{name} <span className="font-mono text-[10px] text-titan-gray-mid">({u.hash})</span></span>
                    : <span className="font-mono text-xs text-titan-gray-mid">{u.hash}</span>}
                </td>
                <td className="py-2 pr-4 text-titan-gray-dark">{u.sessions}</td>
                <td className="py-2 pr-4 text-titan-gray-dark">{u.prompts}</td>
                <td className="py-2 pr-4 text-titan-gray-dark">{u.promptsPerSession.toFixed(1)}</td>
                <td className="py-2 pr-4">
                  <span className="px-2 py-0.5 rounded-pill bg-titan-blue-soft text-titan-blue-main text-xs">/{u.topRole}</span>
                </td>
                <td className="py-2 pr-4 font-mono text-xs text-titan-gray-dark">/{u.topSkill}</td>
                <td className="py-2 pr-4 text-titan-gray-dark">${u.estSpendUsd.toFixed(2)}</td>
                <td className="py-2 pr-4 text-titan-gray-dark text-xs">${u.costPerSession.toFixed(3)}</td>
                <td className="py-2 pr-4 text-titan-gray-dark text-xs">${u.costPerPrompt.toFixed(3)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-xs text-titan-gray-mid mt-3">
        <strong>User IDs are one-way hashes:</strong> Each user's identifier is a non-reversible SHA-256 hash, stable per machine. No real names or identifying information is stored in telemetry.
        {hasMap && ' This display overlays a private hash→name map (dashboard-only) — the map itself never reaches the telemetry blob.'}
      </p>
    </div>
  );
}
