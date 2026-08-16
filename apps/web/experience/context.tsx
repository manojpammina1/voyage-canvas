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
export type AgentTraceKind =
  | 'ai'
  | 'deterministic'
  | 'retrieval'
  | 'guardrail'
  | 'system';
export type AgentTraceStatus = 'running' | 'complete' | 'blocked';
export type AssistantAnswerMode = 'deterministic' | 'policy' | 'fallback';

export interface AgentTraceEntry {
  id: string;
  label: string;
  detail: string;
  kind: AgentTraceKind;
  status: AgentTraceStatus;
}

export const MATERIALIZE_STEPS = [
  { id: 'UNDERSTANDING_INTENT', label: 'Understanding your trip' },
  { id: 'SEARCHING_SAILINGS', label: 'Searching Caribbean sailings' },
  { id: 'CHECKING_AVAILABILITY', label: 'Checking balcony availability' },
  { id: 'CHECKING_PRICING', label: 'Verifying prices & evidence' },
] as const;

export type MaterializePhase = (typeof MATERIALIZE_STEPS)[number]['id'];

const STEP_MS = 420;
const EXPERIENCE_STREAM_TIMEOUT_MS = 30_000;
const POLICY_STREAM_TIMEOUT_MS = 20_000;

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
  clarificationQuestion?: string;
  assistantQuestion?: string;
  assistantAnswerMode?: AssistantAnswerMode;
  assistantCitationEvidenceIds: string[];
  policyNarrative?: string;
  materializePhase?: MaterializePhase;
  nodesReveal: boolean;
  policyStreaming: boolean;
  agentTrace: AgentTraceEntry[];
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
  | { type: 'SET_CLARIFICATION'; question: string }
  | {
      type: 'SET_POLICY_NARRATIVE';
      text: string;
      streaming?: boolean;
      question?: string;
      answerMode?: AssistantAnswerMode;
      citationEvidenceIds?: string[];
    }
  | { type: 'ADD_ASSISTANT_CITATION_EVIDENCE'; evidenceId: string }
  | { type: 'RESET_AGENT_TRACE'; entries?: AgentTraceEntry[] }
  | { type: 'UPSERT_AGENT_TRACE'; entry: AgentTraceEntry }
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
  agentTrace: [],
  assistantCitationEvidenceIds: [],
};

function mergeEvidence(existing: Evidence[], incoming: Evidence[]): Evidence[] {
  const byId = new Map(existing.map((ev) => [ev.id, ev]));
  for (const ev of incoming) {
    byId.set(ev.id, ev);
  }
  return [...byId.values()];
}

function upsertAgentTrace(
  existing: AgentTraceEntry[],
  incoming: AgentTraceEntry,
): AgentTraceEntry[] {
  const index = existing.findIndex((entry) => entry.id === incoming.id);
  if (index === -1) return [...existing, incoming];
  return [
    ...existing.slice(0, index),
    ...existing.slice(index + 1),
    incoming,
  ];
}

function traceEntry(
  id: string,
  label: string,
  detail: string,
  kind: AgentTraceKind,
  status: AgentTraceStatus,
): AgentTraceEntry {
  return { id, label, detail, kind, status };
}

