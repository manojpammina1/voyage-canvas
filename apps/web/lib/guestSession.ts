import { randomUUID } from 'node:crypto';
import type {
  AuthenticationState,
  GuestAuthCtx,
  LockedPreference,
  SearchCriteria,
} from '@voyage/shared';
import { getRedis } from './infra';

const COOKIE_NAME = 'voyage_session_id';
const KEY_PREFIX = 'voyage:web-session:';

export interface GuestSessionRecord {
  sessionId: string;
  guestId: string;
  authenticationState: AuthenticationState;
  criteria: SearchCriteria;
  confirmedCriteria: Partial<SearchCriteria>;
  lockedPreferences: LockedPreference[];
  selectedOptionId?: string;
  holdId?: string;
  createdAt: string;
  updatedAt: string;
}

function ttlSeconds(): number {
  return Number(process.env.SESSION_TTL_SECONDS ?? 3600);
}

function emptyRecord(sessionId: string, now: string): GuestSessionRecord {
  return {
    sessionId,
    guestId: `anon-${sessionId.slice(0, 8)}`,
    authenticationState: 'anonymous',
    criteria: {},
    confirmedCriteria: {},
    lockedPreferences: [],
    createdAt: now,
    updatedAt: now,
  };
}

async function read(sessionId: string): Promise<GuestSessionRecord | null> {
  const raw = await getRedis().get(KEY_PREFIX + sessionId);
  if (!raw) return null;
  return JSON.parse(raw) as GuestSessionRecord;
}

async function write(record: GuestSessionRecord): Promise<void> {
  record.updatedAt = new Date().toISOString();
  await getRedis().set(
    KEY_PREFIX + record.sessionId,
    JSON.stringify(record),
    'EX',
    ttlSeconds(),
  );
}

export function sessionCookieName(): string {
  return COOKIE_NAME;
}

export function parseSessionIdFromCookie(cookieHeader: string | null): string | undefined {
  if (!cookieHeader) return undefined;
  const match = cookieHeader
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE_NAME}=`));
  if (!match) return undefined;
  return decodeURIComponent(match.slice(COOKIE_NAME.length + 1));
}

export function sessionSetCookie(sessionId: string): string {
  const maxAge = ttlSeconds();
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${COOKIE_NAME}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export async function getOrCreateSession(
  sessionId?: string,
): Promise<GuestSessionRecord> {
  if (sessionId) {
    const existing = await read(sessionId);
    if (existing) return existing;
  }
  const now = new Date().toISOString();
  const id = sessionId ?? `anon-${randomUUID()}`;
  const record = emptyRecord(id, now);
  await write(record);
  return record;
}

export async function rotateToAuthenticated(
  oldSessionId: string,
): Promise<GuestSessionRecord> {
  const old = (await read(oldSessionId)) ?? emptyRecord(oldSessionId, new Date().toISOString());
  const now = new Date().toISOString();
  const newSessionId = `auth-${randomUUID()}`;
  const record: GuestSessionRecord = {
    ...old,
    sessionId: newSessionId,
    guestId: `guest-${randomUUID()}`,
    authenticationState: 'authenticated',
    createdAt: now,
    updatedAt: now,
  };
  await write(record);
  await getRedis().del(KEY_PREFIX + oldSessionId);
  return record;
}

export function toGuestAuthCtx(record: GuestSessionRecord): GuestAuthCtx {
  return {
    guestId: record.guestId,
    sessionId: record.sessionId,
    authenticationState: record.authenticationState,
  };
}

export async function updateSessionPlanning(
  sessionId: string,
  patch: Partial<
    Pick<
      GuestSessionRecord,
      | 'criteria'
      | 'confirmedCriteria'
      | 'lockedPreferences'
      | 'selectedOptionId'
      | 'holdId'
    >
  >,
): Promise<GuestSessionRecord | null> {
  const current = await read(sessionId);
  if (!current) return null;
  const next = { ...current, ...patch };
  await write(next);
  return next;
}
