import type { CabinAvailability, CabinType } from '@voyage/shared';
import { COLLECTIONS, getDb } from './db.js';

export interface CabinInventoryDoc {
  cabinId: string;
  sailingId: string;
  cabinType: CabinType;
  availableCount: number;
  totalCount: number;
}

export async function getAvailability(
  sailingId: string,
  cabinType?: CabinType,
): Promise<CabinAvailability[]> {
  const filter: Record<string, unknown> = { sailingId };
  if (cabinType) filter.cabinType = cabinType;

  const rows = await getDb()
    .collection<CabinInventoryDoc>(COLLECTIONS.inventory)
    .find(filter)
    .toArray();

  const asOf = new Date().toISOString();
  return rows.map((row) => ({
    sailingId: row.sailingId,
    cabinType: row.cabinType,
    cabinId: row.cabinId,
    availableCount: row.availableCount,
    asOf,
  }));
}

export async function getCabinInventory(
  sailingId: string,
  cabinId: string,
): Promise<CabinInventoryDoc | null> {
  return getDb()
    .collection<CabinInventoryDoc>(COLLECTIONS.inventory)
    .findOne({ sailingId, cabinId });
}
