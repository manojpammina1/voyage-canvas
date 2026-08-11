'use client';

import { Button } from './primitives';
import { GenerativeProgress } from './GenerativeProgress';
import { useCanvas } from '../experience/context';

const POLICY_DEMO_QUESTION = 'What travel documents do children need?';

function SparkleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="white" aria-hidden="true">
      <path d="M12 2l1.5 5.5L19 9l-5.5 1.5L12 16l-1.5-5.5L5 9l5.5-1.5L12 2z" />
    </svg>
  );
}

export function BottomIntentBar() {
  const {
    viewMode,
    setViewMode,
    selectedOption,
    stage,
    options,
    selectOption,
    askPolicyQuestion,
    triggerFallbackDemo,
    loading,
    policyNarrative,
    policyStreaming,
    materializePhase,
    statusMessage,
    error,
  } = useCanvas();

  if (stage === 'intent') return null;

  const total = selectedOption?.totalUsd;
  const showSteps = loading && materializePhase;

  return (
    <>
      <footer className="vc-bottom-bar vc-bottom-bar--tools" aria-label="Canvas controls">
        <div className="vc-bottom-bar__inner">
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
          <div className="vc-bottom-bar__actions">
            <Button
              type="button"
              variant="secondary"
              disabled={loading}
              onClick={() => void askPolicyQuestion(POLICY_DEMO_QUESTION)}
            >
              Ask policy
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={loading}
              onClick={() => void triggerFallbackDemo()}
            >
              AI outage demo
            </Button>
            {total !== undefined && (
              <div className="vc-bottom-bar__total">
                <span className="vc-bottom-bar__total-label">Verified total</span>
                <span className="vc-bottom-bar__total-value">
                  ${total.toLocaleString('en-US')}
                </span>
              </div>
            )}
            <Button
              type="button"
              disabled={!selectedOption}
              onClick={() => {
                if (options[0] && !selectedOption) selectOption(options[0]!.id);
              }}
            >
              Continue
            </Button>
          </div>
        </div>
      </footer>

      <div className="vc-gen-bar" role="status" aria-live="polite" aria-atomic="true">
        <span className="vc-gen-bar__sparkle" aria-hidden="true">
          <SparkleIcon />
        </span>
        <div className="vc-gen-bar__status">
          {showSteps ? (
            <GenerativeProgress compact />
          ) : (
            <>
              <span
                className={
                  loading || policyStreaming ? 'vc-gen-bar__status--streaming' : undefined
                }
              >
                {error ? (
                  <span style={{ color: 'var(--error)' }}>{error}</span>
                ) : loading ? (
                  'Working…'
                ) : (
                  statusMessage
                )}
              </span>
              {policyNarrative && (
                <span className="vc-gen-bar__stream-text">
                  {policyNarrative.slice(0, 220)}
                  {policyStreaming ? '▍' : policyNarrative.length > 220 ? '…' : ''}
                </span>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
