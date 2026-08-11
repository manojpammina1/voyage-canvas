import { randomUUID } from 'node:crypto';
import { quotePrice } from '@voyage/commerce';
import type {
  CabinType,
  GuestAuthCtx,
  Hold,
  Occupancy,
  ToolResult,
} from '@voyage/shared';
import type { CabinInventoryDoc } from './availability.js';
import { COLLECTIONS, getDb, getMongoClient } from './db.js';

export interface CreateHoldInput {
  sailingId: string;
  cabinId: string;
  cabinType: CabinType;
  quoteId: string;
  occupancy: Occupancy;
  quotedTotalUsd: number;
  guestAuthCtx: GuestAuthCtx;
  idempotencyKey: string;
  /** Explicit UI confirmation signal — required. */
  guestConfirmed: boolean;
  holdTtlSeconds?: number;
  now?: Date;
}

export interface HoldDoc extends Hold {
  createdAt: string;
}

function fail<T>(
  code: string,
  message: string,
  recoverable: boolean,
  requestId: string,
): ToolResult<T> {
  return {
    ok: false,
    error: { code, message, recoverable },
    provenance: { tool: 'create_hold', requestId },
  };
}

function ok(hold: Hold, requestId: string): ToolResult<Hold> {
  return {
    ok: true,
    data: hold,
    asOf: new Date().toISOString(),
    validUntil: hold.expiresAt,
    provenance: { tool: 'create_hold', requestId, sourceId: hold.holdId },
  };
}

function toHold(doc: HoldDoc): Hold {
  return {
    holdId: doc.holdId,
    sailingId: doc.sailingId,
    cabinId: doc.cabinId,
    guestId: doc.guestId,
    quoteId: doc.quoteId,
    expiresAt: doc.expiresAt,
    idempotencyKey: doc.idempotencyKey,
    status: doc.status,
  };
}

function authGate(
  input: CreateHoldInput,
  requestId: string,
): ToolResult<Hold> | null {
  if (!input.guestConfirmed) {
    return fail('CONFIRMATION_REQUIRED', 'Guest confirmation is required', true, requestId);
  }
  if (input.guestAuthCtx.authenticationState !== 'authenticated') {
    return fail('AUTH_REQUIRED', 'Authentication required to create a hold', true, requestId);
  }
  if (!input.idempotencyKey || input.idempotencyKey.trim().length === 0) {
    return fail('IDEMPOTENCY_REQUIRED', 'Idempotency key is required', false, requestId);
  }
  return null;
}

function quoteGate(
  input: CreateHoldInput,
  requestId: string,
): ToolResult<Hold> | null {
  try {
    const current = quotePrice(input.sailingId, input.cabinType, input.occupancy);
    if (
      current.quoteId !== input.quoteId ||
      current.totalUsd !== input.quotedTotalUsd
    ) {
      return fail(
        'QUOTE_CHANGED',
        'Price changed or quote no longer matches current pricing',
        true,
        requestId,
      );
    }
  } catch {
    return fail('QUOTE_INVALID', 'Quote could not be revalidated', true, requestId);
  }
  return null;
}

async function returnExistingIdempotent(
  idempotencyKey: string,
  guestId: string,
  requestId: string,
): Promise<ToolResult<Hold> | null> {
  const existing = await getDb()
    .collection<HoldDoc>(COLLECTIONS.holds)
    .findOne({ idempotencyKey });
  if (!existing) return null;
  if (existing.guestId !== guestId) {
    return fail(
      'IDEMPOTENCY_CONFLICT',
      'Idempotency key belongs to another guest',
      false,
      requestId,
    );
  }
  return ok(toHold(existing), requestId);
}

/**
 * Atomic hold with durable idempotency.
 * Prefers Mongo multi-document transactions (replica set). Falls back to
 * conditional findOneAndUpdate + unique idempotency index on standalone Mongo.
 */
export async function createHold(input: CreateHoldInput): Promise<ToolResult<Hold>> {
  const requestId = randomUUID();
  const gated = authGate(input, requestId);
  if (gated) return gated;

  const prior = await returnExistingIdempotent(
    input.idempotencyKey,
    input.guestAuthCtx.guestId,
    requestId,
  );
  if (prior) return prior;

  const quoteChecked = quoteGate(input, requestId);
  if (quoteChecked) return quoteChecked;

  const ttl = input.holdTtlSeconds ?? Number(process.env.HOLD_TTL_SECONDS ?? 600);
  const now = input.now ?? new Date();
  const holdDoc: HoldDoc = {
    holdId: `hold-${randomUUID()}`,
    sailingId: input.sailingId,
    cabinId: input.cabinId,
    guestId: input.guestAuthCtx.guestId,
    quoteId: input.quoteId,
    expiresAt: new Date(now.getTime() + ttl * 1000).toISOString(),
    idempotencyKey: input.idempotencyKey,
    status: 'held',
    createdAt: now.toISOString(),
  };

  try {
    return await createHoldTransactional(input, holdDoc, requestId);
  } catch (err) {
    if (String((err as Error).message ?? err).includes('Transaction numbers are only allowed')) {
      return createHoldConditional(input, holdDoc, requestId);
    }
    throw err;
  }
}

