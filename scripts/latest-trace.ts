import { join } from 'node:path';
import {
  createMemoryRetrievalAdapter,
  ingestPolicyCorpus,
} from '@voyage/content-adapter';
import { closeMongo, connectMongo } from '@voyage/inventory';
import { HERO_INTENT, runExperience } from '@voyage/orchestrator';
import { persistLatestTrace } from './traceStore.ts';
import { resolveDataDir } from './lib/paths.ts';

async function main(): Promise<void> {
  const { adapter, store } = createMemoryRetrievalAdapter();
  await ingestPolicyCorpus(join(resolveDataDir(), 'policies'), store);
  let inventoryConnected = false;
  try {
    await connectMongo(undefined, { serverSelectionTimeoutMS: 750 });
    inventoryConnected = true;
  } catch {
    inventoryConnected = false;
  }

  try {
    const result = await runExperience({
      intent: HERO_INTENT,
      retrieval: adapter,
      policyQuestion: 'What travel documents do children need?',
    });

    persistLatestTrace(result.trace);

    const summary = {
      traceId: result.trace.traceId,
      provider: result.trace.provider,
      modelTier: result.trace.modelTier,
      durationMs: result.trace.durationMs,
      toolCalls: result.trace.toolCalls,
      toolNames: result.trace.toolNames,
      modelCalls: result.trace.modelCalls,
      estimatedInputTokens: result.trace.estimatedInputTokens,
      estimatedOutputTokens: result.trace.estimatedOutputTokens,
      estimatedCostUsd: result.trace.estimatedCostUsd,
      evidenceIds: result.trace.evidenceIds,
      controls: result.trace.controls,
      errors: result.trace.errors,
      fallbackReason: result.trace.fallbackReason ?? null,
      inventoryConnected,
      redacted: result.trace.redacted,
      spanCount: result.trace.spans.length,
      spans: result.trace.spans.map((span) => ({
        name: span.name,
        durationMs: span.durationMs,
        attributes: span.attributes,
      })),
      options: result.options.length,
      events: result.events.length,
    };

    console.log(JSON.stringify(summary, null, 2));
    console.log(`\nFull trace written to .voyage/traces/latest.json`);
  } finally {
    await closeMongo();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
