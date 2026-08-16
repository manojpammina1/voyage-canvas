import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { BookingContext, GuestAuthCtx, ToolResult } from '@voyage/shared';
import { COLLECTIONS, getDb } from './db.js';
import type { HoldDoc } from './holds.js';

export interface BookingContextDoc extends BookingContext {
  createdAt: string;
  signaturePayload: string;
}

function bookingSecret(): string {
  const secret = process.env.BOOKING_CONTEXT_SECRET?.trim();
  const strict =
    process.env.NODE_ENV === 'production' ||
    process.env.VOYAGE_REQUIRE_BOOKING_SECRET === 'true';

  if (!secret || secret === 'replace-me') {
    if (strict) {
      throw new Error(
        'BOOKING_CONTEXT_SECRET must be configured before checkout handoff',
      );
    }
    return 'local-dev-booking-context-secret';
  }

  return secret;
}

function signPayload(payload: string): string {
  return createHmac('sha256', bookingSecret()).update(payload).digest('hex');
}

function fail(
  code: string,
  message: string,
  recoverable: boolean,
  requestId: string,
): ToolResult<BookingContext> {
  return {
    ok: false,
    error: { code, message, recoverable },
    provenance: { tool: 'start_booking', requestId },
  };
}

/**
 * Create a short-lived signed BookingContext for checkout handoff.
 * Does not process payment — existing checkout owns that boundary.
 */
export async function startBooking(
  holdId: string,
  guestAuthCtx: GuestAuthCtx,
  options?: { ttlSeconds?: number; now?: Date },
): Promise<ToolResult<BookingContext>> {
  const requestId = randomUUID();

  if (guestAuthCtx.authenticationState !== 'authenticated') {
    return fail('AUTH_REQUIRED', 'Authentication required for booking handoff', true, requestId);
  }

  const hold = await getDb().collection<HoldDoc>(COLLECTIONS.holds).findOne({ holdId });
  if (!hold) {
    return fail('HOLD_NOT_FOUND', 'Hold not found', false, requestId);
  }
  if (hold.guestId !== guestAuthCtx.guestId) {
    return fail('FORBIDDEN', 'Cross-guest booking access denied', false, requestId);
  }
  if (hold.status !== 'held') {
    return fail('HOLD_NOT_ACTIVE', `Hold status is ${hold.status}`, true, requestId);
  }

  const now = options?.now ?? new Date();
  if (Date.parse(hold.expiresAt) <= now.getTime()) {
    return fail('HOLD_EXPIRED', 'Hold has expired', true, requestId);
  }

  const ttl = options?.ttlSeconds ?? 900;
  const expiresAt = new Date(now.getTime() + ttl * 1000).toISOString();
  const bookingContextId = `bc-${randomUUID()}`;
  const checkoutDeepLink = `/existing-checkout?bc=${encodeURIComponent(bookingContextId)}`;
  const signaturePayload = [
    bookingContextId,
    holdId,
    guestAuthCtx.guestId,
    expiresAt,
  ].join('|');
  const signature = signPayload(signaturePayload);

  const doc: BookingContextDoc = {
    bookingContextId,
    holdId,
    guestId: guestAuthCtx.guestId,
    expiresAt,
    checkoutDeepLink,
    signature,
    createdAt: now.toISOString(),
    signaturePayload,
  };

  await getDb().collection<BookingContextDoc>(COLLECTIONS.bookingContexts).insertOne(doc);

  const data: BookingContext = {
    bookingContextId,
    holdId,
    guestId: guestAuthCtx.guestId,
    expiresAt,
    checkoutDeepLink,
    signature,
  };

  return {
    ok: true,
    data,
    asOf: now.toISOString(),
    validUntil: expiresAt,
    provenance: {
      tool: 'start_booking',
      requestId,
      sourceId: bookingContextId,
    },
  };
}

export function verifyBookingContextSignature(
  ctx: Pick<
    BookingContext,
    'bookingContextId' | 'holdId' | 'guestId' | 'expiresAt' | 'signature'
  >,
): boolean {
  const payload = [
    ctx.bookingContextId,
    ctx.holdId,
    ctx.guestId,
    ctx.expiresAt,
  ].join('|');
  const expected = signPayload(payload);
  const expectedBuffer = Buffer.from(expected, 'hex');
  const actualBuffer = Buffer.from(ctx.signature, 'hex');
  return (
    expectedBuffer.length === actualBuffer.length &&
    timingSafeEqual(expectedBuffer, actualBuffer)
  );
}
