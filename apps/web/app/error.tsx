'use client';

import { useEffect } from 'react';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="vc-error-shell" role="alert">
      <section className="glass-panel vc-error-card">
        <p className="vc-error-card__eyebrow">Royal Caribbean</p>
        <h1>We hit a recoverable error.</h1>
        <p>
          Your deterministic search state is preserved. Refresh the planner or
          try the action again.
        </p>
        <button className="vc-button" type="button" onClick={reset}>
          Retry
        </button>
      </section>
    </main>
  );
}
