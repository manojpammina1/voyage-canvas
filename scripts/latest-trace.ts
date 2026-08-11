import { join } from 'node:path';
import {
  createMemoryRetrievalAdapter,
  ingestPolicyCorpus,
} from '@voyage/content-adapter';
import { HERO_INTENT, runExperience } from '@voyage/orchestrator';
import { persistLatestTrace } from './traceStore.ts';
import { resolveDataDir } from './lib/paths.ts';

async function main(): Promise<void> {
  const { adapter, store } = createMemoryRetrievalAdapter();
  await ingestPolicyCorpus(join(resolveDataDir(), 'policies'), store);

  const result = await runExperience({
    intent: HERO_INTENT,
    retrieval: adapter,
    policyQuestion: 'What travel documents do children need?',
  });

  persistLatestTrace(result.trace);

  const summary = {
    traceId: result.trace.traceId,
    provider: result.trace.provider,
    toolCalls: result.trace.toolCalls,
    evidenceIds: result.trace.evidenceIds,
    spanCount: result.trace.spans.length,
    options: result.options.length,
    events: result.events.length,
  };

  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nFull trace written to .voyage/traces/latest.json`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
