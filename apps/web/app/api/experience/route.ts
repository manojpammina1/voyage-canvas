import { NextRequest } from 'next/server';
import { MongoClient } from 'mongodb';
import { join } from 'node:path';
import { ExperienceEventSchema, LockedPreferenceSchema, type LockedPreference } from '@voyage/shared';
import {
  createEmbeddingModelFromEnv,
  createMongoRetrievalAdapter,
  ingestPolicyCorpus,
  MongoVectorStore,
} from '@voyage/content-adapter';
import { z } from 'zod';
import { streamExperience } from '@voyage/orchestrator';
import { resolveDataDir } from '../../../lib/dataDir';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

let retrievalReady: Promise<Awaited<ReturnType<typeof createMongoRetrievalAdapter>>> | null =
  null;

async function getRetrievalAdapter() {
  if (!retrievalReady) {
    retrievalReady = (async () => {
      const mongoUrl =
        process.env.MONGO_URL ??
        'mongodb://localhost:27017/voyage?replicaSet=rs0&directConnection=true';
      const client = new MongoClient(mongoUrl);
      await client.connect();
      const dbName =
        mongoUrl.replace(/^mongodb(\+srv)?:\/\//, '').split('/')[1]?.split('?')[0] ||
        'voyage';
      const db = client.db(dbName);
      const count = await db.collection('policy_chunks').countDocuments();
      if (count === 0) {
        const store = new MongoVectorStore(db);
        await ingestPolicyCorpus(
          join(resolveDataDir(), 'policies'),
          store,
          createEmbeddingModelFromEnv(),
        );
      }
      return createMongoRetrievalAdapter(db);
    })();
  }
  return retrievalReady;
}

function sseLine(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: NextRequest): Promise<Response> {
  const body = (await req.json()) as {
    intent?: string;
    policyQuestion?: string;
    locks?: unknown;
  };

  const intent = body.intent?.trim();
  if (!intent) {
    return Response.json({ error: 'intent required' }, { status: 400 });
  }

  const locks: LockedPreference[] | undefined = body.locks
    ? (z.array(LockedPreferenceSchema).parse(body.locks) as LockedPreference[])
    : undefined;

  const retrieval = await getRetrievalAdapter();
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        for await (const event of streamExperience({
          intent,
          policyQuestion: body.policyQuestion,
          locks,
          retrieval,
        })) {
          ExperienceEventSchema.parse(event);
          controller.enqueue(encoder.encode(sseLine(event.type, event)));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'stream failed';
        controller.enqueue(
          encoder.encode(
            sseLine('error', { type: 'error', code: 'STREAM_ERROR', recoverable: true, message }),
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
