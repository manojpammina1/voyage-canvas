'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useState,
  type ReactNode,
} from 'react';
import type {
  AuthenticationState,
  CabinAvailability,
  ComparisonEvidenceData,
  Evidence,
  ExperienceEvent,
  FallbackReason,
  Hold,
  LockableCriterion,
  LockedPreference,
  Port,
  PriceQuote,
  SearchCriteria,
  StatusStep,
  VoyageOption,
} from '@voyage/shared';
import { HERO_INTENT } from '../lib/constants';
import type { EnrichedOption, PlanResult } from '../lib/planTypes';

export type ViewMode = 'orbit' | 'list';
export type CanvasStage = 'intent' | 'exploring' | 'comparing' | 'fallback';

export const MATERIALIZE_STEPS = [
  { id: 'UNDERSTANDING_INTENT', label: 'Understanding your trip' },
  { id: 'SEARCHING_SAILINGS', label: 'Searching Caribbean sailings' },
  { id: 'CHECKING_AVAILABILITY', label: 'Checking balcony availability' },
  { id: 'CHECKING_PRICING', label: 'Verifying prices & evidence' },
] as const;

export type MaterializePhase = (typeof MATERIALIZE_STEPS)[number]['id'];

const STEP_MS = 420;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function runMaterializeSequence(
  onPhase: (phase: MaterializePhase) => void,
) {
  for (const step of MATERIALIZE_STEPS) {
    onPhase(step.id);
    await sleep(STEP_MS);
  }
}

interface CanvasState {
  stage: CanvasStage;
  criteria: SearchCriteria;
  confirmedCriteria: Partial<SearchCriteria>;
  lockedPreferences: LockedPreference[];
  options: EnrichedOption[];
  evidence: Evidence[];
  ports: Port[];
  comparison?: ComparisonEvidenceData;
  selectedOptionId?: string;
  compareOptionIds: string[];
  statusMessage: string;
  viewMode: ViewMode;
  loading: boolean;
  error?: string;
  authenticationState: AuthenticationState;
  hold?: Hold;
  fallbackReason?: FallbackReason;
  policyNarrative?: string;
  materializePhase?: MaterializePhase;
  nodesReveal: boolean;
  policyStreaming: boolean;
}

type Action =
  | { type: 'SET_LOADING'; loading: boolean }
  | { type: 'SET_MATERIALIZE'; phase?: MaterializePhase }
  | { type: 'SET_NODES_REVEAL'; reveal: boolean }
  | { type: 'SET_POLICY_STREAMING'; streaming: boolean }
  | { type: 'SET_ERROR'; error?: string }
  | { type: 'APPLY_PLAN'; plan: PlanResult; stage?: CanvasStage }
  | { type: 'MERGE_EVIDENCE'; evidence: Evidence[] }
  | { type: 'SELECT_OPTION'; optionId: string }
  | { type: 'SET_VIEW'; viewMode: ViewMode }
  | { type: 'SET_COMPARE'; optionIds: [string, string] }
  | { type: 'SET_AUTH'; authenticationState: AuthenticationState }
  | { type: 'SET_HOLD'; hold: Hold }
  | { type: 'SET_FALLBACK'; reason: FallbackReason; criteria: SearchCriteria }
  | { type: 'SET_POLICY_NARRATIVE'; text: string; streaming?: boolean }
  | { type: 'RESET' };

const initialState: CanvasState = {
  stage: 'intent',
  criteria: {},
  confirmedCriteria: {},
  lockedPreferences: [],
  options: [],
  evidence: [],
  ports: [],
  compareOptionIds: [],
  statusMessage: 'Tell us the trip you are imagining',
  viewMode: 'orbit',
  loading: false,
  authenticationState: 'anonymous',
  nodesReveal: false,
  policyStreaming: false,
};

function mergeEvidence(existing: Evidence[], incoming: Evidence[]): Evidence[] {
  const byId = new Map(existing.map((ev) => [ev.id, ev]));
  for (const ev of incoming) {
    byId.set(ev.id, ev);
  }
  return [...byId.values()];
}

