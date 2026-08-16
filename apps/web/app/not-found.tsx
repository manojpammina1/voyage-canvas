import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="vc-error-shell">
      <section className="glass-panel vc-error-card">
        <p className="vc-error-card__eyebrow">Royal Caribbean</p>
        <h1>Planner route not found.</h1>
        <p>Return to the planning assistant and start from verified data.</p>
        <Link className="vc-button" href="/">
          Open Royal Caribbean
        </Link>
      </section>
    </main>
  );
}
