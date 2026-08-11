import type { SavingsMetrics } from '../../lib/types';

// Basis badges — every savings line declares how it's derived so any number
// can be explained on the spot. No inflation: facts are billed reality,
// assumptions state their baseline, estimates are labeled estimates.
const BASIS: Record<SavingsMetrics['bySource'][number]['basis'], { label: string; cls: string; note: string }> = {
  fact:       { label: 'FACT',       cls: 'bg-titan-success/15 text-titan-success', note: 'Billed reality — Anthropic charges cache-read tokens below the input rate.' },
  assumption: { label: 'ASSUMPTION', cls: 'bg-titan-warning/15 text-titan-warning', note: 'Exact tokens priced against an all-Opus baseline (the counterfactual).' },
  estimate:   { label: 'ESTIMATE',   cls: 'bg-titan-gray-light text-titan-gray-mid', note: 'Heuristic — Q&A deflected to Copilot at an assumed avg prompt cost.' },
};

// Exact methodology per source — shown on hover so the panel stays clean while
// every figure remains fully explainable. This is transparency, not fine print:
// the basis badge above is always visible; the hover just carries the math.
const FORMULA: Record<string, string> = {
  'Prompt caching':
    'FORMULA: Σ per call  cache_read_tokens × (input_rate − cache_read_rate) ÷ 1M.\n' +
    'Anthropic bills cache-reads at ~10% of input (Opus 15→1.5; Sonnet 3→0.30).\n' +
    'PLATFORM tier: an Anthropic feature Claude Code uses automatically — no Titan code\n' +
    'or decision produces this. Shown for total-cost context only; excluded from the\n' +
    'harness-attributable headline above, because "did the harness do this?" is No.',
  'Model routing (vs all-Opus)':
    'FORMULA: Σ per call  max(0, cost_if_Opus − actual_cost).\n' +
    'Baseline assumption: "if every call ran on Opus." Opus calls → $0; Sonnet/Haiku → the gap.\n' +
    'HARNESS tier: requires the harness model-routing policy (CLAUDE.md + skill sub-agent model params).\n' +
    'A more conservative baseline (vs next tier down) yields a smaller figure.',
  'Copilot deflection':
    'FORMULA: copilot_redirects × avg_prompt_cost × 0.30.  Heuristic — labeled estimate.\n' +
    'HARNESS tier: requires the harness Copilot-redirect policy + /common/copilot skill.',
  'Deterministic answer cache':
    'FORMULA: Σ _cache_hit avoided_cost_usd (each hit = rolling 30-day avg cost per exact prompt).\n' +
    'The HIT COUNT is exact (a fact); only the $ per hit is estimated.\n' +
    'HARNESS tier: ?build / ?reviewers / ?ki prompts are answered locally by a hook —\n' +
    'the model is never called, so those prompts cost zero tokens. harness-built, v2.3.',
  'Output compression (caveman)':
    'FORMULA: Σ output_tokens (caveman-active roles) × output_rate × 0.39 ÷ (1 − 0.39).\n' +
    'Observed output is assumed post-compression; 0.39 = measured multi-turn SESSION saving\n' +
    '(Better Stack caveman benchmark, Apr 2026, 10-prompt sample) — deliberately NOT the ~75%\n' +
    'per-prompt claim; single queries can be net-negative from skill-load overhead.\n' +
    'HARNESS tier: requires the caveman skill + per-role auto-engage policy.\n' +
    'Pending internal A/B. Finance sign-off required before external use.',
  'Input compression (crush)':
    'FORMULA: Σ (orig_bytes − crushed_bytes) ÷ 4 × input_rate ÷ 1M.\n' +
    'The tool-output-crush hook (v2.4) rewrites large Bash/Grep/MCP results before they enter\n' +
    'the model context: JSON arrays sampled + values elided (vendored Headroom slice), logs head/tail.\n' +
    'Events, bytes elided, and compression % are EXACT (from _crush telemetry — see the FACT strip\n' +
    'below "Built by Titan"); only this $ line is estimated: bytes÷4 ≈ tokens (chars-per-token\n' +
    'heuristic), priced at the default input rate. Deliberately conservative — no Opus counterfactual,\n' +
    'no cache-write credit. Pending internal A/B, like the caveman factor above.\n' +
    'HARNESS tier: harness-built hook. Full outputs stay retrievable via Read from .claude/tool-output-cache/.',
};

