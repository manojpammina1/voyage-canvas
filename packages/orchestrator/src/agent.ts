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
import {
  streamGroundedNarrativeText,
  validatePolicyCitations,
} from './grounding.js';
import { sanitizeForModel } from './guardrails.js';
import { createGenerativeModelFromEnv } from './modelGateway.js';
import {
  addSpan,
  endSpan,
  finishTrace,
  latestTrace,
  recordError,
  recordEvidence,
  recordFallback,
  recordModelUsage,
  recordToolCall,
  startTrace,
  traceControlsFromEnv,
  type ExperienceTrace,
} from './observability.js';
import { invokeTool, type ToolContext } from './tools.js';
import type { ToolName } from './toolSchemas.js';

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

async function invokeObservedTool(
  trace: ExperienceTrace,
  tool: ToolName,
  rawArgs: unknown,
  ctx: ToolContext,
  attributes: Record<string, string | number | boolean> = {},
): ReturnType<typeof invokeTool> {
  const span = addSpan(
    trace,
    tool === 'get_policy_content' ? 'retrieval.search' : `tool.${tool}`,
    Date.now(),
    { tool, ...attributes },
  );
  recordToolCall(trace, tool);
  try {
    const result = await invokeTool(tool, rawArgs, ctx);
    if (!result.result.ok) {
      recordError(
        trace,
        result.result.error?.code ?? `${tool.toUpperCase()}_FAILED`,
        result.result.error?.recoverable ?? true,
        span.name,
      );
    }
    return result;
  } catch (error) {
    recordError(
      trace,
      error instanceof Error ? error.name : `${tool.toUpperCase()}_ERROR`,
      true,
      span.name,
    );
    throw error;
  } finally {
    endSpan(span, Date.now());
  }
}

function extractivePolicyAnswer(passages: PolicyPassage[]): string | undefined {
  const passage =
    passages.find((p) => /^[A-Z0-9]/.test(p.text.trim())) ?? passages[0];
  if (!passage) return undefined;
  const text = passage.text.replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  const limit = Math.min(text.length, 560);
  let excerpt = text.slice(0, limit).trimEnd();
  if (!/[.!?]$/.test(excerpt)) {
    const boundary = Math.max(
      excerpt.lastIndexOf('.'),
      excerpt.lastIndexOf('!'),
      excerpt.lastIndexOf('?'),
    );
    excerpt =
      boundary > 220
        ? text.slice(0, boundary + 1).trimEnd()
        : `${excerpt.replace(/\s+\S*$/, '').trimEnd()}...`;
  } else if (text.length > limit) {
    excerpt = `${excerpt}...`;
  }
  return [
    `From approved demo content: ${excerpt}`,
    `Source: ${passage.metadata.title} (${passage.metadata.sourceId}).`,
  ].join('\n');
}

function aiEnabled(): boolean {
  return (process.env.FEATURE_AI_ENABLED ?? 'true').toLowerCase() !== 'false';
}

