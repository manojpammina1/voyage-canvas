'use client';

import type { EnrichedOption } from '../lib/planTypes';
import { useCanvas } from '../experience/context';

interface VoyageNodeProps {
  option: EnrichedOption;
  index: number;
  selected: boolean;
  compareSelected: boolean;
  onSelect: () => void;
  onCompareToggle: () => void;
}

export function VoyageNode({
  option,
  index,
  selected,
  compareSelected,
  onSelect,
  onCompareToggle,
}: VoyageNodeProps) {
  const { nodesReveal } = useCanvas();
  const shortName = option.sailing.shipName.replace(/ of the Seas$/i, '');

  return (
    <div
      role="listitem"
      className={`vc-orbit-node${selected ? ' vc-orbit-node--selected' : ''}${nodesReveal ? ' vc-orbit-node--materialize' : ''}`}
      data-orbit-index={index}
    >
      <button
        type="button"
        className="vc-orbit-node__select"
        aria-pressed={selected}
        aria-label={`${option.sailing.shipName}, $${option.totalUsd.toLocaleString('en-US')}. ${selected ? 'Selected' : 'Select voyage'}`}
        onClick={onSelect}
      >
        <span className="vc-orbit-node__label">{shortName}</span>
        <span className="vc-orbit-node__bead" aria-hidden="true">
          <span className="vc-voyage-glyph" aria-hidden="true" />
        </span>
        <span className="vc-orbit-node__price">
          ${option.totalUsd.toLocaleString('en-US')}
        </span>
      </button>
      <button
        type="button"
        className={`vc-orbit-node__compare${compareSelected ? ' vc-orbit-node__compare--on' : ''}`}
        aria-pressed={compareSelected}
        aria-label={`${compareSelected ? 'Remove' : 'Compare'} ${option.sailing.shipName}`}
        title={`${compareSelected ? 'Remove from comparison' : 'Compare'} ${option.sailing.shipName}`}
        onClick={(e) => {
          e.stopPropagation();
          onCompareToggle();
        }}
      >
        <span className="vc-compare-glyph" aria-hidden="true" />
      </button>
    </div>
  );
}
