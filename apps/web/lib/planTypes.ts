import type {
  ComparisonEvidenceData,
  Evidence,
  LockedPreference,
  Port,
  SearchCriteria,
  VoyageOption,
} from '@voyage/shared';

/** Client-safe plan types — no server-only package imports. */
export interface EnrichedOption extends VoyageOption {
  totalUsd: number;
  quoteId: string;
  asOf: string;
  validUntil: string;
  shipLabel: string;
  departureLabel: string;
}

export interface PlanResult {
  criteria: SearchCriteria;
  confirmedCriteria: Partial<SearchCriteria>;
  lockedPreferences: LockedPreference[];
  options: EnrichedOption[];
  evidence: Evidence[];
  ports: Port[];
  comparison?: ComparisonEvidenceData;
  statusStep: string;
  uncertainty?: string;
}
