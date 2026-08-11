import { NextRequest } from 'next/server';
import { join } from 'node:path';
import {
  ExperienceEventSchema,
  LockedPreferenceSchema,
  type LockedPreference,
} from '@voyage/shared';
import {
  createEmbeddingModelFromEnv,
  createMongoRetrievalAdapter,
  ingestPolicyCorpus,
  MongoVectorStore,
} from '@voyage/content-adapter';
import { z } from 'zod';
import { streamExperience } from '@voyage/orchestrator';
import { resolveDataDir } from '../../../lib/dataDir';
import { getDb } from '../../../lib/infra';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ExperienceRequestSchema = z.object({
  intent: z.string().trim().min(1),
  policyQuestion: z.string().trim().min(1).optional(),
  locks: z.array(LockedPreferenceSchema).optional(),
});

let retrievalReady: Promise<Awaited<ReturnType<typeof createMongoRetrievalAdapter>>> | null =
  null;

async function getRetrievalAdapter() {
  if (!retrievalReady) {
    retrievalReady = (async () => {
      const db = await getDb();
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
  let body: z.infer<typeof ExperienceRequestSchema>;
  try {
    body = ExperienceRequestSchema.parse(await req.json());
  } catch {
    return Response.json({ error: 'invalid experience request' }, { status: 400 });
  }

  const retrieval = await getRetrievalAdapter();
  const locks = body.locks as LockedPreference[] | undefined;
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        for await (const event of streamExperience({
          intent: body.intent,
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
