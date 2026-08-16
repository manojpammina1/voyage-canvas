'use client';

import { useCallback, useEffect, useState } from 'react';
import type { CabinAvailability, Port, PriceQuote } from '@voyage/shared';
import { GlassPanel, EvidenceBadge } from './primitives';
import { TravelerCore } from './TravelerCore';
import { VoyageNode } from './VoyageNode';
import { CaribbeanRouteMap } from './CaribbeanRouteMap';
import { NoResultsPanel } from './NoResultsPanel';
import { useCanvas } from '../experience/context';

function isPriceQuote(data: unknown): data is PriceQuote {
  return (
    typeof data === 'object' &&
    data !== null &&
    'quoteId' in data &&
    'totalUsd' in data
  );
}

function isCabinAvailability(data: unknown): data is CabinAvailability {
  return (
    typeof data === 'object' &&
    data !== null &&
    'availableCount' in data &&
    'cabinType' in data
  );
}

function formatCabin(cabinType?: string) {
  return cabinType ? cabinType.replace('_', ' ') : 'Balcony';
}

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
    evidence,
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
  const selectedPriceEvidence = selectedOption
    ? evidence.find((ev) => ev.type === 'PRICE' && ev.id.endsWith(selectedOption.id))
    : undefined;
  const selectedAvailabilityEvidence = selectedOption
    ? evidence.find((ev) => ev.type === 'AVAILABILITY' && ev.id.endsWith(selectedOption.id))
    : undefined;
  const selectedPrice = selectedPriceEvidence && isPriceQuote(selectedPriceEvidence.data)
    ? selectedPriceEvidence.data
    : undefined;
  const selectedAvailability =
    selectedAvailabilityEvidence && isCabinAvailability(selectedAvailabilityEvidence.data)
      ? selectedAvailabilityEvidence.data
      : undefined;
  const routeLabel = routePorts.length
    ? routePorts.map((port) => port.name).join(' -> ')
    : selectedOption?.sailing.ports.join(' -> ');

  if (options.length === 0) {
    return (
      <div className="vc-journey-stack">
        <NoResultsPanel />
      </div>
    );
  }

  return (
    <div className="vc-journey-stack">
      {selectedOption && nodesReveal && (
        <GlassPanel active className="vc-selection-card vc-selection-card--materialize">
          <div>
            <EvidenceBadge>Verified price</EvidenceBadge>
            <div className="vc-selection-card__ship">{selectedOption.shipLabel}</div>
            <p className="vc-selection-card__detail">
              {selectedOption.departureLabel} · {selectedOption.sailing.nights} nights · Balcony
            </p>
          </div>
          <div className="vc-selection-card__price">
            ${selectedOption.totalUsd.toLocaleString('en-US')}
          </div>
          <div className="vc-selection-card__meta">
            <span>
              Price valid until{' '}
              {new Date(selectedOption.validUntil).toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>
        </GlassPanel>
      )}

      <div className="vc-orbit-stage" aria-label="Voyage decision orbit">
        <div className="vc-orbit-stage__header">
          <span className="vc-orbit-region">{regionLabel} · verified sailings</span>
          <span className="vc-orbit-count">{options.length} verified options</span>
        </div>

        <div className="vc-orbit-layout">
          <div className="vc-orbit-rings" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className="vc-orbit-options" role="list" aria-label="Verified voyage options">
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
          </div>

          <div className="vc-orbit-core">
            <TravelerCore />
          </div>
        </div>
      </div>

      {selectedOption && nodesReveal && (
        <GlassPanel active className="vc-voyage-details-card">
          <div className="vc-voyage-details-card__header">
            <div>
              <span className="vc-voyage-details-card__eyebrow">Selected voyage details</span>
              <h3>{selectedOption.shipLabel}</h3>
            </div>
            <EvidenceBadge>Live evidence</EvidenceBadge>
          </div>
          <dl className="vc-voyage-details-grid">
            <div>
              <dt>Departure</dt>
              <dd>{selectedOption.departureLabel}</dd>
            </div>
            <div>
              <dt>Duration</dt>
              <dd>{selectedOption.sailing.nights} nights</dd>
            </div>
            <div>
              <dt>Cabin</dt>
              <dd>{formatCabin(selectedPrice?.cabinType ?? selectedOption.cabinType)}</dd>
            </div>
            <div>
              <dt>Availability</dt>
              <dd>
                {selectedAvailability
                  ? `${selectedAvailability.availableCount} cabins`
                  : 'Checked'}
              </dd>
            </div>
          </dl>
          <p className="vc-voyage-details-card__route">{routeLabel}</p>
          {selectedOption.fitReasons.length > 0 && (
            <ul className="vc-voyage-details-card__reasons" aria-label="Why this voyage matches">
              {selectedOption.fitReasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
        </GlassPanel>
      )}

      {selectedOption && routePorts.length > 0 && nodesReveal && (
        <div className="vc-orbit-route-wrap">
          <CaribbeanRouteMap ports={routePorts} sailingLabel={selectedOption.shipLabel} />
        </div>
      )}
    </div>
  );
}