function reducer(state: CanvasState, action: Action): CanvasState {
  switch (action.type) {
    case 'SET_LOADING':
      return {
        ...state,
        loading: action.loading,
        error: undefined,
        clarificationQuestion: action.loading
          ? undefined
          : state.clarificationQuestion,
      };
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
        clarificationQuestion: undefined,
        assistantQuestion: undefined,
        assistantAnswerMode: undefined,
        assistantCitationEvidenceIds: [],
        policyNarrative: undefined,
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
        policyStreaming: false,
        materializePhase: undefined,
        clarificationQuestion: undefined,
        assistantAnswerMode: 'fallback',
        assistantCitationEvidenceIds: [],
        statusMessage: 'Using guided planner — criteria preserved',
      };
    case 'SET_CLARIFICATION':
      return {
        ...state,
        stage: 'intent',
        loading: false,
        materializePhase: undefined,
        nodesReveal: false,
        error: undefined,
        clarificationQuestion: action.question,
        assistantQuestion: undefined,
        assistantAnswerMode: undefined,
        assistantCitationEvidenceIds: [],
        policyNarrative: undefined,
        statusMessage: action.question,
      };
    case 'SET_POLICY_NARRATIVE':
      return {
        ...state,
        assistantQuestion: action.question ?? state.assistantQuestion,
        assistantAnswerMode: action.answerMode ?? state.assistantAnswerMode,
        assistantCitationEvidenceIds:
          action.citationEvidenceIds ?? state.assistantCitationEvidenceIds,
        policyNarrative: action.text,
        loading: action.streaming ? state.loading : false,
        policyStreaming: action.streaming ?? false,
        statusMessage: action.streaming
          ? 'Synthesizing policy answer…'
          : 'Answer grounded in trip data and approved content',
      };
    case 'ADD_ASSISTANT_CITATION_EVIDENCE':
      return {
        ...state,
        assistantCitationEvidenceIds: state.assistantCitationEvidenceIds.includes(
          action.evidenceId,
        )
          ? state.assistantCitationEvidenceIds
          : [...state.assistantCitationEvidenceIds, action.evidenceId],
      };
    case 'RESET_AGENT_TRACE':
      return {
        ...state,
        agentTrace: action.entries ?? [],
      };
    case 'UPSERT_AGENT_TRACE':
      return {
        ...state,
        agentTrace: upsertAgentTrace(state.agentTrace, action.entry),
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
  searchSavedCriteria: () => Promise<void>;
  relaxToAvailableDuration: () => Promise<void>;
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
  askVoyageQuestion: (question: string) => Promise<void>;
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

function formatUsd(value: number): string {
  return `$${value.toLocaleString('en-US')}`;
}

function dollarClaims(text: string): number[] {
  return [...text.matchAll(/\$\s*[\d,]+(?:\.\d{2})?/g)]
    .map((match) => Number(match[0].replace(/[^\d.]/g, '')))
    .filter((value) => Number.isFinite(value));
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function selectedEvidence<T>(
  evidence: Evidence[],
  type: Evidence['type'],
  optionId?: string,
): Evidence<T> | undefined {
  if (!optionId) return undefined;
  return evidence.find((ev) => ev.type === type && ev.id.endsWith(optionId)) as
    | Evidence<T>
    | undefined;
}

function statusTraceEntry(step: StatusStep): AgentTraceEntry {
  switch (step) {
    case 'UNDERSTANDING_INTENT':
      return traceEntry(
        'status-understanding-intent',
        'Intent interpreted',
        'The model can parse preferences, but it cannot set price, availability, hold, or payment state.',
        'ai',
        'complete',
      );
    case 'SEARCHING_SAILINGS':
      return traceEntry(
        'status-searching-sailings',
        'Sailing search invoked',
        'Application services search the catalog using validated criteria and active preference locks.',
        'deterministic',
        'complete',
      );
    case 'CHECKING_AVAILABILITY':
      return traceEntry(
        'status-checking-availability',
        'Availability tool invoked',
        'Inventory is checked through deterministic tooling before any recommendation is shown.',
        'deterministic',
        'complete',
      );
    case 'CHECKING_PRICING':
      return traceEntry(
        'status-checking-pricing',
        'Pricing tool invoked',
        'Pricing is verified by service evidence with quote IDs and expiry, not generated by AI.',
        'deterministic',
        'complete',
      );
    case 'RETRIEVING_POLICY':
      return traceEntry(
        'status-retrieving-policy',
        'Policy retrieval invoked',
        'The RAG path searches only approved policy, FAQ, destination, and ship content.',
        'retrieval',
        'complete',
      );
    case 'COMPUTING_COMPARISON':
      return traceEntry(
        'status-computing-comparison',
        'Comparison service invoked',
        'Differences between voyages are computed deterministically from verified option data.',
        'deterministic',
        'complete',
      );
    case 'REVALIDATING_PRICE':
      return traceEntry(
        'status-revalidating-price',
        'Price revalidation invoked',
        'The service re-checks quote freshness before state-changing booking actions.',
        'deterministic',
        'complete',
      );
    case 'CREATING_HOLD':
      return traceEntry(
        'status-creating-hold',
        'Hold creation invoked',
        'A hold requires guest confirmation and revalidation before the checkout handoff.',
        'deterministic',
        'complete',
      );
  }
}

function evidenceTraceEntry(evidence: Evidence): AgentTraceEntry {
  const tool = evidence.provenance.tool;
  switch (evidence.type) {
    case 'SAILING':
      return traceEntry(
        'evidence-sailing',
        'Catalog evidence returned',
        `${tool} returned matching sailings and itinerary ports for the parsed criteria.`,
        'deterministic',
        'complete',
      );
    case 'AVAILABILITY':
      return traceEntry(
        'evidence-availability',
        'Availability verified',
        `${tool} returned live cabin inventory evidence for the voyage options.`,
        'deterministic',
        'complete',
      );
    case 'PRICE':
      return traceEntry(
        'evidence-price',
        'Price verified',
        `${tool} returned quote-backed fare, taxes, fees, and validity timing.`,
        'deterministic',
        'complete',
      );
    case 'POLICY':
      return traceEntry(
        'evidence-policy',
        'Policy retrieved',
        `${tool} returned approved content for the assistant answer.`,
        'retrieval',
        'complete',
      );
    case 'COMPARISON':
      return traceEntry(
        'evidence-comparison',
        'Comparison calculated',
        `${tool} calculated deterministic differences between selected voyages.`,
        'deterministic',
        'complete',
      );
  }
}

function fallbackTraceEntry(reason: FallbackReason): AgentTraceEntry {
  return traceEntry(
    'fallback-safe-mode',
    'Safe fallback activated',
    `${reason.replace(/_/g, ' ').toLowerCase()} preserved criteria and kept commerce decisions in deterministic services.`,
    'guardrail',
    'blocked',
  );
}

function planActionTraceEntry(
  body: Record<string, unknown>,
  status: AgentTraceStatus,
): AgentTraceEntry {
  const action = typeof body.action === 'string' ? body.action : 'plan';
  const labels: Record<string, string> = {
    budget: 'Budget re-run',
    compare: 'Comparison requested',
    lock: 'Preference locked',
    refine: 'Criteria re-run',
    search: 'Voyage search requested',
    unlock: 'Preference unlocked',
  };
  return traceEntry(
    `plan-${action}`,
    labels[action] ?? 'Planner request',
    'Application services re-run deterministic search, pricing, and evidence validation. The model does not create commerce truth.',
    'deterministic',
    status,
  );
}

function deterministicVoyageAnswer(
  question: string,
  state: CanvasState,
): string | undefined {
  const selected = state.options.find((opt) => opt.id === state.selectedOptionId);
  const normalized = question.toLowerCase();
  const asksForPackageLikeOptions =
    /\b(package|packages|deal|deals|fare|fares|option|options)\b/.test(
      normalized,
    ) &&
    /\b(available|availability|availble|avialble|show|list|what|which|other|another|more|else)\b/.test(
      normalized,
    );
  const asksForVoyageOptions =
    asksForPackageLikeOptions ||
    /\b(other|another|alternative|alternatives|more)\b.*\b(voyage|voyages|sailing|sailings|option|options|ship|ships|cruise|cruises)\b/.test(
      normalized,
    ) ||
    /\b(voyage|voyages|sailing|sailings|option|options|ship|ships|cruise|cruises)\b.*\b(other|another|alternative|alternatives|more|else)\b/.test(
      normalized,
    );

  if (asksForVoyageOptions && state.options.length > 0) {
    const ranked = [...state.options].sort((a, b) => a.totalUsd - b.totalUsd);
    const candidates =
      selected && ranked.length > 1
        ? ranked.filter((opt) => opt.id !== selected.id)
        : ranked;
    const optionText = candidates
      .map(
        (opt) =>
          `${opt.shipLabel} departing ${opt.departureLabel} at ${formatUsd(opt.totalUsd)}`,
      )
      .join('; ');
    const packageClarifier = /\b(package|packages|deal|deals|fare|fares)\b/.test(
      normalized,
    )
      ? 'I am interpreting packages as the verified cruise options in this demo. '
      : '';

    if (selected && candidates.length !== ranked.length) {
      return `${packageClarifier}Yes. Besides ${selected.shipLabel}, this search has ${candidates.length} other verified option${candidates.length === 1 ? '' : 's'}: ${optionText}. These prices come from current-turn deterministic pricing evidence, not model-generated fares.`;
    }

    return `${packageClarifier}This search has ${ranked.length} verified option${ranked.length === 1 ? '' : 's'}: ${optionText}. These prices come from current-turn deterministic pricing evidence, not model-generated fares.`;
  }

  if (!selected) return undefined;

  const priceEvidence = selectedEvidence<PriceQuote>(
    state.evidence,
    'PRICE',
    selected.id,
  );
  const availabilityEvidence = selectedEvidence<CabinAvailability>(
    state.evidence,
    'AVAILABILITY',
    selected.id,
  );
  const routePorts = state.ports.filter((port) =>
    selected.sailing.ports.includes(port.id),
  );

  if (priceEvidence && isPriceQuote(priceEvidence.data)) {
    const supportedDollarClaims = [
      priceEvidence.data.totalUsd,
      ...priceEvidence.data.breakdown.map((item) => item.amountUsd),
    ];
    const unsupportedDollarClaims = dollarClaims(question).filter(
      (claim) => !supportedDollarClaims.includes(claim),
    );

    if (unsupportedDollarClaims.length > 0) {
      const availabilityText =
        availabilityEvidence && isAvailability(availabilityEvidence.data)
          ? ` Availability evidence shows ${availabilityEvidence.data.availableCount} ${availabilityEvidence.data.cabinType.replace('_', ' ')} cabins available as of ${formatDateTime(availabilityEvidence.data.asOf)}.`
          : '';

      return `I cannot state ${formatUsd(unsupportedDollarClaims[0]!)} because current-turn pricing evidence does not support it. ${selected.shipLabel} has a verified total of ${formatUsd(priceEvidence.data.totalUsd)} for ${priceEvidence.data.occupancy.adults} adults and ${priceEvidence.data.occupancy.children} children in a ${priceEvidence.data.cabinType.replace('_', ' ')} cabin.${availabilityText} Price and availability remain grounded in deterministic evidence.`;
    }
  }

  if (
    /\b(adjacent|connecting|nearby|side-by-side|side by side|together)\b/.test(
      normalized,
    ) &&
    /\b(cabin|cabins|room|rooms|balcony|stateroom|staterooms)\b/.test(
      normalized,
    ) &&
    availabilityEvidence &&
    isAvailability(availabilityEvidence.data)
  ) {
    return `${selected.shipLabel} has ${availabilityEvidence.data.availableCount} verified ${availabilityEvidence.data.cabinType.replace('_', ' ')} cabins available right now. Adjacent or connecting assignment is not confirmed by this demo inventory response, so the booking flow must re-check cabin placement deterministically before creating a hold.`;
  }

  if (
    /\b(price|total|cost|fee|fees|tax|taxes|included|breakdown)\b/.test(
      normalized,
    ) &&
    priceEvidence &&
    isPriceQuote(priceEvidence.data)
  ) {
    const breakdown = priceEvidence.data.breakdown
      .map((item) => `${item.label}: ${formatUsd(item.amountUsd)}`)
      .join('; ');

    return [
      `${selected.shipLabel} has a verified total of ${formatUsd(priceEvidence.data.totalUsd)} for ${priceEvidence.data.occupancy.adults} adults and ${priceEvidence.data.occupancy.children} children in a ${priceEvidence.data.cabinType.replace('_', ' ')} cabin.`,
      breakdown ? `Pricing data breakdown: ${breakdown}.` : '',
      `Quote ${priceEvidence.data.quoteId} was verified ${formatDateTime(priceEvidence.data.asOf)} and is valid until ${formatDateTime(priceEvidence.data.validUntil)}.`,
    ]
      .filter(Boolean)
      .join(' ');
  }

  if (
    /\b(available|availability|inventory|cabin|balcony|live)\b/.test(
      normalized,
    ) &&
    availabilityEvidence &&
    isAvailability(availabilityEvidence.data)
  ) {
    return `${selected.shipLabel} currently has ${availabilityEvidence.data.availableCount} ${availabilityEvidence.data.cabinType.replace('_', ' ')} cabins available in the inventory service. This was checked ${formatDateTime(availabilityEvidence.data.asOf)} by ${availabilityEvidence.provenance.tool}.`;
  }

  if (/\b(route|port|ports|stop|stops|itinerary|map)\b/.test(normalized)) {
    const route = routePorts.length
      ? routePorts.map((port) => port.name).join(' -> ')
      : selected.sailing.ports.join(' -> ');
    return `${selected.shipLabel} is a ${selected.sailing.nights}-night ${selected.sailing.destination} sailing departing ${selected.departureLabel}. The route shown from catalog data is ${route}.`;
  }

  if (/\b(why|fit|best|family|recommend|match)\b/.test(normalized)) {
    const reasons = selected.fitReasons.length
      ? selected.fitReasons.join('; ')
      : 'it matches the requested destination, month, duration, cabin type, and budget';
    return `${selected.shipLabel} fits this request because ${reasons}. Price and availability remain grounded in current-turn deterministic evidence.`;
  }

  if (/\b(budget|cheaper|lower|under|less)\b/.test(normalized)) {
    const ranked = [...state.options]
      .sort((a, b) => a.totalUsd - b.totalUsd)
      .map((opt) => `${opt.shipLabel}: ${formatUsd(opt.totalUsd)}`)
      .join('; ');
    return `From verified options in this turn, the price order is ${ranked}. Use the budget slider or lock chips to rerun deterministic search without asking the model to recalculate prices.`;
  }

  return undefined;
}

function clarificationQuestionFromPayload(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const question = (payload as { question?: unknown }).question;
  if (typeof question !== 'string') return undefined;
  const trimmed = question.trim();
  return trimmed.length > 0 ? trimmed : undefined;
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
      const action = typeof body.action === 'string' ? body.action : 'plan';
      dispatch({ type: 'SET_LOADING', loading: true });
      dispatch({ type: 'SET_NODES_REVEAL', reveal: false });
      if (action === 'compare') {
        dispatch({
          type: 'UPSERT_AGENT_TRACE',
          entry: planActionTraceEntry(body, 'running'),
        });
      } else {
        dispatch({
          type: 'RESET_AGENT_TRACE',
          entries: [planActionTraceEntry(body, 'running')],
        });
      }
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
        dispatch({
          type: 'UPSERT_AGENT_TRACE',
          entry: planActionTraceEntry(body, 'complete'),
        });
        for (const evidence of plan.evidence) {
          dispatch({
            type: 'UPSERT_AGENT_TRACE',
            entry: evidenceTraceEntry(evidence),
          });
        }
        dispatch({
          type: 'UPSERT_AGENT_TRACE',
          entry: traceEntry(
            'grounding-commerce',
            'Grounding check passed',
            'The UI is showing only values backed by current deterministic evidence.',
            'guardrail',
            'complete',
          ),
        });
        dispatch({ type: 'APPLY_PLAN', plan, stage });
        dispatch({ type: 'SET_NODES_REVEAL', reveal: true });
      } catch (e) {
        dispatch({
          type: 'UPSERT_AGENT_TRACE',
          entry: planActionTraceEntry(body, 'blocked'),
        });
        dispatch({
          type: 'UPSERT_AGENT_TRACE',
          entry: traceEntry(
            'plan-error',
            'Planner fallback required',
            'The deterministic plan request failed before a fully grounded result could be rendered.',
            'guardrail',
            'blocked',
          ),
        });
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
      let sawClarification = false;
      let materializeActive = true;

      dispatch({ type: 'SET_LOADING', loading: true });
      dispatch({
        type: 'RESET_AGENT_TRACE',
        entries: [
          traceEntry(
            'guest-intent',
            'Guest intent captured',
            'The assistant uses the prompt to extract trip criteria without sending payment data or raw authorization state to the model.',
            'system',
            'complete',
          ),
          traceEntry(
            'commerce-boundary',
            'Commerce boundary enforced',
            'Prices, availability, holds, and checkout state must come from deterministic services.',
            'guardrail',
            'complete',
          ),
        ],
      });
      dispatch({ type: 'SET_NODES_REVEAL', reveal: false });
      dispatch({ type: 'SET_MATERIALIZE', phase: 'UNDERSTANDING_INTENT' });
      void runMaterializeSequence((phase) => {
        if (materializeActive) {
          dispatch({ type: 'SET_MATERIALIZE', phase });
        }
      });

      const abortController = new AbortController();
      const timeoutId = window.setTimeout(
        () => abortController.abort(),
        EXPERIENCE_STREAM_TIMEOUT_MS,
      );

      try {
        const res = await fetch('/api/experience', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: abortController.signal,
          body: JSON.stringify({ intent: text, locks }),
        });
        if (!res.ok) throw new Error('Experience stream failed');

        await readExperienceStream(res, (event) => {
          if (event.type === 'status') {
            const phase = STATUS_TO_PHASE[event.step];
            if (phase && materializeActive) {
              dispatch({ type: 'SET_MATERIALIZE', phase });
            }
            dispatch({
              type: 'UPSERT_AGENT_TRACE',
              entry: statusTraceEntry(event.step),
            });
          }
          if (event.type === 'action' && event.action === 'ASK_CLARIFICATION') {
            const question =
              clarificationQuestionFromPayload(event.payload) ??
              'Can you add a little more detail so we can search verified sailings?';
            sawClarification = true;
            materializeActive = false;
            dispatch({
              type: 'UPSERT_AGENT_TRACE',
              entry: traceEntry(
                'clarification-needed',
                'Clarification needed',
                'The model can ask for missing planning details, but search remains blocked until the guest clarifies.',
                'ai',
                'blocked',
              ),
            });
            dispatch({ type: 'SET_CLARIFICATION', question });
          }
          if (event.type === 'fallback') {
            sawFallback = true;
            materializeActive = false;
            dispatch({
              type: 'UPSERT_AGENT_TRACE',
              entry: fallbackTraceEntry(event.reason),
            });
            dispatch({
              type: 'SET_FALLBACK',
              reason: event.reason,
              criteria: event.criteria,
            });
          }
          if (event.type === 'evidence') {
            streamedEvidence.push(event.evidence);
            dispatch({
              type: 'UPSERT_AGENT_TRACE',
              entry: evidenceTraceEntry(event.evidence),
            });
            const plan = buildPlanFromStreamEvidence(streamedEvidence, locks);
            if (plan) {
              latestPlan = plan;
              if (plan.options.length > 0) {
                materializeActive = false;
                dispatch({ type: 'APPLY_PLAN', plan });
                dispatch({ type: 'SET_NODES_REVEAL', reveal: true });
              }
            }
          }
          if (event.type === 'error' && event.code !== 'AVAILABILITY_UNAVAILABLE') {
            dispatch({
              type: 'UPSERT_AGENT_TRACE',
              entry: traceEntry(
                `stream-error-${event.code.toLowerCase()}`,
                'Stream error handled',
                `${event.code.replace(/_/g, ' ').toLowerCase()} prevented a fully grounded response.`,
                'guardrail',
                'blocked',
              ),
            });
            dispatch({
              type: 'SET_ERROR',
              error: event.code.replace(/_/g, ' ').toLowerCase(),
            });
            materializeActive = false;
          }
        });

        materializeActive = false;
        if (sawFallback) {
          return;
        }
        if (sawClarification) {
          return;
        }
        const completedPlan =
          latestPlan ?? buildPlanFromStreamEvidence(streamedEvidence, locks);
        if (completedPlan) {
          dispatch({
            type: 'UPSERT_AGENT_TRACE',
            entry: traceEntry(
              'grounding-commerce',
              'Grounding check passed',
              'The selected voyage, price, and availability are backed by current-turn evidence.',
              'guardrail',
              'complete',
            ),
          });
          dispatch({ type: 'APPLY_PLAN', plan: completedPlan });
          dispatch({
            type: 'SET_NODES_REVEAL',
            reveal: completedPlan.options.length > 0,
          });
        } else {
          dispatch({
            type: 'UPSERT_AGENT_TRACE',
            entry: traceEntry(
              'no-verified-options',
              'No grounded result',
              'The services did not return a complete sailing, price, and availability set for display.',
              'guardrail',
              'blocked',
            ),
          });
          dispatch({
            type: 'SET_ERROR',
            error: 'No verified voyage options returned',
          });
        }
      } catch (e) {
        materializeActive = false;
        if (latestPlan) {
          dispatch({
            type: 'UPSERT_AGENT_TRACE',
            entry: traceEntry(
              'grounding-commerce',
              'Grounding check passed',
              'A partial stream already produced enough deterministic evidence to render verified options.',
              'guardrail',
              'complete',
            ),
          });
          dispatch({ type: 'APPLY_PLAN', plan: latestPlan });
          dispatch({ type: 'SET_NODES_REVEAL', reveal: true });
          return;
        }
        if (sawFallback || sawClarification) {
          return;
        }
        const isAbort = e instanceof Error && e.name === 'AbortError';
        dispatch({
          type: 'UPSERT_AGENT_TRACE',
          entry: traceEntry(
            'experience-stream-failed',
            'Experience stream failed',
            isAbort
              ? 'The model stream timed out before verified sailings returned; fallback keeps criteria available.'
              : 'The experience stream failed before a grounded result could be rendered.',
            'guardrail',
            'blocked',
          ),
        });
        dispatch({
          type: 'SET_ERROR',
          error: isAbort
            ? 'AI planner timed out before verified sailings returned. Please try again or use the AI outage demo.'
            : e instanceof Error
              ? e.message
              : 'Experience stream failed',
        });
      } finally {
        materializeActive = false;
        window.clearTimeout(timeoutId);
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

  const searchSavedCriteria = useCallback(async () => {
    await apply(
      {
        action: 'refine',
        criteria: state.criteria,
        locks: state.lockedPreferences,
      },
      'exploring',
      { cinematic: true },
    );
  }, [apply, state.criteria, state.lockedPreferences]);

  const relaxToAvailableDuration = useCallback(async () => {
    await apply(
      {
        action: 'refine',
        criteria: { ...state.criteria, nights: 7 },
        locks: state.lockedPreferences.filter((lock) => lock.criterion !== 'nights'),
      },
      'exploring',
      { cinematic: true },
    );
  }, [apply, state.criteria, state.lockedPreferences]);

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
      dispatch({
        type: 'RESET_AGENT_TRACE',
        entries: [
          traceEntry(
            'question-routing',
            'Question routed',
            'This question needs approved content, so it goes through the retrieval and grounded-answer path.',
            'system',
            'complete',
          ),
          traceEntry(
            'policy-retrieval',
            'Policy retrieval started',
            'Only approved policy, FAQ, destination, and ship content can be retrieved for answers.',
            'retrieval',
            'running',
          ),
        ],
      });
      dispatch({ type: 'SET_POLICY_STREAMING', streaming: true });
      dispatch({
        type: 'SET_POLICY_NARRATIVE',
        text: '',
        streaming: true,
        question,
        answerMode: 'policy',
        citationEvidenceIds: [],
      });
      const abortController = new AbortController();
      const timeoutId = window.setTimeout(
        () => abortController.abort(),
        POLICY_STREAM_TIMEOUT_MS,
      );
      try {
        const res = await fetch('/api/experience', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: abortController.signal,
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
              if (payload.evidence.type === 'POLICY') {
                dispatch({
                  type: 'ADD_ASSISTANT_CITATION_EVIDENCE',
                  evidenceId: payload.evidence.id,
                });
                dispatch({
                  type: 'UPSERT_AGENT_TRACE',
                  entry: traceEntry(
                    'policy-retrieval',
                    'Policy retrieval complete',
                    'Approved content was retrieved and attached as evidence for the answer.',
                    'retrieval',
                    'complete',
                  ),
                });
              }
              dispatch({
                type: 'UPSERT_AGENT_TRACE',
                entry: evidenceTraceEntry(payload.evidence),
              });
            }
            if (payload.type === 'token' && payload.text) {
              narrative += payload.text;
              dispatch({
                type: 'UPSERT_AGENT_TRACE',
                entry: traceEntry(
                  'policy-narrative',
                  'Grounded answer streaming',
                  'The LLM is composing language from approved retrieved content and current trip context.',
                  'ai',
                  'running',
                ),
              });
              dispatch({
                type: 'SET_POLICY_NARRATIVE',
                text: narrative,
                streaming: true,
                question,
                answerMode: 'policy',
              });
            }
            if (payload.type === 'fallback' && payload.reason) {
              dispatch({
                type: 'UPSERT_AGENT_TRACE',
                entry: traceEntry(
                  'policy-retrieval',
                  'Policy retrieval unavailable',
                  'The policy path could not complete, so the assistant avoided ungrounded policy text.',
                  'retrieval',
                  'blocked',
                ),
              });
              dispatch({
                type: 'UPSERT_AGENT_TRACE',
                entry: fallbackTraceEntry(payload.reason),
              });
              dispatch({
                type: 'SET_POLICY_NARRATIVE',
                text: 'The AI policy answer is unavailable right now. The selected voyage, price, and availability remain grounded in deterministic evidence.',
                streaming: false,
                question,
                answerMode: 'fallback',
                citationEvidenceIds: [],
              });
              return;
            }
          }
        }
        const finalText =
          narrative.trim() ||
          'I could not find an approved policy passage for that question. The selected voyage details remain backed by deterministic price and availability evidence.';
        if (!narrative.trim()) {
          dispatch({
            type: 'UPSERT_AGENT_TRACE',
            entry: traceEntry(
              'policy-retrieval',
              'Policy retrieval empty',
              'No approved passage matched the question strongly enough to answer with details.',
              'retrieval',
              'blocked',
            ),
          });
        }
        dispatch({
          type: 'UPSERT_AGENT_TRACE',
          entry: traceEntry(
            'policy-narrative',
            'Grounded answer complete',
            narrative.trim()
              ? 'The model answer completed using approved retrieval context.'
              : 'No matching approved passage was found, so the assistant avoided inventing policy details.',
            narrative.trim() ? 'ai' : 'guardrail',
            narrative.trim() ? 'complete' : 'blocked',
          ),
        });
        dispatch({
          type: 'UPSERT_AGENT_TRACE',
          entry: traceEntry(
            'grounding-policy',
            'Policy grounding checked',
            'The assistant response is limited to approved content or a safe unavailable answer.',
            'guardrail',
            'complete',
          ),
        });
        dispatch({
          type: 'SET_POLICY_NARRATIVE',
          text: finalText,
          streaming: false,
          question,
          answerMode: 'policy',
        });
      } catch {
        dispatch({
          type: 'UPSERT_AGENT_TRACE',
          entry: traceEntry(
            'policy-retrieval',
            'Policy retrieval failed',
            'The retrieval or model stream failed before an approved policy answer could complete.',
            'retrieval',
            'blocked',
          ),
        });
        dispatch({
          type: 'UPSERT_AGENT_TRACE',
          entry: traceEntry(
            'policy-narrative',
            'Policy answer unavailable',
            'The model or retrieval stream failed, so the UI shows a safe fallback instead of ungrounded content.',
            'guardrail',
            'blocked',
          ),
        });
        dispatch({
          type: 'SET_POLICY_NARRATIVE',
          text: 'The AI policy answer timed out or failed. You can keep using the verified voyage details and ask another question.',
          streaming: false,
          question,
          answerMode: 'fallback',
          citationEvidenceIds: [],
        });
      } finally {
        window.clearTimeout(timeoutId);
        dispatch({ type: 'SET_POLICY_STREAMING', streaming: false });
      }
    },
    [intentDraft, state.criteria, state.lockedPreferences],
  );

  const askVoyageQuestion = useCallback(
    async (question: string) => {
      const trimmed = question.trim();
      if (!trimmed) return;

      const deterministicAnswer = deterministicVoyageAnswer(trimmed, state);
      if (deterministicAnswer) {
        dispatch({
          type: 'RESET_AGENT_TRACE',
          entries: [
            traceEntry(
              'deterministic-voyage-answer',
              'Deterministic answer used',
              'This voyage question was answered from selected sailing, price, availability, and route evidence without a model call.',
              'deterministic',
              'complete',
            ),
            traceEntry(
              'grounding-deterministic-answer',
              'Grounding check passed',
              'No new commerce facts were generated; the answer uses values already present in current-turn evidence.',
              'guardrail',
              'complete',
            ),
          ],
        });
        dispatch({
          type: 'SET_POLICY_NARRATIVE',
          text: deterministicAnswer,
          streaming: false,
          question: trimmed,
          answerMode: 'deterministic',
          citationEvidenceIds: [],
        });
        return;
      }

      await askPolicyQuestion(trimmed);
    },
    [askPolicyQuestion, state],
  );

  const triggerFallbackDemo = useCallback(async () => {
    dispatch({
      type: 'UPSERT_AGENT_TRACE',
      entry: fallbackTraceEntry('MODEL_TIMEOUT'),
    });
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
    searchSavedCriteria,
    relaxToAvailableDuration,
    updateBudget,
    togglePreferenceLock,
    selectOption,
    compareOptions: compareOptionsFn,
    setViewMode,
    askPolicyQuestion,
    askVoyageQuestion,
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
