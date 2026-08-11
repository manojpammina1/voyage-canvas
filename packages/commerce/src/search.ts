import type { SearchCriteria, VoyageOption } from '@voyage/shared';
import { cabinIdFor, loadCatalog, type Catalog } from './catalog.js';
import { quotePrice } from './pricing.js';

function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7);
}

function destinationMatches(sailingDest: string, criteriaDest?: string): boolean {
  if (!criteriaDest) return true;
  return sailingDest.toLowerCase() === criteriaDest.toLowerCase();
}

/**
 * Deterministic sailing search. Filters catalog by destination/month/nights/
 * occupancy/cabin/budget. Budget uses quoted total for requested cabin+occupancy
 * (defaults: balcony + hero occupancy from pricing fixture).
 */
export function searchSailings(
  criteria: SearchCriteria,
  catalog: Catalog = loadCatalog(),
): VoyageOption[] {
  const cabinType = criteria.cabinType ?? catalog.pricing.heroCabinType;
  const occupancy = criteria.occupancy ?? catalog.pricing.heroOccupancy;

  const options: VoyageOption[] = [];

  for (const sailing of catalog.sailings) {
    if (!destinationMatches(sailing.destination, criteria.destination)) continue;
    if (criteria.month && monthKey(sailing.departureDate) !== criteria.month) continue;
    if (criteria.nights !== undefined && sailing.nights !== criteria.nights) continue;
    if (criteria.departurePort && sailing.ports[0] !== criteria.departurePort) continue;

    const quote = quotePrice(sailing.id, cabinType, occupancy, catalog);
    if (
      criteria.maxPriceUsd !== undefined &&
      quote.totalUsd > criteria.maxPriceUsd
    ) {
      continue;
    }

    const fitReasons: string[] = [];
    if (criteria.destination) fitReasons.push(`Matches ${sailing.destination}`);
    if (criteria.month) fitReasons.push(`Departs ${criteria.month}`);
    if (criteria.nights !== undefined) fitReasons.push(`${sailing.nights}-night itinerary`);
    if (criteria.cabinType) fitReasons.push(`${cabinType} cabin`);
    if (criteria.maxPriceUsd !== undefined) {
      fitReasons.push(`Within $${criteria.maxPriceUsd.toLocaleString('en-US')} budget`);
    }

    options.push({
      id: `opt-${sailing.id}-${cabinType}`,
      sailing,
      cabinType,
      cabinId: cabinIdFor(sailing.id, cabinType),
      fitReasons,
    });
  }

  return options.sort((a, b) => {
    const qa = quotePrice(a.sailing.id, cabinType, occupancy, catalog);
    const qb = quotePrice(b.sailing.id, cabinType, occupancy, catalog);
    return qa.totalUsd - qb.totalUsd || a.sailing.id.localeCompare(b.sailing.id);
  });
}
