'use client';

import { Button, GlassPanel } from './primitives';
import { useCanvas } from '../experience/context';

/** Deterministic fallback when AI streaming is unavailable (T17). */
export function GuidedVoyagePlanner() {
  const {
    criteria,
    lockedPreferences,
    submitIntent,
    updateBudget,
    loading,
    fallbackReason,
  } = useCanvas();

  return (
    <div style={{ maxWidth: 720, margin: '2rem auto' }}>
      <GlassPanel className="vc-guided">
      <h2 id="guided-heading">Guided voyage planner</h2>
      <p style={{ lineHeight: 1.6, color: 'var(--on-surface-variant)' }}>
        AI assistance is temporarily unavailable
        {fallbackReason ? ` (${fallbackReason.replace(/_/g, ' ').toLowerCase()})` : ''}.
        Your confirmed criteria are preserved — adjust and search using the same deterministic services.
      </p>
      <dl style={{ fontSize: '0.9rem', margin: '1rem 0' }}>
        <dt style={{ fontWeight: 600 }}>Destination</dt>
        <dd>{criteria.destination ?? '—'}</dd>
        <dt style={{ fontWeight: 600 }}>Month</dt>
        <dd>{criteria.month ?? '—'}</dd>
        <dt style={{ fontWeight: 600 }}>Budget</dt>
        <dd>{criteria.maxPriceUsd ? `$${criteria.maxPriceUsd}` : '—'}</dd>
        <dt style={{ fontWeight: 600 }}>Locks</dt>
        <dd>{lockedPreferences.map((l) => l.criterion).join(', ') || 'None'}</dd>
      </dl>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        <Button type="button" disabled={loading} onClick={() => void submitIntent()}>
          Search again with saved criteria
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={loading}
          onClick={() => void updateBudget(4400)}
        >
          Try $4,400 budget
        </Button>
      </div>
    </GlassPanel>
    </div>
  );
}
