import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { cabinIdFor } from '@voyage/commerce';
import { createHold } from '@voyage/inventory';
import type { CabinType } from '@voyage/shared';
import { getDb } from '../../../lib/infra';
import {
  getOrCreateSession,
  parseSessionIdFromCookie,
  sessionSetCookie,
  toGuestAuthCtx,
  updateSessionPlanning,
} from '../../../lib/guestSession';

export const runtime = 'nodejs';

const CONFIRMATION_TOKEN = 'CONFIRM_HOLD';

export async function POST(request: NextRequest) {
  try {
    await getDb();
    const cookieSession = parseSessionIdFromCookie(request.headers.get('cookie'));
    const session = await getOrCreateSession(cookieSession);

    const body = (await request.json()) as {
      sailingId: string;
      quoteId: string;
      cabinType?: CabinType;
      cabinId?: string;
      confirmationToken: string;
    };

    if (body.confirmationToken !== CONFIRMATION_TOKEN) {
      return NextResponse.json(
        { ok: false, error: 'Explicit guest confirmation required' },
        { status: 400 },
      );
    }

    const idempotencyKey =
      request.headers.get('idempotency-key')?.trim() || `hold-${randomUUID()}`;
    const cabinType = body.cabinType ?? 'balcony';
    const cabinId = body.cabinId ?? cabinIdFor(body.sailingId, cabinType);

    const result = await createHold({
      sailingId: body.sailingId,
      cabinId,
      quoteId: body.quoteId,
      guestAuthCtx: toGuestAuthCtx(session),
      idempotencyKey,
      guestConfirmed: true,
    });

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: result.error?.code === 'AUTH_REQUIRED' ? 401 : 409 },
      );
    }

    await updateSessionPlanning(session.sessionId, { holdId: result.data!.holdId });

    const res = NextResponse.json({ ok: true, hold: result.data });
    if (!cookieSession) {
      res.headers.set('Set-Cookie', sessionSetCookie(session.sessionId));
    }
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Hold failed';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
