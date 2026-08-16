import type { Evidence, PolicyPassage } from '@voyage/shared';

const PRICE_CLAIM =
  /\$\s*[\d,]+(?:\.\d{2})?|\b(?:total|price|cost)\s*(?:is|of|:)?\s*\$?\s*[\d,]+/gi;
const AVAILABILITY_CLAIM =
  /\b(?:inventory|availability|cabins?|staterooms?|rooms?)\b[^.!?]{0,80}\bavailable\b|\bavailable\b[^.!?]{0,80}\b(?:inventory|availability|cabins?|staterooms?|rooms?)\b|\bsold[- ]?out\b/gi;
const AVAILABILITY_COUNT_CLAIM =
  /\b(\d+)\s+(?:balcony|interior|ocean[-_\s]?view|suite)?\s*(?:cabins?|staterooms?|rooms?)\s+(?:are\s+)?available\b/gi;

export interface GroundingResult {
  ok: boolean;
  violations: string[];
}

const SAFE_COMMERCE_FALLBACK =
  'I can only share pricing shown in verified evidence for this turn.';

export function validateCommerceClaimsInText(
  text: string,
  evidence: Evidence[],
): GroundingResult {
  const violations: string[] = [];
  const priceEvidence = evidence.filter((e) => e.type === 'PRICE');
  const matches = text.match(PRICE_CLAIM) ?? [];

  for (const match of matches) {
    const numeric = Number(match.replace(/[^\d.]/g, ''));
    if (!Number.isFinite(numeric)) continue;
    const supported = priceEvidence.some((ev) => {
      const data = ev.data as { totalUsd?: number };
      return data.totalUsd === numeric;
    });
    if (!supported) {
      violations.push(`Unsupported price claim: ${match.trim()}`);
    }
  }

  const availabilityEvidence = evidence.filter((e) => e.type === 'AVAILABILITY');
  const availabilityMatches = text.match(AVAILABILITY_CLAIM) ?? [];
  if (availabilityMatches.length > 0 && availabilityEvidence.length === 0) {
    violations.push('Unsupported availability or inventory claim');
  }

  const availabilityCounts = [...text.matchAll(AVAILABILITY_COUNT_CLAIM)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value));
  for (const count of availabilityCounts) {
    const supported = availabilityEvidence.some((ev) => {
      const data = ev.data as { availableCount?: number };
      return data.availableCount === count;
    });
    if (!supported) {
      violations.push(`Unsupported availability count claim: ${count}`);
    }
  }

  if (/\bsold[- ]?out\b/i.test(text) && availabilityEvidence.length > 0) {
    const soldOutSupported = availabilityEvidence.some((ev) => {
      const data = ev.data as { availableCount?: number };
      return data.availableCount === 0;
    });
    if (!soldOutSupported) {
      violations.push('Unsupported sold-out claim');
    }
  }

  return { ok: violations.length === 0, violations };
}

export function validatePolicyCitations(
  passages: PolicyPassage[],
  narrative: string,
): GroundingResult {
  if (passages.length === 0) {
    return { ok: false, violations: ['No policy passages retrieved'] };
  }
  const violations: string[] = [];
  const cited = passages.some(
    (p) =>
      narrative.includes(p.metadata.sourceId) ||
      narrative.includes(p.metadata.title),
  );
  if (!cited) {
    violations.push('Narrative missing source citation reference');
  }
  return { ok: violations.length === 0, violations };
}

export function filterNarrativeByGrounding(
  text: string,
  evidence: Evidence[],
): { text: string; grounding: GroundingResult } {
  const grounding = validateCommerceClaimsInText(text, evidence);
  if (!grounding.ok) {
    return {
      text: SAFE_COMMERCE_FALLBACK,
      grounding,
    };
  }
  return { text, grounding };
}

function safeBoundaryIndex(text: string): number {
  return Math.max(
    text.lastIndexOf('. '),
    text.lastIndexOf('! '),
    text.lastIndexOf('? '),
    text.lastIndexOf('\n'),
  );
}

export async function* streamGroundedNarrativeText(
  chunks: AsyncIterable<string>,
  evidence: Evidence[],
): AsyncGenerator<string> {
  let emitted = '';
  let pending = '';

  for await (const chunk of chunks) {
    pending += chunk;
    const boundary = safeBoundaryIndex(pending);
    if (boundary < 0) continue;

    const release = pending.slice(0, boundary + 1);
    const grounding = validateCommerceClaimsInText(emitted + release, evidence);
    if (!grounding.ok) {
      yield SAFE_COMMERCE_FALLBACK;
      return;
    }

    emitted += release;
    pending = pending.slice(boundary + 1);
    if (release) yield release;
  }

  if (!pending) return;
  const grounded = filterNarrativeByGrounding(emitted + pending, evidence);
  if (!grounded.grounding.ok) {
    yield SAFE_COMMERCE_FALLBACK;
    return;
  }
  yield pending;
}
