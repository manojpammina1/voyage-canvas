import { NextRequest, NextResponse } from 'next/server';
import {
  getOrCreateSession,
  parseSessionIdFromCookie,
  rotateToAuthenticated,
  sessionSetCookie,
} from '../../../../lib/guestSession';

export const runtime = 'nodejs';

/** Simulated sign-in: rotates anonymous session → authenticated guest session. */
export async function POST(request: NextRequest) {
  try {
    const cookieSession = parseSessionIdFromCookie(request.headers.get('cookie'));
    const current = await getOrCreateSession(cookieSession);
    const next =
      current.authenticationState === 'authenticated'
        ? current
        : await rotateToAuthenticated(current.sessionId);

    const res = NextResponse.json({
      ok: true,
      sessionId: next.sessionId,
      guestId: next.guestId,
      authenticationState: next.authenticationState,
    });
    res.headers.set('Set-Cookie', sessionSetCookie(next.sessionId));
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sign-in failed';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const cookieSession = parseSessionIdFromCookie(request.headers.get('cookie'));
  const session = await getOrCreateSession(cookieSession);
  const res = NextResponse.json({
    sessionId: session.sessionId,
    guestId: session.guestId,
    authenticationState: session.authenticationState,
    holdId: session.holdId,
  });
  if (!cookieSession) {
    res.headers.set('Set-Cookie', sessionSetCookie(session.sessionId));
  }
  return res;
}
