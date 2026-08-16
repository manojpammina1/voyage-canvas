'use client';

import { Button, GlassPanel } from './primitives';
import { useCanvas } from '../experience/context';

function criteriaSummary(criteria: ReturnType<typeof useCanvas>['criteria']) {
  const parts = [
    criteria.nights ? `${criteria.nights}-night` : undefined,
    criteria.destination,
    criteria.month,
    criteria.cabinType ? criteria.cabinType.replace('_', ' ') : undefined,
    criteria.maxPriceUsd
      ? `under $${criteria.maxPriceUsd.toLocaleString('en-US')}`
      : undefined,
  ].filter(Boolean);

  return parts.join(' · ');
}

export function NoResultsPanel() {
  const {
    criteria,
    loading,
    searchSavedCriteria,
    relaxToAvailableDuration,
    setIntentDraft,
  } = useCanvas();

  const requestedNights = criteria.nights;

  return (
    <GlassPanel active className="vc-no-results" role="status" aria-live="polite">
      <p className="vc-no-results__eyebrow">No exact verified match</p>
      <h2>No {requestedNights ?? ''}-night Caribbean balcony sailings are in this demo catalog.</h2>
      <p>
        The search worked, but the local deterministic data currently contains
        March 2027 Caribbean sailings for 7 nights only. We do not fabricate
        unavailable sailings, prices, or cabins.
      </p>
      <dl className="vc-no-results__criteria" aria-label="Searched criteria">
        <div>
          <dt>Searched</dt>
          <dd>{criteriaSummary(criteria) || 'Current criteria'}</dd>
        </div>
      </dl>
      <div className="vc-no-results__actions">
        <Button
          type="button"
          disabled={loading}
          onClick={() => {
            setIntentDraft(
              '7-night Caribbean cruise in March 2027 for 1 adult and 2 kids, balcony, under $5,000',
            );
            void relaxToAvailableDuration();
          }}
        >
          Try available 7-night sailings
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={loading}
          onClick={() => void searchSavedCriteria()}
        >
          Search exact criteria again
        </Button>
      </div>
    </GlassPanel>
  );
}
