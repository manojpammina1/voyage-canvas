import { COLLECTIONS, verifyBookingContextSignature } from '@voyage/inventory';
import type { BookingContext } from '@voyage/shared';
import { getDb } from '../../lib/infra';

export const runtime = 'nodejs';

interface BookingContextDoc extends BookingContext {
  signaturePayload: string;
  createdAt: string;
}

async function loadBookingContext(
  bookingContextId: string,
): Promise<BookingContext | null> {
  const db = await getDb();
  const doc = await db
    .collection<BookingContextDoc>(COLLECTIONS.bookingContexts)
    .findOne({ bookingContextId });
  if (!doc) return null;
  return {
    bookingContextId: doc.bookingContextId,
    holdId: doc.holdId,
    guestId: doc.guestId,
    expiresAt: doc.expiresAt,
    checkoutDeepLink: doc.checkoutDeepLink,
    signature: doc.signature,
  };
}

export default async function ExistingCheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ bc?: string }>;
}) {
  const params = await searchParams;
  const bookingContextId = params.bc?.trim();

  if (!bookingContextId) {
    return (
      <main style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
        <h1>Existing checkout boundary</h1>
        <p>
          Missing booking context. The Royal Caribbean planner stops here; payment is
          handled by existing checkout.
        </p>
      </main>
    );
  }

  const ctx = await loadBookingContext(bookingContextId);
  if (!ctx) {
    return (
      <main style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
        <h1>Checkout handoff invalid</h1>
        <p>Booking context not found or expired.</p>
      </main>
    );
  }

  const signatureValid = verifyBookingContextSignature(ctx);
  const expired = Date.parse(ctx.expiresAt) <= Date.now();

  return (
    <main
      style={{
        padding: '2rem',
        maxWidth: 640,
        margin: '0 auto',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <p
        style={{
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          fontSize: 12,
          color: '#006494',
          fontWeight: 600,
        }}
      >
        Existing checkout boundary
      </p>
      <h1>Secure checkout handoff received</h1>
      <p style={{ lineHeight: 1.6, color: '#444' }}>
        The Royal Caribbean planner verified a signed booking context and transferred
        you here.
        <strong> Payment is not processed inside the planning assistant.</strong>
      </p>
      <dl
        style={{
          background: '#f4f8fb',
          borderRadius: 12,
          padding: '1rem 1.25rem',
          marginTop: '1.5rem',
        }}
      >
        <dt style={{ fontWeight: 600 }}>Booking context</dt>
        <dd style={{ margin: '0.25rem 0 1rem' }}>{ctx.bookingContextId}</dd>
        <dt style={{ fontWeight: 600 }}>Hold</dt>
        <dd style={{ margin: '0.25rem 0 1rem' }}>{ctx.holdId}</dd>
        <dt style={{ fontWeight: 600 }}>Signature</dt>
        <dd style={{ margin: '0.25rem 0 1rem' }}>
          {signatureValid ? 'Valid' : 'Invalid'}
        </dd>
        <dt style={{ fontWeight: 600 }}>Expires</dt>
        <dd style={{ margin: '0.25rem 0 0' }}>
          {ctx.expiresAt}
          {expired ? ' (expired)' : ''}
        </dd>
      </dl>
      {signatureValid && !expired ? (
        <p style={{ color: '#0a6640' }}>
          Handoff OK — in production, existing checkout would collect payment here.
        </p>
      ) : (
        <p style={{ color: '#9b1c1c' }}>Handoff rejected — do not proceed to payment.</p>
      )}
    </main>
  );
}
