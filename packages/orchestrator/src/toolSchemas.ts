import { z } from 'zod';
import {
  CabinTypeSchema,
  GuestAuthCtxSchema,
  OccupancySchema,
  SearchCriteriaSchema,
} from '@voyage/shared';

export const SearchSailingsArgsSchema = z.object({
  criteria: SearchCriteriaSchema,
});

export const CheckAvailabilityArgsSchema = z.object({
  sailingId: z.string().min(1),
  cabinType: CabinTypeSchema.optional(),
});

export const GetPricingArgsSchema = z.object({
  sailingId: z.string().min(1),
  cabinType: CabinTypeSchema,
  occupancy: OccupancySchema,
});

export const GetPolicyContentArgsSchema = z.object({
  question: z.string().min(1).max(2000),
  topic: z.string().optional(),
  topK: z.number().int().min(1).max(10).optional(),
});

export const CreateHoldArgsSchema = z.object({
  sailingId: z.string().min(1),
  cabinId: z.string().min(1),
  quoteId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  guestConfirmed: z.literal(true),
  guestAuthCtx: GuestAuthCtxSchema,
});

export const StartBookingArgsSchema = z.object({
  holdId: z.string().min(1),
  guestAuthCtx: GuestAuthCtxSchema,
});

export type ToolName =
  | 'search_sailings'
  | 'check_availability'
  | 'get_pricing'
  | 'get_policy_content'
  | 'create_hold'
  | 'start_booking';

export const TOOL_ARG_SCHEMAS: Record<ToolName, z.ZodTypeAny> = {
  search_sailings: SearchSailingsArgsSchema,
  check_availability: CheckAvailabilityArgsSchema,
  get_pricing: GetPricingArgsSchema,
  get_policy_content: GetPolicyContentArgsSchema,
  create_hold: CreateHoldArgsSchema,
  start_booking: StartBookingArgsSchema,
};

export function parseToolArgs<T extends ToolName>(
  tool: T,
  raw: unknown,
): z.infer<(typeof TOOL_ARG_SCHEMAS)[T]> {
  return TOOL_ARG_SCHEMAS[tool].parse(raw) as z.infer<(typeof TOOL_ARG_SCHEMAS)[T]>;
}
