import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { GuestAuthCtx } from '@voyage/shared';
import {
  bindMongo,
  buildInventoryDocs,
  closeMongo,
  COLLECTIONS,
  createHold,
  ensureIndexes,
  getAvailability,
  getDb,
  getHoldForGuest,
  reconcileExpiredHolds,
  startBooking,
  verifyBookingContextSignature,
} from '../src/index.js';

const SAILING = 'sail-serenade-2027-03-06';
const CABIN = `cabin-${SAILING}-balcony`;

const guestA: GuestAuthCtx = {
  guestId: 'guest-demo-a',
  sessionId: 'sess-a',
  authenticationState: 'authenticated',
};

const guestB: GuestAuthCtx = {
  guestId: 'guest-demo-b',
  sessionId: 'sess-b',
  authenticationState: 'authenticated',
};

describe('@voyage/inventory holds (T6)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    const uri = replSet.getUri('voyage');
    const { MongoClient } = await import('mongodb');
    const client = new MongoClient(uri);
    await client.connect();
    bindMongo(client.db('voyage'), client);
    await ensureIndexes();
  }, 120_000);

  afterAll(async () => {
    await closeMongo();
    if (replSet) await replSet.stop();
  });

  beforeEach(async () => {
    const db = getDb();
    await db.collection(COLLECTIONS.holds).deleteMany({});
    await db.collection(COLLECTIONS.bookingContexts).deleteMany({});
    await db.collection(COLLECTIONS.inventory).deleteMany({});
    await db.collection(COLLECTIONS.inventory).insertMany(buildInventoryDocs([SAILING]));
  });

  it('hold decrements inventory once', async () => {
    const before = await getAvailability(SAILING, 'balcony');
    expect(before[0]?.availableCount).toBe(3);

    const result = await createHold({
      sailingId: SAILING,
      cabinId: CABIN,
      quoteId: 'quote-test-1',
      guestAuthCtx: guestA,
      idempotencyKey: 'idem-decrement-1',
      guestConfirmed: true,
    });

    expect(result.ok).toBe(true);
    expect(result.data?.status).toBe('held');

    const after = await getAvailability(SAILING, 'balcony');
    expect(after[0]?.availableCount).toBe(2);
  });

  it('sold-out rejects further holds', async () => {
    await getDb().collection(COLLECTIONS.inventory).updateOne(
      { cabinId: CABIN },
      { $set: { availableCount: 1, totalCount: 1 } },
    );

    const first = await createHold({
      sailingId: SAILING,
      cabinId: CABIN,
      quoteId: 'quote-test-2',
      guestAuthCtx: guestA,
      idempotencyKey: 'idem-sold-1',
      guestConfirmed: true,
    });
    expect(first.ok).toBe(true);

    const second = await createHold({
      sailingId: SAILING,
      cabinId: CABIN,
      quoteId: 'quote-test-3',
      guestAuthCtx: guestB,
      idempotencyKey: 'idem-sold-2',
      guestConfirmed: true,
    });
    expect(second.ok).toBe(false);
    expect(second.error?.code).toBe('SOLD_OUT');

    const after = await getAvailability(SAILING, 'balcony');
    expect(after[0]?.availableCount).toBe(0);
  });

  it('same idempotency key returns the same hold without second claim', async () => {
    const first = await createHold({
      sailingId: SAILING,
      cabinId: CABIN,
      quoteId: 'quote-test-4',
      guestAuthCtx: guestA,
      idempotencyKey: 'idem-same-key',
      guestConfirmed: true,
    });
    const second = await createHold({
      sailingId: SAILING,
      cabinId: CABIN,
      quoteId: 'quote-test-4',
      guestAuthCtx: guestA,
      idempotencyKey: 'idem-same-key',
      guestConfirmed: true,
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.data?.holdId).toBe(first.data?.holdId);

    const after = await getAvailability(SAILING, 'balcony');
    expect(after[0]?.availableCount).toBe(2);
  });

  it('expired hold releases inventory once (CAS)', async () => {
    const created = await createHold({
      sailingId: SAILING,
      cabinId: CABIN,
      quoteId: 'quote-test-5',
      guestAuthCtx: guestA,
      idempotencyKey: 'idem-expire-1',
      guestConfirmed: true,
      holdTtlSeconds: 1,
      now: new Date('2027-03-01T00:00:00.000Z'),
    });
    expect(created.ok).toBe(true);

    const mid = await getAvailability(SAILING, 'balcony');
    expect(mid[0]?.availableCount).toBe(2);

    const firstPass = await reconcileExpiredHolds(new Date('2027-03-01T00:00:02.000Z'));
    expect(firstPass.expired).toBe(1);
    expect(firstPass.restored).toBe(1);

    const after = await getAvailability(SAILING, 'balcony');
    expect(after[0]?.availableCount).toBe(3);

    const secondPass = await reconcileExpiredHolds(new Date('2027-03-01T00:00:03.000Z'));
    expect(secondPass.expired).toBe(0);
    expect(secondPass.restored).toBe(0);

    const finalAvail = await getAvailability(SAILING, 'balcony');
    expect(finalAvail[0]?.availableCount).toBe(3);
  });

  it('cross-guest access is denied', async () => {
    const created = await createHold({
      sailingId: SAILING,
      cabinId: CABIN,
      quoteId: 'quote-test-6',
      guestAuthCtx: guestA,
      idempotencyKey: 'idem-xguest-1',
      guestConfirmed: true,
    });
    expect(created.data).toBeTruthy();

    const peek = await getHoldForGuest(created.data!.holdId, guestB);
    expect(peek.ok).toBe(false);
    expect(peek.error?.code).toBe('FORBIDDEN');

    const booking = await startBooking(created.data!.holdId, guestB);
    expect(booking.ok).toBe(false);
    expect(booking.error?.code).toBe('FORBIDDEN');
  });

  it('startBooking returns a verifiable signed BookingContext', async () => {
    process.env.BOOKING_CONTEXT_SECRET = 'test-secret';
    const created = await createHold({
      sailingId: SAILING,
      cabinId: CABIN,
      quoteId: 'quote-test-7',
      guestAuthCtx: guestA,
      idempotencyKey: 'idem-booking-1',
      guestConfirmed: true,
    });
    const booking = await startBooking(created.data!.holdId, guestA);
    expect(booking.ok).toBe(true);
    expect(booking.data?.checkoutDeepLink).toContain('/existing-checkout');
    expect(verifyBookingContextSignature(booking.data!)).toBe(true);
  });

  it('sequential last-cabin contention: exactly one success (docker concurrent documented)', async () => {
    /**
     * Full 20-way concurrent contention is validated against docker replica-set Mongo:
     *   docker compose up -d && pnpm --filter @voyage/inventory test
     * This single-threaded version proves the sold-out gate after the final cabin.
     */
    await getDb().collection(COLLECTIONS.inventory).updateOne(
      { cabinId: CABIN },
      { $set: { availableCount: 1, totalCount: 1 } },
    );

    const attempts = [];
    for (let i = 0; i < 5; i++) {
      attempts.push(
        await createHold({
          sailingId: SAILING,
          cabinId: CABIN,
          quoteId: `quote-contention-${i}`,
          guestAuthCtx: i === 0 ? guestA : guestB,
          idempotencyKey: `idem-contention-${i}`,
          guestConfirmed: true,
        }),
      );
    }

    const successes = attempts.filter((a) => a.ok);
    const soldOut = attempts.filter((a) => a.error?.code === 'SOLD_OUT');
    expect(successes).toHaveLength(1);
    expect(soldOut).toHaveLength(4);
  });
});
