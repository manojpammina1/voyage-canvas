import type { CabinInventoryDoc } from './availability.js';
import { COLLECTIONS, getDb } from './db.js';
import type { HoldDoc } from './holds.js';

export interface ReconcileResult {
  scanned: number;
  expired: number;
  restored: number;
  skipped: number;
}

/**
 * Expire held cabins past expiresAt via CAS held→expired.
 * Only the CAS winner restores inventory (exactly once).
 * Confirmed / already-expired holds are never reclaimed.
 */
export async function reconcileExpiredHolds(
  now: Date = new Date(),
): Promise<ReconcileResult> {
  const db = getDb();
  const holds = db.collection<HoldDoc>(COLLECTIONS.holds);
  const inventory = db.collection<CabinInventoryDoc>(COLLECTIONS.inventory);
  const nowIso = now.toISOString();

  const candidates = await holds
    .find({
      status: 'held',
      expiresAt: { $lte: nowIso },
    })
    .toArray();

  let expired = 0;
  let restored = 0;
  let skipped = 0;

  for (const hold of candidates) {
    const cas = await holds.findOneAndUpdate(
      { holdId: hold.holdId, status: 'held' },
      { $set: { status: 'expired' } },
      { returnDocument: 'after' },
    );

    if (!cas) {
      skipped += 1;
      continue;
    }

    expired += 1;
    const inv = await inventory.updateOne(
      { sailingId: hold.sailingId, cabinId: hold.cabinId },
      { $inc: { availableCount: 1 } },
    );
    if (inv.modifiedCount === 1) {
      restored += 1;
    }
  }

  return {
    scanned: candidates.length,
    expired,
    restored,
    skipped,
  };
}
