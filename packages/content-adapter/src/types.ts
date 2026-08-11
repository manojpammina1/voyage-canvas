import { z } from 'zod';
import { ContentClassificationSchema } from '@voyage/shared';

export const ApprovedContentDocSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  topic: z.string().min(1),
  publishedAt: z.string().optional(),
  contentVersion: z.string().min(1),
  classification: ContentClassificationSchema,
  keywords: z.array(z.string()).default([]),
  disclaimer: z.string().optional(),
  content: z.string().min(1),
});

export type ApprovedContentDoc = z.infer<typeof ApprovedContentDocSchema>;

/** Fields that must never enter the retrieval index. */
export const FORBIDDEN_INGESTION_KEYS = [
  'price',
  'inventory',
  'availability',
  'discount',
  'tax',
  'fee',
  'hold',
  'bookingStatus',
  'loyaltyBalance',
  'totalUsd',
  'availableCount',
] as const;

export interface ContentChunkDraft {
  id: string;
  text: string;
  embedText?: string;
  metadata: {
    sourceId: string;
    title: string;
    topic: string;
    publishedAt?: string;
    contentVersion: string;
    classification: z.infer<typeof ContentClassificationSchema>;
  };
}
