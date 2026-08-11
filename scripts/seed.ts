import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MongoClient } from 'mongodb';
import Redis from 'ioredis';
import {
  createEmbeddingModelFromEnv,
  ingestPolicyCorpus,
  MongoVectorStore,
  ensurePolicyChunkIndexes,
} from '../packages/content-adapter/src/index.ts';
import {
  COLLECTIONS,
  buildInventoryDocs,
  ensureIndexes,
} from '../packages/inventory/src/index.ts';
import { resolveDataDir } from './lib/paths.ts';

async function main(): Promise<void> {
  const dataDir = resolveDataDir();
  const sailings = JSON.parse(
    readFileSync(join(dataDir, 'sailings.json'), 'utf8'),
  ) as Array<{ id: string }>;
  const ports = JSON.parse(readFileSync(join(dataDir, 'ports.json'), 'utf8'));
  const pricing = JSON.parse(readFileSync(join(dataDir, 'pricing.json'), 'utf8'));

  const mongoUrl =
    process.env.MONGO_URL ??
    'mongodb://localhost:27017/voyage?replicaSet=rs0&directConnection=true';
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

  const client = new MongoClient(mongoUrl);
  await client.connect();
  const dbName =
    mongoUrl.replace(/^mongodb(\+srv)?:\/\//, '').split('/')[1]?.split('?')[0] ||
    'voyage';
  const db = client.db(dbName);

  await ensureIndexes(db);
  await ensurePolicyChunkIndexes(db);

  await db.collection('sailings').deleteMany({});
  await db.collection('ports').deleteMany({});
  await db.collection('pricing_fixture').deleteMany({});
  await db.collection(COLLECTIONS.inventory).deleteMany({});
  await db.collection(COLLECTIONS.holds).deleteMany({});
  await db.collection(COLLECTIONS.bookingContexts).deleteMany({});

  await db.collection('sailings').insertMany(sailings);
  await db.collection('ports').insertMany(ports);
  await db.collection('pricing_fixture').insertOne({ key: 'hero', ...pricing });
  await db
    .collection(COLLECTIONS.inventory)
    .insertMany(buildInventoryDocs(sailings.map((s) => s.id)));

  const policyStore = new MongoVectorStore(db);
  await policyStore.clear();
  const embeddingModel = createEmbeddingModelFromEnv();
  const policyChunks = await ingestPolicyCorpus(
    join(dataDir, 'policies'),
    policyStore,
    embeddingModel,
  );

  const redis = new Redis(redisUrl);
  const sessionKeys = await redis.keys('voyage:session:*');
  if (sessionKeys.length > 0) {
    await redis.del(...sessionKeys);
  }
  await redis.set(
    'voyage:meta:seed',
    JSON.stringify({
      seededAt: new Date().toISOString(),
      sailingIds: sailings.map((s) => s.id),
      heroMonth: '2027-03',
      policyChunks: policyChunks.length,
    }),
  );
  await redis.quit();
  await client.close();

  console.log(
    `seed: ok — ${sailings.length} sailings, ${ports.length} ports, ${policyChunks.length} policy chunks`,
  );
}

main().catch((err) => {
  console.error('seed failed:', err);
  process.exitCode = 1;
});
