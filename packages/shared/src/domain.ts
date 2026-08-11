/** Core domain enums and commerce primitives (DOMAIN_CONTRACTS.md). */

export type AuthenticationState = 'anonymous' | 'authenticated';

export type ExperienceStage =
  | 'intent'
  | 'materializing'
  | 'exploring'
  | 'comparing'
  | 'commitment'
  | 'handoff'
  | 'fallback';

export type CabinType = 'interior' | 'ocean_view' | 'balcony' | 'suite';

export type UncertaintyState =
  | 'NEEDS_DETAIL'
  | 'PRICE_UNAVAILABLE'
  | 'AVAILABILITY_CHANGED'
  | 'QUOTE_EXPIRED'
  | 'POLICY_UNAVAILABLE'
  | 'MODEL_UNAVAILABLE';

export type StatusStep =
  | 'UNDERSTANDING_INTENT'
  | 'SEARCHING_SAILINGS'
  | 'CHECKING_AVAILABILITY'
  | 'CHECKING_PRICING'
  | 'COMPUTING_COMPARISON'
  | 'RETRIEVING_POLICY'
  | 'REVALIDATING_PRICE'
  | 'CREATING_HOLD';

export interface Occupancy {
  adults: number;
  children: number;
}

export interface SearchCriteria {
  destination?: string;
  month?: string;
  nights?: number;
  occupancy?: Occupancy;
  cabinType?: CabinType;
  maxPriceUsd?: number;
  departurePort?: string;
}

export type LockableCriterion =
  | 'destination'
  | 'month'
  | 'nights'
  | 'occupancy'
  | 'cabinType'
  | 'maxPriceUsd'
  | 'departurePort';

export interface LockedPreference {
  criterion: LockableCriterion;
  value: unknown;
  lockedAt: string;
}

export interface Sailing {
  id: string;
  shipName: string;
  destination: string;
  departureDate: string;
  nights: number;
  ports: string[];
}

export interface CabinInventoryRef {
  cabinId: string;
  sailingId: string;
  cabinType: CabinType;
}

export interface VoyageOption {
  id: string;
  sailing: Sailing;
  cabinType?: CabinType;
  cabinId?: string;
  priceEvidenceId?: string;
  availabilityEvidenceId?: string;
  fitReasons: string[];
}

export interface ToolProvenance {
  tool: string;
  requestId: string;
  sourceId?: string;
}

export interface ToolResult<T> {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    recoverable: boolean;
  };
  asOf?: string;
  validUntil?: string;
  provenance: ToolProvenance;
}

export interface CabinAvailability {
  sailingId: string;
  cabinType: CabinType;
  cabinId?: string;
  availableCount: number;
  asOf: string;
}

export interface PriceBreakdownItem {
  label: string;
  amountUsd: number;
}

export interface PriceQuote {
  quoteId: string;
  sailingId: string;
  cabinType: CabinType;
  occupancy: Occupancy;
  totalUsd: number;
  breakdown: PriceBreakdownItem[];
  asOf: string;
  validUntil: string;
}

/** Deterministic compare result — not a model tool. */
export interface ComparisonEvidenceData {
  optionA: string;
  optionB: string;
  priceDeltaUsd: number;
  nightsDelta: number;
  destinationDifferences: string[];
  cabinDifference?: string;
}

export type EvidenceType =
  | 'SAILING'
  | 'AVAILABILITY'
  | 'PRICE'
  | 'POLICY'
  | 'COMPARISON';

export interface Evidence<T = unknown> {
  id: string;
  type: EvidenceType;
  source: 'deterministic' | 'approved-content';
  data: T;
  asOf?: string;
  validUntil?: string;
  provenance: ToolProvenance;
}

export type ContentClassification =
  | 'POLICY'
  | 'FAQ'
  | 'DESTINATION_DESCRIPTION'
  | 'SHIP_DESCRIPTION';

export interface PolicyChunkMetadata {
  sourceId: string;
  title: string;
  topic: string;
  publishedAt?: string;
  contentVersion: string;
  classification: ContentClassification;
}

export interface PolicyChunk {
  id: string;
  text: string;
  vector: number[];
  metadata: PolicyChunkMetadata;
  embeddingMetadata: {
    provider: string;
    model: string;
    dimensions: number;
    createdAt: string;
  };
}

export interface PolicyPassage {
  chunkId: string;
  text: string;
  score: number;
  metadata: PolicyChunkMetadata;
}

export interface RetrievalAdapter {
  search(query: string, topK: number, topic?: string): Promise<PolicyPassage[]>;
}

export type HoldStatus = 'held' | 'expired' | 'confirmed';

export interface Hold {
  holdId: string;
  sailingId: string;
  cabinId: string;
  guestId: string;
  quoteId: string;
  expiresAt: string;
  idempotencyKey: string;
  status: HoldStatus;
}

export interface BookingContext {
  bookingContextId: string;
  holdId: string;
  guestId: string;
  expiresAt: string;
  checkoutDeepLink: string;
  signature: string;
}

/** Server-derived guest identity — never supplied by the model. */
export interface GuestAuthCtx {
  guestId: string;
  sessionId: string;
  authenticationState: AuthenticationState;
}

export interface Port {
  id: string;
  name: string;
  region: string;
  latitude?: number;
  longitude?: number;
  canvasX: number;
  canvasY: number;
}
