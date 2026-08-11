import type { Db } from 'mongodb';
import type { PolicyChunk } from '@voyage/shared';
import type { VectorStore } from './vectorStore.js';

export const POLICY_CHUNKS_COLLECTION = 'policy_chunks';

export class MongoVectorStore implements VectorStore {
  constructor(private readonly db: Db) {}

  async upsertMany(chunks: PolicyChunk[]): Promise<void> {
    if (chunks.length === 0) return;
    const col = this.db.collection<PolicyChunk>(POLICY_CHUNKS_COLLECTION);
    const ops = chunks.map((chunk) => ({
      replaceOne: {
        filter: { id: chunk.id },
        replacement: chunk,
        upsert: true,
      },
    }));
    await col.bulkWrite(ops);
  }

  async listAll(): Promise<PolicyChunk[]> {
    return this.db.collection<PolicyChunk>(POLICY_CHUNKS_COLLECTION).find({}).toArray();
  }

  async clear(): Promise<void> {
    await this.db.collection(POLICY_CHUNKS_COLLECTION).deleteMany({});
  }
}

export async function ensurePolicyChunkIndexes(db: Db): Promise<void> {
  await db
    .collection(POLICY_CHUNKS_COLLECTION)
    .createIndex({ id: 1 }, { unique: true });
  await db
    .collection(POLICY_CHUNKS_COLLECTION)
    .createIndex({ 'metadata.sourceId': 1 });
  await db
    .collection(POLICY_CHUNKS_COLLECTION)
    .createIndex({ 'metadata.topic': 1 });
}
