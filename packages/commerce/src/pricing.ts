import { createHash } from 'node:crypto';
import type { CabinType, Occupancy, PriceQuote } from '@voyage/shared';
import { loadCatalog, type PricingFixture } from './catalog.js';

function occupancyFactor(
  occupancy: Occupancy,
  pricing: PricingFixture,
): number {
  const hero = pricing.heroOccupancy;
  const heroDenom =
    hero.adults * pricing.adultWeight + hero.children * pricing.childWeight;
  const actual =
    occupancy.adults * pricing.adultWeight +
    occupancy.children * pricing.childWeight;
  return actual / heroDenom;
}

function roundUsd(n: number): number {
  return Math.round(n * 100) / 100;
}

function buildQuoteId(
  sailingId: string,
  cabinType: CabinType,
  occupancy: Occupancy,
  asOf: string,
): string {
  const material = [
    sailingId,
    cabinType,
    String(occupancy.adults),
    String(occupancy.children),
    asOf,
  ].join('|');
  const digest = createHash('sha256').update(material).digest('hex').slice(0, 16);
  return `quote-${digest}`;
}

/**
 * Deterministic price quote. Same inputs always yield the same quoteId/total.
 * Hero balcony + 2 adults + 2 children matches sailingBaseBalconyHeroUsd fixtures.
 */
export function quotePrice(
  sailingId: string,
  cabinType: CabinType,
  occupancy: Occupancy,
  catalog = loadCatalog(),
): PriceQuote {
  const { pricing } = catalog;
  const baseHero = pricing.sailingBaseBalconyHeroUsd[sailingId];
  if (baseHero === undefined) {
    throw new Error(`Unknown sailing for pricing: ${sailingId}`);
  }
  if (occupancy.adults < 1) {
    throw new Error('At least one adult is required');
  }

  const cabinMult = pricing.cabinMultipliers[cabinType];
  if (cabinMult === undefined) {
    throw new Error(`Unknown cabin type: ${cabinType}`);
  }

  const occFactor = occupancyFactor(occupancy, pricing);
  const taxesFeesUsd = roundUsd(pricing.taxesFeesUsd * cabinMult * occFactor);
  // Fixture totals are all-in for hero balcony; taxes/fees are a breakdown line item.
  const totalUsd = roundUsd(baseHero * cabinMult * occFactor);
  const fareUsd = roundUsd(totalUsd - taxesFeesUsd);

  const asOf = pricing.asOfFixed;
  const validUntil = new Date(
    Date.parse(asOf) + pricing.validForSeconds * 1000,
  ).toISOString();

  return {
    quoteId: buildQuoteId(sailingId, cabinType, occupancy, asOf),
    sailingId,
    cabinType,
    occupancy: { adults: occupancy.adults, children: occupancy.children },
    totalUsd,
    breakdown: [
      { label: 'Cruise fare', amountUsd: fareUsd },
      { label: 'Taxes and fees', amountUsd: taxesFeesUsd },
    ],
    asOf,
    validUntil,
  };
}

/** Revalidate that a quoteId still matches current deterministic pricing. */
export function revalidateQuote(
  quote: Pick<PriceQuote, 'quoteId' | 'sailingId' | 'cabinType' | 'occupancy' | 'totalUsd'>,
  catalog = loadCatalog(),
): boolean {
  const current = quotePrice(quote.sailingId, quote.cabinType, quote.occupancy, catalog);
  return current.quoteId === quote.quoteId && current.totalUsd === quote.totalUsd;
}
