'use client';

import { useEffect } from 'react';

export default function GlobalError({
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
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          background: '#f7f9fb',
          color: '#191c1e',
          fontFamily: '"Inter", "Segoe UI", system-ui, sans-serif',
        }}
      >
        <main
          role="alert"
          style={{
            minHeight: '100vh',
            display: 'grid',
            placeItems: 'center',
            padding: '2rem',
          }}
        >
          <section
            style={{
              width: 'min(520px, 100%)',
              border: '1px solid rgba(255, 255, 255, 0.7)',
              borderRadius: 16,
              background: 'rgba(255, 255, 255, 0.72)',
              boxShadow: '0 18px 60px rgba(0, 45, 84, 0.14)',
              padding: '2rem',
            }}
          >
            <p
              style={{
                margin: '0 0 0.75rem',
                color: '#003e7a',
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              Royal Caribbean
            </p>
            <h1 style={{ margin: '0 0 0.75rem', color: '#002d54' }}>
              The planner needs a clean retry.
            </h1>
            <p style={{ margin: '0 0 1.25rem', lineHeight: 1.6 }}>
              The planning assistant could not render this request. The
              commerce services remain the source of truth for price and
              availability.
            </p>
            <button
              type="button"
              onClick={reset}
              style={{
                border: 0,
                borderRadius: 9999,
                background: '#9b4500',
                color: '#fff',
                cursor: 'pointer',
                fontWeight: 700,
                padding: '0.85rem 1.4rem',
              }}
            >
              Retry
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
