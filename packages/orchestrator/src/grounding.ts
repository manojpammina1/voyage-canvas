import type { Evidence, PolicyPassage } from '@voyage/shared';

const PRICE_CLAIM =
  /\$\s*[\d,]+(?:\.\d{2})?|\b(?:total|price|cost)\s*(?:is|of|:)?\s*\$?\s*[\d,]+/gi;

export interface GroundingResult {
  ok: boolean;
  violations: string[];
}

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
      text: 'I can only share pricing shown in verified evidence for this turn.',
      grounding,
    };
  }
  return { text, grounding };
}
