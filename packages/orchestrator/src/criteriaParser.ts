import type { CabinType, SearchCriteria } from '@voyage/shared';

const MONTH_NAMES: Record<string, string> = {
  january: '01',
  february: '02',
  march: '03',
  april: '04',
  may: '05',
  june: '06',
  july: '07',
  august: '08',
  september: '09',
  october: '10',
  november: '11',
  december: '12',
};

const CABIN_ALIASES: Array<{ pattern: RegExp; cabin: CabinType }> = [
  { pattern: /\bsuite\b/i, cabin: 'suite' },
  { pattern: /\bbalcony\b|\bveranda\b/i, cabin: 'balcony' },
  { pattern: /\bocean\s*view\b|\boceanview\b/i, cabin: 'ocean_view' },
  { pattern: /\binterior\b|\binside\b/i, cabin: 'interior' },
];

function parsePositiveMoney(value: string): number | undefined {
  const amount = Number(value.replace(/,/g, ''));
  return Number.isFinite(amount) && amount > 0 ? amount : undefined;
}

/**
 * Deterministic hero criteria parser. No LLM — regex/heuristic only.
 * Supports the locked hero string and close variants.
 */
export function parseCriteria(input: string): SearchCriteria {
  const text = input.trim();
  const criteria: SearchCriteria = {};

  if (/\bcaribbean\b/i.test(text)) {
    criteria.destination = 'Caribbean';
  }

  const nightsMatch = text.match(/\b(\d+)\s*-?\s*night/i);
  if (nightsMatch) {
    criteria.nights = Number(nightsMatch[1]);
  }

  const isoMonth = text.match(/\b(20\d{2})-(0[1-9]|1[0-2])\b/);
  if (isoMonth) {
    criteria.month = `${isoMonth[1]}-${isoMonth[2]}`;
  } else {
    const named = text.match(
      /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(20\d{2})\b/i,
    );
    if (named) {
      const monthName = named[1]!.toLowerCase();
      const year = named[2]!;
      criteria.month = `${year}-${MONTH_NAMES[monthName]}`;
    }
  }

  const adultsMatch = text.match(/\b(\d+)\s*adults?\b/i);
  const kidsMatch = text.match(/\b(\d+)\s*(kids?|children|child)\b/i);
  if (adultsMatch || kidsMatch) {
    criteria.occupancy = {
      adults: adultsMatch ? Number(adultsMatch[1]) : 1,
      children: kidsMatch ? Number(kidsMatch[1]) : 0,
    };
  }

  for (const { pattern, cabin } of CABIN_ALIASES) {
    if (pattern.test(text)) {
      criteria.cabinType = cabin;
      break;
    }
  }

  const budgetMatch = text.match(
    /\b(?:under|below|max(?:imum)?|upto|up\s*to)\s*\$?\s*([\d,]+(?:\.\d+)?)\b/i,
  ) ?? text.match(/\$\s*([\d,]+(?:\.\d+)?)\s*(?:or\s*less|max)?/i);
  if (budgetMatch) {
    const budget = parsePositiveMoney(budgetMatch[1]!);
    if (budget !== undefined) {
      criteria.maxPriceUsd = budget;
    }
  }

  return criteria;
}

/** Hero fixture used by acceptance tests and Guided Planner fallback. */
export const HERO_INTENT =
  '7-night Caribbean cruise in March 2027 for 2 adults and 2 kids, balcony, under $5,000';

export const HERO_CRITERIA: SearchCriteria = {
  destination: 'Caribbean',
  month: '2027-03',
  nights: 7,
  occupancy: { adults: 2, children: 2 },
  cabinType: 'balcony',
  maxPriceUsd: 5000,
};
