'use client';

import { MATERIALIZE_STEPS, useCanvas } from '../experience/context';

export function GenerativeProgress({ compact = false }: { compact?: boolean }) {
  const { materializePhase, loading } = useCanvas();

  if (!loading && !materializePhase) return null;

  const activeIndex = materializePhase
    ? MATERIALIZE_STEPS.findIndex((s) => s.id === materializePhase)
    : -1;

  return (
    <ol
      className="vc-gen-steps"
      aria-label="Materialization progress"
      style={compact ? { width: '100%' } : undefined}
    >
      {MATERIALIZE_STEPS.map((step, i) => {
        const isActive = step.id === materializePhase;
        const isDone = activeIndex > i;
        return (
          <li
            key={step.id}
            className={`vc-gen-step${isActive ? ' vc-gen-step--active' : ''}${isDone ? ' vc-gen-step--done' : ''}`}
            aria-current={isActive ? 'step' : undefined}
          >
            <span className="vc-gen-step__dot" aria-hidden="true" />
            {step.label}
          </li>
        );
      })}
    </ol>
  );
}
