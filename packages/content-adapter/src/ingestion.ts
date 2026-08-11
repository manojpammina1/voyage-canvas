import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ForbiddenContentClassificationSchema } from '@voyage/shared';
import {
  ApprovedContentDocSchema,
  FORBIDDEN_INGESTION_KEYS,
  type ApprovedContentDoc,
  type ContentChunkDraft,
} from './types.js';

const CHUNK_SIZE = 480;
const CHUNK_OVERLAP = 80;

export class IngestionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IngestionValidationError';
  }
}

function assertNoForbiddenFields(raw: unknown, sourceId: string): void {
  if (!raw || typeof raw !== 'object') return;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    if (FORBIDDEN_INGESTION_KEYS.some((f) => lower.includes(f.toLowerCase()))) {
      throw new IngestionValidationError(
        `Document "${sourceId}" contains forbidden commerce field "${key}"`,
      );
    }
    if (typeof value === 'string') {
      const forbiddenClass = ForbiddenContentClassificationSchema.safeParse(
        value.toUpperCase(),
      );
      if (forbiddenClass.success) {
        throw new IngestionValidationError(
          `Document "${sourceId}" references forbidden classification ${value}`,
        );
      }
    }
    if (value && typeof value === 'object') {
      assertNoForbiddenFields(value, sourceId);
    }
  }
}

export function parseApprovedContentDoc(raw: unknown): ApprovedContentDoc {
  const doc = ApprovedContentDocSchema.parse(raw);
  assertNoForbiddenFields(raw, doc.id);
  return doc;
}

export function loadPolicyDocuments(policiesDir: string): ApprovedContentDoc[] {
  const files = readdirSync(policiesDir).filter((f) => f.endsWith('.json'));
  return files.map((file) => {
    const raw = JSON.parse(readFileSync(join(policiesDir, file), 'utf8'));
    return parseApprovedContentDoc(raw);
  });
}

export function chunkDocument(doc: ApprovedContentDoc): ContentChunkDraft[] {
  const paragraphs = doc.content
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let buffer = '';

  for (const paragraph of paragraphs) {
    if ((buffer + ' ' + paragraph).trim().length <= CHUNK_SIZE) {
      buffer = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
      continue;
    }
    if (buffer) chunks.push(buffer);
    if (paragraph.length <= CHUNK_SIZE) {
      buffer = paragraph;
      continue;
    }
    for (let i = 0; i < paragraph.length; i += CHUNK_SIZE - CHUNK_OVERLAP) {
      chunks.push(paragraph.slice(i, i + CHUNK_SIZE));
    }
    buffer = '';
  }
  if (buffer) chunks.push(buffer);

  const keywordPrefix = [doc.title, doc.topic, doc.id, ...doc.keywords].join(' ');

  return chunks.map((text, index) => ({
    id: `${doc.id}#${index}`,
    text,
    embedText: `${keywordPrefix}\n${text}`,
    metadata: {
      sourceId: doc.id,
      title: doc.title,
      topic: doc.topic,
      publishedAt: doc.publishedAt,
      contentVersion: doc.contentVersion,
      classification: doc.classification,
    },
  }));
}

export function chunkAllDocuments(docs: ApprovedContentDoc[]): ContentChunkDraft[] {
  return docs.flatMap((doc) => chunkDocument(doc));
}