const usd = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function S2bSavings({ s }: { s: SavingsMetrics }) {
  if (!s.hasActualData) {
    return (
      <div className="p-4 rounded-card bg-titan-warning/10 text-sm text-titan-gray-mid">
        ⚠ Savings need exact token data. The Stop hook must be capturing <code>_actual_usage</code> events —
        once a session runs with it, cache and routing savings compute automatically.
      </div>
    );
  }

  const harnessRows   = s.bySource.filter((r) => r.tier === 'harness');
  const platformRows  = s.bySource.filter((r) => r.tier === 'platform');

  const Row = ({ row, denomUsd }: { row: SavingsMetrics['bySource'][number]; denomUsd: number }) => {
    const b = BASIS[row.basis];
    const pct = denomUsd > 0 ? (row.usd / denomUsd) * 100 : 0;
    const tip = `${b.note}\n\n${FORMULA[row.source] ?? ''}`;
    return (
      <div key={row.source} className="flex items-center gap-3 px-4 py-3" title={tip}>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-pill ${b.cls}`} title={tip}>{b.label}</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-titan-gray-dark flex items-center gap-1">
            {row.source}
            <span className="text-titan-gray-mid cursor-help" title={tip}>ⓘ</span>
          </div>
          <div className="text-xs text-titan-gray-mid truncate" title={tip}>{row.detail ?? b.note}</div>
        </div>
        <div className="w-28 h-2 bg-titan-gray-light rounded-pill overflow-hidden hidden sm:block">
          <div className="h-full bg-titan-success" style={{ width: `${pct}%` }} />
        </div>
        <div className="text-right w-24">
          <div className="text-sm font-bold text-titan-success">{usd(row.usd)}</div>
          <div className="text-[10px] text-titan-gray-mid">{pct.toFixed(0)}% of tier</div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Hero row — HARNESS-ATTRIBUTABLE is the headline. Platform-inherent
          (Anthropic prompt caching) is deliberately NOT blended in here —
          it required no Titan work, so it isn't "what the harness did." */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-card p-5 bg-titan-success/10 ring-1 ring-titan-success text-center cursor-help"
             title={'Harness-attributable savings = model routing + answer-cache + caveman + Copilot deflection.\nEach required a Titan decision or a Titan-built hook/skill — that is the bar for inclusion here.\nAnthropic prompt caching is deliberately excluded (see the Platform baseline row below) because it\nrequires zero Titan code and fires automatically for any Claude Code user.\nAnthropic list pricing (June 2026) — your org's contract rates may be lower.'}>
          <div className="text-xs uppercase tracking-wider text-titan-gray-mid">Harness-attributable savings</div>
          <div className="text-4xl font-bold text-titan-success mt-1">{usd(s.harnessAttributableUsd)}</div>
          <div className="text-xs text-titan-gray-mid mt-1">what Titan built — hover for basis</div>
        </div>
        <div className="rounded-card p-5 bg-titan-blue-soft/40 text-center cursor-help"
             title={'Harness discount = harness-attributable savings ÷ (harness-attributable savings + exact spend).\nDeliberately excludes the Anthropic platform-caching line — this is the defensible number for leadership.'}>
          <div className="text-xs uppercase tracking-wider text-titan-gray-mid">Harness discount</div>
          <div className="text-4xl font-bold text-titan-blue-main mt-1">{s.harnessDiscountPct.toFixed(0)}%</div>
          <div className="text-xs text-titan-gray-mid mt-1">harness savings ÷ (harness savings + spend)</div>
        </div>
        <div className="rounded-card p-5 bg-titan-gray-light text-center cursor-help"
             title={'Exact spend = sum of per-call cost_usd from Claude Code API usage (input + output + cache tokens × list rates). Not an estimate.'}>
          <div className="text-xs uppercase tracking-wider text-titan-gray-mid">Exact spend (period)</div>
          <div className="text-4xl font-bold text-titan-gray-dark mt-1">{usd(s.actualSpendUsd)}</div>
          <div className="text-xs text-titan-gray-mid mt-1">from Claude Code API usage</div>
        </div>
      </div>

      {/* Harness-attributable breakdown */}
      <div>
        <div className="text-sm font-semibold text-titan-gray-dark mb-2">Built by Titan</div>
        <div className="bg-white rounded-card ring-1 ring-titan-gray-light divide-y divide-titan-gray-light">
          {harnessRows.map((row) => <Row key={row.source} row={row} denomUsd={s.harnessAttributableUsd} />)}
        </div>
      </div>

      {/* Input compression (crush) — the RAW measured facts behind the $ row
          above (bytes/events/% straight from _crush telemetry, never adjusted).
          The $ conversion of these same bytes is the "Input compression
          (crush)" line in the Built-by-Titan list above — this strip is
          the fact basis that $ estimate is built on, kept visible and separate
          so the underlying measurement is never obscured by the dollar figure. */}
      {s.crushHits > 0 && (
        <div className="flex items-center gap-3 p-4 rounded-card bg-white ring-1 ring-titan-gray-light cursor-help"
             title={'tool-output-crush hook (v2.4): large Bash/Grep/MCP results are compressed before entering the\nmodel context (JSON arrays sampled + long values elided, logs head/tail). Full outputs stay\nretrievable via Read from .claude/tool-output-cache/.\n\nEvery figure here is measured directly by the hook per event (exact orig/crushed byte counts\nfrom _crush telemetry) — this is the fact basis for the "Input compression (crush)" $ estimate\nlisted above; see that row for the $ formula.'}>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-pill bg-titan-success/15 text-titan-success">FACT</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-titan-gray-dark flex items-center gap-1">
              Input compression (crush) — raw measurement
              <span className="text-titan-gray-mid cursor-help">ⓘ</span>
            </div>
            <div className="text-xs text-titan-gray-mid">
              exact bytes/events/% this $ estimate above is built from — never adjusted
            </div>
          </div>
          <div className="text-right">
            <div className="text-sm font-bold text-titan-gray-dark">
              {s.crushHits} event{s.crushHits === 1 ? '' : 's'} · {(s.crushSavedBytes / 1024).toFixed(0)} KB elided · {s.crushSavedPct.toFixed(0)}% avg
            </div>
            <div className="text-[10px] text-titan-gray-mid">all measured — of {(s.crushOrigBytes / 1024).toFixed(0)} KB intercepted</div>
          </div>
        </div>
      )}

      {/* Platform baseline — separated, not summed into "what we did" */}
      <div>
        <div className="text-sm font-semibold text-titan-gray-dark mb-2 flex items-center gap-2">
          Platform baseline
          <span className="text-[10px] font-normal text-titan-gray-mid">(Anthropic — not built by Titan; shown for cost context only)</span>
        </div>
        <div className="bg-white rounded-card ring-1 ring-titan-gray-light divide-y divide-titan-gray-light opacity-90">
          {platformRows.map((row) => <Row key={row.source} row={row} denomUsd={s.platformInherentUsd} />)}
        </div>
      </div>

      {/* Annualized projection — harness-only, clearly labeled, not banked */}
      <div className="flex items-center justify-between p-4 rounded-card bg-titan-blue-soft/20">
        <div>
          <div className="text-sm font-semibold text-titan-gray-dark">
            Harness savings run-rate
            <span className="ml-2 text-[10px] font-bold px-2 py-0.5 rounded-pill bg-titan-warning/15 text-titan-warning">PROJECTION</span>
          </div>
          <div className="text-xs text-titan-gray-mid mt-0.5">
            Current harness-attributable run-rate extrapolated to 12 months — not a booked figure.
            All-in (incl. Anthropic platform caching): {usd(s.annualizedSavingsUsd)}/yr.
          </div>
        </div>
        <div className="text-2xl font-bold text-titan-blue-main">{usd(s.harnessAnnualizedUsd)}/yr</div>
      </div>

      {/* What these are + how they're derived — so it's defensible in the room */}
      <details className="text-xs text-titan-gray-mid">
        <summary className="cursor-pointer font-medium text-titan-gray-dark">What these are &amp; how they're calculated</summary>

        <div className="mt-3 font-semibold text-titan-gray-dark">Why two tiers</div>
        <p className="mt-1">
          The test for "harness-attributable" is simple: <b>did a Titan decision or a Titan-built
          hook/skill have to exist for this dollar to be saved?</b> Model routing, the answer-cache, caveman
          compression, and Copilot deflection all pass — each needed a harness policy or harness-built code. Anthropic's
          prompt-caching discount does not: it fires automatically the moment anyone uses Claude Code with
          repeated context, with zero Titan involvement. Blending it into "what the harness did" doesn't
          survive the first "did the harness do this?" question in the room — so it's reported separately, as
          context for total cost, not as credit.
        </p>

        <div className="mt-3 font-semibold text-titan-gray-dark">What each harness-tier lever is</div>
        <ul className="mt-1 space-y-1 list-disc pl-5">
          <li><b>Model routing:</b> a harness policy — send each task to the cheapest capable model (Haiku for lookups, Sonnet for code, Opus only for hard reasoning) instead of defaulting everything to Opus.</li>
          <li><b>Deterministic answer cache (v2.3):</b> harness-built — <code>?build</code> / <code>?reviewers</code> / <code>?ki</code> prompts are answered locally by a hook from governed lookup tables; the model is never called. Hit counts are exact; the $ value per hit is an estimate.</li>
          <li><b>Output compression (caveman, v2.3):</b> harness policy — role skills auto-engage the caveman skill, which strips narrative filler from responses. Modeled at session level with the measured 0.39 factor, not the ~75% per-prompt claim.</li>
          <li><b>Input compression (crush, v2.4):</b> harness-built hook — large Bash/Grep/MCP tool outputs are compressed before entering the model context (JSON arrays sampled, long values elided, logs head/tail). Events, bytes elided, and compression % are exact (shown separately as the raw-measurement fact strip); the $ value applies bytes÷4 × input rate to those exact bytes — a documented, conservative formula, not a vendor claim, pending internal A/B like caveman. Full outputs remain retrievable on demand.</li>
          <li><b>Copilot deflection:</b> a harness policy — route general Q&amp;A to Microsoft Copilot (free) instead of Claude, so those calls never hit the Claude API.</li>
        </ul>

        <div className="mt-3 font-semibold text-titan-gray-dark">Platform-tier lever (context only)</div>
        <ul className="mt-1 space-y-1 list-disc pl-5">
          <li><b>Prompt caching:</b> an <i>Anthropic</i> feature (not harness-built) that Claude Code uses automatically. Reused context (system prompt, tools, conversation history) is read from Anthropic's cache at ~10% of the input rate instead of full price. Long sessions re-read the context each turn, so the discount compounds. Real avoided spend — just not something Titan produced.</li>
        </ul>

        <div className="mt-3 font-semibold text-titan-gray-dark">How each number is derived</div>
        <ul className="mt-1 space-y-1 list-disc pl-5">
          <li><b>Prompt caching (fact):</b> Σ cache-read tokens × (input rate − cache-read rate), per model.</li>
          <li><b>Model routing (assumption):</b> the exact tokens for each call, repriced on Opus, minus what was actually paid. Baseline = "if everything ran on Opus." A next-tier baseline yields a smaller figure.</li>
          <li><b>Copilot deflection (estimate):</b> Copilot redirects × avg prompt cost × 0.30.</li>
          <li><b>Harness discount:</b> harness-attributable savings ÷ (harness-attributable savings + exact spend) — excludes platform caching.</li>
          <li><b>All-in discount:</b> (harness + platform) savings ÷ (that total + exact spend) — kept for reference, not the headline.</li>
          <li><b>Annualized:</b> a projection — current run-rate × 365. Not a booked figure.</li>
          <li>All figures use Anthropic list pricing (June 2026). your org's contract rates may be lower — confirm with Finance. Savings compute only for days with exact token data.</li>
        </ul>
      </details>
    </div>
  );
}
