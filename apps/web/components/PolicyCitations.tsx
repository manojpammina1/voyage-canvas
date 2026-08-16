'use client';

import type { Evidence } from '@voyage/shared';

interface PolicyCitation {
  sourceId: string;
  title: string;
  topic: string;
  chunkId: string;
  excerpt: string;
  contentVersion: string;
  score?: number;
}

function isCitation(value: unknown): value is PolicyCitation {
  if (typeof value !== 'object' || value === null) return false;
  const citation = value as Record<string, unknown>;
  return (
    typeof citation.sourceId === 'string' &&
    typeof citation.title === 'string' &&
    typeof citation.topic === 'string' &&
    typeof citation.chunkId === 'string' &&
    typeof citation.excerpt === 'string' &&
    typeof citation.contentVersion === 'string'
  );
}

function citationScoreLabel(score?: number): string | undefined {
  if (typeof score !== 'number' || !Number.isFinite(score)) return undefined;
  const normalized = Math.max(0, Math.min(score, 1));
  return `${Math.round(normalized * 100)}% match`;
}

function citationExcerpt(excerpt: string): string {
  let trimmed = excerpt.replace(/\s+/g, ' ').trim();
  if (!trimmed) return '';
  let prefix = '';
  if (/^[a-z]/.test(trimmed)) {
    prefix = '... ';
    const sentenceBreak = trimmed.indexOf('. ');
    const commaBreak = trimmed.indexOf(', ');
    if (sentenceBreak > 0 && sentenceBreak < 80) {
      trimmed = trimmed.slice(sentenceBreak + 2).trimStart();
    } else if (commaBreak > 0 && commaBreak < 40) {
      trimmed = trimmed.slice(commaBreak + 2).trimStart();
    } else {
      trimmed = trimmed.replace(/^\S+\s+/, '').trimStart();
    }
  }
  const clipped =
    trimmed.length > 220 ? `${trimmed.slice(0, 220).trimEnd()}...` : trimmed;
  return `${prefix}${clipped}`;
}

function policyCitationsFromEvidence(evidence: Evidence[]): PolicyCitation[] {
  const byChunk = new Map<string, PolicyCitation>();

  for (const ev of evidence) {
    if (ev.type !== 'POLICY') continue;
    const data = ev.data as { citations?: unknown };
    if (!Array.isArray(data.citations)) continue;
    for (const citation of data.citations) {
      if (isCitation(citation)) byChunk.set(citation.chunkId, citation);
    }
  }

  const citations = [...byChunk.values()];
  const primarySourceId = citations[0]?.sourceId;
  return primarySourceId
    ? citations.filter((citation) => citation.sourceId === primarySourceId)
    : citations;
}

export function PolicyCitations({ evidence }: { evidence: Evidence[] }) {
  const citations = policyCitationsFromEvidence(evidence);

  if (citations.length === 0) return null;

  return (
    <section className="vc-policy-citations" aria-label="RAG citations">
      <div className="vc-policy-citations__header">
        <span>RAG citations</span>
        <span>Approved content</span>
      </div>
      <ol className="vc-policy-citations__list">
        {citations.map((citation, index) => {
          const score = citationScoreLabel(citation.score);
          return (
            <li key={citation.chunkId} className="vc-policy-citation">
              <div className="vc-policy-citation__title-row">
                <span className="vc-policy-citation__index">{index + 1}</span>
                <span className="vc-policy-citation__title">{citation.title}</span>
              </div>
              <div className="vc-policy-citation__meta">
                <span>{citation.sourceId}</span>
                <span>{citation.topic}</span>
                <span>v{citation.contentVersion}</span>
                {score && <span>{score}</span>}
              </div>
              <p className="vc-policy-citation__excerpt">
                {citationExcerpt(citation.excerpt)}
              </p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
