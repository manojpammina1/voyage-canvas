import { HERO_INTENT } from '../../../lib/constants';
import type { LockableCriterion, SearchCriteria } from '@voyage/shared';
import { NextResponse } from 'next/server';
import {
  compareTwo,
  planFromIntent,
  planWithCriteria,
  toggleLock,
  type EnrichedOption,
  type PlanResult,
} from '../../../lib/planService';

export const runtime = 'nodejs';

type PlanBody =
  | { action: 'search'; intent: string; locks?: PlanResult['lockedPreferences'] }
  | {
      action: 'refine';
      criteria: SearchCriteria;
      locks?: PlanResult['lockedPreferences'];
    }
  | {
      action: 'budget';
      criteria: SearchCriteria;
      maxPriceUsd: number;
      locks?: PlanResult['lockedPreferences'];
    }
  | {
      action: 'lock';
      criteria: SearchCriteria;
      criterion: LockableCriterion;
      value: unknown;
      locks?: PlanResult['lockedPreferences'];
    }
  | {
      action: 'unlock';
      criteria: SearchCriteria;
      criterion: LockableCriterion;
      locks?: PlanResult['lockedPreferences'];
    }
  | {
      action: 'compare';
      criteria: SearchCriteria;
      optionIds: [string, string];
      options: EnrichedOption[];
      locks?: PlanResult['lockedPreferences'];
    };

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as PlanBody;

    switch (body.action) {
      case 'search': {
        const intent = body.intent?.trim() || HERO_INTENT;
        const result = planFromIntent(intent, body.locks ?? []);
        return NextResponse.json(result);
      }
      case 'refine': {
        const result = planWithCriteria(body.criteria, body.locks ?? []);
        return NextResponse.json(result);
      }
      case 'budget': {
        const locks = body.locks ?? [];
        const criteria = { ...body.criteria, maxPriceUsd: body.maxPriceUsd };
        const result = planWithCriteria(criteria, locks);
        return NextResponse.json(result);
      }
      case 'lock': {
        const locks = toggleLock(
          body.locks ?? [],
          body.criterion,
          body.value,
          true,
        );
        const result = planWithCriteria(body.criteria, locks);
        return NextResponse.json(result);
      }
      case 'unlock': {
        const locks = toggleLock(
          body.locks ?? [],
          body.criterion,
          undefined,
          false,
        );
        const result = planWithCriteria(body.criteria, locks);
        return NextResponse.json(result);
      }
      case 'compare': {
        const result = compareTwo(
          body.criteria,
          body.locks ?? [],
          body.optionIds,
          body.options,
        );
        return NextResponse.json(result);
      }
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Plan failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
