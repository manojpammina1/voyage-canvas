import { NextRequest, NextResponse } from 'next/server';
import { startBooking } from '@voyage/inventory';
import { getDb } from '../../../../lib/infra';
import {
  getOrCreateSession,
  parseSessionIdFromCookie,
  sessionSetCookie,
  toGuestAuthCtx,
} from '../../../../lib/guestSession';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    await getDb();
    const cookieSession = parseSessionIdFromCookie(request.headers.get('cookie'));
    const session = await getOrCreateSession(cookieSession);

    const body = (await request.json()) as { holdId?: string };
    const holdId = body.holdId ?? session.holdId;
    if (!holdId) {
      return NextResponse.json(
        { ok: false, error: 'No active hold to hand off' },
        { status: 400 },
      );
    }

    const result = await startBooking(holdId, toGuestAuthCtx(session));
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: result.error?.code === 'AUTH_REQUIRED' ? 401 : 409 },
      );
    }

    const res = NextResponse.json({ ok: true, bookingContext: result.data });
    if (!cookieSession) {
      res.headers.set('Set-Cookie', sessionSetCookie(session.sessionId));
    }
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Booking handoff failed';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
