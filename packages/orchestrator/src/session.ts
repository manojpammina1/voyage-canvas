import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import type { LockedPreference, SearchCriteria } from '@voyage/shared';

const KEY_PREFIX = 'voyage:session:';

/** Safe anonymous planning state only — no PII, tokens, or payment data. */
export interface PlanningSession {
  sessionId: string;
  criteria: SearchCriteria;
  confirmedCriteria: Partial<SearchCriteria>;
  lockedPreferences: LockedPreference[];
  selectedOptionId?: string;
  compareOptionIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SessionStore {
  create(initial?: Partial<PlanningSession>): Promise<PlanningSession>;
  get(sessionId: string): Promise<PlanningSession | null>;
  update(
    sessionId: string,
    patch: Partial<
      Pick<
        PlanningSession,
        | 'criteria'
        | 'confirmedCriteria'
        | 'lockedPreferences'
        | 'selectedOptionId'
        | 'compareOptionIds'
      >
    >,
  ): Promise<PlanningSession | null>;
  destroy(sessionId: string): Promise<boolean>;
}

function ttlSeconds(): number {
  return Number(process.env.SESSION_TTL_SECONDS ?? 3600);
}

function emptySession(sessionId: string, now: string): PlanningSession {
  return {
    sessionId,
    criteria: {},
    confirmedCriteria: {},
    lockedPreferences: [],
    compareOptionIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function createRedisSessionStore(redis: Redis): SessionStore {
  return {
    async create(initial = {}) {
      const now = new Date().toISOString();
      const sessionId = initial.sessionId ?? `anon-${randomUUID()}`;
      const session: PlanningSession = {
        ...emptySession(sessionId, now),
        ...initial,
        sessionId,
        createdAt: now,
        updatedAt: now,
      };
      await redis.set(
        KEY_PREFIX + sessionId,
        JSON.stringify(session),
        'EX',
        ttlSeconds(),
      );
      return session;
    },

    async get(sessionId) {
      const raw = await redis.get(KEY_PREFIX + sessionId);
      if (!raw) return null;
      return JSON.parse(raw) as PlanningSession;
    },

    async update(sessionId, patch) {
      const current = await this.get(sessionId);
      if (!current) return null;
      const next: PlanningSession = {
        ...current,
        ...patch,
        sessionId: current.sessionId,
        createdAt: current.createdAt,
        updatedAt: new Date().toISOString(),
      };
      await redis.set(
        KEY_PREFIX + sessionId,
        JSON.stringify(next),
        'EX',
        ttlSeconds(),
      );
      return next;
    },

    async destroy(sessionId) {
      const n = await redis.del(KEY_PREFIX + sessionId);
      return n > 0;
    },
  };
}

/** In-memory store for unit tests / offline CI without Redis. */
export function createMemorySessionStore(): SessionStore {
  const map = new Map<string, PlanningSession>();
  return {
    async create(initial = {}) {
      const now = new Date().toISOString();
      const sessionId = initial.sessionId ?? `anon-${randomUUID()}`;
      const session: PlanningSession = {
        ...emptySession(sessionId, now),
        ...initial,
        sessionId,
        createdAt: now,
        updatedAt: now,
      };
      map.set(sessionId, session);
      return session;
    },
    async get(sessionId) {
      return map.get(sessionId) ?? null;
    },
    async update(sessionId, patch) {
      const current = map.get(sessionId);
      if (!current) return null;
      const next: PlanningSession = {
        ...current,
        ...patch,
        sessionId: current.sessionId,
        createdAt: current.createdAt,
        updatedAt: new Date().toISOString(),
      };
      map.set(sessionId, next);
      return next;
    },
    async destroy(sessionId) {
      return map.delete(sessionId);
    },
  };
}
