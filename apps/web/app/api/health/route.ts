import { NextResponse } from 'next/server';
import { pingInfra } from '../../../lib/infra';

export const runtime = 'nodejs';

export async function GET() {
  const status = await pingInfra();
  const ok = status.mongo && status.redis;
  return NextResponse.json(
    { ok, services: status, ts: new Date().toISOString() },
    { status: ok ? 200 : 503 },
  );
}