async function createHoldTransactional(
  input: CreateHoldInput,
  holdDoc: HoldDoc,
  requestId: string,
): Promise<ToolResult<Hold>> {
  const client = getMongoClient();
  const db = getDb();
  const holds = db.collection<HoldDoc>(COLLECTIONS.holds);
  const inventory = db.collection<CabinInventoryDoc>(COLLECTIONS.inventory);
  const session = client.startSession();

  try {
    let outcome: ToolResult<Hold> | undefined;

    await session.withTransaction(async () => {
      const existing = await holds.findOne(
        { idempotencyKey: input.idempotencyKey },
        { session },
      );
      if (existing) {
        outcome =
          existing.guestId === input.guestAuthCtx.guestId
            ? ok(toHold(existing), requestId)
            : fail(
                'IDEMPOTENCY_CONFLICT',
                'Idempotency key belongs to another guest',
                false,
                requestId,
              );
        return;
      }

      const claimed = await inventory.findOneAndUpdate(
        {
          sailingId: input.sailingId,
          cabinId: input.cabinId,
          availableCount: { $gt: 0 },
        },
        { $inc: { availableCount: -1 } },
        { session, returnDocument: 'after' },
      );

      if (!claimed) {
        const cabin = await inventory.findOne(
          { sailingId: input.sailingId, cabinId: input.cabinId },
          { session },
        );
        outcome = cabin
          ? fail('SOLD_OUT', 'No cabins available', true, requestId)
          : fail('CABIN_NOT_FOUND', 'Cabin inventory not found', false, requestId);
        return;
      }

      try {
        await holds.insertOne(holdDoc, { session });
        outcome = ok(holdDoc, requestId);
      } catch (err) {
        if ((err as { code?: number }).code === 11000) {
          const raced = await holds.findOne(
            { idempotencyKey: input.idempotencyKey },
            { session },
          );
          if (raced && raced.guestId === input.guestAuthCtx.guestId) {
            // Abort txn so inventory decrement rolls back; return winner hold.
            outcome = ok(toHold(raced), requestId);
            throw Object.assign(new Error('idempotent-race'), { voyageIdempotent: true });
          }
        }
        throw err;
      }
    });

    return outcome ?? fail('HOLD_FAILED', 'Hold transaction did not complete', true, requestId);
  } catch (err) {
    if ((err as { voyageIdempotent?: boolean }).voyageIdempotent) {
      const raced = await holds.findOne({ idempotencyKey: input.idempotencyKey });
      if (raced && raced.guestId === input.guestAuthCtx.guestId) {
        return ok(toHold(raced), requestId);
      }
    }
    throw err;
  } finally {
    await session.endSession();
  }
}

/** Conditional-update fallback when transactions are unavailable. */
async function createHoldConditional(
  input: CreateHoldInput,
  holdDoc: HoldDoc,
  requestId: string,
): Promise<ToolResult<Hold>> {
  const db = getDb();
  const holds = db.collection<HoldDoc>(COLLECTIONS.holds);
  const inventory = db.collection<CabinInventoryDoc>(COLLECTIONS.inventory);

  const prior = await returnExistingIdempotent(
    input.idempotencyKey,
    input.guestAuthCtx.guestId,
    requestId,
  );
  if (prior) return prior;

  const claimed = await inventory.findOneAndUpdate(
    {
      sailingId: input.sailingId,
      cabinId: input.cabinId,
      availableCount: { $gt: 0 },
    },
    { $inc: { availableCount: -1 } },
    { returnDocument: 'after' },
  );

  if (!claimed) {
    const cabin = await inventory.findOne({
      sailingId: input.sailingId,
      cabinId: input.cabinId,
    });
    return cabin
      ? fail('SOLD_OUT', 'No cabins available', true, requestId)
      : fail('CABIN_NOT_FOUND', 'Cabin inventory not found', false, requestId);
  }

  try {
    await holds.insertOne(holdDoc);
    return ok(holdDoc, requestId);
  } catch (err) {
    await inventory.updateOne(
      { sailingId: input.sailingId, cabinId: input.cabinId },
      { $inc: { availableCount: 1 } },
    );
    if ((err as { code?: number }).code === 11000) {
      const raced = await returnExistingIdempotent(
        input.idempotencyKey,
        input.guestAuthCtx.guestId,
        requestId,
      );
      if (raced) return raced;
      return fail('IDEMPOTENCY_CONFLICT', 'Idempotency key conflict', false, requestId);
    }
    throw err;
  }
}

export async function getHoldForGuest(
  holdId: string,
  guestAuthCtx: GuestAuthCtx,
): Promise<ToolResult<Hold>> {
  const requestId = randomUUID();
  const doc = await getDb().collection<HoldDoc>(COLLECTIONS.holds).findOne({ holdId });
  if (!doc) {
    return fail('HOLD_NOT_FOUND', 'Hold not found', false, requestId);
  }
  if (doc.guestId !== guestAuthCtx.guestId) {
    return fail('FORBIDDEN', 'Cross-guest hold access denied', false, requestId);
  }
  return ok(toHold(doc), requestId);
}
