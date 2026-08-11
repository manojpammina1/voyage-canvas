import type {
  Evidence,
  ExperienceStage,
  LockedPreference,
  PolicyPassage,
  SearchCriteria,
} from './domain.js';
import type { BoundedActionRequest, NarrativeSegment } from './events.js';

export interface SanitizedIntentInput {
  text: string;
  deterministicCriteria: SearchCriteria;
  lockedPreferences: LockedPreference[];
}

export interface IntentResolution {
  criteriaPatch: Partial<SearchCriteria>;
  needsClarification: boolean;
  clarificationQuestion?: string;
  proposedActions: BoundedActionRequest[];
}

export interface GroundedNarrativeInput {
  userQuestion: string;
  experienceStage: ExperienceStage;
  evidence: Evidence[];
  policyPassages?: PolicyPassage[];
}

export interface NarrativeChunk {
  text: string;
  segments?: NarrativeSegment[];
}

export interface GenerativeModel {
  resolveIntent(input: SanitizedIntentInput): Promise<IntentResolution>;
  streamNarrative(input: GroundedNarrativeInput): AsyncIterable<NarrativeChunk>;
}

export interface EmbeddingResult {
  vector: number[];
  provider: string;
  model: string;
  dimensions: number;
}

export interface EmbeddingModel {
  embed(texts: string[]): Promise<EmbeddingResult[]>;
}
