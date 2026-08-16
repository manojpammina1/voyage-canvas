'use client';

import { Button, GlassPanel } from './primitives';
import { useCanvas } from '../experience/context';

/** Deterministic fallback when AI streaming is unavailable (T17). */
export function GuidedVoyagePlanner() {
  const {
    criteria,
    lockedPreferences,
    searchSavedCriteria,
    updateBudget,
    loading,
    fallbackReason,
  } = useCanvas();

  return (
    <div className="vc-guided-wrap">
      <GlassPanel className="vc-guided">
        <h2 id="guided-heading">Guided voyage planner</h2>
        <p>
          AI assistance is temporarily unavailable
          {fallbackReason ? ` (${fallbackReason.replace(/_/g, ' ').toLowerCase()})` : ''}.
          Your confirmed criteria are preserved — adjust and search using the same deterministic services.
        </p>
        <dl className="vc-guided__criteria">
          <dt>Destination</dt>
          <dd>{criteria.destination ?? '—'}</dd>
          <dt>Month</dt>
          <dd>{criteria.month ?? '—'}</dd>
          <dt>Budget</dt>
          <dd>{criteria.maxPriceUsd ? `$${criteria.maxPriceUsd}` : '—'}</dd>
          <dt>Locks</dt>
          <dd>{lockedPreferences.map((l) => l.criterion).join(', ') || 'None'}</dd>
        </dl>
        <div className="vc-guided__actions">
          <Button type="button" disabled={loading} onClick={() => void searchSavedCriteria()}>
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
