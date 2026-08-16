'use client';

import type { CabinAvailability, Evidence, PriceQuote } from '@voyage/shared';
import { useCanvas, type AssistantAnswerMode } from '../experience/context';

type ValidationStatus = 'pass' | 'review' | 'blocked' | 'na';

interface ValidationRow {
  id: string;
  label: string;
  detail: string;
  status: ValidationStatus;
}

function isPriceQuote(data: unknown): data is PriceQuote {
  return (
    typeof data === 'object' &&
    data !== null &&
    'totalUsd' in data &&
    'breakdown' in data
  );
}

function isAvailability(data: unknown): data is CabinAvailability {
  return (
    typeof data === 'object' &&
    data !== null &&
    'availableCount' in data &&
    'cabinId' in data
  );
}

function supportedPriceValues(evidence: Evidence[]): number[] {
  return evidence.flatMap((ev) => {
    if (ev.type !== 'PRICE' || !isPriceQuote(ev.data)) return [];
    const breakdown = ev.data.breakdown.map((item) => item.amountUsd);
    return [ev.data.totalUsd, ...breakdown];
  });
}

function priceClaims(text: string): number[] {
  const matches = text.match(/\$\s*[\d,]+(?:\.\d{2})?/g) ?? [];
  return matches
    .map((match) => Number(match.replace(/[^\d.]/g, '')))
    .filter((value) => Number.isFinite(value));
}

function hasAvailabilityClaim(text: string): boolean {
  return /\b(available|availability|inventory|cabins?|staterooms?)\b/i.test(
    text,
  );
}

function validationSummary(rows: ValidationRow[]): string {
  if (rows.some((row) => row.status === 'blocked')) return 'Blocked';
  if (rows.some((row) => row.status === 'review')) return 'Reviewing';
  return 'Passed';
}

function modeLabel(mode?: AssistantAnswerMode): string {
  switch (mode) {
    case 'deterministic':
      return 'Service answer';
    case 'policy':
      return 'RAG answer';
    case 'fallback':
      return 'Safe fallback';
    default:
      return 'No answer yet';
  }
}

function buildValidationRows({
  answerMode,
  citationEvidence,
  evidence,
  narrative,
  policyStreaming,
}: {
  answerMode?: AssistantAnswerMode;
  citationEvidence: Evidence[];
  evidence: Evidence[];
  narrative: string;
  policyStreaming: boolean;
}): ValidationRow[] {
  const claims = priceClaims(narrative);
  const supportedPrices = supportedPriceValues(evidence);
  const unsupportedPrices = claims.filter(
    (claim) => !supportedPrices.includes(claim),
  );
  const availabilityClaim = hasAvailabilityClaim(narrative);
  const hasAvailabilityEvidence = evidence.some(
    (ev) => ev.type === 'AVAILABILITY' && isAvailability(ev.data),
  );

  return [
    {
      id: 'answer-route',
      label: 'Answer route',
      detail:
        answerMode === 'deterministic'
          ? 'Handled from selected voyage, price, availability, and route evidence without a model call.'
          : answerMode === 'policy'
            ? 'LLM language is allowed only after approved content retrieval.'
            : answerMode === 'fallback'
              ? 'Safe fallback avoids unsupported policy or commerce claims.'
              : 'Ask a question to validate the answer path.',
      status: answerMode ? 'pass' : 'na',
    },
    {
      id: 'price-claims',
      label: 'Price claims',
      detail:
        claims.length === 0
          ? 'No dollar amounts in the current answer.'
          : unsupportedPrices.length === 0
            ? `${claims.length} dollar amount${claims.length === 1 ? '' : 's'} matched PRICE evidence.`
            : `${unsupportedPrices.length} dollar amount${unsupportedPrices.length === 1 ? '' : 's'} did not match PRICE evidence.`,
      status:
        claims.length === 0
          ? 'na'
          : unsupportedPrices.length === 0
            ? 'pass'
            : 'blocked',
    },
    {
      id: 'availability-claims',
      label: 'Availability claims',
      detail: availabilityClaim
        ? hasAvailabilityEvidence
          ? 'Availability wording is backed by current check_availability evidence.'
          : 'Availability wording needs current inventory evidence before display.'
        : 'No availability or inventory claim in the current answer.',
      status: availabilityClaim ? (hasAvailabilityEvidence ? 'pass' : 'blocked') : 'na',
    },
    {
      id: 'policy-citations',
      label: 'Policy citations',
      detail:
        answerMode === 'policy'
          ? citationEvidence.length > 0
            ? `${citationEvidence.length} POLICY evidence object is attached to this answer.`
            : policyStreaming
              ? 'Waiting for approved content evidence.'
              : 'Policy answer is missing approved-content evidence.'
          : 'Not required for deterministic commerce answers.',
      status:
        answerMode === 'policy'
          ? citationEvidence.length > 0
            ? 'pass'
            : policyStreaming
              ? 'review'
              : 'blocked'
          : 'na',
    },
  ];
}

export function GroundingValidator({
  citationEvidence,
}: {
  citationEvidence: Evidence[];
}) {
  const {
    assistantAnswerMode,
    assistantQuestion,
    evidence,
    policyNarrative,
    policyStreaming,
  } = useCanvas();

  if (!assistantQuestion && !policyNarrative) return null;

  const rows = buildValidationRows({
    answerMode: assistantAnswerMode,
    citationEvidence,
    evidence,
    narrative: policyNarrative ?? '',
    policyStreaming,
  });
  const summary = validationSummary(rows);

  return (
    <section className="vc-grounding-validator" aria-label="Grounding validator">
      <div className="vc-grounding-validator__header">
        <span>Grounding validator</span>
        <span>{summary}</span>
      </div>
      <div className="vc-grounding-validator__mode">
        <span>{modeLabel(assistantAnswerMode)}</span>
        <span>Current answer only</span>
      </div>
      <ul className="vc-grounding-validator__list">
        {rows.map((row) => (
          <li
            key={row.id}
            className={`vc-grounding-validator__row vc-grounding-validator__row--${row.status}`}
          >
            <span
              className={`vc-grounding-validator__mark vc-grounding-validator__mark--${row.status}`}
              aria-hidden="true"
            />
            <div>
              <div className="vc-grounding-validator__label">{row.label}</div>
              <p>{row.detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
