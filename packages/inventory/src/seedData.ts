import type { CabinType } from '@voyage/shared';
import type { CabinInventoryDoc } from './availability.js';

/** Fixed synthetic demo inventory — balcony has limited stock for sold-out demos. */
export const DEMO_INVENTORY_COUNTS: Record<CabinType, number> = {
  interior: 8,
  ocean_view: 6,
  balcony: 3,
  suite: 2,
};

export function cabinIdFor(sailingId: string, cabinType: CabinType): string {
  return `cabin-${sailingId}-${cabinType}`;
}

export function buildInventoryDocs(sailingIds: string[]): CabinInventoryDoc[] {
  const cabinTypes = Object.keys(DEMO_INVENTORY_COUNTS) as CabinType[];
  const docs: CabinInventoryDoc[] = [];
  for (const sailingId of sailingIds) {
    for (const cabinType of cabinTypes) {
      const total = DEMO_INVENTORY_COUNTS[cabinType];
      docs.push({
        cabinId: cabinIdFor(sailingId, cabinType),
        sailingId,
        cabinType,
        availableCount: total,
        totalCount: total,
      });
    }
  }
  return docs;
}
