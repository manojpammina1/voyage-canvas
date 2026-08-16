import { NextResponse } from 'next/server';
import { pingInfra } from '../../../lib/infra';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const INFRA_HEALTH_TIMEOUT_MS = 1_500;

interface InfraHealthStatus {
  mongo: boolean;
  redis: boolean;
  timedOut?: boolean;
}

function aiStatus() {
  const provider = (process.env.LLM_PROVIDER ?? 'mock').toLowerCase();
  const configured =
    provider === 'gemini' ? Boolean(process.env.GEMINI_API_KEY?.trim()) : true;
  const model =
    provider === 'gemini'
      ? process.env.LLM_FAST_MODEL ?? process.env.LLM_CAPABLE_MODEL
      : 'mock';

  return {
    provider,
    configured,
    model,
  };
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timeout = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function GET() {
  const status = await withTimeout<InfraHealthStatus>(
    pingInfra(),
    INFRA_HEALTH_TIMEOUT_MS,
    {
      mongo: false,
      redis: false,
      timedOut: true,
    },
  );
  const ok = status.mongo && status.redis;
  return NextResponse.json(
    { ok, services: status, ai: aiStatus(), ts: new Date().toISOString() },
    { status: 200 },
  );
}
