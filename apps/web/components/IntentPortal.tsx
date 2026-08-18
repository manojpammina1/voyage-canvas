'use client';

import { LiveRegion } from './primitives';
import { useCanvas } from '../experience/context';

export function IntentPortal() {
  const {
    intentDraft,
    setIntentDraft,
    submitIntent,
    loading,
    clarificationQuestion,
  } = useCanvas();

  return (
    <section
      className="vc-intent-hero vc-intent-hero--cinematic"
      aria-labelledby="intent-heading"
    >
      <div className="vc-intent-glow" aria-hidden="true" />
      <LiveRegion message={loading ? 'Materializing voyage possibilities' : ''} />
      <p className="vc-intent-eyebrow">Voyage Canvas planner</p>
      <h1 id="intent-heading">Describe the trip you&apos;re imagining</h1>
      <p className="vc-intent-sub">
        Destination, dates, travelers, cabin, budget — we materialize verified
        sailings around your traveler core as evidence arrives.
      </p>
      {clarificationQuestion && (
        <p
          role="status"
          aria-live="polite"
          className="vc-intent-clarification"
        >
          {clarificationQuestion}
        </p>
      )}
      <form
        className="vc-intent-pill"
        onSubmit={(e) => {
          e.preventDefault();
          void submitIntent();
        }}
      >
        <label htmlFor="intent-input" className="visually-hidden">
          Trip description
        </label>
        <textarea
          id="intent-input"
          rows={2}
          value={intentDraft}
          onChange={(e) => setIntentDraft(e.target.value)}
          placeholder="7-night Caribbean cruise in March 2027 for 2 adults and 2 kids, balcony, under $5,000"
          disabled={loading}
        />
        <button
          type="submit"
          className="vc-intent-send"
          disabled={loading || !intentDraft.trim()}
          aria-label={loading ? 'Materializing voyages' : 'Explore voyages'}
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M5 12h14M13 6l6 6-6 6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </form>
      <p className="vc-intent-hint">
        Press enter or tap the arrow — watch nodes appear on the orbit as prices verify.
      </p>
    </section>
  );
}
