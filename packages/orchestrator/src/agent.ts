import { randomUUID } from 'node:crypto';
import { searchSailings, loadCatalog, quotePrice } from '@voyage/commerce';
import type {
  Evidence,
  ExperienceEvent,
  LockedPreference,
  PolicyPassage,
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
  criteria: SearchCriteria,
  requestId: string,
): Evidence {
  const catalog = loadCatalog();
  const cabinType = criteria.cabinType ?? catalog.pricing.heroCabinType;
  const occupancy = criteria.occupancy ?? catalog.pricing.heroOccupancy;
  const quote = quotePrice(opt.sailing.id, cabinType, occupancy, catalog);
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
    const model = createGenerativeModelFromEnv();
    const span = addSpan(trace, 'resolveIntent', Date.now());
    try {
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

  let policyPassages: PolicyPassage[] = [];
  if (input.policyQuestion && toolSteps < stepLimit) {
    yield { type: 'status', step: 'RETRIEVING_POLICY' };
    toolSteps += 1;
    trace.toolCalls += 1;
    const policySanitized = sanitizeForModel(input.policyQuestion);
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

  yield { type: 'status', step: 'CHECKING_PRICING' };

  const pricingSlots = Math.min(options.length, Math.max(0, stepLimit - toolSteps));
  for (const opt of options.slice(0, pricingSlots)) {
    toolSteps += 1;
    trace.toolCalls += 1;
    const priceEv = buildPriceEvidence(opt, criteria, requestId);
    evidence.push(priceEv);
    trace.evidenceIds.push(priceEv.id);
    yield { type: 'evidence', evidence: priceEv };
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

  for await (const event of streamExperience(input)) {
    events.push(event);
    if (event.type === 'evidence') evidence.push(event.evidence);
  }

  const criteria = applyLocks(parseCriteria(input.intent), input.locks ?? []);
  const options = searchSailings(criteria);
  const trace = latestTrace() ?? startTrace('mock', 'mock');

  return { criteria, options, evidence, events, trace };
}
