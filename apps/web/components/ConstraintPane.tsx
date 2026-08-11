'use client';

import type { LockableCriterion } from '@voyage/shared';
import { Button, GlassPanel } from './primitives';
import { BudgetControl } from './BudgetControl';
import { CommitmentPanel } from './CommitmentPanel';
import { useCanvas } from '../experience/context';

const LOCKABLE: Array<{ key: LockableCriterion; label: string }> = [
  { key: 'cabinType', label: 'Balcony cabin' },
  { key: 'destination', label: 'Caribbean' },
  { key: 'month', label: 'March 2027' },
  { key: 'nights', label: '7 nights' },
  { key: 'maxPriceUsd', label: 'Budget cap' },
];

export function ConstraintPane() {
  const {
    criteria,
    lockedPreferences,
    togglePreferenceLock,
    loading,
  } = useCanvas();

  const isLocked = (key: LockableCriterion) =>
    lockedPreferences.some((l) => l.criterion === key);

  const valueFor = (key: LockableCriterion): unknown => {
    if (key in criteria && criteria[key as keyof typeof criteria] !== undefined) {
      return criteria[key as keyof typeof criteria];
    }
    const defaults: Partial<Record<LockableCriterion, unknown>> = {
      cabinType: 'balcony',
      destination: 'Caribbean',
      month: '2027-03',
      nights: 7,
      maxPriceUsd: 5000,
    };
    return defaults[key];
  };

  return (
    <GlassPanel className="vc-pane vc-pane--constraints">
      <h2
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: '0.875rem',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: 'var(--primary)',
          margin: '0 0 0.5rem',
        }}
      >
        Constraints
      </h2>
      <p style={{ fontSize: '0.8rem', color: 'var(--on-surface-variant)', margin: 0 }}>
        Lock preferences to keep them while you adjust budget.
      </p>
      <div className="vc-chip-row" role="list" aria-label="Locked preferences">
        {LOCKABLE.map(({ key, label }) => {
          const locked = isLocked(key);
          return (
            <span
              key={key}
              className={`vc-chip${locked ? ' vc-chip--locked' : ''}`}
              role="listitem"
            >
              {locked && <span aria-hidden="true">🔒</span>}
              {label}
              <button
                type="button"
                aria-pressed={locked}
                aria-label={`${locked ? 'Unlock' : 'Lock'} ${label}`}
                disabled={loading}
                onClick={() =>
                  void togglePreferenceLock(key, valueFor(key), !locked)
                }
              >
                {locked ? '✕' : '+'}
              </button>
            </span>
          );
        })}
      </div>
      <BudgetControl />
      <CommitmentPanel />
      <Button
        type="button"
        variant="secondary"
        disabled={loading}
        onClick={() =>
          void togglePreferenceLock('cabinType', 'balcony', true)
        }
        style={{ marginTop: '0.5rem', width: '100%' }}
      >
        Lock balcony preference
      </Button>
    </GlassPanel>
  );
}
