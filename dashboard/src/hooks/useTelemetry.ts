import { useState, useEffect, useCallback } from 'react';
import { fetchAllEvents } from '../lib/blob-fetch';
import { compute }        from '../lib/aggregations';
import type { Aggregations, AggPeriod, PrStats, CorrectionStats } from '../lib/types';

// Merged-PR stats overlay (gitignored, built by scripts/build-pr-stats.mjs).
// Absent/invalid → null: cost-per-PR shows "baseline pending", never a fake number.
async function fetchPrStats(): Promise<PrStats | null> {
  try {
    const res = await fetch('/pr-stats.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const json = (await res.json()) as PrStats;
    return json && json.periods ? json : null;
  } catch {
    return null;
  }
}

// Downstream correction-record overlay (gitignored, built by
// scripts/build-correction-stats.mjs). Absent/invalid/PAT-pending → null: the
// Correction section shows "ADO pending", never a fabricated record count.
async function fetchCorrectionStats(): Promise<CorrectionStats | null> {
  try {
    const res = await fetch('/correction-stats.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const json = (await res.json()) as CorrectionStats;
    return json && json.periods ? json : null;
  } catch {
    return null;
  }
}

const POLL_MS = 5 * 60 * 1000;  // 5 min

export interface TelemetryHookResult {
  data:        Aggregations | null;
  loading:     boolean;
  error:       string | null;
  // Non-fatal: set when SOME blobs failed to fetch but enough succeeded to
  // still render `data`. Distinct from `error`, which means nothing rendered.
  partialWarning: string | null;
  lastUpdated: Date | null;
  refresh:     () => void;
}

export function useTelemetry(sasUrl: string, period: AggPeriod): TelemetryHookResult {
  const [data, setData]           = useState<Aggregations | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [partialWarning, setPartialWarning] = useState<string | null>(null);
  const [lastUpdated, setUpdated] = useState<Date | null>(null);

  const run = useCallback(async () => {
    if (!sasUrl) {
      setError('No SAS URL configured. Set VITE_TELEMETRY_READ_SAS in .env');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setPartialWarning(null);
    try {
      const [{ events, totalBlobs, failedBlobs }, prStats, correctionStats] = await Promise.all([
        fetchAllEvents(sasUrl), fetchPrStats(), fetchCorrectionStats(),
      ]);
      setData(compute(events, period, prStats, correctionStats));
      setUpdated(new Date());
      if (failedBlobs > 0) {
        setPartialWarning(`${failedBlobs} of ${totalBlobs} telemetry file(s) could not be read — figures below are based on the remaining ${totalBlobs - failedBlobs}.`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [sasUrl, period.daysBack]);

  useEffect(() => {
    void run();
    const interval = setInterval(() => { void run(); }, POLL_MS);
    return () => clearInterval(interval);
  }, [run]);

  return { data, loading, error, partialWarning, lastUpdated, refresh: () => void run() };
}
