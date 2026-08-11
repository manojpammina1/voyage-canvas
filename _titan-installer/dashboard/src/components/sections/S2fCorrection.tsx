import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceDot,
} from 'recharts';
import type { CorrectionMetrics } from '../../lib/types';
import { CORRECTION_THRESHOLD } from '../../lib/correction-config';

// S2f — Correction cost ("cost of AI hallucinations"). Presentation discipline:
// EVERYTHING here is a measured FACT (real billed cost_usd, measured idle-capped
// minutes, counts, git/ADO records). There is NO monetary assumption — no hourly
// rate. Avoided cost is shown as a COUNT only: a non-event has no measurable $
// (same discipline as S2dRisk). Self-correction is low-confidence and never in the
// headline or the alert.

const usd = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

const Badge = ({ text, cls }: { text: string; cls: string }) => (
  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-pill ${cls}`}>{text}</span>
);

const Tile = ({ label, value, sub, tip }: { label: string; value: string; sub?: string; tip: string }) => (
  <div className="rounded-card p-4 bg-white ring-1 ring-titan-gray-light text-center cursor-help" title={tip}>
    <div className="text-xs uppercase tracking-wider text-titan-gray-mid">{label}</div>
    <div className="text-2xl font-bold text-titan-gray-dark mt-1">{value}</div>
    {sub && <div className="text-xs text-titan-gray-mid mt-1">{sub}</div>}
    <div className="mt-2"><Badge text="FACT" cls="bg-titan-success/15 text-titan-success" /></div>
  </div>
);

export default function S2fCorrection({ c, view }: { c: CorrectionMetrics; view: 'leadership' | 'operations' }) {
  if (!c.hasData) {
    return (
      <div className="p-4 rounded-card bg-titan-success/10 text-sm text-titan-gray-mid">
        No correction signals this period — no flagged tool failures, corrections, or spirals detected.
        Either clean sailing, or telemetry has only just started capturing.
      </div>
    );
  }

  // Threshold band: measured rework ratio per day vs its own rolling baseline × multiplier.
  const band = c.perDay.map((d) => ({
    date: d.date,
    ratioPct: +(d.reworkRatio * 100).toFixed(2),
    thresholdPct: d.baseline != null ? +(d.baseline * CORRECTION_THRESHOLD.baselineMultiplier * 100).toFixed(2) : null,
    alert: d.alert,
  }));
  const breaches = band.filter((d) => d.alert);

  return (
    <div className="space-y-5">
      {/* Headline facts */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Tile label="Wasted $ (measured)" value={usd(c.wastedCostUsd)}
              sub={`${c.wastedTokens.toLocaleString()} tokens`}
              tip={'Real billed cost_usd of correction turns — the assistant turns spent inside a correction\nepisode (opened by a correction prompt or a failed Edit/Read, closed by a clean prompt).\nThis is money Anthropic actually charged. Not a model.'} />
        <Tile label="Rework ratio" value={pct(c.reworkTokenRatio)}
              sub="of total tokens"
              tip={'Rework token ratio = correction-turn tokens ÷ total tokens this period.\nThe DORA quality counter-metric. Lower is better.'} />
        <Tile label="Tool-error rate" value={pct(c.toolErrorRate)}
              sub="of file/bash calls"
              tip={'Counted tool failures (edit_string_not_found / file_not_found / bash_nonzero) ÷ file+bash\ntool calls. A failed Edit = the AI asserted code that is not in the file — the hardest\nin-session hallucination fingerprint, captured before any commit.'} />
        <Tile label="Corrections" value={c.correctionCount.toLocaleString()}
              sub={`${pct(c.correctionRate)} of AI turns`}
              tip={'Count of correction prompts (explicit flag + follow-up phrase) ÷ assistant turns.\nCounts are exact; classifying a prompt as a correction carries the signal confidence.'} />
        <Tile label="Spirals contained" value={c.spiralsContained.toLocaleString()}
              sub={`${c.spiralWarnings} warnings`}
              tip={'Times the real-time circuit-breaker injected a break directive (5+ consecutive corrections\nor episode cost cap) to stop a hallucination loop. Each is a fact logged to telemetry.'} />
      </div>

      {/* Avoided — COUNT only (no $, a non-event has no measurable cost) */}
      <div className="text-xs text-titan-gray-mid px-1">
        Guardrail + refusal catches this period: <b>{c.avoidedCount}</b> ({c.refusalCount} "I cannot confirm" refusals).
        <span className="cursor-help" title={'Avoided cost is a COUNT, never a dollar: the bad output never happened, so there is no billed\ncost to measure (same discipline as Risk posture). Median time-to-correct is measured and idle-capped.'}>
          {' '}Median time-to-correct: <b>{Math.round(c.medianTimeToCorrectSec / 60)} min</b> (measured). ⓘ
        </span>
      </div>

      {/* Threshold band — fact-driven alert */}
      {band.length > 1 && (
        <div className="bg-white rounded-card ring-1 ring-titan-gray-light p-4">
          <div className="text-sm font-semibold text-titan-gray-dark mb-1 cursor-help"
               title={'Measured rework ratio per day (solid) vs its own rolling baseline × multiplier (dashed).\nA breach (red dot) = the day\'s rework ratio rose above the rolling median × ' +
                      `${CORRECTION_THRESHOLD.baselineMultiplier}. No assumption in the alert — both lines are facts.`}>
            Rework ratio per day vs rolling baseline
            {breaches.length > 0 && <span className="ml-2 text-titan-danger">· {breaches.length} breach day(s)</span>}
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={band} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E8E8E8" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} unit="%" />
              <Tooltip formatter={(v: number, n: string) => [`${v}%`, n]} />
              <Line type="monotone" dataKey="ratioPct" stroke="#1F5FBF" strokeWidth={2} dot={false} name="rework ratio" />
              <Line type="monotone" dataKey="thresholdPct" stroke="#D62828" strokeWidth={1.5} strokeDasharray="4 3" dot={false} name="alert threshold" connectNulls />
              {breaches.map((d) => (
                <ReferenceDot key={d.date} x={d.date} y={d.ratioPct} r={4} fill="#D62828" stroke="none" />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Operations detail */}
      {view === 'operations' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Tool failures by class */}
          <div className="bg-white rounded-card ring-1 ring-titan-gray-light p-4">
            <div className="text-sm font-semibold text-titan-gray-dark mb-2">Tool failures by type (in-session)</div>
            {c.toolErrorsByClass.length ? (
              <table className="w-full text-xs">
                <tbody>
                  {c.toolErrorsByClass.map((t) => (
                    <tr key={t.errorClass} className="border-b border-titan-gray-light/60 last:border-0">
                      <td className="py-1 font-mono text-titan-gray-dark">{t.errorClass}</td>
                      <td className="py-1 text-right font-semibold">{t.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <div className="text-xs text-titan-gray-mid">None this period.</div>}
          </div>

          {/* Corrections by signal */}
          <div className="bg-white rounded-card ring-1 ring-titan-gray-light p-4">
            <div className="text-sm font-semibold text-titan-gray-dark mb-2">Corrections by signal</div>
            <table className="w-full text-xs">
              <tbody>
                {c.correctionsBySignal.map((s) => (
                  <tr key={s.signal} className="border-b border-titan-gray-light/60 last:border-0">
                    <td className="py-1 text-titan-gray-dark">
                      {s.signal}
                      {s.signal === 'self_correction' && <span className="text-titan-gray-mid"> (low confidence)</span>}
                    </td>
                    <td className="py-1 text-right font-semibold">{s.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Correction rate by model */}
          <div className="bg-white rounded-card ring-1 ring-titan-gray-light p-4">
            <div className="text-sm font-semibold text-titan-gray-dark mb-2 cursor-help"
                 title={'Corrections attributed to the model that produced the flagged answer, per 100 assistant turns.\nActionable: is a cheaper model being corrected more often?'}>
              Correction rate by model <span className="text-titan-gray-mid font-normal">(per 100 turns)</span>
            </div>
            {c.byModel.length ? (
              <table className="w-full text-xs">
                <tbody>
                  {c.byModel.map((m) => (
                    <tr key={m.model} className="border-b border-titan-gray-light/60 last:border-0">
                      <td className="py-1 text-titan-gray-dark">{m.model}</td>
                      <td className="py-1 text-right text-titan-gray-mid">{m.corrections}/{m.assistantTurns}</td>
                      <td className="py-1 text-right font-semibold">{m.ratePer100.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <div className="text-xs text-titan-gray-mid">No usage data.</div>}
          </div>

          {/* Downstream records (Layer B) */}
          <div className="bg-white rounded-card ring-1 ring-titan-gray-light p-4">
            <div className="text-sm font-semibold text-titan-gray-dark mb-2">Downstream records (slipped to a PR)</div>
            {c.records.adoPending ? (
              <div className="text-xs text-titan-gray-mid">
                ADO pending — run <code>scripts/build-correction-stats.mjs</code> with a valid PAT
                (rotation tracked in SLING-PHASE2). Git-local reverts: follow-up.
              </div>
            ) : (
              <table className="w-full text-xs">
                <tbody>
                  <tr className="border-b border-titan-gray-light/60"><td className="py-1">PR rework iterations</td><td className="py-1 text-right font-semibold">{c.records.prIterations ?? '—'}</td></tr>
                  <tr className="border-b border-titan-gray-light/60"><td className="py-1">Changes-requested votes</td><td className="py-1 text-right font-semibold">{c.records.changesRequested ?? '—'}</td></tr>
                  <tr className="border-b border-titan-gray-light/60"><td className="py-1">CI failures</td><td className="py-1 text-right font-semibold">{c.records.ciFails ?? '—'}</td></tr>
                  <tr><td className="py-1">Git reverts</td><td className="py-1 text-right font-semibold">{c.records.revertCount ?? '—'}</td></tr>
                </tbody>
              </table>
            )}
          </div>

          {/* Per-dev alerts */}
          {c.perDevAlerts.length > 0 && (
            <div className="bg-white rounded-card ring-1 ring-titan-gray-light p-4 md:col-span-2">
              <div className="text-sm font-semibold text-titan-gray-dark mb-2">Per-developer (anonymous hash)</div>
              <table className="w-full text-xs">
                <thead><tr className="text-titan-gray-mid text-left"><th className="py-1">User</th><th>Corrections</th><th>Wasted $</th><th>Rework ratio</th><th></th></tr></thead>
                <tbody>
                  {c.perDevAlerts.map((u) => (
                    <tr key={u.hash} className="border-b border-titan-gray-light/60 last:border-0">
                      <td className="py-1 font-mono">{u.hash.slice(0, 8)}</td>
                      <td>{u.corrections}</td>
                      <td>{usd(u.wastedUsd)}</td>
                      <td>{pct(u.reworkRatio)}</td>
                      <td className="text-right">{u.alert && <Badge text="ABOVE COHORT" cls="bg-titan-danger/15 text-titan-danger" />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Persistent caveat */}
      <div className="text-xs text-titan-gray-mid px-1">
        $ and time are measured (real billed <code>cost_usd</code>, idle-capped timestamps). Git undercounts
        hallucinations caught in-session — tool failures capture those. Classifying a turn as a correction
        carries the signal's confidence; ADO record counts require a valid PAT. No monetary assumption anywhere.
      </div>
    </div>
  );
}
