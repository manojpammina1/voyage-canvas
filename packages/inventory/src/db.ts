import { MongoClient, type Db, type MongoClientOptions } from 'mongodb';

export const COLLECTIONS = {
  inventory: 'cabin_inventory',
  holds: 'holds',
  bookingContexts: 'booking_contexts',
} as const;

const DEFAULT_DB = 'voyage';

let client: MongoClient | undefined;
let db: Db | undefined;

export function mongoUrlFromEnv(): string {
  return (
    process.env.MONGO_URL ??
    'mongodb://localhost:27017/voyage?replicaSet=rs0&directConnection=true'
  );
}

function dbNameFromUrl(url: string): string {
  const stripped = url.replace(/^mongodb(\+srv)?:\/\//, '');
  const slash = stripped.indexOf('/');
  if (slash < 0) return DEFAULT_DB;
  const pathAndQuery = stripped.slice(slash + 1);
  const name = pathAndQuery.split('?')[0]?.trim();
  return name && name.length > 0 ? name : DEFAULT_DB;
}

export async function connectMongo(
  url = mongoUrlFromEnv(),
  options: MongoClientOptions = {},
): Promise<Db> {
  if (db) return db;
  client = new MongoClient(url, {
    ignoreUndefined: true,
    ...options,
  });
  await client.connect();
  db = client.db(dbNameFromUrl(url));
  return db;
}

/** Bind an already-open client (used by tests / seed). */
export function bindMongo(database: Db, mongoClient?: MongoClient): void {
  db = database;
  if (mongoClient) client = mongoClient;
}

export function getDb(): Db {
  if (!db) {
    throw new Error('MongoDB not connected. Call connectMongo() or bindMongo() first.');
  }
  return db;
}

export function getMongoClient(): MongoClient {
  if (!client) {
    throw new Error('MongoDB client not available.');
  }
  return client;
}

export async function ensureIndexes(database = getDb()): Promise<void> {
  await database.collection(COLLECTIONS.inventory).createIndex(
    { sailingId: 1, cabinType: 1 },
    { unique: true },
  );
  await database.collection(COLLECTIONS.inventory).createIndex({ cabinId: 1 }, { unique: true });
  await database.collection(COLLECTIONS.holds).createIndex(
    { idempotencyKey: 1 },
    { unique: true },
  );
  await database.collection(COLLECTIONS.holds).createIndex({ holdId: 1 }, { unique: true });
  await database.collection(COLLECTIONS.holds).createIndex({ status: 1, expiresAt: 1 });
  await database.collection(COLLECTIONS.holds).createIndex({ guestId: 1, holdId: 1 });
  await database.collection(COLLECTIONS.bookingContexts).createIndex({ holdId: 1 });
  await database
    .collection(COLLECTIONS.bookingContexts)
    .createIndex({ bookingContextId: 1 }, { unique: true });
}

export async function closeMongo(): Promise<void> {
  if (client) {
    await client.close();
  }
  client = undefined;
  db = undefined;
}
