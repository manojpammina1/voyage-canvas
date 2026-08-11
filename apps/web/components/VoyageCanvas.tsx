'use client';

import { useMemo } from 'react';
import { IntentPortal } from './IntentPortal';
import { ConstraintPane } from './ConstraintPane';
import { JourneyOrbit } from './JourneyOrbit';
import { AccessibleVoyageList } from './AccessibleVoyageList';
import { EvidenceDrawer } from './EvidenceDrawer';
import { ComparisonLens } from './ComparisonLens';
import { BottomIntentBar } from './BottomIntentBar';
import { GuidedVoyagePlanner } from './GuidedVoyagePlanner';
import { MaterializationScene } from './MaterializationScene';
import { CanvasProvider, useCanvas } from '../experience/context';

function WorkspaceHeader() {
  const { stage } = useCanvas();
  return (
    <header className="vc-header vc-header--glass">
      <div className="vc-header__brand">Voyage Canvas</div>
      <nav className="vc-header__nav" aria-label="Workspace sections">
        <button type="button" className="vc-header__link">
          Your Trip
        </button>
        <button
          type="button"
          className={`vc-header__link${stage !== 'intent' ? ' vc-header__link--active' : ''}`}
        >
          Explore
        </button>
        <button type="button" className="vc-header__link">
          Why this fits
        </button>
      </nav>
    </header>
  );
}

function ExploringWorkspace() {
  const { viewMode, options, ports, selectedOptionId } = useCanvas();

  const routePorts = useMemo(() => {
    const selected = options.find((o) => o.id === selectedOptionId);
    if (!selected) return [];
    return ports.filter((p) => selected.sailing.ports.includes(p.id));
  }, [options, ports, selectedOptionId]);

  return (
    <div className="vc-workspace">
      <ConstraintPane />
      <section className="vc-pane vc-pane--canvas" aria-label="Voyage canvas">
        <ComparisonLens />
        {viewMode === 'orbit' ? (
          <JourneyOrbit routePorts={routePorts} />
        ) : (
          <AccessibleVoyageList />
        )}
      </section>
      <EvidenceDrawer />
    </div>
  );
}

function VoyageCanvasInner() {
  const { stage } = useCanvas();

  return (
    <>
      <WorkspaceHeader />
      <main className="vc-shell" style={{ paddingBottom: '7.5rem' }}>
        {stage === 'intent' && <IntentPortal />}
        {stage === 'fallback' && <GuidedVoyagePlanner />}
        {(stage === 'exploring' || stage === 'comparing') && <ExploringWorkspace />}
      </main>
      <MaterializationScene />
      <BottomIntentBar />
    </>
  );
}

export function VoyageCanvas() {
  return (
    <CanvasProvider>
      <div className="vc-root">
        <div className="vc-ambient vc-ambient--active" aria-hidden="true">
          <span className="vc-ambient__shimmer" />
        </div>
        <VoyageCanvasInner />
      </div>
    </CanvasProvider>
  );
}
