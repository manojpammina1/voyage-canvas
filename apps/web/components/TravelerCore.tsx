'use client';

import type { SearchCriteria } from '@voyage/shared';
import { GlassPanel } from './primitives';
import { useCanvas } from '../experience/context';

function formatOccupancy(criteria: SearchCriteria): string {
  const a = criteria.occupancy?.adults ?? 2;
  const c = criteria.occupancy?.children ?? 0;
  const parts = [`${a} adult${a === 1 ? '' : 's'}`];
  if (c > 0) parts.push(`${c} child${c === 1 ? '' : 'ren'}`);
  return parts.join(' · ');
}

function buildAvatars(criteria: SearchCriteria): string[] {
  const adults = criteria.occupancy?.adults ?? 2;
  const children = criteria.occupancy?.children ?? 0;
  const avatars: string[] = [];
  for (let i = 0; i < Math.min(adults, 2); i++) avatars.push('A');
  for (let i = 0; i < Math.min(children, 2); i++) avatars.push('C');
  while (avatars.length < 4 && avatars.length < adults + children) {
    avatars.push(avatars.length % 2 === 0 ? 'A' : 'C');
  }
  return avatars.slice(0, 4);
}

export function TravelerCore() {
  const { criteria, confirmedCriteria, nodesReveal } = useCanvas();
  const c = { ...confirmedCriteria, ...criteria };
  const avatars = buildAvatars(c);

  const chips: Array<{ label: string; delay: number }> = [];
  if (c.destination) chips.push({ label: c.destination, delay: 0.1 });
  if (c.month) chips.push({ label: c.month, delay: 0.18 });
  if (c.nights) chips.push({ label: `${c.nights} nights`, delay: 0.26 });
  if (c.cabinType) chips.push({ label: c.cabinType, delay: 0.34 });
  if (c.maxPriceUsd)
    chips.push({ label: `≤ $${c.maxPriceUsd.toLocaleString('en-US')}`, delay: 0.42 });

  return (
    <GlassPanel className="vc-traveler-core vc-traveler-core--live">
      {nodesReveal && <span className="vc-traveler-core__pulse" aria-hidden="true" />}
      <div className="vc-family-grid" aria-label={`Travel party: ${formatOccupancy(c)}`}>
        {avatars.map((label, i) => (
          <span
            key={`${label}-${i}`}
            className="vc-family-avatar"
            style={nodesReveal ? { animationDelay: `${0.05 + i * 0.07}s` } : undefined}
            aria-hidden="true"
          >
            {label}
          </span>
        ))}
      </div>
      <div className="vc-traveler-core__title">Your traveler core</div>
      <div className="vc-traveler-core__meta">{formatOccupancy(c)}</div>
      {nodesReveal && chips.length > 0 && (
        <div className="vc-chip-row" role="list" aria-label="Parsed trip criteria">
          {chips.map((chip) => (
            <span
              key={chip.label}
              className="vc-chip vc-criteria-chip"
              role="listitem"
              style={{ animationDelay: `${chip.delay}s` }}
            >
              {chip.label}
            </span>
          ))}
        </div>
      )}
    </GlassPanel>
  );
}