function hasCompleteSearchCriteria(criteria: SearchCriteria): boolean {
  return Boolean(
    criteria.destination &&
      criteria.month &&
      criteria.nights &&
      criteria.occupancy &&
      criteria.cabinType &&
      criteria.maxPriceUsd,
  );
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
  const stepLimit = maxSteps(input);
  const requestId = randomUUID();
  const trace = startTrace(
    provider,
    process.env.LLM_CAPABLE_MODEL ?? 'mock',
    traceControlsFromEnv(stepLimit),
  );
  const requestSpan = addSpan(trace, 'experience.request', Date.now(), {
    requestId,
    hasPolicyQuestion: Boolean(input.policyQuestion),
    locks: input.locks?.length ?? 0,
  });
  const evidence: Evidence[] = [];
  let toolSteps = 0;
  const ctx: ToolContext = { retrieval: input.retrieval, requestId };

  try {
    yield { type: 'status', step: 'UNDERSTANDING_INTENT' };

    const parserSpan = addSpan(trace, 'criteria.parse', Date.now(), {
      source: 'deterministic',
    });
    const sanitized = sanitizeForModel(input.intent);
    const parsedCriteria = parseCriteria(sanitized.text);
    endSpan(parserSpan, Date.now());
    if (sanitized.blocked) {
      recordFallback(trace, 'MODEL_POLICY_BLOCK');
      yield {
        type: 'fallback',
        criteria: parseCriteria(input.intent),
        reason: 'MODEL_POLICY_BLOCK',
      };
      return;
    }

    let criteria = applyLocks(parsedCriteria, input.locks ?? []);

    if (aiEnabled() && !hasCompleteSearchCriteria(criteria)) {
      const span = addSpan(trace, 'model.intent', Date.now(), {
        tier: 'fast',
      });
      try {
        const model = createGenerativeModelFromEnv();
        const modelInput = JSON.stringify({
          text: sanitized.text,
          deterministicCriteria: criteria,
          lockedPreferences: input.locks ?? [],
        });
        const resolution = await model.resolveIntent({
          text: sanitized.text,
          deterministicCriteria: criteria,
          lockedPreferences: input.locks ?? [],
        });
        recordModelUsage(trace, modelInput, JSON.stringify(resolution));
        criteria = applyLocks({ ...criteria, ...resolution.criteriaPatch }, input.locks ?? []);
        if (resolution.needsClarification && resolution.clarificationQuestion) {
          yield {
            type: 'action',
            action: 'ASK_CLARIFICATION',
            payload: { question: resolution.clarificationQuestion },
          };
          return;
        }
      } catch {
        recordError(trace, 'MODEL_ERROR', true, span.name);
        if (!hasCompleteSearchCriteria(criteria)) {
          recordFallback(trace, 'MODEL_ERROR');
          yield {
            type: 'fallback',
            criteria,
            reason: 'MODEL_ERROR',
          };
          return;
        }
      } finally {
        endSpan(span, Date.now());
      }
    }

    yield { type: 'status', step: 'SEARCHING_SAILINGS' };
    toolSteps += 1;
    const searchResult = await invokeObservedTool(
      trace,
      'search_sailings',
      { criteria },
      ctx,
      { maxToolSteps: stepLimit },
    );
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
    recordEvidence(trace, sailingEvidence.id);
    yield { type: 'evidence', evidence: sailingEvidence };

    yield { type: 'status', step: 'CHECKING_AVAILABILITY' };
    const catalog = loadCatalog();
    const cabinType = criteria.cabinType ?? catalog.pricing.heroCabinType;
    const occupancy = criteria.occupancy ?? catalog.pricing.heroOccupancy;

    for (const opt of options) {
      try {
        const availabilityResult = await invokeObservedTool(
          trace,
          'check_availability',
          { sailingId: opt.sailing.id, cabinType },
          ctx,
          { sailingId: opt.sailing.id, cabinType },
        );
        const rows = (availabilityResult.result.data as CabinAvailability[]) ?? [];
        const row = rows.find((r) => r.cabinId === opt.cabinId) ?? rows[0];
        if (row) {
          const ev = buildAvailabilityEvidence(opt, row, requestId);
          evidence.push(ev);
          recordEvidence(trace, ev.id);
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
      const priceResult = await invokeObservedTool(
        trace,
        'get_pricing',
        { sailingId: opt.sailing.id, cabinType, occupancy },
        ctx,
        { sailingId: opt.sailing.id, cabinType },
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
      recordEvidence(trace, priceEv.id);
      yield { type: 'evidence', evidence: priceEv };
    }

    let policyPassages: PolicyPassage[] = [];
    if (input.policyQuestion && toolSteps < stepLimit) {
      yield { type: 'status', step: 'RETRIEVING_POLICY' };
      toolSteps += 1;
      const policySanitized = sanitizeForModel(input.policyQuestion);
      if (policySanitized.blocked) {
        recordFallback(trace, 'MODEL_POLICY_BLOCK');
        yield {
          type: 'fallback',
          criteria,
          reason: 'MODEL_POLICY_BLOCK',
        };
        return;
      }
      const policyResult = await invokeObservedTool(
        trace,
        'get_policy_content',
        { question: policySanitized.text },
        ctx,
        { topK: trace.controls.retrievalTopK },
      );
      if (policyResult.evidence) {
        for (const ev of policyResult.evidence) {
          evidence.push(ev);
          recordEvidence(trace, ev.id);
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
      const span = addSpan(trace, 'model.narrative', Date.now(), {
        tier: 'capable',
        policyPassages: policyPassages.length,
      });
      const modelInputEstimate = [
        policySanitized.text,
        JSON.stringify(evidence.map((ev) => ({ id: ev.id, type: ev.type }))),
        policyPassages.map((passage) => passage.text).join('\n'),
      ].join('\n');
      let modelUsageRecorded = false;
      try {
        let narrative = '';
        const modelChunks = model.streamNarrative({
          userQuestion: policySanitized.text,
          experienceStage: 'exploring',
          evidence,
          policyPassages,
        });
        const textChunks = (async function* () {
          for await (const chunk of modelChunks) {
            yield chunk.text;
          }
        })();

        for await (const text of streamGroundedNarrativeText(textChunks, evidence)) {
          narrative += text;
          yield { type: 'token', text };
        }

        recordModelUsage(trace, modelInputEstimate, narrative);
        modelUsageRecorded = true;

        if (!narrative.trim()) {
          const fallbackAnswer = extractivePolicyAnswer(policyPassages);
          if (fallbackAnswer) {
            narrative += fallbackAnswer;
            yield { type: 'token', text: fallbackAnswer };
          }
        }

        const groundingSpan = addSpan(trace, 'grounding.validate', Date.now(), {
          validator: 'policy_citation',
        });
        const citation = validatePolicyCitations(policyPassages, narrative);
        if (!citation.ok && policyPassages[0]) {
          const source = policyPassages[0].metadata;
          const sourceText = `\nSource: ${source.title} (${source.sourceId}).`;
          yield { type: 'token', text: sourceText };
        }
        endSpan(groundingSpan, Date.now());
      } catch {
        recordError(trace, 'MODEL_ERROR', true, span.name);
        const fallbackAnswer = extractivePolicyAnswer(policyPassages);
        if (fallbackAnswer) {
          yield { type: 'token', text: fallbackAnswer };
        } else {
          recordFallback(trace, 'MODEL_ERROR');
          yield {
            type: 'fallback',
            criteria,
            reason: 'MODEL_ERROR',
          };
        }
      } finally {
        if (!modelUsageRecorded) recordModelUsage(trace, modelInputEstimate);
        endSpan(span, Date.now());
      }
    }

    if (input.policyQuestion && policyPassages.length > 0 && !aiEnabled()) {
      const fallbackAnswer = extractivePolicyAnswer(policyPassages);
      if (fallbackAnswer) {
        yield { type: 'token', text: fallbackAnswer };
      }
    }
  } finally {
    endSpan(requestSpan, Date.now());
    finishTrace(trace);
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

  const stoppedBeforeCommerce = events.some(
    (event) =>
      event.type === 'fallback' ||
      (event.type === 'action' && event.action === 'ASK_CLARIFICATION'),
  );

  if (options.length === 0 && !stoppedBeforeCommerce) {
    options = searchSailings(criteria);
  }
  const trace = latestTrace() ?? startTrace('mock', 'mock');

  return { criteria, options, evidence, events, trace };
}
