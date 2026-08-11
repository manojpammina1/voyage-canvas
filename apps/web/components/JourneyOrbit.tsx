'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Port } from '@voyage/shared';
import { GlassPanel, EvidenceBadge } from './primitives';
import { TravelerCore } from './TravelerCore';
import { VoyageNode } from './VoyageNode';
import { CaribbeanRouteMap } from './CaribbeanRouteMap';
import { useCanvas } from '../experience/context';

export function JourneyOrbit({ routePorts }: { routePorts: Port[] }) {
  const {
    options,
    selectedOptionId,
    selectOption,
    compareOptionIds,
    compareOptions,
    selectedOption,
    criteria,
    nodesReveal,
  } = useCanvas();

  const [compareDraft, setCompareDraft] = useState<string[]>([]);

  useEffect(() => {
    if (compareDraft.length === 2) {
      void compareOptions([compareDraft[0]!, compareDraft[1]!]);
    }
  }, [compareDraft, compareOptions]);

  const handleCompareToggle = useCallback((optionId: string) => {
    setCompareDraft((prev) => {
      if (prev.includes(optionId)) {
        return prev.filter((id) => id !== optionId);
      }
      if (prev.length >= 2) {
        return [prev[1]!, optionId];
      }
      return [...prev, optionId];
    });
  }, []);

  const activeCompare =
    compareOptionIds.length === 2 ? compareOptionIds : compareDraft;

  const regionLabel = criteria.destination ?? 'Caribbean';

  return (
    <div className="vc-orbit-stage" aria-label="Voyage decision orbit">
      <span className="vc-orbit-region">{regionLabel} · verified sailings</span>

      <svg
        className="vc-orbit-arc vc-orbit-arc--animated"
        viewBox="0 0 800 400"
        preserveAspectRatio="xMidYMax meet"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="vc-arc-glow" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(0,119,182,0.2)" />
            <stop offset="50%" stopColor="rgba(0,119,182,0.75)" />
            <stop offset="100%" stopColor="rgba(0,119,182,0.2)" />
          </linearGradient>
        </defs>
        <path d="M 50,400 A 350,350 0 0,1 750,400" stroke="url(#vc-arc-glow)" />
      </svg>

      {selectedOption && nodesReveal && (
        <GlassPanel active className="vc-selection-card vc-selection-card--materialize">
          <EvidenceBadge>Verified price</EvidenceBadge>
          <div className="vc-selection-card__ship">{selectedOption.shipLabel}</div>
          <div className="vc-selection-card__price">
            ${selectedOption.totalUsd.toLocaleString('en-US')}
          </div>
          <p className="vc-selection-card__detail">
            {selectedOption.departureLabel} · {selectedOption.sailing.nights} nights
          </p>
          <div className="vc-selection-card__meta">
            <span>Balcony</span>
            <span>
              Valid until{' '}
              {new Date(selectedOption.validUntil).toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>
        </GlassPanel>
      )}

      {options.map((opt, i) => (
        <VoyageNode
          key={opt.id}
          option={opt}
          index={i}
          selected={opt.id === selectedOptionId}
          compareSelected={activeCompare.includes(opt.id)}
          onSelect={() => selectOption(opt.id)}
          onCompareToggle={() => handleCompareToggle(opt.id)}
        />
      ))}

      <div className="vc-orbit-core">
        <TravelerCore />
      </div>

      {selectedOption && routePorts.length > 0 && nodesReveal && (
        <div className="vc-orbit-route-wrap">
          <CaribbeanRouteMap ports={routePorts} sailingLabel={selectedOption.shipLabel} />
        </div>
      )}
    </div>
  );
}
