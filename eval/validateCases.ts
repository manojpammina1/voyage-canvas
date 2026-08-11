import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GoldenEvalCaseSchema,
  RedteamEvalCaseSchema,
  RetrievalEvalCaseSchema,
} from '../packages/shared/src/schemas.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadJsonl(path: string): unknown[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function validateEvalSeeds() {
  const golden = loadJsonl(resolve(root, 'eval/golden.jsonl')).map((c) =>
    GoldenEvalCaseSchema.parse(c),
  );
  const retrieval = loadJsonl(resolve(root, 'eval/retrieval.jsonl')).map((c) =>
    RetrievalEvalCaseSchema.parse(c),
  );
  const redteam = loadJsonl(resolve(root, 'eval/redteam.jsonl')).map((c) =>
    RedteamEvalCaseSchema.parse(c),
  );

  if (golden.length < 10) {
    throw new Error(`Expected >= 10 golden cases, got ${golden.length}`);
  }

  return {
    golden: golden.length,
    retrieval: retrieval.length,
    redteam: redteam.length,
  };
}

const counts = validateEvalSeeds();
console.log('Eval seed validation OK', counts);
