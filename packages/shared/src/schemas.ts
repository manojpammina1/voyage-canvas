import { z } from 'zod';

export const OccupancySchema = z.object({
  adults: z.number().int().min(1),
  children: z.number().int().min(0),
});

export const CabinTypeSchema = z.enum(['interior', 'ocean_view', 'balcony', 'suite']);

export const SearchCriteriaSchema = z.object({
  destination: z.string().optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  nights: z.number().int().positive().optional(),
  occupancy: OccupancySchema.optional(),
  cabinType: CabinTypeSchema.optional(),
  maxPriceUsd: z.number().positive().optional(),
  departurePort: z.string().optional(),
});

export const LockableCriterionSchema = z.enum([
  'destination',
  'month',
  'nights',
  'occupancy',
  'cabinType',
  'maxPriceUsd',
  'departurePort',
]);

export const LockedPreferenceSchema = z.object({
  criterion: LockableCriterionSchema,
  value: z.unknown(),
  lockedAt: z.string(),
});

export const SailingSchema = z.object({
  id: z.string(),
  shipName: z.string(),
  destination: z.string(),
  departureDate: z.string(),
  nights: z.number().int().positive(),
  ports: z.array(z.string()),
});

export const VoyageOptionSchema = z.object({
  id: z.string(),
  sailing: SailingSchema,
  cabinType: CabinTypeSchema.optional(),
  cabinId: z.string().optional(),
  priceEvidenceId: z.string().optional(),
  availabilityEvidenceId: z.string().optional(),
  fitReasons: z.array(z.string()),
});

export const ToolProvenanceSchema = z.object({
  tool: z.string(),
  requestId: z.string(),
  sourceId: z.string().optional(),
});

export const ToolResultSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    ok: z.boolean(),
    data: dataSchema.optional(),
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        recoverable: z.boolean(),
      })
      .optional(),
    asOf: z.string().optional(),
    validUntil: z.string().optional(),
    provenance: ToolProvenanceSchema,
  });

export const CabinAvailabilitySchema = z.object({
  sailingId: z.string(),
  cabinType: CabinTypeSchema,
  cabinId: z.string().optional(),
  availableCount: z.number().int().min(0),
  asOf: z.string(),
});

export const PriceQuoteSchema = z.object({
  quoteId: z.string(),
  sailingId: z.string(),
  cabinType: CabinTypeSchema,
  occupancy: OccupancySchema,
  totalUsd: z.number(),
  breakdown: z.array(
    z.object({
      label: z.string(),
      amountUsd: z.number(),
    }),
  ),
  asOf: z.string(),
  validUntil: z.string(),
});

export const ComparisonEvidenceDataSchema = z.object({
  optionA: z.string(),
  optionB: z.string(),
  priceDeltaUsd: z.number(),
  nightsDelta: z.number(),
  destinationDifferences: z.array(z.string()),
  cabinDifference: z.string().optional(),
});

export const EvidenceTypeSchema = z.enum([
  'SAILING',
  'AVAILABILITY',
  'PRICE',
  'POLICY',
  'COMPARISON',
]);

export const EvidenceSchema = z.object({
  id: z.string(),
  type: EvidenceTypeSchema,
  source: z.enum(['deterministic', 'approved-content']),
  data: z.unknown(),
  asOf: z.string().optional(),
  validUntil: z.string().optional(),
  provenance: ToolProvenanceSchema,
});

export const ContentClassificationSchema = z.enum([
  'POLICY',
  'FAQ',
  'DESTINATION_DESCRIPTION',
  'SHIP_DESCRIPTION',
]);

export const ForbiddenContentClassificationSchema = z.enum([
  'PRICE',
  'INVENTORY',
  'AVAILABILITY',
  'DISCOUNT',
  'TAX',
  'FEE',
  'HOLD',
  'BOOKING_STATUS',
  'LOYALTY_BALANCE',
]);

