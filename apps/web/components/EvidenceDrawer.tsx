'use client';

import { AgentTrace } from './AgentTrace';
import { GroundingValidator } from './GroundingValidator';
import { PolicyCitations } from './PolicyCitations';
import { EvidenceBadge, GlassPanel } from './primitives';
import { useCanvas } from '../experience/context';

export function EvidenceDrawer() {
  const {
    evidence,
    selectedOptionId,
    assistantQuestion,
    assistantAnswerMode,
    assistantCitationEvidenceIds,
    policyNarrative,
    policyStreaming,
  } = useCanvas();

  const visible = selectedOptionId
    ? evidence.filter(
        (e) =>
          e.id.includes(selectedOptionId) ||
          e.type === 'COMPARISON',
      )
    : evidence.slice(0, 3);
  const citationEvidence =
    assistantAnswerMode === 'policy'
      ? evidence.filter((ev) => assistantCitationEvidenceIds.includes(ev.id))
      : [];

  return (
    <GlassPanel className="vc-evidence-drawer vc-pane--evidence">
      <h2
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: '0.875rem',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: 'var(--primary)',
          margin: '0 0 0.75rem',
        }}
      >
        Evidence
      </h2>
      <AgentTrace />
      {assistantQuestion && (
        <section className="vc-answer-panel" aria-label="Assistant answer">
          <div className="vc-answer-panel__label">Asked</div>
          <p className="vc-answer-panel__question">{assistantQuestion}</p>
          <div className="vc-answer-panel__label">Grounded answer</div>
          <p className="vc-answer-panel__text">
            {policyNarrative}
            {policyStreaming ? '▍' : ''}
          </p>
        </section>
      )}
      {assistantQuestion && citationEvidence.length > 0 && (
        <PolicyCitations evidence={citationEvidence} />
      )}
      <GroundingValidator citationEvidence={citationEvidence} />
      {visible.length === 0 ? (
        <p style={{ fontSize: '0.875rem', color: 'var(--on-surface-variant)' }}>
          Select a voyage to view verified price and availability evidence.
        </p>
      ) : (
        visible.map((ev) => (
          <div key={ev.id} className="vc-evidence-item">
            <div className="vc-evidence-item__title">{ev.type}</div>
            <EvidenceBadge>
              {ev.source === 'deterministic' ? 'Deterministic' : 'Approved content'}
            </EvidenceBadge>
            {ev.asOf && (
              <p style={{ fontSize: '0.75rem', margin: '0.35rem 0 0' }}>
                As of {new Date(ev.asOf).toLocaleString('en-US')}
              </p>
            )}
            {ev.validUntil && (
              <p style={{ fontSize: '0.75rem', margin: '0.15rem 0 0' }}>
                Valid until {new Date(ev.validUntil).toLocaleString('en-US')}
              </p>
            )}
            <p style={{ fontSize: '0.7rem', margin: '0.35rem 0 0', opacity: 0.8 }}>
              Source: {ev.provenance.tool}
            </p>
          </div>
        ))
      )}
    </GlassPanel>
  );
}
