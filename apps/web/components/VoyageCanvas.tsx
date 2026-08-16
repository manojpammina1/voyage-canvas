'use client';

import { useEffect, useMemo, useState } from 'react';
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

interface AiRuntimeStatus {
  provider: string;
  configured: boolean;
  model?: string;
}

function findNextCommitmentAction(commitment: HTMLElement) {
  return (
    commitment.querySelector<HTMLElement>(
      'button[data-commitment-next="true"]:not(:disabled), a[data-commitment-next="true"]',
    ) ??
    commitment.querySelector<HTMLElement>(
      'input[data-commitment-next="true"]:not(:disabled)',
    ) ??
    commitment.querySelector<HTMLElement>('button:not(:disabled), a[href]') ??
    commitment.querySelector<HTMLElement>('input:not(:disabled)')
  );
}

function advanceCommitmentPanel() {
  const commitment = document.getElementById('commitment-panel');
  if (!commitment) return;

  commitment.scrollIntoView({ behavior: 'smooth', block: 'center' });
  window.setTimeout(() => {
    const nextAction = findNextCommitmentAction(commitment);
    (nextAction ?? commitment).focus({ preventScroll: true });

    if (
      nextAction instanceof HTMLButtonElement ||
      nextAction instanceof HTMLAnchorElement
    ) {
      nextAction.click();
    }
  }, 300);
}

function WorkspaceHeader() {
  const {
    stage,
    viewMode,
    setViewMode,
    selectedOption,
    options,
    selectOption,
    triggerFallbackDemo,
    loading,
    policyStreaming,
  } = useCanvas();
  const [ai, setAi] = useState<AiRuntimeStatus>();

  useEffect(() => {
    let active = true;
    fetch('/api/health')
      .then((res) => res.json())
      .then((data: { ai?: AiRuntimeStatus }) => {
        if (active) setAi(data.ai);
      })
      .catch(() => {
        if (active) setAi({ provider: 'unknown', configured: false });
      });
    return () => {
      active = false;
    };
  }, []);

  const providerLabel =
    ai?.provider === 'gemini'
      ? ai.configured
        ? 'Gemini live'
        : 'Gemini key missing'
      : ai?.provider === 'mock'
        ? 'Mock AI'
        : 'AI status pending';
  const showCanvasControls = stage !== 'intent' && stage !== 'fallback';
  const canvasBusy = loading && !policyStreaming;
  const actionDisabled = canvasBusy || policyStreaming;
  const total = selectedOption?.totalUsd;

  return (
    <header className="vc-header vc-header--glass">
      <div className="vc-header__brand">Royal Caribbean</div>
      <div className="vc-header__right">
        {showCanvasControls && (
          <div className="vc-header-controls" aria-label="Canvas controls">
            <div className="vc-view-toggle" role="group" aria-label="View mode">
              <button
                type="button"
                aria-pressed={viewMode === 'orbit'}
                onClick={() => setViewMode('orbit')}
              >
                Orbit
              </button>
              <button
                type="button"
                aria-pressed={viewMode === 'list'}
                onClick={() => setViewMode('list')}
              >
                List
              </button>
            </div>
            <div className="vc-header-controls__actions">
              <button
                className="vc-button vc-button--secondary"
                type="button"
                disabled={actionDisabled}
                onClick={() => void triggerFallbackDemo()}
              >
                AI outage demo
              </button>
              {total !== undefined && (
                <div className="vc-header-total">
                  <span className="vc-header-total__label">Verified total</span>
                  <span className="vc-header-total__value">
                    ${total.toLocaleString('en-US')}
                  </span>
                </div>
              )}
              <button
                className="vc-button"
                type="button"
                disabled={actionDisabled || (!selectedOption && options.length === 0)}
                onClick={() => {
                  if (options[0] && !selectedOption) selectOption(options[0]!.id);
                  window.setTimeout(advanceCommitmentPanel, 0);
                }}
              >
                Continue
              </button>
            </div>
          </div>
        )}
        <span
          className={`vc-header__ai${ai?.provider === 'gemini' && ai.configured ? ' vc-header__ai--live' : ''}`}
          title={ai?.model ? `Model: ${ai.model}` : undefined}
        >
          {providerLabel}
        </span>
      </div>
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
  const { stage, loading } = useCanvas();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  return (
    <>
      <WorkspaceHeader />
      <BottomIntentBar />
      <main
        className="vc-shell"
        data-voyage-ready={hydrated ? 'true' : 'false'}
      >
        {stage === 'intent' && <IntentPortal />}
        {stage === 'fallback' && !loading && <GuidedVoyagePlanner />}
        {(stage === 'exploring' || stage === 'comparing') && <ExploringWorkspace />}
      </main>
      <MaterializationScene />
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
