import { randomUUID } from 'node:crypto';
import { getPort, loadCatalog, searchSailings } from '@voyage/commerce';
import type {
  CabinAvailability,
  Evidence,
  ExperienceEvent,
  LockedPreference,
  Port,
  PolicyPassage,
  PriceQuote,
  RetrievalAdapter,
  SearchCriteria,
  VoyageOption,
} from '@voyage/shared';
import { parseCriteria } from './criteriaParser.js';
import { filterNarrativeByGrounding } from './grounding.js';
import { sanitizeForModel } from './guardrails.js';
import { createGenerativeModelFromEnv } from './modelGateway.js';
import {
  addSpan,
  endSpan,
  latestTrace,
  startTrace,
  type ExperienceTrace,
} from './observability.js';
import { invokeTool, type ToolContext } from './tools.js';

export interface RunExperienceInput {
  intent: string;
  locks?: LockedPreference[];
  policyQuestion?: string;
  retrieval: RetrievalAdapter;
  maxToolSteps?: number;
}

export interface RunExperienceResult {
  criteria: SearchCriteria;
  options: VoyageOption[];
  evidence: Evidence[];
  events: ExperienceEvent[];
  trace: ExperienceTrace;
}

function applyLocks(
  criteria: SearchCriteria,
  locks: LockedPreference[],
): SearchCriteria {
  const next = { ...criteria };
  for (const lock of locks) {
    (next as Record<string, unknown>)[lock.criterion] = lock.value;
  }
  return next;
}

function maxSteps(input: RunExperienceInput): number {
  return input.maxToolSteps ?? Number(process.env.MAX_TOOL_STEPS ?? 4);
}

function aiEnabled(): boolean {
  return (process.env.FEATURE_AI_ENABLED ?? 'true').toLowerCase() !== 'false';
}

function buildPriceEvidence(
  opt: VoyageOption,
  quote: PriceQuote,
  requestId: string,
): Evidence {
  return {
    id: `ev-price-${opt.id}`,
    type: 'PRICE',
    source: 'deterministic',
    data: quote,
    asOf: quote.asOf,
    validUntil: quote.validUntil,
    provenance: { tool: 'get_pricing', requestId, sourceId: quote.quoteId },
  };
}

interface SailingEvidenceData {
  criteria: SearchCriteria;
  options: VoyageOption[];
  ports: Port[];
}

function collectPorts(options: VoyageOption[]): Port[] {
  const portIds = new Set<string>();
  for (const opt of options) {
    for (const portId of opt.sailing.ports) {
      portIds.add(portId);
    }
  }
  return [...portIds]
    .map((portId) => getPort(portId))
    .filter((port): port is Port => Boolean(port));
}

function buildSailingEvidence(
  criteria: SearchCriteria,
  options: VoyageOption[],
  requestId: string,
): Evidence<SailingEvidenceData> {
  return {
    id: 'ev-sailing-results',
    type: 'SAILING',
    source: 'deterministic',
    data: { criteria, options, ports: collectPorts(options) },
    asOf: new Date().toISOString(),
    provenance: { tool: 'search_sailings', requestId },
  };
}

function buildAvailabilityEvidence(
  opt: VoyageOption,
  availability: CabinAvailability,
  requestId: string,
): Evidence {
  return {
    id: `ev-avail-${opt.id}`,
    type: 'AVAILABILITY',
    source: 'deterministic',
    data: availability,
    asOf: availability.asOf,
    provenance: {
      tool: 'check_availability',
      requestId,
      sourceId: availability.cabinId,
    },
  };
}

