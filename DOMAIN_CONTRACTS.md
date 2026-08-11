# Voyage Canvas - Domain Contracts

Status: **CONTRACT LOCK TARGET (T2)**

This file defines the shared contract between frontend, backend, orchestration, retrieval, and tests. After T2 approval, implementation agents must not silently change these contracts.

## 1. Core enums and primitives

```ts
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
```

## 2. Search criteria

```ts
export interface Occupancy {
  adults: number;
  children: number;
}

export interface SearchCriteria {
  destination?: string;
  month?: string;          // YYYY-MM
  nights?: number;
  occupancy?: Occupancy;
  cabinType?: CabinType;
  maxPriceUsd?: number;
  departurePort?: string;
}
```

The deterministic parser only needs locked hero-field coverage. The model may enrich/clarify ambiguous requests, but application validation owns the final criteria.

## 3. Locked preferences

```ts
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
```

Invariant: model actions cannot relax/change a locked criterion unless the guest explicitly unlocks it.

## 4. Sailing and voyage option

```ts
export interface Sailing {
  id: string;
  shipName: string;
  destination: string;
  departureDate: string;
  nights: number;
  ports: string[];
}

export interface VoyageOption {
  id: string;
  sailing: Sailing;
  cabinType?: CabinType;
  priceEvidenceId?: string;
  availabilityEvidenceId?: string;
  fitReasons: string[];
}
```

`VoyageOption` may reference evidence IDs, but it must not contain model-invented authoritative prices or availability.

## 5. ToolResult envelope

```ts
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
```

## 6. Commerce results

```ts
export interface CabinAvailability {
  sailingId: string;
  cabinType: CabinType;
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

export interface ComparisonEvidenceData {
  optionA: string;
  optionB: string;
  priceDeltaUsd: number;
  nightsDelta: number;
  destinationDifferences: string[];
  cabinDifference?: string;
}
```

Comparison values are computed by deterministic commerce code, never the model.

## 7. Evidence

```ts
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
```

Invariant: authoritative UI commerce values render from `Evidence`/ToolResults, not model prose.

## 8. Policy/retrieval contracts

```ts
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
```

Forbidden corpus classifications such as price, inventory, availability, taxes, fees, holds, booking status, or loyalty balances must fail ingestion tests rather than enter the retrieval index.

## 9. Model contracts

```ts
export interface SanitizedIntentInput {
  text: string;
  deterministicCriteria: SearchCriteria;
  lockedPreferences: LockedPreference[];
}

export interface IntentResolution {
  criteriaPatch: Partial<SearchCriteria>;
  needsClarification: boolean;
  clarificationQuestion?: string;
  proposedActions: BoundedActionRequest[];
}

export interface GroundedNarrativeInput {
  userQuestion: string;
  experienceStage: ExperienceStage;
  evidence: Evidence[];
  policyPassages?: PolicyPassage[];
}

export interface NarrativeChunk {
  text: string;
}

export interface GenerativeModel {
  resolveIntent(input: SanitizedIntentInput): Promise<IntentResolution>;
  streamNarrative(input: GroundedNarrativeInput): AsyncIterable<NarrativeChunk>;
}

export interface EmbeddingResult {
  vector: number[];
  provider: string;
  model: string;
  dimensions: number;
}

export interface EmbeddingModel {
  embed(texts: string[]): Promise<EmbeddingResult[]>;
}
```

## 10. Bounded model actions

```ts
export type BoundedAction =
  | 'ADD_CONSTRAINT'
  | 'RELAX_CONSTRAINT'
  | 'LOCK_PREFERENCE'
  | 'FOCUS_DECISION'
  | 'ASK_CLARIFICATION'
  | 'EXPLAIN_TRADEOFF';

export interface BoundedActionRequest {
  action: BoundedAction;
  payload: unknown;
}
```

Direct deterministic UI events such as `SELECT_OPTION`, `UPDATE_BUDGET`, `COMPARE`, `UNLOCK_PREFERENCE`, and `CONFIRM_HOLD` are application events, not discretionary model actions.

## 11. Hold and booking

```ts
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
  expiresAt: string;
  checkoutDeepLink: string;
}
```

`Hold`/`BookingContext` are deterministic service results. The model cannot construct them.

## 12. VoyageExperience

```ts
export interface VoyageExperience {
  sessionId: string;
  authenticationState: AuthenticationState;
  stage: ExperienceStage;
  criteria: SearchCriteria;
  confirmedCriteria: Partial<SearchCriteria>;
  lockedPreferences: LockedPreference[];
  availableOptions: VoyageOption[];
  evidence: Evidence[];
  selectedOptionId?: string;
  compareOptionIds: string[];
  activeDecision?: string;
  uncertainty?: UncertaintyState;
  hold?: Hold;
  bookingContext?: BookingContext;
}
```

### Critical reducer invariant

The LLM/model action path must never directly write:

- `availableOptions`
- `evidence`
- price/availability/inventory values
- `hold`
- `bookingContext`
- authentication/authorization truth

Tests must prove model-sourced mutations to these fields are rejected.

## 13. Streaming event contract

```ts
export type FallbackReason =
  | 'MODEL_TIMEOUT'
  | 'MODEL_ERROR'
  | 'MODEL_POLICY_BLOCK'
  | 'CIRCUIT_OPEN'
  | 'FEATURE_DISABLED';

export type ExperienceEvent =
  | { type: 'status'; step: StatusStep }
  | { type: 'action'; action: BoundedAction; payload: unknown }
  | { type: 'evidence'; evidence: Evidence }
  | { type: 'token'; text: string }
  | { type: 'handoff'; bookingContext: BookingContext }
  | { type: 'fallback'; criteria: SearchCriteria; reason: FallbackReason }
  | { type: 'error'; code: string; recoverable: boolean };
```

Backend sends semantic event states; frontend owns guest-friendly copy.

## 14. Narrative grounding

Preferred structured narration:

```ts
export type NarrativeSegment =
  | { type: 'text'; text: string }
  | { type: 'evidence-ref'; evidenceId: string; field: string };
```

The server resolves evidence references and validates any remaining commerce-sensitive prose before it can be shown.

## 15. Port/map contract

```ts
export interface Port {
  id: string;
  name: string;
  region: string;
  latitude?: number;
  longitude?: number;
  canvasX: number;
  canvasY: number;
}
```

Map/geography labels and positions come from trusted local data, never free-form model generation.

## 16. Contract change process

After T2 contract lock, any proposed change must include:

- reason/blocker
- affected frontend/backend/AI/test surfaces
- migration impact
- new/updated tests
- confirmation that authority/security boundaries are not weakened

No implementation agent may silently fork shared types.
