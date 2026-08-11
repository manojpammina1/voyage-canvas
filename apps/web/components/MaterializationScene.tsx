'use client';

import { GenerativeProgress } from './GenerativeProgress';
import { useCanvas } from '../experience/context';

export function MaterializationScene() {
  const { loading, materializePhase, stage } = useCanvas();

  const show =
    loading && materializePhase && (stage === 'intent' || stage === 'exploring');

  if (!show) return null;

  return (
    <div
      className="vc-materialize"
      role="dialog"
      aria-modal="true"
      aria-labelledby="materialize-title"
      aria-busy="true"
    >
      <div className="vc-materialize__core" aria-hidden="true">
        <span className="vc-materialize__ring" />
        <span className="vc-materialize__ring" />
        <span className="vc-materialize__ring" />
        <div className="vc-materialize__orb">
          <span className="vc-materialize__orb-inner" />
        </div>
      </div>
      <h2 id="materialize-title" className="vc-materialize__title">
        Materializing your voyage canvas
      </h2>
      <GenerativeProgress />
    </div>
  );
}
