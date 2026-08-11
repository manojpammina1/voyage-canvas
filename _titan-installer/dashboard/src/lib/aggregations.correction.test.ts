import { describe, it, expect } from 'vitest';
import { computeCorrection } from './aggregations';
import type { TelemetryEvent, AggPeriod } from './types';

// Facts-only correction math. All fixtures are fictional — no PHI/creds/real data.
const PERIOD: AggPeriod = { label: 'all', daysBack: 365 };

// Build an ISO ts `daysAgo` days back at a fixed UTC time (12:00 keeps the local
// calendar date stable across timezones for the per-day grouping assertions).
function iso(daysAgo: number, h = 12, m = 0, s = 0): string {
  const d = new Date(Date.now() - daysAgo * 86400_000);
  d.setUTCHours(h, m, s, 0);
  return d.toISOString();
}
function ev(ts: string, tool: string, meta: Record<string, unknown> = {},
           o: { session?: string; user?: string } = {}): TelemetryEvent {
  return { v: 1, ts, user: o.user ?? 'u1', role: 'dev-mode', tool, session: o.session ?? 's1', meta };
}
const usage = (ts: string, tok: number, cost: number, o = {}) =>
  ev(ts, '_actual_usage', { model: 'claude-sonnet-4-6', total_tokens: tok, cost_usd: cost }, o);
const clean = (ts: string, o = {}) => ev(ts, '_cost_estimate', { class: 'code_generation' }, o);
const correction = (ts: string, o = {}) =>
  ev(ts, '_correction', { signal: 'followup_phrase', confidence: 'medium', category: 'wrong_output' }, o);

describe('computeCorrection — wasted cost/tokens (measured facts)', () => {
  const events = [
    usage(iso(1, 10, 0, 0), 1000, 0.10),      // clean answer
    clean(iso(1, 10, 1, 0)),                    // clean prompt
    correction(iso(1, 10, 2, 0)),               // correction → opens episode
    usage(iso(1, 10, 2, 30), 2000, 0.20),       // wasted turn (in episode)
    clean(iso(1, 10, 4, 0)),                     // clean prompt → resolves episode
    usage(iso(1, 10, 5, 0), 500, 0.05),          // clean turn again
  ];
  const c = computeCorrection(events, PERIOD, null);

  it('sums only the in-episode turn as wasted', () => {
    expect(c.wastedTokens).toBe(2000);
    expect(c.wastedCostUsd).toBeCloseTo(0.20, 6);
  });
  it('computes rework ratio against total period tokens', () => {
    expect(c.totalPeriodTokens).toBe(3500);
    expect(c.reworkTokenRatio).toBeCloseTo(2000 / 3500, 6);
  });
  it('counts one correction across three assistant turns', () => {
    expect(c.correctionCount).toBe(1);
    expect(c.correctionRate).toBeCloseTo(1 / 3, 6);
  });
  it('measures time-to-correct from real timestamps (30s + 90s = 120s)', () => {
    expect(c.medianTimeToCorrectSec).toBe(120);
  });
  it('attributes the correction to the model that produced the flagged answer', () => {
    const sonnet = c.byModel.find((m) => m.model.toLowerCase().includes('sonnet'));
    expect(sonnet?.corrections).toBe(1);
    expect(sonnet?.assistantTurns).toBe(3);
  });
});

describe('computeCorrection — idle cap bounds measured time', () => {
  const events = [
    correction(iso(2, 9, 0, 0), { session: 's2' }),
    usage(iso(2, 9, 0, 20), 1000, 0.10, { session: 's2' }),   // +20s
    clean(iso(2, 9, 20, 0), { session: 's2' }),                // raw +1180s, capped to 300
  ];
  const c = computeCorrection(events, PERIOD, null);
  it('caps a 20-minute idle gap at 300s (20 + 300 = 320)', () => {
    expect(c.medianTimeToCorrectSec).toBe(320);
  });
});

describe('computeCorrection — tool failures (primary in-session signal)', () => {
  const events = [
    usage(iso(1, 8, 0, 0), 1000, 0.10),
    ev(iso(1, 8, 1, 0), 'Edit', { path_prefix: 'x', ok: false, error_class: 'edit_string_not_found' }),
    ev(iso(1, 8, 2, 0), 'Edit', { path_prefix: 'x', ok: false, error_class: 'edit_string_not_unique' }),
    ev(iso(1, 8, 3, 0), 'Edit', { path_prefix: 'x', ok: true }),
  ];
  const c = computeCorrection(events, PERIOD, null);
  it('counts hallucination-indicative failures, excludes ambiguity (not_unique)', () => {
    expect(c.toolErrorRate).toBeCloseTo(1 / 3, 6); // 1 counted of 3 Edit calls
    expect(c.toolErrorsByClass).toEqual([{ errorClass: 'edit_string_not_found', count: 1 }]);
  });
});

describe('computeCorrection — spiral + refusal signals', () => {
  const events = [
    ev(iso(1, 7, 0, 0), '_correction', { signal: 'spiral_break', confidence: 'high' }),
    ev(iso(1, 7, 1, 0), '_correction', { signal: 'spiral_warn', confidence: 'medium' }),
    ev(iso(1, 7, 2, 0), '_hook_block', { category: 'refusal-unverified', action: 'refused' }),
    ev(iso(1, 7, 3, 0), '_hook_block', { category: 'credential', action: 'blocked' }),
  ];
  const c = computeCorrection(events, PERIOD, null);
  it('counts contained spirals and avoided (count only, no $)', () => {
    expect(c.spiralsContained).toBe(1);
    expect(c.spiralWarnings).toBe(1);
    expect(c.avoidedCount).toBe(2);
    expect(c.refusalCount).toBe(1);
    expect(c.correctionCount).toBe(0); // spiral_* are not prompt corrections
    expect(c.hasData).toBe(true);
  });
});

