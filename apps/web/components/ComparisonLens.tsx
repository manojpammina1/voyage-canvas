'use client';

import { GlassPanel } from './primitives';
import { useCanvas } from '../experience/context';

export function ComparisonLens() {
  const { comparison, stage } = useCanvas();

  if (stage !== 'comparing' || !comparison) {
    return null;
  }

  return (
    <GlassPanel className="vc-compare-panel">
      <h3
        style={{
          margin: '0 0 0.75rem',
          fontFamily: 'var(--font-display)',
          fontSize: '0.875rem',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        Compare two voyages
      </h3>
      <dl>
        <dt>Price delta</dt>
        <dd>
          {comparison.priceDeltaUsd >= 0 ? '+' : ''}$
          {comparison.priceDeltaUsd.toLocaleString('en-US')}
        </dd>
        <dt>Nights delta</dt>
        <dd>{comparison.nightsDelta}</dd>
        {comparison.cabinDifference && (
          <>
            <dt>Cabin</dt>
            <dd>{comparison.cabinDifference}</dd>
          </>
        )}
        {comparison.destinationDifferences.length > 0 && (
          <>
            <dt>Itinerary</dt>
            <dd>{comparison.destinationDifferences.join('; ')}</dd>
          </>
        )}
      </dl>
    </GlassPanel>
  );
}
