import { MongoClient, type Db } from 'mongodb';
import Redis from 'ioredis';
import { connectMongo, ensureIndexes } from '@voyage/inventory';

let mongoReady: Promise<Db> | null = null;
let redisClient: Redis | null = null;

export function mongoUrl(): string {
  return (
    process.env.MONGO_URL ??
    'mongodb://localhost:27017/voyage?replicaSet=rs0&directConnection=true'
  );
}

export function redisUrl(): string {
  return process.env.REDIS_URL ?? 'redis://localhost:6379';
}

export async function getDb(): Promise<Db> {
  if (!mongoReady) {
    mongoReady = (async () => {
      const db = await connectMongo(mongoUrl());
      await ensureIndexes(db);
      return db;
    })();
  }
  return mongoReady;
}

export function getRedis(): Redis {
  if (!redisClient) {
    redisClient = new Redis(redisUrl(), { maxRetriesPerRequest: 2 });
  }
  return redisClient;
}

export async function pingInfra(): Promise<{ mongo: boolean; redis: boolean }> {
  let mongo = false;
  let redis = false;
  try {
    const db = await getDb();
    await db.command({ ping: 1 });
    mongo = true;
  } catch {
    mongo = false;
  }
  try {
    const pong = await getRedis().ping();
    redis = pong === 'PONG';
  } catch {
    redis = false;
  }
  return { mongo, redis };
}