function reducer(state: CanvasState, action: Action): CanvasState {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, loading: action.loading, error: undefined };
    case 'SET_MATERIALIZE':
      return { ...state, materializePhase: action.phase };
    case 'SET_NODES_REVEAL':
      return { ...state, nodesReveal: action.reveal };
    case 'SET_POLICY_STREAMING':
      return { ...state, policyStreaming: action.streaming };
    case 'SET_ERROR':
      return {
        ...state,
        loading: false,
        error: action.error,
        materializePhase: undefined,
        policyStreaming: false,
      };
    case 'APPLY_PLAN':
      return {
        ...state,
        ...action.plan,
        evidence: action.plan.evidence,
        stage: action.stage ?? 'exploring',
        loading: false,
        error: undefined,
        fallbackReason: undefined,
        materializePhase: undefined,
        selectedOptionId:
          action.plan.options[0]?.id ?? state.selectedOptionId,
        statusMessage:
          action.plan.options.length > 0
            ? `${action.plan.options.length} voyage possibilities verified`
            : 'Adjust criteria to see more options',
      };
    case 'MERGE_EVIDENCE':
      return {
        ...state,
        evidence: mergeEvidence(state.evidence, action.evidence),
      };
    case 'SELECT_OPTION':
      return {
        ...state,
        selectedOptionId: action.optionId,
        stage: state.stage === 'fallback' ? 'fallback' : 'exploring',
      };
    case 'SET_VIEW':
      return { ...state, viewMode: action.viewMode };
    case 'SET_COMPARE':
      return {
        ...state,
        compareOptionIds: [...action.optionIds],
        stage: 'comparing',
      };
    case 'SET_AUTH':
      return {
        ...state,
        authenticationState: action.authenticationState,
      };
    case 'SET_HOLD':
      return { ...state, hold: action.hold };
    case 'SET_FALLBACK':
      return {
        ...state,
        stage: 'fallback',
        fallbackReason: action.reason,
        criteria: action.criteria,
        loading: false,
        statusMessage: 'Using guided planner — criteria preserved',
      };
    case 'SET_POLICY_NARRATIVE':
      return {
        ...state,
        policyNarrative: action.text,
        loading: action.streaming ? state.loading : false,
        policyStreaming: action.streaming ?? false,
        statusMessage: action.streaming
          ? 'Synthesizing policy answer…'
          : 'Policy answer retrieved with citation',
      };
    case 'RESET':
      return { ...initialState };
    default:
      return state;
  }
}

interface CanvasContextValue extends CanvasState {
  intentDraft: string;
  setIntentDraft: (v: string) => void;
  submitIntent: (intent?: string) => Promise<void>;
  updateBudget: (maxPriceUsd: number) => Promise<void>;
  togglePreferenceLock: (
    criterion: LockableCriterion,
    value: unknown,
    locked: boolean,
  ) => Promise<void>;
  selectOption: (optionId: string) => void;
  compareOptions: (optionIds: [string, string]) => Promise<void>;
  setViewMode: (mode: ViewMode) => void;
  askPolicyQuestion: (question: string) => Promise<void>;
  triggerFallbackDemo: () => Promise<void>;
  refreshAuth: () => Promise<void>;
  selectedOption?: EnrichedOption;
  priceEvidenceFor: (optionId: string) => Evidence | undefined;
}

const CanvasContext = createContext<CanvasContextValue | null>(null);

async function postPlan(body: Record<string, unknown>): Promise<PlanResult> {
  const res = await fetch('/api/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json()) as { error?: string };
    throw new Error(err.error ?? 'Planning request failed');
  }
  return res.json() as Promise<PlanResult>;
}

const STATUS_TO_PHASE: Partial<Record<StatusStep, MaterializePhase>> = {
  UNDERSTANDING_INTENT: 'UNDERSTANDING_INTENT',
  SEARCHING_SAILINGS: 'SEARCHING_SAILINGS',
  CHECKING_AVAILABILITY: 'CHECKING_AVAILABILITY',
  CHECKING_PRICING: 'CHECKING_PRICING',
};

