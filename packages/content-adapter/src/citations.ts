import type { Evidence, PolicyPassage } from '@voyage/shared';

export interface PolicyCitation {
  sourceId: string;
  title: string;
  topic: string;
  chunkId: string;
  excerpt: string;
  contentVersion: string;
  score: number;
}

export function passagesToCitations(passages: PolicyPassage[]): PolicyCitation[] {
  return passages.map((p) => ({
    sourceId: p.metadata.sourceId,
    title: p.metadata.title,
    topic: p.metadata.topic,
    chunkId: p.chunkId,
    excerpt: p.text.slice(0, 240),
    contentVersion: p.metadata.contentVersion,
    score: p.score,
  }));
}

export function policyEvidenceFromPassages(
  passages: PolicyPassage[],
  requestId: string,
): Evidence {
  const citations = passagesToCitations(passages);
  return {
    id: `ev-policy-${requestId}`,
    type: 'POLICY',
    source: 'approved-content',
    data: { citations, passages: passages.map((p) => p.text) },
    asOf: new Date().toISOString(),
    provenance: {
      tool: 'get_policy_content',
      requestId,
      sourceId: citations[0]?.sourceId,
    },
  };
}

export function formatCitationLabel(citation: PolicyCitation): string {
  return `${citation.title} (${citation.sourceId}, v${citation.contentVersion})`;
}
