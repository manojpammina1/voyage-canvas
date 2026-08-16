'use client';

import { useCanvas, type AgentTraceEntry } from '../experience/context';

const KIND_LABEL: Record<AgentTraceEntry['kind'], string> = {
  ai: 'AI',
  deterministic: 'Service',
  retrieval: 'RAG',
  guardrail: 'Guardrail',
  system: 'System',
};

const STATUS_LABEL: Record<AgentTraceEntry['status'], string> = {
  running: 'Running',
  complete: 'Complete',
  blocked: 'Fallback',
};

export function AgentTrace() {
  const { agentTrace } = useCanvas();

  if (agentTrace.length === 0) return null;

  const visibleTrace = agentTrace.slice(-8);

  return (
    <section className="vc-agent-trace" aria-label="Agent trace" aria-live="polite">
      <div className="vc-agent-trace__header">
        <span>Agent trace</span>
        <span>{visibleTrace.length} steps</span>
      </div>
      <ol className="vc-agent-trace__list">
        {visibleTrace.map((entry) => (
          <li
            key={entry.id}
            className={`vc-agent-trace__item vc-agent-trace__item--${entry.status}`}
          >
            <span
              className={`vc-agent-trace__dot vc-agent-trace__dot--${entry.status}`}
              aria-hidden="true"
            />
            <div className="vc-agent-trace__body">
              <div className="vc-agent-trace__title-row">
                <span className="vc-agent-trace__title">{entry.label}</span>
                <span
                  className={`vc-agent-trace__kind vc-agent-trace__kind--${entry.kind}`}
                >
                  {KIND_LABEL[entry.kind]}
                </span>
              </div>
              <p>{entry.detail}</p>
              <span className="vc-agent-trace__status">
                {STATUS_LABEL[entry.status]}
              </span>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
