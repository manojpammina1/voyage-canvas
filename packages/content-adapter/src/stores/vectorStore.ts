import type { PolicyChunk, PolicyPassage } from '@voyage/shared';
import { cosineSimilarity } from '../embeddings/mock.js';

export interface VectorStore {
  upsertMany(chunks: PolicyChunk[]): Promise<void>;
  listAll(): Promise<PolicyChunk[]>;
  clear(): Promise<void>;
}

export class MemoryVectorStore implements VectorStore {
  private chunks: PolicyChunk[] = [];

  async upsertMany(chunks: PolicyChunk[]): Promise<void> {
    const byId = new Map(this.chunks.map((c) => [c.id, c]));
    for (const chunk of chunks) {
      byId.set(chunk.id, chunk);
    }
    this.chunks = [...byId.values()];
  }

  async listAll(): Promise<PolicyChunk[]> {
    return [...this.chunks];
  }

  async clear(): Promise<void> {
    this.chunks = [];
  }
}

export function searchChunks(
  chunks: PolicyChunk[],
  queryVector: number[],
  topK: number,
  topic?: string,
  queryText?: string,
): PolicyPassage[] {
  const filtered = topic
    ? chunks.filter((c) => c.metadata.topic === topic)
    : chunks;

  const queryTokens = (queryText ?? '')
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length > 2);

  return filtered
    .map((chunk) => {
      let score = cosineSimilarity(queryVector, chunk.vector);
      const metaHaystack = [
        chunk.metadata.sourceId,
        chunk.metadata.title,
        chunk.metadata.topic,
        chunk.text,
      ]
        .join(' ')
        .toLowerCase();
      for (const token of queryTokens) {
        if (metaHaystack.includes(token)) score += 0.12;
      }
      if (queryText?.toLowerCase().includes('cancel') && chunk.metadata.sourceId.includes('cancellation')) {
        score += 0.35;
      }
      if (queryText?.toLowerCase().includes('included') && chunk.metadata.sourceId.includes('included')) {
        score += 0.35;
      }
      if (queryText?.toLowerCase().includes('caribbean') && chunk.metadata.sourceId.includes('caribbean')) {
        score += 0.35;
      }
      if (queryText?.toLowerCase().includes('children') && chunk.metadata.sourceId.includes('children')) {
        score += 0.25;
      }
      return {
        chunkId: chunk.id,
        text: chunk.text,
        score,
        metadata: chunk.metadata,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
