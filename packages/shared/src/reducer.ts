import type {
  Evidence,
  Hold,
  LockedPreference,
  SearchCriteria,
  VoyageOption,
} from './domain.js';
import type { VoyageExperience } from './experience.js';
import type { BoundedAction, ExperienceEvent, UiExperienceEvent } from './events.js';

export type ExperienceAction =
  | { source: 'model'; event: Extract<ExperienceEvent, { type: 'action' }> }
  | { source: 'system'; event: ExperienceEvent }
  | { source: 'ui'; event: UiExperienceEvent }
  | {
      source: 'deterministic';
      kind:
        | 'SET_CRITERIA'
        | 'SET_OPTIONS'
        | 'ADD_EVIDENCE'
        | 'SET_HOLD'
        | 'SET_BOOKING'
        | 'SET_AUTH'
        | 'SET_STAGE'
        | 'SET_UNCERTAINTY'
        | 'CLEAR_HOLD';
      payload: unknown;
    };

const MODEL_FORBIDDEN_FIELDS = [
  'availableOptions',
  'evidence',
  'hold',
  'bookingContext',
  'authenticationState',
  'guestId',
] as const;

export class AuthorityViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthorityViolation';
  }
}

function isLocked(
  state: VoyageExperience,
  criterion: keyof SearchCriteria,
): boolean {
  return state.lockedPreferences.some((p) => p.criterion === criterion);
}

function applyModelAction(
  state: VoyageExperience,
  action: BoundedAction,
  payload: unknown,
): VoyageExperience {
  switch (action) {
    case 'ASK_CLARIFICATION':
    case 'EXPLAIN_TRADEOFF':
    case 'FOCUS_DECISION':
      return {
        ...state,
        activeDecision:
          typeof payload === 'object' &&
          payload !== null &&
          'focus' in payload &&
          typeof (payload as { focus: unknown }).focus === 'string'
            ? (payload as { focus: string }).focus
            : state.activeDecision,
      };
    case 'ADD_CONSTRAINT': {
      const patch = (payload ?? {}) as Partial<SearchCriteria>;
      const next: SearchCriteria = { ...state.criteria };
      for (const [key, value] of Object.entries(patch)) {
        const k = key as keyof SearchCriteria;
        if (isLocked(state, k)) continue;
        (next as Record<string, unknown>)[k] = value;
      }
      return { ...state, criteria: next };
    }
    case 'RELAX_CONSTRAINT': {
      const criterion = (payload as { criterion?: keyof SearchCriteria } | null)
        ?.criterion;
      if (!criterion) return state;
      if (isLocked(state, criterion)) {
        throw new AuthorityViolation(
          `Model cannot relax locked preference: ${criterion}`,
        );
      }
      const next = { ...state.criteria };
      delete next[criterion];
      return { ...state, criteria: next };
    }
    case 'LOCK_PREFERENCE': {
      // Model may propose lock; guest UI owns durable lock write via UI event.
      return state;
    }
    default:
      return state;
  }
}

export function experienceReducer(
  state: VoyageExperience,
  action: ExperienceAction,
): VoyageExperience {
  if (action.source === 'model') {
    // Reject any attempt to smuggle commerce/auth writes via payload.
    if (
      action.event.payload &&
      typeof action.event.payload === 'object' &&
      MODEL_FORBIDDEN_FIELDS.some((f) => f in (action.event.payload as object))
    ) {
      throw new AuthorityViolation(
        'Model action payload cannot write commerce/auth authority fields',
      );
    }
    return applyModelAction(state, action.event.action, action.event.payload);
  }

  if (action.source === 'ui') {
    const e = action.event;
    switch (e.type) {
      case 'SUBMIT_INTENT':
        return { ...state, stage: 'materializing' };
      case 'SELECT_OPTION':
        return {
          ...state,
          selectedOptionId: e.optionId,
          stage: 'commitment',
        };
      case 'UPDATE_BUDGET':
        return {
          ...state,
          criteria: { ...state.criteria, maxPriceUsd: e.maxPriceUsd },
        };
      case 'COMPARE':
        return {
          ...state,
          compareOptionIds: [...e.optionIds],
          stage: 'comparing',
        };
      case 'LOCK_PREFERENCE': {
        const lockedAt = new Date().toISOString();
        const rest = state.lockedPreferences.filter(
          (p) => p.criterion !== e.criterion,
        );
        const locked: LockedPreference = {
          criterion: e.criterion as LockedPreference['criterion'],
          value: e.value,
          lockedAt,
        };
        return {
          ...state,
          lockedPreferences: [...rest, locked],
          criteria: {
            ...state.criteria,
            [e.criterion]: e.value,
          } as SearchCriteria,
        };
      }
      case 'UNLOCK_PREFERENCE':
        return {
          ...state,
          lockedPreferences: state.lockedPreferences.filter(
            (p) => p.criterion !== e.criterion,
          ),
        };
      case 'SIMULATE_SIGN_IN':
        // Auth truth is set only via deterministic SET_AUTH after server rotation.
        return state;
      case 'CONFIRM_HOLD':
        return state;
      default:
        return state;
    }
  }

  if (action.source === 'system') {
    const e = action.event;
    if (e.type === 'evidence') {
      return { ...state, evidence: [...state.evidence, e.evidence] };
    }
    if (e.type === 'handoff') {
      return {
        ...state,
        bookingContext: e.bookingContext,
        stage: 'handoff',
      };
    }
    if (e.type === 'fallback') {
      return {
        ...state,
        stage: 'fallback',
        criteria: e.criteria,
        confirmedCriteria: { ...state.confirmedCriteria, ...e.criteria },
        uncertainty: 'MODEL_UNAVAILABLE',
      };
    }
    if (e.type === 'status') {
      return state.stage === 'intent'
        ? { ...state, stage: 'materializing' }
        : state;
    }
    return state;
  }

  // deterministic
  switch (action.kind) {
    case 'SET_CRITERIA': {
      const criteria = action.payload as SearchCriteria;
      return {
        ...state,
        criteria,
        confirmedCriteria: { ...state.confirmedCriteria, ...criteria },
      };
    }
    case 'SET_OPTIONS':
      return {
        ...state,
        availableOptions: action.payload as VoyageOption[],
        stage: 'exploring',
      };
    case 'ADD_EVIDENCE':
      return {
        ...state,
        evidence: [...state.evidence, action.payload as Evidence],
      };
    case 'SET_HOLD':
      return { ...state, hold: action.payload as Hold };
    case 'CLEAR_HOLD': {
      const { hold: _h, ...rest } = state;
      return { ...rest, hold: undefined };
    }
    case 'SET_BOOKING':
      return {
        ...state,
        bookingContext: action.payload as VoyageExperience['bookingContext'],
        stage: 'handoff',
      };
    case 'SET_AUTH': {
      const auth = action.payload as {
        authenticationState: VoyageExperience['authenticationState'];
        sessionId: string;
        guestId: string;
      };
      return {
        ...state,
        authenticationState: auth.authenticationState,
        sessionId: auth.sessionId,
        guestId: auth.guestId,
      };
    }
    case 'SET_STAGE':
      return {
        ...state,
        stage: action.payload as VoyageExperience['stage'],
      };
    case 'SET_UNCERTAINTY':
      return {
        ...state,
        uncertainty: action.payload as VoyageExperience['uncertainty'],
      };
    default:
      return state;
  }
}
