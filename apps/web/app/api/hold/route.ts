import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { cabinIdFor } from '@voyage/commerce';
import { createHold, reconcileExpiredHolds } from '@voyage/inventory';
import { CabinTypeSchema, OccupancySchema } from '@voyage/shared';
import { z } from 'zod';
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

const HoldRequestSchema = z.object({
  sailingId: z.string().min(1),
  quoteId: z.string().min(1),
  occupancy: OccupancySchema.optional(),
  quotedTotalUsd: z.number().positive().optional(),
  cabinType: CabinTypeSchema.optional(),
  cabinId: z.string().min(1).optional(),
  confirmationToken: z.string(),
});

export async function POST(request: NextRequest) {
  try {
    await getDb();
    await reconcileExpiredHolds();
    const cookieSession = parseSessionIdFromCookie(request.headers.get('cookie'));
    const session = await getOrCreateSession(cookieSession);

    const body = HoldRequestSchema.parse(await request.json());

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
    const occupancy = body.occupancy ?? session.criteria.occupancy;
    if (!occupancy || body.quotedTotalUsd === undefined) {
      return NextResponse.json(
        { ok: false, error: 'Quote occupancy and total are required' },
        { status: 400 },
      );
    }

    const result = await createHold({
      sailingId: body.sailingId,
      cabinId,
      cabinType,
      quoteId: body.quoteId,
      occupancy,
      quotedTotalUsd: body.quotedTotalUsd,
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
    if (err instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: 'Invalid hold request' }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : 'Hold failed';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
