'use client';

import { useCallback, useEffect, useState } from 'react';
import { useCanvas } from '../experience/context';

export function BudgetControl() {
  const { criteria, updateBudget, loading, lockedPreferences } = useCanvas();
  const lockedBudget = lockedPreferences.some((l) => l.criterion === 'maxPriceUsd');
  const initial = criteria.maxPriceUsd ?? 5000;
  const [value, setValue] = useState(initial);

  useEffect(() => {
    setValue(criteria.maxPriceUsd ?? 5000);
  }, [criteria.maxPriceUsd]);

  const commit = useCallback(
    (v: number) => {
      void updateBudget(v);
    },
    [updateBudget],
  );

  return (
    <div className="vc-budget">
      <label htmlFor="budget-range">
        <span style={{ fontSize: '0.8rem', color: 'var(--on-surface-variant)' }}>
          Max budget (USD)
        </span>
        <div className="vc-budget__value">${value.toLocaleString('en-US')}</div>
      </label>
      <input
        id="budget-range"
        type="range"
        min={3500}
        max={5500}
        step={50}
        value={value}
        disabled={loading || lockedBudget}
        onChange={(e) => setValue(Number(e.target.value))}
        onMouseUp={() => commit(value)}
        onTouchEnd={() => commit(value)}
        onKeyUp={(e) => {
          if (e.key === 'Enter' || e.key === ' ') commit(value);
        }}
        aria-valuemin={3500}
        aria-valuemax={5500}
        aria-valuenow={value}
      />
      {lockedBudget && (
        <p style={{ fontSize: '0.75rem', color: 'var(--primary)', margin: '0.25rem 0 0' }}>
          Budget locked — unlock to scrub orbit
        </p>
      )}
    </div>
  );
}