export const BoundedActionSchema = z.enum([
  'ADD_CONSTRAINT',
  'RELAX_CONSTRAINT',
  'LOCK_PREFERENCE',
  'FOCUS_DECISION',
  'ASK_CLARIFICATION',
  'EXPLAIN_TRADEOFF',
]);

export const HoldSchema = z.object({
  holdId: z.string(),
  sailingId: z.string(),
  cabinId: z.string(),
  guestId: z.string(),
  quoteId: z.string(),
  expiresAt: z.string(),
  idempotencyKey: z.string(),
  status: z.enum(['held', 'expired', 'confirmed']),
});

export const BookingContextSchema = z.object({
  bookingContextId: z.string(),
  holdId: z.string(),
  guestId: z.string(),
  expiresAt: z.string(),
  checkoutDeepLink: z.string(),
  signature: z.string(),
});

export const GuestAuthCtxSchema = z.object({
  guestId: z.string(),
  sessionId: z.string(),
  authenticationState: z.enum(['anonymous', 'authenticated']),
});

export const StatusStepSchema = z.enum([
  'UNDERSTANDING_INTENT',
  'SEARCHING_SAILINGS',
  'CHECKING_AVAILABILITY',
  'CHECKING_PRICING',
  'COMPUTING_COMPARISON',
  'RETRIEVING_POLICY',
  'REVALIDATING_PRICE',
  'CREATING_HOLD',
]);

export const FallbackReasonSchema = z.enum([
  'MODEL_TIMEOUT',
  'MODEL_ERROR',
  'MODEL_POLICY_BLOCK',
  'CIRCUIT_OPEN',
  'FEATURE_DISABLED',
]);

export const ExperienceEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('status'), step: StatusStepSchema }),
  z.object({
    type: z.literal('action'),
    action: BoundedActionSchema,
    payload: z.unknown(),
  }),
  z.object({ type: z.literal('evidence'), evidence: EvidenceSchema }),
  z.object({ type: z.literal('token'), text: z.string() }),
  z.object({ type: z.literal('handoff'), bookingContext: BookingContextSchema }),
  z.object({
    type: z.literal('fallback'),
    criteria: SearchCriteriaSchema,
    reason: FallbackReasonSchema,
  }),
  z.object({
    type: z.literal('error'),
    code: z.string(),
    recoverable: z.boolean(),
  }),
]);

export const PortSchema = z.object({
  id: z.string(),
  name: z.string(),
  region: z.string(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  canvasX: z.number(),
  canvasY: z.number(),
});

export const UiExperienceEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('SELECT_OPTION'), optionId: z.string() }),
  z.object({ type: z.literal('UPDATE_BUDGET'), maxPriceUsd: z.number() }),
  z.object({
    type: z.literal('COMPARE'),
    optionIds: z.tuple([z.string(), z.string()]),
  }),
  z.object({
    type: z.literal('LOCK_PREFERENCE'),
    criterion: LockableCriterionSchema,
    value: z.unknown(),
  }),
  z.object({
    type: z.literal('UNLOCK_PREFERENCE'),
    criterion: LockableCriterionSchema,
  }),
  z.object({
    type: z.literal('CONFIRM_HOLD'),
    sailingId: z.string(),
    cabinId: z.string(),
    quoteId: z.string(),
    confirmationToken: z.string(),
  }),
  z.object({ type: z.literal('SIMULATE_SIGN_IN') }),
  z.object({ type: z.literal('SUBMIT_INTENT'), text: z.string() }),
]);

/** Eval case schemas (T3). */
export const GoldenEvalCaseSchema = z.object({
  id: z.string(),
  input: z.string(),
  expect: z.record(z.unknown()),
}).passthrough();

export const RetrievalEvalCaseSchema = z.object({
  id: z.string(),
  question: z.string(),
  expectedSourceIds: z.array(z.string()).min(1),
}).passthrough();

export const RedteamEvalCaseSchema = z.object({
  id: z.string(),
  category: z.string(),
  input: z.string(),
  expect: z.record(z.unknown()),
}).passthrough();
