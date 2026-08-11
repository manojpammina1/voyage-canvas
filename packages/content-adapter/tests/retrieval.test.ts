import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
  chunkAllDocuments,
  createMemoryRetrievalAdapter,
  ingestPolicyCorpus,
  IngestionValidationError,
  loadPolicyDocuments,
  parseApprovedContentDoc,
} from '../src/adapter.js';
import { resolveDataDir } from '@voyage/commerce';

const policiesDir = join(resolveDataDir(), 'policies');

describe('ingestion (T10)', () => {
  it('loads synthetic approved policy documents', () => {
    const docs = loadPolicyDocuments(policiesDir);
    expect(docs.length).toBeGreaterThanOrEqual(4);
    expect(docs.some((d) => d.id === 'children-travel-policy')).toBe(true);
  });

  it('rejects forbidden commerce fields at ingestion', () => {
    expect(() =>
      parseApprovedContentDoc({
        id: 'bad-doc',
        title: 'Bad',
        topic: 'test',
        contentVersion: '1',
        classification: 'POLICY',
        content: 'ok',
        priceUsd: 100,
      }),
    ).toThrow(IngestionValidationError);
  });

  it('chunks documents for embedding', () => {
    const docs = loadPolicyDocuments(policiesDir);
    const chunks = chunkAllDocuments(docs);
    expect(chunks.length).toBeGreaterThanOrEqual(docs.length);
  });
});

describe('retrieval (T11)', () => {
  it('returns expected source within top 3 for locked eval questions', async () => {
    const { adapter, store } = createMemoryRetrievalAdapter();
    await ingestPolicyCorpus(policiesDir, store);

    const cases: Array<{ question: string; expected: string }> = [
      {
        question: 'What travel documents do children need?',
        expected: 'children-travel-policy',
      },
      {
        question: 'What is the cancellation policy for this demo?',
        expected: 'cancellation-policy',
      },
      {
        question: "What is included with the cruise fare in this demo?",
        expected: 'whats-included-faq',
      },
      {
        question: 'Tell me about the Caribbean route in the approved demo content.',
        expected: 'caribbean-destination-guide',
      },
    ];

    for (const { question, expected } of cases) {
      const results = await adapter.search(question, 3);
      const sourceIds = results.map((r) => r.metadata.sourceId);
      expect(sourceIds).toContain(expected);
    }
  });
});