interface SailingEvidenceData {
  criteria?: SearchCriteria;
  options?: VoyageOption[];
  ports?: Port[];
}

function isPriceQuote(data: unknown): data is PriceQuote {
  return (
    typeof data === 'object' &&
    data !== null &&
    'quoteId' in data &&
    'sailingId' in data &&
    'totalUsd' in data
  );
}

function isAvailability(data: unknown): data is CabinAvailability {
  return (
    typeof data === 'object' &&
    data !== null &&
    'sailingId' in data &&
    'availableCount' in data
  );
}

function buildPlanFromStreamEvidence(
  evidence: Evidence[],
  locks: LockedPreference[],
): PlanResult | null {
  const sailingEv = evidence.find((ev) => ev.type === 'SAILING');
  if (!sailingEv) return null;

  const sailingData = sailingEv.data as SailingEvidenceData;
  const options = sailingData.options ?? [];
  const criteria = sailingData.criteria ?? {};
  const pricesBySailing = new Map<string, PriceQuote>();
  const availabilityBySailing = new Map<string, CabinAvailability>();

  for (const ev of evidence) {
    if (ev.type === 'PRICE' && isPriceQuote(ev.data)) {
      pricesBySailing.set(ev.data.sailingId, ev.data);
    }
    if (ev.type === 'AVAILABILITY' && isAvailability(ev.data)) {
      availabilityBySailing.set(ev.data.sailingId, ev.data);
    }
  }

  const enriched: EnrichedOption[] = [];
  for (const opt of options) {
    const quote = pricesBySailing.get(opt.sailing.id);
    if (!quote) continue;
    enriched.push({
      ...opt,
      cabinType: opt.cabinType ?? quote.cabinType,
      cabinId: opt.cabinId ?? availabilityBySailing.get(opt.sailing.id)?.cabinId,
      totalUsd: quote.totalUsd,
      quoteId: quote.quoteId,
      asOf: quote.asOf,
      validUntil: quote.validUntil,
      shipLabel: opt.sailing.shipName,
      departureLabel: new Date(opt.sailing.departureDate).toLocaleDateString(
        'en-US',
        { month: 'short', day: 'numeric', year: 'numeric' },
      ),
    });
  }

  return {
    criteria,
    confirmedCriteria: { ...criteria },
    lockedPreferences: locks,
    options: enriched,
    evidence,
    ports: sailingData.ports ?? [],
    statusStep: enriched.length ? 'CHECKING_PRICING' : 'SEARCHING_SAILINGS',
    uncertainty: enriched.length ? undefined : 'NEEDS_DETAIL',
  };
}

async function readExperienceStream(
  res: Response,
  onEvent: (event: ExperienceEvent) => void,
): Promise<void> {
  if (!res.body) throw new Error('Experience stream unavailable');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';
    for (const part of parts) {
      const dataLine = part.split('\n').find((line) => line.startsWith('data: '));
      if (!dataLine) continue;
      onEvent(JSON.parse(dataLine.slice(6)) as ExperienceEvent);
    }
  }
}

