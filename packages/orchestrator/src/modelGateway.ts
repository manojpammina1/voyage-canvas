import type {
  EmbeddingModel,
  GenerativeModel,
} from '@voyage/shared';
import { createMockEmbeddingModel } from '@voyage/content-adapter';
import type {
  GroundedNarrativeInput,
  IntentResolution,
  SanitizedIntentInput,
} from '@voyage/shared';
import { markUntrustedRetrievedContext } from './guardrails.js';
import { NARRATIVE_INSTRUCTION } from './prompts.js';

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
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY required when LLM_PROVIDER=gemini');
  }
  return createMockGenerativeModel();
}

export function createGenerativeModelFromEnv(): GenerativeModel {
  const provider = (process.env.LLM_PROVIDER ?? 'mock').toLowerCase();
  if (provider === 'gemini') {
    return createGeminiGenerativeModel();
  }
  return createMockGenerativeModel();
}

export function createEmbeddingModelFromEnv(): EmbeddingModel {
  return createMockEmbeddingModel();
}