describe('computeCorrection — normal iteration never counts as correction', () => {
  const events = [
    usage(iso(1, 6, 0, 0), 1000, 0.10),
    clean(iso(1, 6, 1, 0)),
    usage(iso(1, 6, 2, 0), 1000, 0.10),
    clean(iso(1, 6, 3, 0)),
  ];
  const c = computeCorrection(events, PERIOD, null);
  it('reports zero wasted + no data when there are no correction signals', () => {
    expect(c.correctionCount).toBe(0);
    expect(c.wastedTokens).toBe(0);
    expect(c.hasData).toBe(false);
  });
});

describe('computeCorrection — threshold (fact-driven alert)', () => {
  // 5 prior days at ratio 0.1 (100 wasted / 1000), each 1 correction → 5 window
  // events; today at ratio 0.5. baseline median 0.1 × 1.5 = 0.15; 0.5 > 0.15 → breach.
  function day(daysAgo: number, wastedTok: number, cleanTok: number) {
    return [
      usage(iso(daysAgo, 12, 0, 0), cleanTok, 0.10),                 // clean (out of episode)
      correction(iso(daysAgo, 12, 1, 0)),
      usage(iso(daysAgo, 12, 1, 30), wastedTok, 0.05),               // wasted (in episode)
      clean(iso(daysAgo, 12, 3, 0)),                                  // resolve
    ];
  }
  const events = [
    ...day(5, 100, 900), ...day(4, 100, 900), ...day(3, 100, 900),
    ...day(2, 100, 900), ...day(1, 100, 900),
    ...day(0, 500, 500),   // today: ratio 0.5
  ];
  const c = computeCorrection(events, PERIOD, null);
  it('flags the breach day above rolling baseline × multiplier', () => {
    const today = c.perDay[c.perDay.length - 1];
    expect(today.reworkRatio).toBeCloseTo(0.5, 3);
    expect(today.baseline).toBeCloseTo(0.1, 3);
    expect(today.alert).toBe(true);
  });
});

describe('computeCorrection — threshold suppressed below min events', () => {
  // Only 2 prior correction days → window events < min_events_for_baseline (5).
  function day(daysAgo: number, wastedTok: number, cleanTok: number) {
    return [
      usage(iso(daysAgo, 12, 0, 0), cleanTok, 0.10),
      correction(iso(daysAgo, 12, 1, 0)),
      usage(iso(daysAgo, 12, 1, 30), wastedTok, 0.05),
      clean(iso(daysAgo, 12, 3, 0)),
    ];
  }
  const events = [...day(2, 100, 900), ...day(1, 100, 900), ...day(0, 800, 200)];
  const c = computeCorrection(events, PERIOD, null);
  it('does not alert when the rolling window has too few events', () => {
    const today = c.perDay[c.perDay.length - 1];
    expect(today.reworkRatio).toBeGreaterThan(0.5); // high ratio…
    expect(today.alert).toBe(false);                // …but suppressed (only 2 window events)
  });
});

describe('computeCorrection — session ID must match exactly across producers (regression, 2.4.1 audit)', () => {
  // Documents the real bug found in the 2.4.1 pre-ship audit:
  // harness/hooks/stop-usage-capture.py truncated session_id to [:64] while
  // every other producer (telemetry-capture.py, cost-estimate.py,
  // correction-signal.py, ...) truncates to [:32]. Same logical session,
  // two different ID strings in the event stream — episode reconstruction
  // joins on exact session-string equality, so a _correction event and the
  // _actual_usage event it should attribute to silently land in different
  // buckets whenever the producers disagree on truncation length. All prior
  // tests in this file use one consistent session string per fixture, which
  // is exactly why this drift was invisible to the existing suite.
  it('fails to attribute wasted cost when session IDs diverge (documents the pre-fix failure mode)', () => {
    const events = [
      correction(iso(1, 10, 0, 0), { session: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6' }),        // 32-char producer
      usage(iso(1, 10, 0, 30), 2000, 0.20, { session: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6ffff' }), // 36-char producer (pre-fix bug)
    ];
    const c = computeCorrection(events, PERIOD, null);
    // This is the BUG being documented, not the desired behavior: mismatched
    // session strings mean the usage event never joins the open episode.
    expect(c.wastedTokens).toBe(0);
    expect(c.wastedCostUsd).toBe(0);
  });

  it('correctly attributes wasted cost once both producers emit the same truncation (post-fix contract)', () => {
    const sid = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';   // both producers now emit exactly this
    const events = [
      correction(iso(1, 10, 0, 0), { session: sid }),
      usage(iso(1, 10, 0, 30), 2000, 0.20, { session: sid }),
    ];
    const c = computeCorrection(events, PERIOD, null);
    expect(c.wastedTokens).toBe(2000);
    expect(c.wastedCostUsd).toBeCloseTo(0.20, 6);
  });
});

describe('computeCorrection — ADO overlay gating', () => {
  it('marks records ADO-pending when the overlay is null', () => {
    const c = computeCorrection([usage(iso(1), 1000, 0.1)], PERIOD, null);
    expect(c.records.adoPending).toBe(true);
    expect(c.records.prIterations).toBeNull();
  });
  it('reads records from a present overlay', () => {
    const overlay = {
      generated: iso(0),
      periods: { '365': { prCount: 10, reworkIterations: 4, changesRequested: 2, ciFails: 1, byRepo: {} } },
    };
    const c = computeCorrection([usage(iso(1), 1000, 0.1)], PERIOD, overlay);
    expect(c.records.adoPending).toBe(false);
    expect(c.records.prIterations).toBe(4);
    expect(c.records.ciFails).toBe(1);
  });
});
