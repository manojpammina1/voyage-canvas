import { join } from 'node:path';
import {
  createMemoryRetrievalAdapter,
  ingestPolicyCorpus,
} from '@voyage/content-adapter';
import { RetrievalEvalCaseSchema } from '@voyage/shared';
import { resolveDataDir } from '../scripts/lib/paths.ts';
import {
  buildSummary,
  finishEval,
  loadJsonl,
  type EvalOutcome,
} from './lib.ts';

interface CaseResult {
  id: string;
  recallAt1: boolean;
  recallAt3: boolean;
  reciprocalRank: number;
  topSources: string[];
}

const FORBIDDEN_INDEX_KEYS = [
  'price',
  'inventory',
  'availability',
  'discount',
  'tax',
  'fee',
  'hold',
  'bookingStatus',
  'loyaltyBalance',
  'totalUsd',
  'availableCount',
  'quoteId',
  'holdId',
  'bookingContextId',
];

function findForbiddenIndexedFields(
  value: unknown,
  path = 'chunk',
): string[] {
  if (!value || typeof value !== 'object') return [];
  const violations: string[] = [];
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    if (FORBIDDEN_INDEX_KEYS.some((forbidden) => lower.includes(forbidden.toLowerCase()))) {
      violations.push(`${path}.${key}`);
    }
    violations.push(...findForbiddenIndexedFields(nested, `${path}.${key}`));
  }
  return violations;
}

async function main(): Promise<void> {
  const dataDir = resolveDataDir();
  const policiesDir = join(dataDir, 'policies');
  const casesRaw = loadJsonl('eval/retrieval.jsonl', RetrievalEvalCaseSchema);

  const { adapter, store } = createMemoryRetrievalAdapter();
  await ingestPolicyCorpus(policiesDir, store);
  const indexedChunks = await store.listAll();
  const indexSafetyViolations = indexedChunks.flatMap((chunk) =>
    findForbiddenIndexedFields(chunk),
  );

  const results: CaseResult[] = [];
  const outcomes: EvalOutcome[] = [];
  for (const evalCase of casesRaw) {
    const passages = await adapter.search(evalCase.question, 3);
    const topSources = passages.map((p) => p.metadata.sourceId);
    const expected = evalCase.expectedSourceIds;
    const firstExpectedRank = topSources.findIndex((source) =>
      expected.includes(source),
    );
    const result = {
      id: evalCase.id,
      recallAt1: expected.some((id) => topSources[0] === id),
      recallAt3: expected.some((id) => topSources.includes(id)),
      reciprocalRank: firstExpectedRank >= 0 ? 1 / (firstExpectedRank + 1) : 0,
      topSources,
    };
    results.push(result);
    outcomes.push({
      id: evalCase.id,
      pass: result.recallAt3,
      notes: result.recallAt3
        ? []
        : [`Expected one of ${expected.join(', ')} in top 3; got ${topSources.join(', ')}`],
      metrics: result,
    });
  }

  const recall3 = results.filter((r) => r.recallAt3).length / results.length;
  const recall1 = results.filter((r) => r.recallAt1).length / results.length;
  const mrr =
    results.reduce((sum, result) => sum + result.reciprocalRank, 0) /
    results.length;

  outcomes.push({
    id: 'index-safety',
    pass: indexSafetyViolations.length === 0,
    notes: indexSafetyViolations,
    metrics: {
      indexedChunks: indexedChunks.length,
      forbiddenFieldViolations: indexSafetyViolations.length,
    },
  });

  finishEval(
    buildSummary('retrieval', outcomes, {
      recallAt1: recall1,
      recallAt3: recall3,
      mrr,
      top3Gate: recall3 === 1,
      indexSafetyGate: indexSafetyViolations.length === 0,
    }),
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
