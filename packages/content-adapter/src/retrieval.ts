import type { EmbeddingModel, PolicyChunk, PolicyPassage, RetrievalAdapter } from '@voyage/shared';
import { searchChunks, type VectorStore } from './stores/vectorStore.js';

export interface RetrievalOptions {
  topK?: number;
  topic?: string;
}

export async function embedAndStoreChunks(
  drafts: Array<{
    id: string;
    text: string;
    metadata: PolicyChunk['metadata'];
    embedText?: string;
  }>,
  embeddingModel: EmbeddingModel,
  store: VectorStore,
): Promise<PolicyChunk[]> {
  const embeddings = await embeddingModel.embed(
    drafts.map((d) => d.embedText ?? d.text),
  );
  const createdAt = new Date().toISOString();
  const chunks: PolicyChunk[] = drafts.map((draft, i) => {
    const emb = embeddings[i]!;
    return {
      id: draft.id,
      text: draft.text,
      vector: emb.vector,
      metadata: draft.metadata,
      embeddingMetadata: {
        provider: emb.provider,
        model: emb.model,
        dimensions: emb.dimensions,
        createdAt,
      },
    };
  });
  await store.upsertMany(chunks);
  return chunks;
}

export class ContentRetrievalAdapter implements RetrievalAdapter {
  constructor(
    private readonly store: VectorStore,
    private readonly embeddingModel: EmbeddingModel,
    private readonly defaultTopK = 3,
  ) {}

  async search(query: string, topK: number, topic?: string): Promise<PolicyPassage[]> {
    const k = topK || this.defaultTopK;
    const [queryEmb] = await this.embeddingModel.embed([query]);
    const chunks = await this.store.listAll();
    return searchChunks(chunks, queryEmb!.vector, k, topic, query);
  }
}
