import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  GoldenEvalCaseSchema,
  RedteamEvalCaseSchema,
  RetrievalEvalCaseSchema,
} from '../src/schemas.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function loadJsonl(rel: string): unknown[] {
  return readFileSync(resolve(root, rel), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe('eval seed schemas (T3)', () => {
  it('validates golden.jsonl (>=10)', () => {
    const cases = loadJsonl('eval/golden.jsonl').map((c) =>
      GoldenEvalCaseSchema.parse(c),
    );
    expect(cases.length).toBeGreaterThanOrEqual(10);
  });

  it('validates retrieval.jsonl', () => {
    const cases = loadJsonl('eval/retrieval.jsonl').map((c) =>
      RetrievalEvalCaseSchema.parse(c),
    );
    expect(cases.length).toBeGreaterThan(0);
    expect(cases[0]?.expectedSourceIds.length).toBeGreaterThan(0);
  });

  it('validates redteam.jsonl', () => {
    const cases = loadJsonl('eval/redteam.jsonl').map((c) =>
      RedteamEvalCaseSchema.parse(c),
    );
    expect(cases.length).toBeGreaterThan(0);
  });
});
