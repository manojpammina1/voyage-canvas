import {
  compareOptions,
  getPort,
  loadCatalog,
  quotePrice,
  searchSailings,
} from '@voyage/commerce';
import { parseCriteria } from '@voyage/orchestrator';
import type {
  Evidence,
  LockableCriterion,
  LockedPreference,
  Port,
  SearchCriteria,
  VoyageOption,
} from '@voyage/shared';
import type { EnrichedOption, PlanResult } from './planTypes';

export type { EnrichedOption, PlanResult } from './planTypes';

function enrichOptions(
  options: VoyageOption[],
  criteria: SearchCriteria,
): EnrichedOption[] {
  const catalog = loadCatalog();
  const cabinType = criteria.cabinType ?? catalog.pricing.heroCabinType;
  const occupancy = criteria.occupancy ?? catalog.pricing.heroOccupancy;

  return options.map((opt) => {
    const quote = quotePrice(opt.sailing.id, cabinType, occupancy, catalog);
    return {
      ...opt,
      cabinType,
      totalUsd: quote.totalUsd,
      quoteId: quote.quoteId,
      asOf: quote.asOf,
      validUntil: quote.validUntil,
      shipLabel: opt.sailing.shipName,
      departureLabel: new Date(opt.sailing.departureDate).toLocaleDateString(
        'en-US',
        { month: 'short', day: 'numeric', year: 'numeric' },
      ),
    };
  });
}

function buildEvidence(
  options: EnrichedOption[],
  criteria: SearchCriteria,
): Evidence[] {
  const catalog = loadCatalog();
  const occupancy = criteria.occupancy ?? catalog.pricing.heroOccupancy;
  const evidence: Evidence[] = [];

  for (const opt of options) {
    const quote = quotePrice(
      opt.sailing.id,
      opt.cabinType ?? catalog.pricing.heroCabinType,
      occupancy,
      catalog,
    );
    evidence.push({
      id: `ev-price-${opt.id}`,
      type: 'PRICE',
      source: 'deterministic',
      data: quote,
      asOf: quote.asOf,
      validUntil: quote.validUntil,
      provenance: {
        tool: 'get_pricing',
        requestId: `req-${opt.id}`,
        sourceId: quote.quoteId,
      },
    });
    evidence.push({
      id: `ev-avail-${opt.id}`,
      type: 'AVAILABILITY',
      source: 'deterministic',
      data: {
        sailingId: opt.sailing.id,
        cabinType: opt.cabinType,
        cabinId: opt.cabinId,
        availableCount: 4,
        asOf: quote.asOf,
      },
      asOf: quote.asOf,
      provenance: {
        tool: 'check_availability',
        requestId: `req-avail-${opt.id}`,
      },
    });
  }

  return evidence;
}

function applyLocksToCriteria(
  criteria: SearchCriteria,
  locks: LockedPreference[],
): SearchCriteria {
  const next = { ...criteria };
  for (const lock of locks) {
    (next as Record<string, unknown>)[lock.criterion] = lock.value;
  }
  return next;
}

function collectPorts(options: EnrichedOption[]): Port[] {
  const ports: Port[] = [];
  const portIds = new Set<string>();
  for (const opt of options) {
    for (const portId of opt.sailing.ports) {
      portIds.add(portId);
    }
  }
  for (const portId of portIds) {
    const port = getPort(portId);
    if (port) ports.push(port);
  }
  return ports;
}

export function planFromIntent(
  intent: string,
  locks: LockedPreference[] = [],
): PlanResult {
  const parsed = parseCriteria(intent);
  const criteria = applyLocksToCriteria(parsed, locks);
  const raw = searchSailings(criteria);
  const options = enrichOptions(raw, criteria);
  const evidence = buildEvidence(options, criteria);
  const ports = collectPorts(options);

  return {
    criteria,
    confirmedCriteria: { ...criteria },
    lockedPreferences: locks,
    options,
    evidence,
    ports,
    statusStep: options.length ? 'SEARCHING_SAILINGS' : 'UNDERSTANDING_INTENT',
    uncertainty: options.length ? undefined : 'NEEDS_DETAIL',
  };
}

export function planWithCriteria(
  criteria: SearchCriteria,
  locks: LockedPreference[] = [],
): PlanResult {
  const merged = applyLocksToCriteria(criteria, locks);
  const raw = searchSailings(merged);
  const options = enrichOptions(raw, merged);
  const evidence = buildEvidence(options, merged);
  const ports = collectPorts(options);

  return {
    criteria: merged,
    confirmedCriteria: { ...merged },
    lockedPreferences: locks,
    options,
    evidence,
    ports,
    statusStep: 'SEARCHING_SAILINGS',
    uncertainty:
      options.length === 0 && merged.maxPriceUsd !== undefined
        ? 'NEEDS_DETAIL'
        : undefined,
  };
}

export function toggleLock(
  locks: LockedPreference[],
  criterion: LockableCriterion,
  value: unknown,
  lock: boolean,
): LockedPreference[] {
  if (!lock) {
    return locks.filter((l) => l.criterion !== criterion);
  }
  const rest = locks.filter((l) => l.criterion !== criterion);
  return [
    ...rest,
    { criterion, value, lockedAt: new Date().toISOString() },
  ];
}

export function compareTwo(
  criteria: SearchCriteria,
  locks: LockedPreference[],
  optionIds: [string, string],
  options: EnrichedOption[],
): PlanResult {
  const base = planWithCriteria(criteria, locks);
  const a = options.find((o) => o.id === optionIds[0]);
  const b = options.find((o) => o.id === optionIds[1]);
  if (!a || !b) {
    return { ...base, comparison: undefined };
  }
  const comparison = compareOptions({ optionA: a, optionB: b });
  const comparisonEvidence: Evidence = {
    id: `ev-compare-${a.id}-${b.id}`,
    type: 'COMPARISON',
    source: 'deterministic',
    data: comparison,
    provenance: {
      tool: 'compare_internal',
      requestId: `req-cmp-${Date.now()}`,
    },
  };
  return {
    ...base,
    options,
    comparison,
    evidence: [...base.evidence, comparisonEvidence],
    statusStep: 'COMPUTING_COMPARISON',
  };
}
