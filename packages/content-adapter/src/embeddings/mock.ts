import type { EmbeddingModel, EmbeddingResult } from '@voyage/shared';

export const MOCK_EMBED_DIMENSIONS = 64;

/** Deterministic bag-of-words style vectors for offline retrieval eval. */
export function mockEmbedText(text: string, dimensions = MOCK_EMBED_DIMENSIONS): number[] {
  const vec = new Array<number>(dimensions).fill(0);
  const tokens = text
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length > 1);

  for (const token of tokens) {
    let hash = 0;
    for (let i = 0; i < token.length; i++) {
      hash = (hash * 31 + token.charCodeAt(i)) >>> 0;
    }
    vec[hash % dimensions]! += 1;
    vec[(hash >> 8) % dimensions]! += 0.5;
  }

  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

export function createMockEmbeddingModel(): EmbeddingModel {
  const provider = 'mock';
  const model = process.env.EMBEDDING_MODEL?.trim() || 'mock-embed-v1';

  return {
    async embed(texts: string[]): Promise<EmbeddingResult[]> {
      return texts.map((text) => ({
        vector: mockEmbedText(text),
        provider,
        model,
        dimensions: MOCK_EMBED_DIMENSIONS,
      }));
    },
  };
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
