import type {
  CabinType,
  ComparisonEvidenceData,
  Occupancy,
  VoyageOption,
} from '@voyage/shared';
import { loadCatalog, type Catalog } from './catalog.js';
import { quotePrice } from './pricing.js';

export interface CompareInput {
  optionA: VoyageOption;
  optionB: VoyageOption;
  occupancy?: Occupancy;
}

/**
 * Deterministic compare-two. Server computes deltas — never the model.
 */
export function compareOptions(
  input: CompareInput,
  catalog: Catalog = loadCatalog(),
): ComparisonEvidenceData {
  const { optionA, optionB } = input;
  const occupancy = input.occupancy ?? catalog.pricing.heroOccupancy;
  const cabinA = (optionA.cabinType ?? catalog.pricing.heroCabinType) as CabinType;
  const cabinB = (optionB.cabinType ?? catalog.pricing.heroCabinType) as CabinType;

  const priceA = quotePrice(optionA.sailing.id, cabinA, occupancy, catalog);
  const priceB = quotePrice(optionB.sailing.id, cabinB, occupancy, catalog);

  const destinationDifferences: string[] = [];
  if (optionA.sailing.destination !== optionB.sailing.destination) {
    destinationDifferences.push(
      `${optionA.sailing.destination} vs ${optionB.sailing.destination}`,
    );
  }
  const portsA = optionA.sailing.ports.join('→');
  const portsB = optionB.sailing.ports.join('→');
  if (portsA !== portsB) {
    destinationDifferences.push('Different port itineraries');
  }

  return {
    optionA: optionA.id,
    optionB: optionB.id,
    priceDeltaUsd: Math.round((priceB.totalUsd - priceA.totalUsd) * 100) / 100,
    nightsDelta: optionB.sailing.nights - optionA.sailing.nights,
    destinationDifferences,
    cabinDifference:
      cabinA === cabinB ? undefined : `${cabinA} vs ${cabinB}`,
  };
}
