import { useEffect, useRef, useState } from 'react';
import { useWizard } from '../store/wizard-state';
import type { InstallEvent } from '../global';
import Button from '../components/Button';

// Phase name → [startPct, endPct]. Native setup uses 5 phases — keep mapping
// in sync with electron/main.ts emit('phase', ...) calls. Phase 5 ("Complete")
// jumps the bar to 100%.
const PHASE_MAP: { match: RegExp; label: string; start: number; end: number }[] = [
  { match: /Phase 1/i, label: 'Checking prerequisites',  start:   0, end:  20 },
  { match: /Phase 2/i, label: 'Writing settings',         start:  20, end:  40 },
  { match: /Phase 3/i, label: 'Deploying framework',      start:  40, end:  75 },
  { match: /Phase 4/i, label: 'Verifying setup',          start:  75, end:  95 },
  { match: /Phase 5/i, label: 'Complete',                 start:  95, end: 100 },
];

function findPhase(msg: string) {
  return PHASE_MAP.find((p) => p.match.test(msg));
}

export default function InstallProgress(): JSX.Element {
  const role          = useWizard((s) => s.role);
  const workspacePath = useWizard((s) => s.workspacePath);
  const adoPatValue   = useWizard((s) => s.adoPatValue);   // direct from state — no keytar
  const jiraEmail        = useWizard((s) => s.jiraEmail);     // optional REST/health-check token — Rovo connector uses OAuth, not this
  const jiraToken        = useWizard((s) => s.jiraToken);
  const telemetrySasUrl  = useWizard((s) => s.telemetrySasUrl);
  const displayName      = useWizard((s) => s.displayName);   // optional — local roster-entry.json only
  const setScreen     = useWizard((s) => s.setScreen);
  const nextScreen    = useWizard((s) => s.nextScreen);
  const markInstallComplete = useWizard((s) => s.markInstallComplete);

  const [label, setLabel]         = useState('Starting up');
  const [pct, setPct]             = useState(0);
  const [phaseRange, setRange]    = useState([0, 15]);
  const [, setSteps]  = useState(0);
  const [log, setLog]             = useState<(InstallEvent & { ts: string })[]>([]);
  const [logOpen, setLogOpen]     = useState(false);
  const [stuckAfter6s, setStuck]  = useState(false);
  const [finished, setFinished]   = useState(false);
  const [ok, setOk]               = useState<boolean | null>(null);
  const [errMsg, setErrMsg]       = useState<string | null>(null);

  const startedRef   = useRef(false);
  const offRef       = useRef<(() => void) | null>(null);
  const logBottomRef = useRef<HTMLDivElement | null>(null);
  const eventCount   = useRef(0);

  // Auto-scroll log
  useEffect(() => {
    if (logOpen) logBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [log.length, logOpen]);

  // Stuck detector — fires once after 6 s if 0 events received
  useEffect(() => {
    const id = setTimeout(() => {
      if (eventCount.current === 0 && !finished) {
        setStuck(true);
        setLogOpen(true);
      }
    }, 6000);
    return () => clearTimeout(id);
  }, [finished]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    offRef.current = window.api.installer.onEvent((evt) => {
      const ts = new Date().toLocaleTimeString();
      eventCount.current += 1;
      setStuck(false);

      if (evt.phase === 'phase') {
        const found = findPhase(evt.message);
        if (found) {
          setLabel(found.label);
          setRange([found.start, found.end]);
          setSteps(0);
          setPct(found.start);
        }
      } else if (['step', 'raw', 'start', 'stderr'].includes(evt.phase)) {
        setSteps((n) => {
          const next = n + 1;
          setRange(([s, e]) => {
            const filled = Math.min(e - 1, Math.round(s + (next / 6) * (e - s)));
            setPct(filled);
            return [s, e];
          });
          return next;
        });
      }

      setLog((l) => {
        const entry = { ...evt, ts };
        return l.length >= 200 ? [...l.slice(-199), entry] : [...l, entry];
      });
    });

    // Use the native Node.js setup (no Python subprocess, no keytar dependency).
    // Passes credentials directly from wizard state — no keytar read needed.
    void window.api.setup
      .runNative({ role: role ?? 'developer', workspacePath, adoPat: adoPatValue, jiraEmail, jiraToken, telemetrySasUrl, displayName })
      .then((result) => {
        setFinished(true);
        setOk(result.ok);
        setPct(result.ok ? 100 : pct);
        setLabel(result.ok ? 'Titan is ready' : 'Install failed');
        if (!result.ok) {
          setErrMsg(result.message ?? 'install.py exited with an error — see the log.');
          setLogOpen(true);
        }
        if (result.ok) markInstallComplete();
      })
      .catch((err: unknown) => {
        setFinished(true);
        setOk(false);
        setErrMsg(`IPC error: ${(err as Error).message}. Restart the installer and try again.`);
        setLogOpen(true);
      });

    return () => { offRef.current?.(); offRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const advance = (): void => setScreen(nextScreen());

  const logHasErrors = log.some((e) => e.level === 'error');

  return (
    <div className="max-w-2xl mx-auto text-center">
      {/* Animated phase indicator above title */}
      <div className="flex justify-center mb-4">
        {!finished && (
          <div className="flex items-end gap-2 h-10">
            <span className="w-3 h-3 rounded-full bg-titan-blue-main animate-dot-pulse" />
            <span className="w-3 h-3 rounded-full bg-titan-blue-main animate-dot-pulse-d1" />
            <span className="w-3 h-3 rounded-full bg-titan-blue-main animate-dot-pulse-d2" />
          </div>
        )}
        {finished && ok && (
          <div className="w-10 h-10 rounded-pill bg-titan-success/15 flex items-center justify-center">
            <svg viewBox="0 0 24 24" className="w-6 h-6 text-titan-success animate-check-pop" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 13l4 4L19 7" />
            </svg>
          </div>
        )}
        {finished && !ok && (
          <div className="w-10 h-10 rounded-pill bg-titan-danger/15 flex items-center justify-center">
            <svg viewBox="0 0 24 24" className="w-6 h-6 text-titan-danger" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
              <path d="M6 6l12 12 M18 6l-12 12" />
            </svg>
          </div>
        )}
      </div>

      <h1 className="text-3xl font-bold text-titan-gray-dark mb-3 tracking-tight">
        {finished ? (ok ? 'All set!' : 'Something went wrong') : 'Setting up Titan'}
      </h1>
      <p className="text-base text-titan-gray-mid mb-8">
        {finished
          ? (ok ? 'Titan is configured for your role.' : (errMsg ?? 'See the log below.'))
          : 'This usually takes under two minutes.'}
      </p>

      {/* ── Progress card ─────────────────────────────────────────── */}
      {/* Defensive: once finished+ok, force 100 + final label regardless of any
          stale phase event that arrived after the runNative promise resolved. */}
      <div className="bg-titan-white rounded-card shadow-card p-8 mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-base font-medium text-titan-gray-dark">
            {finished && ok ? 'Titan is ready' : label}{!finished ? '…' : ''}
          </span>
          <span className={`text-sm font-bold tabular-nums ${
            finished && !ok ? 'text-titan-danger' : 'text-titan-blue-main'
          }`}>
            {finished && ok ? 100 : pct}%
          </span>
        </div>

        <div className="w-full h-4 bg-titan-gray-light rounded-pill overflow-hidden mb-3">
          <div
            className={`h-full rounded-pill transition-all duration-500 ${
              finished && !ok ? 'bg-titan-danger' : 'bg-titan-blue-main'
            }`}
            style={{ width: `${finished && ok ? 100 : pct}%` }}
          />
        </div>

        <div className="text-xs text-titan-gray-mid">
          {finished
            ? (ok ? 'Complete' : 'Failed')
            : `${log.length} events  ·  phases ${phaseRange[0]}–${phaseRange[1]}%`}
        </div>
      </div>

      {/* ── Stuck warning ─────────────────────────────────────────── */}
      {stuckAfter6s && !finished && (
        <div className="bg-titan-warning/10 border border-titan-warning rounded-card p-4 mb-4 text-left text-sm">
          <p className="font-semibold text-titan-gray-dark mb-2">⚠ No progress after 6 seconds</p>
          <p className="text-titan-gray-mid mb-2">Common causes:</p>
          <ul className="list-disc list-inside text-titan-gray-mid space-y-1">
            <li>
              Python not on PATH — open a terminal and run{' '}
              <code className="bg-titan-gray-light px-1 rounded text-xs">python --version</code>
            </li>
            <li>
              <code className="bg-titan-gray-light px-1 rounded text-xs">install.py</code> not found in{' '}
              <code className="bg-titan-gray-light px-1 rounded text-xs">{workspacePath}</code>
            </li>
            <li>Keytar native module not loading — check the log below for a stderr message</li>
          </ul>
        </div>
      )}

      {/* ── Live log ──────────────────────────────────────────────── */}
      <div className="bg-titan-white rounded-card shadow-card mb-6 text-left overflow-hidden">
        <button
          className="w-full px-4 py-3 flex items-center justify-between text-sm font-medium text-titan-gray-dark hover:bg-titan-gray-bg transition-colors"
          onClick={() => setLogOpen((v) => !v)}
        >
          <span>
            {logOpen ? '▾' : '▸'} Install log
            <span className={`ml-2 px-2 py-0.5 rounded-pill text-xs font-bold ${
              logHasErrors ? 'bg-titan-danger/15 text-titan-danger'
                : log.length > 0 ? 'bg-titan-blue-soft text-titan-blue-main'
                : 'bg-titan-gray-light text-titan-gray-mid'
            }`}>
              {log.length} events
            </span>
          </span>
          <span className="text-xs text-titan-gray-mid">
            {log.length > 0 ? `Last: ${log[log.length - 1].ts}` : 'waiting…'}
          </span>
        </button>

        {logOpen && (
          <div className="border-t border-titan-gray-light max-h-72 overflow-y-auto px-4 py-3 text-xs font-mono leading-5">
            {log.length === 0 ? (
              <p className="text-titan-gray-mid italic">
                No events yet. If Python is not installed, run: <strong>winget install Python.Python.3</strong>
              </p>
            ) : log.map((e, i) => (
              <div key={i} className={`flex gap-2 ${
                e.level === 'error' ? 'text-titan-danger font-medium'
                  : e.level === 'warn' || e.phase === 'stderr' ? 'text-titan-warning'
                  : 'text-titan-gray-mid'
              }`}>
                <span className="shrink-0 text-titan-gray-light">{e.ts}</span>
                <span className="shrink-0 text-titan-gray-light">[{e.phase}]</span>
                <span className="break-all">{e.message}</span>
              </div>
            ))}
            <div ref={logBottomRef} />
          </div>
        )}
      </div>

      {finished && ok && (
        <Button size="lg" onClick={advance}>Show me what&apos;s next</Button>
      )}
      {finished && !ok && (
        <div className="flex justify-center gap-3">
          <Button size="lg" variant="secondary" onClick={() => setScreen(nextScreen())}>
            Skip and continue
          </Button>
          <Button size="lg" onClick={() => {
            startedRef.current = false;
            window.location.reload();
          }}>
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}
