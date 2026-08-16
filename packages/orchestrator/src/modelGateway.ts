import type {
  EmbeddingModel,
  GenerativeModel,
} from '@voyage/shared';
import {
  createEmbeddingModelFromEnv as createContentEmbeddingModelFromEnv,
} from '@voyage/content-adapter';
import type {
  GroundedNarrativeInput,
  IntentResolution,
  SanitizedIntentInput,
} from '@voyage/shared';
import { z } from 'zod';
import { markUntrustedRetrievedContext } from './guardrails.js';
import { NARRATIVE_INSTRUCTION } from './prompts.js';
import {
  BoundedActionSchema,
  SearchCriteriaSchema,
} from '@voyage/shared';

const IntentResolutionSchema = z.object({
  criteriaPatch: SearchCriteriaSchema.partial().default({}),
  needsClarification: z.boolean().default(false),
  clarificationQuestion: z.string().optional(),
  proposedActions: z
    .array(z.object({ action: BoundedActionSchema, payload: z.unknown() }))
    .default([]),
});

const RawIntentResolutionSchema = z.object({
  criteriaPatch: z.record(z.unknown()).default({}),
  needsClarification: z.boolean().catch(false).default(false),
  clarificationQuestion: z.string().nullable().optional(),
  proposedActions: z.array(z.unknown()).catch([]).default([]),
});

interface GeminiGenerateResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}

function geminiApiKey(): string {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) {
    throw new Error('GEMINI_API_KEY required when LLM_PROVIDER=gemini');
  }
  return key;
}

function geminiModelFromEnv(kind: 'fast' | 'capable'): string {
  const configured =
    kind === 'fast'
      ? process.env.LLM_FAST_MODEL?.trim() || process.env.LLM_CAPABLE_MODEL?.trim()
      : process.env.LLM_CAPABLE_MODEL?.trim() || process.env.LLM_FAST_MODEL?.trim();
  if (!configured) {
    throw new Error(`LLM_${kind === 'fast' ? 'FAST' : 'CAPABLE'}_MODEL required when LLM_PROVIDER=gemini`);
  }
  return configured.startsWith('models/') ? configured : `models/${configured}`;
}

function geminiApiBase(): string {
  return (
    process.env.GEMINI_API_BASE?.trim() ||
    'https://generativelanguage.googleapis.com/v1beta'
  );
}

function timeoutMs(): number {
  return Number(process.env.LLM_TIMEOUT_MS ?? 20000);
}

function maxPromptChars(): number {
  const configured = Number(process.env.LLM_MAX_PROMPT_CHARS ?? 12000);
  return Number.isFinite(configured) && configured > 0 ? configured : 12000;
}

function maxOutputTokens(): number {
  const configured = Number(process.env.LLM_MAX_OUTPUT_TOKENS ?? 512);
  return Number.isFinite(configured) && configured > 0 ? configured : 512;
}