export async function* streamExperience(
  input: RunExperienceInput,
): AsyncGenerator<ExperienceEvent> {
  const provider = process.env.LLM_PROVIDER ?? 'mock';
  startTrace(provider, process.env.LLM_CAPABLE_MODEL ?? 'mock');
  const trace = latestTrace()!;
  const evidence: Evidence[] = [];
  let toolSteps = 0;
  const stepLimit = maxSteps(input);
  const requestId = randomUUID();
  const ctx: ToolContext = { retrieval: input.retrieval, requestId };

  yield { type: 'status', step: 'UNDERSTANDING_INTENT' };

  const sanitized = sanitizeForModel(input.intent);
  if (sanitized.blocked) {
    yield {
      type: 'fallback',
      criteria: parseCriteria(input.intent),
      reason: 'MODEL_POLICY_BLOCK',
    };
    return;
  }

  let criteria = applyLocks(parseCriteria(sanitized.text), input.locks ?? []);

  if (aiEnabled()) {
    const span = addSpan(trace, 'resolveIntent', Date.now());
    try {
      const model = createGenerativeModelFromEnv();
      const resolution = await model.resolveIntent({
        text: sanitized.text,
        deterministicCriteria: criteria,
        lockedPreferences: input.locks ?? [],
      });
      criteria = applyLocks({ ...criteria, ...resolution.criteriaPatch }, input.locks ?? []);
      if (resolution.needsClarification && resolution.clarificationQuestion) {
        yield {
          type: 'action',
          action: 'ASK_CLARIFICATION',
          payload: { question: resolution.clarificationQuestion },
        };
      }
    } catch {
      yield {
        type: 'fallback',
        criteria,
        reason: 'MODEL_ERROR',
      };
      return;
    } finally {
      endSpan(span, Date.now());
    }
  }

  yield { type: 'status', step: 'SEARCHING_SAILINGS' };
  toolSteps += 1;
  trace.toolCalls += 1;
  const searchResult = await invokeTool('search_sailings', { criteria }, ctx);
  if (!searchResult.result.ok) {
    yield {
      type: 'error',
      code: searchResult.result.error?.code ?? 'SEARCH_FAILED',
      recoverable: true,
    };
    return;
  }

  const options = (searchResult.result.data as VoyageOption[]) ?? [];
  const sailingEvidence = buildSailingEvidence(criteria, options, requestId);
  evidence.push(sailingEvidence);
  trace.evidenceIds.push(sailingEvidence.id);
  yield { type: 'evidence', evidence: sailingEvidence };

  yield { type: 'status', step: 'CHECKING_AVAILABILITY' };
  const catalog = loadCatalog();
  const cabinType = criteria.cabinType ?? catalog.pricing.heroCabinType;
  const occupancy = criteria.occupancy ?? catalog.pricing.heroOccupancy;

  for (const opt of options) {
    try {
      trace.toolCalls += 1;
      const availabilityResult = await invokeTool(
        'check_availability',
        { sailingId: opt.sailing.id, cabinType },
        ctx,
      );
      const rows = (availabilityResult.result.data as CabinAvailability[]) ?? [];
      const row = rows.find((r) => r.cabinId === opt.cabinId) ?? rows[0];
      if (row) {
        const ev = buildAvailabilityEvidence(opt, row, requestId);
        evidence.push(ev);
        trace.evidenceIds.push(ev.id);
        yield { type: 'evidence', evidence: ev };
      }
    } catch {
      yield {
        type: 'error',
        code: 'AVAILABILITY_UNAVAILABLE',
        recoverable: true,
      };
    }
  }

  yield { type: 'status', step: 'CHECKING_PRICING' };

  for (const opt of options) {
    trace.toolCalls += 1;
    const priceResult = await invokeTool(
      'get_pricing',
      { sailingId: opt.sailing.id, cabinType, occupancy },
      ctx,
    );
    if (!priceResult.result.ok) {
      yield {
        type: 'error',
        code: priceResult.result.error?.code ?? 'PRICING_FAILED',
        recoverable: true,
      };
      continue;
    }
    const quote = priceResult.result.data as PriceQuote;
    const priceEv = buildPriceEvidence(opt, quote, requestId);
    evidence.push(priceEv);
    trace.evidenceIds.push(priceEv.id);
    yield { type: 'evidence', evidence: priceEv };
  }

  let policyPassages: PolicyPassage[] = [];
  if (input.policyQuestion && toolSteps < stepLimit) {
    yield { type: 'status', step: 'RETRIEVING_POLICY' };
    toolSteps += 1;
    trace.toolCalls += 1;
    const policySanitized = sanitizeForModel(input.policyQuestion);
    if (policySanitized.blocked) {
      yield {
        type: 'fallback',
        criteria,
        reason: 'MODEL_POLICY_BLOCK',
      };
      return;
    }
    const policyResult = await invokeTool(
      'get_policy_content',
      { question: policySanitized.text },
      ctx,
    );
    if (policyResult.evidence) {
      for (const ev of policyResult.evidence) {
        evidence.push(ev);
        trace.evidenceIds.push(ev.id);
        yield { type: 'evidence', evidence: ev };
      }
    }
    if (policyResult.result.ok) {
      policyPassages =
        (policyResult.result.data as { passages?: PolicyPassage[] }).passages ?? [];
    }
  }

  if (input.policyQuestion && policyPassages.length > 0 && aiEnabled()) {
    const policySanitized = sanitizeForModel(input.policyQuestion);
    const model = createGenerativeModelFromEnv();
    const span = addSpan(trace, 'streamNarrative', Date.now());
    try {
      for await (const chunk of model.streamNarrative({
        userQuestion: policySanitized.text,
        experienceStage: 'exploring',
        evidence,
        policyPassages,
      })) {
        const grounded = filterNarrativeByGrounding(chunk.text, evidence);
        yield { type: 'token', text: grounded.text };
      }
    } catch {
      yield {
        type: 'fallback',
        criteria,
        reason: 'MODEL_ERROR',
      };
    } finally {
      endSpan(span, Date.now());
    }
  }
}

export async function runExperience(
  input: RunExperienceInput,
): Promise<RunExperienceResult> {
  const events: ExperienceEvent[] = [];
  const evidence: Evidence[] = [];
  let criteria = applyLocks(parseCriteria(input.intent), input.locks ?? []);
  let options: VoyageOption[] = [];

  for await (const event of streamExperience(input)) {
    events.push(event);
    if (event.type === 'evidence') {
      evidence.push(event.evidence);
      if (event.evidence.type === 'SAILING') {
        const data = event.evidence.data as Partial<SailingEvidenceData>;
        if (data.criteria) criteria = data.criteria;
        if (Array.isArray(data.options)) options = data.options;
      }
    }
  }

  if (options.length === 0) {
    options = searchSailings(criteria);
  }
  const trace = latestTrace() ?? startTrace('mock', 'mock');

  return { criteria, options, evidence, events, trace };
}
