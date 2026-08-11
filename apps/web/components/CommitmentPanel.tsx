'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AuthenticationState, BookingContext, Hold } from '@voyage/shared';
import { Button, GlassPanel } from './primitives';
import { useCanvas } from '../experience/context';

const HOLD_CONFIRMATION = 'CONFIRM_HOLD';

export function CommitmentPanel() {
  const { selectedOption, authenticationState, hold, refreshAuth, criteria } = useCanvas();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [confirmHold, setConfirmHold] = useState(false);
  const [sessionHoldId, setSessionHoldId] = useState<string>();
  const [bookingContext, setBookingContext] = useState<BookingContext>();

  const loadSession = useCallback(async () => {
    const res = await fetch('/api/auth/mock');
    if (!res.ok) return;
    const data = (await res.json()) as {
      authenticationState: AuthenticationState;
      holdId?: string;
    };
    if (data.holdId) setSessionHoldId(data.holdId);
    await refreshAuth();
  }, [refreshAuth]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  const signIn = useCallback(async () => {
    setBusy(true);
    setMessage(undefined);
    try {
      const res = await fetch('/api/auth/mock', { method: 'POST' });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? 'Sign-in failed');
      await loadSession();
      setMessage('Signed in — session rotated.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  }, [loadSession]);

  const createHold = useCallback(async () => {
    if (!selectedOption) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const res = await fetch('/api/hold', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `ui-hold-${selectedOption.id}`,
        },
        body: JSON.stringify({
          sailingId: selectedOption.sailing.id,
          quoteId: selectedOption.quoteId,
          occupancy: criteria.occupancy,
          quotedTotalUsd: selectedOption.totalUsd,
          cabinType: selectedOption.cabinType ?? 'balcony',
          cabinId: selectedOption.cabinId,
          confirmationToken: HOLD_CONFIRMATION,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        hold?: Hold;
        error?: { message?: string; code?: string };
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error?.message ?? data.error?.code ?? 'Hold failed');
      }
      setMessage(`Hold active until ${data.hold?.expiresAt ?? 'soon'}`);
      if (data.hold?.holdId) setSessionHoldId(data.hold.holdId);
      await loadSession();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Hold failed');
    } finally {
      setBusy(false);
    }
  }, [criteria.occupancy, loadSession, selectedOption]);

  const continueCheckout = useCallback(async () => {
    setBusy(true);
    setMessage(undefined);
    try {
      const res = await fetch('/api/booking/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ holdId: sessionHoldId ?? hold?.holdId }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        bookingContext?: BookingContext;
        error?: { message?: string };
      };
      if (!res.ok || !data.ok || !data.bookingContext) {
        throw new Error(data.error?.message ?? 'Handoff failed');
      }
      setBookingContext(data.bookingContext);
      window.location.href = data.bookingContext.checkoutDeepLink;
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Handoff failed');
    } finally {
      setBusy(false);
    }
  }, [sessionHoldId, hold?.holdId]);

  if (!selectedOption) return null;

  return (
    <div style={{ marginTop: '1rem' }}>
      <GlassPanel className="vc-commitment">
      <h2
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: '0.875rem',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: 'var(--primary)',
          margin: '0 0 0.5rem',
        }}
      >
        Commitment
      </h2>
      <p style={{ fontSize: '0.85rem', color: 'var(--on-surface-variant)', margin: 0 }}>
        {selectedOption.shipLabel} · ${selectedOption.totalUsd.toLocaleString()} verified
      </p>

      {authenticationState === 'anonymous' ? (
        <Button type="button" disabled={busy} onClick={() => void signIn()} style={{ marginTop: '0.75rem', width: '100%' }}>
          Simulate sign in
        </Button>
      ) : (
        <>
          <label style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', fontSize: '0.85rem' }}>
            <input
              type="checkbox"
              checked={confirmHold}
              onChange={(e) => setConfirmHold(e.target.checked)}
            />
            I confirm I want to hold this cabin (demo)
          </label>
          <Button
            type="button"
            variant="secondary"
            disabled={busy || !confirmHold}
            onClick={() => void createHold()}
            style={{ marginTop: '0.5rem', width: '100%' }}
          >
            Create short-lived hold
          </Button>
          {(sessionHoldId || hold) && (
            <Button
              type="button"
              disabled={busy}
              onClick={() => void continueCheckout()}
              style={{ marginTop: '0.5rem', width: '100%' }}
            >
              Continue to secure checkout
            </Button>
          )}
        </>
      )}

      {message && (
        <p role="status" aria-live="polite" style={{ fontSize: '0.8rem', marginTop: '0.75rem' }}>
          {message}
        </p>
      )}
      {bookingContext && (
        <p style={{ fontSize: '0.75rem', color: 'var(--on-surface-variant)' }}>
          Handoff ID: {bookingContext.bookingContextId}
        </p>
      )}
    </GlassPanel>
    </div>
  );
}
