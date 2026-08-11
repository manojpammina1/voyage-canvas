import type {
  BookingContext,
  Evidence,
  SearchCriteria,
  StatusStep,
} from './domain.js';

export type FallbackReason =
  | 'MODEL_TIMEOUT'
  | 'MODEL_ERROR'
  | 'MODEL_POLICY_BLOCK'
  | 'CIRCUIT_OPEN'
  | 'FEATURE_DISABLED';

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

/** Guest/UI events — not discretionary model actions. */
export type UiExperienceEvent =
  | { type: 'SELECT_OPTION'; optionId: string }
  | { type: 'UPDATE_BUDGET'; maxPriceUsd: number }
  | { type: 'COMPARE'; optionIds: [string, string] }
  | { type: 'LOCK_PREFERENCE'; criterion: string; value: unknown }
  | { type: 'UNLOCK_PREFERENCE'; criterion: string }
  | { type: 'CONFIRM_HOLD'; sailingId: string; cabinId: string; quoteId: string; confirmationToken: string }
  | { type: 'SIMULATE_SIGN_IN' }
  | { type: 'SUBMIT_INTENT'; text: string };

export type ExperienceEvent =
  | { type: 'status'; step: StatusStep }
  | { type: 'action'; action: BoundedAction; payload: unknown }
  | { type: 'evidence'; evidence: Evidence }
  | { type: 'token'; text: string }
  | { type: 'handoff'; bookingContext: BookingContext }
  | { type: 'fallback'; criteria: SearchCriteria; reason: FallbackReason }
  | { type: 'error'; code: string; recoverable: boolean };

export type NarrativeSegment =
  | { type: 'text'; text: string }
  | { type: 'evidence-ref'; evidenceId: string; field: string };