function capText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars).trimEnd()}\n[TRUNCATED_TO_CONTEXT_CAP]`;
}

function extractGeminiText(json: GeminiGenerateResponse): string {
  return (
    json.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? '')
      .join('') ?? ''
  );
}

function extractJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) {
    throw new Error('Gemini response did not contain JSON');
  }
  return JSON.parse(text.slice(start, end + 1)) as unknown;
}

async function geminiGenerateText(
  model: string,
  prompt: string,
  systemInstruction?: string,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  try {
    const response = await fetch(
      `${geminiApiBase()}/${model}:generateContent`,
      {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': geminiApiKey(),
        },
        body: JSON.stringify({
          systemInstruction: systemInstruction
            ? { parts: [{ text: systemInstruction }] }
            : undefined,
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json',
            maxOutputTokens: maxOutputTokens(),
          },
        }),
      },
    );
    if (!response.ok) {
      throw new Error(`Gemini generation failed: ${response.status}`);
    }
    return extractGeminiText((await response.json()) as GeminiGenerateResponse);
  } finally {
    clearTimeout(timer);
  }
}

function buildIntentPrompt(input: SanitizedIntentInput): string {
  return capText([
    'Resolve cruise-planning intent into a minimal JSON object.',
    'Return only JSON with fields: criteriaPatch, needsClarification, clarificationQuestion, proposedActions.',
    'Allowed criteriaPatch fields: destination, month, nights, occupancy, cabinType, maxPriceUsd, departurePort.',
    'month must be YYYY-MM when known. occupancy must be {"adults": number, "children": number}; if the guest says family of four, use {"adults":2,"children":2}.',
    'proposedActions must contain only exact allowed action names, otherwise return an empty array.',
    'Do not invent prices, availability, inventory, discounts, booking state, auth state, or payment actions.',
    'Do not alter locked preferences.',
    `Deterministic criteria: ${JSON.stringify(input.deterministicCriteria)}`,
    `Locked preferences: ${JSON.stringify(input.lockedPreferences)}`,
    `Guest text: ${input.text}`,
  ].join('\n'), maxPromptChars());
}

function normalizeMonth(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}$/.test(trimmed)) return trimmed;
  const namedWithYear = trimmed.match(
    /^(january|february|march|april|may|june|july|august|september|october|november|december)\s+(20\d{2})$/i,
  );
  if (!namedWithYear) return undefined;
  const month = trimmed.toLowerCase().slice(0, 3);
  const byName: Record<string, string> = {
    jan: '01',
    feb: '02',
    mar: '03',
    apr: '04',
    may: '05',
    jun: '06',
    jul: '07',
    aug: '08',
    sep: '09',
    oct: '10',
    nov: '11',
    dec: '12',
  };
  const monthNumber = byName[month];
  return monthNumber ? `${namedWithYear[2]}-${monthNumber}` : undefined;
}

function normalizeCriteriaPatch(
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  if (typeof patch.destination === 'string') next.destination = patch.destination;
  const month = normalizeMonth(patch.month);
  if (month) next.month = month;
  if (typeof patch.nights === 'number') next.nights = patch.nights;
  if (
    typeof patch.maxPriceUsd === 'number' &&
    Number.isFinite(patch.maxPriceUsd) &&
    patch.maxPriceUsd > 0
  ) {
    next.maxPriceUsd = patch.maxPriceUsd;
  }
  if (typeof patch.departurePort === 'string') next.departurePort = patch.departurePort;
  if (typeof patch.cabinType === 'string') next.cabinType = patch.cabinType;
  if (
    typeof patch.occupancy === 'object' &&
    patch.occupancy !== null
  ) {
    next.occupancy = patch.occupancy;
  } else if (typeof patch.occupancy === 'number' && patch.occupancy >= 1) {
    next.occupancy = {
      adults: Math.min(2, patch.occupancy),
      children: Math.max(0, patch.occupancy - Math.min(2, patch.occupancy)),
    };
  }
  return next;
}

function normalizeProposedActions(actions: unknown[]): Array<{
  action: z.infer<typeof BoundedActionSchema>;
  payload: unknown;
}> {
  return actions.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return [];
    const record = item as Record<string, unknown>;
    const parsed = BoundedActionSchema.safeParse(record.action);
    if (!parsed.success) return [];
    return [{ action: parsed.data, payload: record.payload ?? {} }];
  });
}

function parseIntentResolution(text: string): IntentResolution {
  const raw = RawIntentResolutionSchema.parse(extractJsonObject(text));
  return IntentResolutionSchema.parse({
    criteriaPatch: normalizeCriteriaPatch(raw.criteriaPatch),
    needsClarification: raw.needsClarification,
    clarificationQuestion: raw.clarificationQuestion ?? undefined,
    proposedActions: normalizeProposedActions(raw.proposedActions),
  }) as IntentResolution;
}

function buildNarrativePrompt(input: GroundedNarrativeInput): string {
  const evidence = input.evidence.map((ev) => ({
    id: ev.id,
    type: ev.type,
    source: ev.source,
    data: ev.data,
    asOf: ev.asOf,
    validUntil: ev.validUntil,
  }));
  const policyContext = input.policyPassages?.length
    ? markUntrustedRetrievedContext(input.policyPassages.map((p) => p.text))
    : '';
  return capText([
    'Answer the guest using only the provided current-turn evidence and approved policy context.',
    'Do not create prices, availability, holds, booking context, or payment instructions.',
    'Cite approved policy source titles or source IDs when answering policy questions.',
    `Guest question: ${input.userQuestion}`,
    `Experience stage: ${input.experienceStage}`,
    `Evidence JSON: ${JSON.stringify(evidence)}`,
    policyContext ? `Approved policy context:\n${policyContext}` : '',
    NARRATIVE_INSTRUCTION,
  ].filter(Boolean).join('\n\n'), maxPromptChars());
}

async function* streamGeminiText(
  model: string,
  prompt: string,
): AsyncGenerator<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  try {
    const response = await fetch(
      `${geminiApiBase()}/${model}:streamGenerateContent?alt=sse`,
      {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': geminiApiKey(),
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: maxOutputTokens(),
          },
        }),
      },
    );
    if (!response.ok || !response.body) {
      throw new Error(`Gemini streaming failed: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';
      for (const event of events) {
        const data = event
          .split('\n')
          .find((line) => line.startsWith('data: '))
          ?.slice(6);
        if (!data || data === '[DONE]') continue;
        const text = extractGeminiText(JSON.parse(data) as GeminiGenerateResponse);
        if (text) yield text;
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

function mockResolveIntent(_input: SanitizedIntentInput): Promise<IntentResolution> {
  return Promise.resolve({
    criteriaPatch: {},
    needsClarification: false,
    proposedActions: [],
  });
}

async function* mockStreamNarrative(input: GroundedNarrativeInput) {
  const policyText = input.policyPassages?.length
    ? markUntrustedRetrievedContext(input.policyPassages.map((p) => p.text))
    : '';

  const priceLines = input.evidence
    .filter((e) => e.type === 'PRICE')
    .map((e) => {
      const q = e.data as { totalUsd?: number; quoteId?: string };
      return q.totalUsd != null
        ? `Verified quote ${q.quoteId ?? 'n/a'}: $${q.totalUsd} total.`
        : '';
    })
    .filter(Boolean);

  const intro = 'Based on approved demo content and verified evidence for this turn:\n';
  const policyAnswer = policyText
    ? `\nPolicy reference:\n${policyText.slice(0, 600)}`
    : '';
  const prices = priceLines.length ? `\n${priceLines.join('\n')}` : '';
  const citation = input.policyPassages?.[0]
    ? `\nSource: ${input.policyPassages[0].metadata.title} (${input.policyPassages[0].metadata.sourceId}).`
    : '';

  yield {
    text: `${intro}${input.userQuestion}${policyAnswer}${prices}${citation}\n\n${NARRATIVE_INSTRUCTION}`,
  };
}

export function createMockGenerativeModel(): GenerativeModel {
  return {
    resolveIntent: mockResolveIntent,
    streamNarrative: mockStreamNarrative,
  };
}

export function createGeminiGenerativeModel(): GenerativeModel {
  const fastModel = geminiModelFromEnv('fast');
  const capableModel = geminiModelFromEnv('capable');
  return {
    async resolveIntent(input) {
      const text = await geminiGenerateText(
        fastModel,
        buildIntentPrompt(input),
        'You are a bounded intent resolver. You output schema-valid JSON only.',
      );
      return parseIntentResolution(text);
    },
    async *streamNarrative(input) {
      for await (const text of streamGeminiText(
        capableModel,
        buildNarrativePrompt(input),
      )) {
        yield { text };
      }
    },
  };
}

export function createGenerativeModelFromEnv(): GenerativeModel {
  const provider = (process.env.LLM_PROVIDER ?? 'mock').toLowerCase();
  if (provider === 'gemini') {
    return createGeminiGenerativeModel();
  }
  return createMockGenerativeModel();
}

export function createEmbeddingModelFromEnv(): EmbeddingModel {
  return createContentEmbeddingModelFromEnv();
}
