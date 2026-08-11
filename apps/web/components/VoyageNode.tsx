'use client';

import type { EnrichedOption } from '../lib/planTypes';
import { useCanvas } from '../experience/context';

/** Positions for up to 5 options on a semicircular arc (percent of stage). */
const ORBIT_SLOTS: Array<{ left: string; top: string }> = [
  { left: '18%', top: '42%' },
  { left: '35%', top: '18%' },
  { left: '50%', top: '8%' },
  { left: '65%', top: '18%' },
  { left: '82%', top: '42%' },
];

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
  const slot = ORBIT_SLOTS[index % ORBIT_SLOTS.length]!;
  const shortName = option.sailing.shipName.replace(/ of the Seas$/i, '');

  return (
    <div
      className={`vc-orbit-node${selected ? ' vc-orbit-node--selected' : ''}${nodesReveal ? ' vc-orbit-node--materialize' : ''}`}
      style={{
        left: slot.left,
        top: slot.top,
        transform: 'translate(-50%, -50%)',
        animationDelay: nodesReveal ? `${0.15 + index * 0.12}s` : undefined,
      }}
    >
      <button
        type="button"
        className="vc-orbit-node__bead"
        aria-pressed={selected}
        aria-label={`${option.sailing.shipName}, $${option.totalUsd.toLocaleString('en-US')}. ${selected ? 'Selected' : 'Select voyage'}`}
        onClick={onSelect}
      />
      <span className="vc-orbit-node__label">{shortName}</span>
      <span className="vc-orbit-node__price">
        ${option.totalUsd.toLocaleString('en-US')}
      </span>
      <button
        type="button"
        className={`vc-orbit-node__compare${compareSelected ? ' vc-orbit-node__compare--on' : ''}`}
        aria-pressed={compareSelected}
        aria-label={`Compare ${option.sailing.shipName}`}
        onClick={(e) => {
          e.stopPropagation();
          onCompareToggle();
        }}
      >
        {compareSelected ? 'Compare ✓' : 'Compare'}
      </button>
    </div>
  );
}
