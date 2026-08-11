import { HERO_INTENT } from '../../../lib/constants';
import {
  LockableCriterionSchema,
  LockedPreferenceSchema,
  SearchCriteriaSchema,
  VoyageOptionSchema,
} from '@voyage/shared';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  compareTwo,
  planFromIntent,
  planWithCriteria,
  toggleLock,
  type EnrichedOption,
  type PlanResult,
} from '../../../lib/planService';
import { getDb } from '../../../lib/infra';

export const runtime = 'nodejs';

const LocksSchema = z.array(LockedPreferenceSchema).optional();
const EnrichedOptionSchema = VoyageOptionSchema.extend({
  totalUsd: z.number(),
  quoteId: z.string(),
  asOf: z.string(),
  validUntil: z.string(),
  shipLabel: z.string(),
  departureLabel: z.string(),
});

const PlanRequestSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('search'),
    intent: z.string().trim().min(1).optional(),
    locks: LocksSchema,
  }),
  z.object({
    action: z.literal('refine'),
    criteria: SearchCriteriaSchema,
    locks: LocksSchema,
  }),
  z.object({
    action: z.literal('budget'),
    criteria: SearchCriteriaSchema,
    maxPriceUsd: z.number().positive(),
    locks: LocksSchema,
  }),
  z.object({
    action: z.literal('lock'),
    criteria: SearchCriteriaSchema,
    criterion: LockableCriterionSchema,
    value: z.unknown(),
    locks: LocksSchema,
  }),
  z.object({
    action: z.literal('unlock'),
    criteria: SearchCriteriaSchema,
    criterion: LockableCriterionSchema,
    locks: LocksSchema,
  }),
  z.object({
    action: z.literal('compare'),
    criteria: SearchCriteriaSchema,
    optionIds: z.tuple([z.string(), z.string()]),
    options: z.array(EnrichedOptionSchema),
    locks: LocksSchema,
  }),
]);

type PlanBody = z.infer<typeof PlanRequestSchema>;

function toLocks(locks: z.infer<typeof LocksSchema>): PlanResult['lockedPreferences'] {
  return (locks ?? []) as PlanResult['lockedPreferences'];
}

export async function POST(request: Request) {
  try {
    await getDb();
    const body: PlanBody = PlanRequestSchema.parse(await request.json());
    const locks = toLocks(body.locks);

    switch (body.action) {
      case 'search': {
        const intent = body.intent?.trim() || HERO_INTENT;
        const result = await planFromIntent(intent, locks);
        return NextResponse.json(result);
      }
      case 'refine': {
        const result = await planWithCriteria(body.criteria, locks);
        return NextResponse.json(result);
      }
      case 'budget': {
        const criteria = { ...body.criteria, maxPriceUsd: body.maxPriceUsd };
        const result = await planWithCriteria(criteria, locks);
        return NextResponse.json(result);
      }
      case 'lock': {
        const nextLocks = toggleLock(
          locks,
          body.criterion,
          body.value,
          true,
        );
        const result = await planWithCriteria(body.criteria, nextLocks);
        return NextResponse.json(result);
      }
      case 'unlock': {
        const nextLocks = toggleLock(
          locks,
          body.criterion,
          undefined,
          false,
        );
        const result = await planWithCriteria(body.criteria, nextLocks);
        return NextResponse.json(result);
      }
      case 'compare': {
        const result = await compareTwo(
          body.criteria,
          locks,
          body.optionIds,
          body.options as EnrichedOption[],
        );
        return NextResponse.json(result);
      }
    }
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid plan request' }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : 'Plan failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
