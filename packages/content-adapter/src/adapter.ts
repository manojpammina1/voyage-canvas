import { join } from 'node:path';
import type { EmbeddingModel, PolicyChunk, RetrievalAdapter } from '@voyage/shared';
import { createGeminiEmbeddingModel } from './embeddings/gemini.js';
import { createMockEmbeddingModel } from './embeddings/mock.js';
import { chunkAllDocuments, loadPolicyDocuments } from './ingestion.js';
import {
  ContentRetrievalAdapter,
  embedAndStoreChunks,
} from './retrieval.js';
import { MemoryVectorStore, type VectorStore } from './stores/vectorStore.js';
import { MongoVectorStore, ensurePolicyChunkIndexes } from './stores/mongoVectorStore.js';
import type { Db } from 'mongodb';

export function resolvePoliciesDir(dataDir: string): string {
  return join(dataDir, 'policies');
}

export function createEmbeddingModelFromEnv(): EmbeddingModel {
  const provider = (process.env.LLM_PROVIDER ?? 'mock').toLowerCase();
  if (provider === 'gemini') {
    return createGeminiEmbeddingModel();
  }
  return createMockEmbeddingModel();
}

export async function ingestPolicyCorpus(
  policiesDir: string,
  store: VectorStore,
  embeddingModel: EmbeddingModel = createEmbeddingModelFromEnv(),
): Promise<PolicyChunk[]> {
  const docs = loadPolicyDocuments(policiesDir);
  const drafts = chunkAllDocuments(docs);
  return embedAndStoreChunks(drafts, embeddingModel, store);
}

export function createMemoryRetrievalAdapter(
  embeddingModel?: EmbeddingModel,
): { adapter: RetrievalAdapter; store: MemoryVectorStore } {
  const store = new MemoryVectorStore();
  const model = embeddingModel ?? createMockEmbeddingModel();
  const adapter = new ContentRetrievalAdapter(
    store,
    model,
    Number(process.env.RETRIEVAL_TOP_K ?? 3),
  );
  return { adapter, store };
}

export async function createMongoRetrievalAdapter(
  db: Db,
  embeddingModel?: EmbeddingModel,
): Promise<RetrievalAdapter> {
  await ensurePolicyChunkIndexes(db);
  const store = new MongoVectorStore(db);
  const model = embeddingModel ?? createEmbeddingModelFromEnv();
  return new ContentRetrievalAdapter(
    store,
    model,
    Number(process.env.RETRIEVAL_TOP_K ?? 3),
  );
}

export {
  chunkAllDocuments,
  chunkDocument,
  IngestionValidationError,
  loadPolicyDocuments,
  parseApprovedContentDoc,
} from './ingestion.js';
export { policyEvidenceFromPassages, passagesToCitations } from './citations.js';
export { ContentRetrievalAdapter, embedAndStoreChunks } from './retrieval.js';
export { createGeminiEmbeddingModel } from './embeddings/gemini.js';
export { createMockEmbeddingModel, mockEmbedText, cosineSimilarity } from './embeddings/mock.js';
export { MemoryVectorStore, searchChunks } from './stores/vectorStore.js';
export { MongoVectorStore, ensurePolicyChunkIndexes, POLICY_CHUNKS_COLLECTION } from './stores/mongoVectorStore.js';
