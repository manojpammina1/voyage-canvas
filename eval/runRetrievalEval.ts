import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createMemoryRetrievalAdapter,
  ingestPolicyCorpus,
} from '@voyage/content-adapter';
import { RetrievalEvalCaseSchema } from '@voyage/shared';
import { resolveDataDir } from '../scripts/lib/paths.ts';

interface CaseResult {
  id: string;
  recallAt1: boolean;
  recallAt3: boolean;
  topSources: string[];
}

async function main(): Promise<void> {
  const dataDir = resolveDataDir();
  const policiesDir = join(dataDir, 'policies');
  const casesRaw = readFileSync(join(process.cwd(), 'eval/retrieval.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => RetrievalEvalCaseSchema.parse(JSON.parse(line)));

  const { adapter, store } = createMemoryRetrievalAdapter();
  await ingestPolicyCorpus(policiesDir, store);

  const results: CaseResult[] = [];
  for (const evalCase of casesRaw) {
    const passages = await adapter.search(evalCase.question, 3);
    const topSources = passages.map((p) => p.metadata.sourceId);
    const expected = evalCase.expectedSourceIds;
    results.push({
      id: evalCase.id,
      recallAt1: expected.some((id) => topSources[0] === id),
      recallAt3: expected.some((id) => topSources.includes(id)),
      topSources,
    });
  }

  const recall3 = results.filter((r) => r.recallAt3).length / results.length;
  const recall1 = results.filter((r) => r.recallAt1).length / results.length;

  console.log(JSON.stringify({ recallAt1: recall1, recallAt3: recall3, results }, null, 2));

  if (recall3 < 1) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