export function CanvasProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [intentDraft, setIntentDraft] = useState(HERO_INTENT);

  const refreshAuth = useCallback(async () => {
    const res = await fetch('/api/auth/mock');
    if (!res.ok) return;
    const data = (await res.json()) as {
      authenticationState: AuthenticationState;
      holdId?: string;
    };
    dispatch({
      type: 'SET_AUTH',
      authenticationState: data.authenticationState,
    });
  }, []);

  const apply = useCallback(
    async (
      body: Record<string, unknown>,
      stage?: CanvasStage,
      options?: { cinematic?: boolean },
    ) => {
      const cinematic =
        options?.cinematic ?? body.action === 'search';
      dispatch({ type: 'SET_LOADING', loading: true });
      dispatch({ type: 'SET_NODES_REVEAL', reveal: false });
      if (cinematic) {
        dispatch({
          type: 'SET_MATERIALIZE',
          phase: MATERIALIZE_STEPS[0]!.id,
        });
      }
      try {
        const planPromise = postPlan(body);
        if (cinematic) {
          await Promise.all([
            runMaterializeSequence((phase) =>
              dispatch({ type: 'SET_MATERIALIZE', phase }),
            ),
            planPromise,
          ]);
        }
        const plan = await planPromise;
        dispatch({ type: 'APPLY_PLAN', plan, stage });
        dispatch({ type: 'SET_NODES_REVEAL', reveal: true });
      } catch (e) {
        dispatch({
          type: 'SET_ERROR',
          error: e instanceof Error ? e.message : 'Unknown error',
        });
      }
    },
    [],
  );

  const submitIntent = useCallback(
    async (intent?: string) => {
      const text = (intent ?? intentDraft).trim();
      const locks = state.lockedPreferences;
      const streamedEvidence: Evidence[] = [];
      let latestPlan: PlanResult | null = null;
      let sawFallback = false;

      dispatch({ type: 'SET_LOADING', loading: true });
      dispatch({ type: 'SET_NODES_REVEAL', reveal: false });
      dispatch({ type: 'SET_MATERIALIZE', phase: 'UNDERSTANDING_INTENT' });

      try {
        const res = await fetch('/api/experience', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ intent: text, locks }),
        });
        if (!res.ok) throw new Error('Experience stream failed');

        await readExperienceStream(res, (event) => {
          if (event.type === 'status') {
            const phase = STATUS_TO_PHASE[event.step];
            if (phase) dispatch({ type: 'SET_MATERIALIZE', phase });
          }
          if (event.type === 'fallback') {
            sawFallback = true;
            dispatch({
              type: 'SET_FALLBACK',
              reason: event.reason,
              criteria: event.criteria,
            });
          }
          if (event.type === 'evidence') {
            streamedEvidence.push(event.evidence);
            const plan = buildPlanFromStreamEvidence(streamedEvidence, locks);
            if (plan && plan.options.length > 0) {
              latestPlan = plan;
              dispatch({ type: 'APPLY_PLAN', plan });
              dispatch({ type: 'SET_NODES_REVEAL', reveal: true });
            }
          }
          if (event.type === 'error' && event.code !== 'AVAILABILITY_UNAVAILABLE') {
            dispatch({
              type: 'SET_ERROR',
              error: event.code.replace(/_/g, ' ').toLowerCase(),
            });
          }
        });

        if (sawFallback) {
          return;
        }
        if (latestPlan) {
          dispatch({ type: 'APPLY_PLAN', plan: latestPlan });
          dispatch({ type: 'SET_NODES_REVEAL', reveal: true });
        } else {
          dispatch({
            type: 'SET_ERROR',
            error: 'No verified voyage options returned',
          });
        }
      } catch (e) {
        dispatch({
          type: 'SET_ERROR',
          error: e instanceof Error ? e.message : 'Experience stream failed',
        });
      }
    },
    [intentDraft, state.lockedPreferences],
  );

  const updateBudget = useCallback(
    async (maxPriceUsd: number) => {
      await apply({
        action: 'budget',
        criteria: state.criteria,
        maxPriceUsd,
        locks: state.lockedPreferences,
      });
    },
    [apply, state.criteria, state.lockedPreferences],
  );

  const togglePreferenceLock = useCallback(
    async (criterion: LockableCriterion, value: unknown, locked: boolean) => {
      await apply({
        action: locked ? 'lock' : 'unlock',
        criteria: state.criteria,
        criterion,
        value,
        locks: state.lockedPreferences,
      });
    },
    [apply, state.criteria, state.lockedPreferences],
  );

  const selectOption = useCallback((optionId: string) => {
    dispatch({ type: 'SELECT_OPTION', optionId });
  }, []);

  const compareOptionsFn = useCallback(
    async (optionIds: [string, string]) => {
      dispatch({ type: 'SET_COMPARE', optionIds });
      await apply({
        action: 'compare',
        criteria: state.criteria,
        optionIds,
        options: state.options,
        locks: state.lockedPreferences,
      });
    },
    [apply, state.criteria, state.options, state.lockedPreferences],
  );

  const setViewMode = useCallback((viewMode: ViewMode) => {
    dispatch({ type: 'SET_VIEW', viewMode });
  }, []);

  const askPolicyQuestion = useCallback(
    async (question: string) => {
      dispatch({ type: 'SET_LOADING', loading: true });
      dispatch({ type: 'SET_POLICY_STREAMING', streaming: true });
      dispatch({ type: 'SET_POLICY_NARRATIVE', text: '', streaming: true });
      try {
        const res = await fetch('/api/experience', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            intent: intentDraft,
            policyQuestion: question,
            locks: state.lockedPreferences,
          }),
        });
        if (!res.ok || !res.body) {
          throw new Error('Policy stream unavailable');
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let narrative = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() ?? '';
          for (const part of parts) {
            const dataLine = part.split('\n').find((l) => l.startsWith('data: '));
            if (!dataLine) continue;
            const payload = JSON.parse(dataLine.slice(6)) as {
              type?: string;
              text?: string;
              evidence?: Evidence;
              reason?: FallbackReason;
              criteria?: SearchCriteria;
            };
            if (payload.type === 'evidence' && payload.evidence) {
              dispatch({ type: 'MERGE_EVIDENCE', evidence: [payload.evidence] });
            }
            if (payload.type === 'token' && payload.text) {
              narrative += payload.text;
              dispatch({
                type: 'SET_POLICY_NARRATIVE',
                text: narrative,
                streaming: true,
              });
            }
            if (payload.type === 'fallback' && payload.reason) {
              dispatch({
                type: 'SET_FALLBACK',
                reason: payload.reason,
                criteria: payload.criteria ?? state.criteria,
              });
              return;
            }
          }
        }
        dispatch({
          type: 'SET_POLICY_NARRATIVE',
          text: narrative.trim(),
          streaming: false,
        });
        dispatch({ type: 'SET_POLICY_STREAMING', streaming: false });
      } catch {
        dispatch({
          type: 'SET_FALLBACK',
          reason: 'MODEL_ERROR',
          criteria: state.criteria,
        });
      }
    },
    [intentDraft, state.criteria, state.lockedPreferences],
  );

  const triggerFallbackDemo = useCallback(async () => {
    dispatch({
      type: 'SET_FALLBACK',
      reason: 'MODEL_TIMEOUT',
      criteria: state.criteria.destination ? state.criteria : {
        destination: 'Caribbean',
        month: '2027-03',
        nights: 7,
        maxPriceUsd: 5000,
        cabinType: 'balcony',
      },
    });
  }, [state.criteria]);

  const selectedOption = useMemo(
    () => state.options.find((o) => o.id === state.selectedOptionId),
    [state.options, state.selectedOptionId],
  );

  const priceEvidenceFor = useCallback(
    (optionId: string) =>
      state.evidence.find(
        (e) => e.type === 'PRICE' && e.id === `ev-price-${optionId}`,
      ),
    [state.evidence],
  );

  const value: CanvasContextValue = {
    ...state,
    intentDraft,
    setIntentDraft,
    submitIntent,
    updateBudget,
    togglePreferenceLock,
    selectOption,
    compareOptions: compareOptionsFn,
    setViewMode,
    askPolicyQuestion,
    triggerFallbackDemo,
    refreshAuth,
    selectedOption,
    priceEvidenceFor,
  };

  return (
    <CanvasContext.Provider value={value}>{children}</CanvasContext.Provider>
  );
}

export function useCanvas() {
  const ctx = useContext(CanvasContext);
  if (!ctx) throw new Error('useCanvas must be used within CanvasProvider');
  return ctx;
}
