'use client';

import { EvidenceBadge, GlassPanel } from './primitives';
import { useCanvas } from '../experience/context';

export function AccessibleVoyageList() {
  const { options, selectedOptionId, selectOption } = useCanvas();

  if (options.length === 0) {
    return (
      <GlassPanel>
        <p style={{ padding: '1rem', margin: 0 }}>No voyages match your criteria.</p>
      </GlassPanel>
    );
  }

  return (
    <div className="vc-list" role="list" aria-label="Voyage options">
      {options.map((opt) => {
        const selected = opt.id === selectedOptionId;
        return (
          <button
            key={opt.id}
            type="button"
            role="listitem"
            className={`vc-list-item${selected ? ' vc-list-item--selected' : ''}`}
            aria-pressed={selected}
            onClick={() => selectOption(opt.id)}
          >
            <div>
              <strong style={{ fontFamily: 'var(--font-display)' }}>
                {opt.shipLabel}
              </strong>
              <div style={{ fontSize: '0.8rem', color: 'var(--on-surface-variant)' }}>
                {opt.departureLabel} · {opt.sailing.nights} nights · Balcony
              </div>
              <EvidenceBadge>Verified</EvidenceBadge>
            </div>
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 700,
                fontSize: '1.25rem',
                color: 'var(--secondary)',
              }}
            >
              ${opt.totalUsd.toLocaleString('en-US')}
            </div>
          </button>
        );
      })}
    </div>
  );
}
