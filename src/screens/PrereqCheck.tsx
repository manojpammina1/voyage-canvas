import { useEffect, useState } from 'react';
import Button from '../components/Button';
import { useWizard } from '../store/wizard-state';
import type { PrereqCheckEntry } from '../global';

// Screen — prereq detection + one-click install via winget (Win10+) / npm.
// Non-tech users get an Install button per missing tool; advanced users
// can click "Show instructions" to do it manually.

const FRIENDLY: Record<string, {
  label: string;
  install: string;       // download URL fallback
  manualSteps: string[]; // step-by-step copy
}> = {
  node: {
    label: 'Node.js 18+ (20 LTS recommended)',
    install: 'https://nodejs.org/en/download',
    manualSteps: [
      'Node 18 or newer is REQUIRED — MCP servers and build tools break on older Node (e.g. 16).',
      'WITH admin rights: download the LTS Windows Installer (.msi) from nodejs.org, run it, accept defaults.',
      'WITHOUT admin rights (no write to Program Files):',
      '  • Option A — fnm (per-user): run  winget install Schniz.fnm  then  fnm install 20  then  fnm use 20',
      '  • Option B — portable: download the Node Windows .zip, unzip into your user profile, add that folder to your USER Path',
      '  • Option C — ask IT to install Node 20 LTS',
      'Restart this Titan installer when finished',
    ],
  },
  java: {
    label: 'Java (OpenJDK 17)',
    install: 'https://adoptium.net/temurin/releases/?version=17',
    manualSteps: [
      'Open https://adoptium.net/temurin/releases/?version=17',
      'Pick Windows · x64 · JDK · .msi',
      'Run the .msi, tick "Set JAVA_HOME variable" + "Add to PATH"',
      'Restart this Titan installer when finished',
    ],
  },
  python: {
    label: 'Python 3.12+',
    install: 'https://www.python.org/downloads/',
    manualSteps: [
      'Open https://www.python.org/downloads/',
      'Download "Latest Python 3 Release" Windows installer (64-bit)',
      'IMPORTANT: tick "Add python.exe to PATH" on the first install page',
      'Click Install Now, accept defaults',
      'Restart this Titan installer when finished',
    ],
  },
  git: {
    label: 'Git',
    install: 'https://git-scm.com/download/win',
    manualSteps: [
      'Open https://git-scm.com/download/win',
      'Download starts automatically (64-bit installer)',
      'Accept all defaults during install (do NOT change "Use Git from the Windows Command Prompt")',
      'Restart this Titan installer when finished',
    ],
  },
  claude: {
    label: 'Claude Code',
    install: 'https://docs.claude.com/en/docs/claude-code/quickstart',
    manualSteps: [
      'Install Node.js first if not already done',
      'Open Windows Terminal or PowerShell',
      'Run: npm install -g @anthropic-ai/claude-code',
      'Verify with: claude --version',
      'Restart this Titan installer when finished',
    ],
  },
};

// Node must be >= 18 (MCP servers + Vite/electron-builder need it). Detecting
// "a node" isn't enough — an old default (e.g. 16) silently breaks the harness.
const MIN_NODE_MAJOR = 18;

function nodeMajor(version: string): number {
  const m = version.match(/v?(\d+)\./);
  return m ? parseInt(m[1], 10) : 0;
}

// Satisfied = detected AND (for node) meets the minimum major version.
function isSatisfied(p: PrereqCheckEntry): boolean {
  if (!p.detected) return false;
  if (p.name === 'node') return nodeMajor(p.version) >= MIN_NODE_MAJOR;
  return true;
}

export default function PrereqCheck(): JSX.Element {
  const role = useWizard((s) => s.role);
  const setScreen = useWizard((s) => s.setScreen);
  const nextScreen = useWizard((s) => s.nextScreen);
  // QA never needs Java (no AEM/Maven build) — main.ts drops it from the
  // detect list when role === 'qa'. Default check count for the loading
  // banner mirrors that (4 vs 5).
  const defaultCheckCount = role === 'qa' ? 4 : 5;

  const [checks, setChecks] = useState<PrereqCheckEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [wingetAvailable, setWingetAvailable] = useState(true);
  const [installing, setInstalling] = useState<Record<string, boolean>>({});
  const [installLog, setInstallLog] = useState<Record<string, string>>({});
  const [installResult, setInstallResult] = useState<Record<string, { ok: boolean; needsRestart: boolean; message: string } | null>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Live detect-progress log — populated from REAL 'result' events as each
  // tool's child_process spawn actually resolves (electron/main.ts), not a
  // simulated/staggered reveal. Drives the highlighted "please wait" card
  // below so the user sees genuine progress instead of one static line.
  const [detectLog, setDetectLog] = useState<string[]>([]);
  const [detectTotal, setDetectTotal] = useState(0);

  const runDetect = (): void => {
    setLoading(true);
    setDetectLog([]);
    void window.api.prereqs.detect(role ?? undefined).then((r) => {
      if (r.ok && r.data) setChecks(r.data.checks);
      setLoading(false);
    });
  };

  useEffect(() => {
    runDetect();
    void window.api.prereqs.wingetAvailable().then((r) => setWingetAvailable(r.available));
    const offInstall = window.api.prereqs.onInstallEvent(({ name, line }) => {
      setInstallLog((prev) => ({ ...prev, [name]: (prev[name] ?? '') + line }));
    });
    const offDetect = window.api.prereqs.onDetectEvent((evt) => {
      if (evt.phase === 'start') {
        setDetectTotal(evt.total);
        setDetectLog([]);
      } else if (evt.phase === 'result') {
        const meta = FRIENDLY[evt.name] ?? { label: evt.name };
        const status = isSatisfied(evt.result)
          ? `✓ found${evt.result.version ? ` — ${evt.result.version}` : ''}`
          : '✗ not found';
        setDetectLog((prev) => [...prev, `${meta.label}: ${status}`]);
      }
    });
    return () => { offInstall(); offDetect(); };
  }, []);

  const onInstall = async (name: string): Promise<void> => {
    setInstalling((p) => ({ ...p, [name]: true }));
    setInstallLog((p) => ({ ...p, [name]: '' }));
    setInstallResult((p) => ({ ...p, [name]: null }));
    const r = await window.api.prereqs.install(name);
    setInstallResult((p) => ({ ...p, [name]: r }));
    setInstalling((p) => ({ ...p, [name]: false }));
    runDetect();
  };

  const missingCount = checks.filter((c) => !isSatisfied(c)).length;
  const needsRestartGlobal = Object.values(installResult).some((r) => r?.needsRestart && r.ok);

  return (
    <div>
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-titan-gray-dark mb-3">Quick prerequisite check</h1>
        <p className="text-base text-titan-gray-mid">
          Titan uses these tools. Missing one? Click Install — we'll handle it.
        </p>
        {!wingetAvailable && (
          <p className="mt-2 text-sm text-titan-warning">
            ⚠ Auto-install is unavailable on this Windows build. Use the manual instructions below.
          </p>
        )}
      </div>

      {/* Prominent, highlighted while checks run — a ring + pulse so this
          doesn't read as a static/frozen page the user might click away from.
          The log lines are REAL results streaming in one at a time, not a
          cosmetic timer, so "please wait" is backed by visible, honest progress. */}
      {loading && (
        <div className="max-w-2xl mx-auto rounded-card ring-2 ring-titan-blue-main shadow-card-hover p-6 mb-6 bg-titan-blue-soft/20">
          <div className="flex items-center gap-3 mb-3">
            <span className="inline-block w-3 h-3 rounded-full bg-titan-blue-main animate-pulse" />
            <span className="text-base font-semibold text-titan-gray-dark">
              Checking your environment — please wait, don't skip this step
            </span>
          </div>
          <p className="text-sm text-titan-gray-mid mb-3">
            Verifying {detectTotal || defaultCheckCount} required tools ({detectLog.length}/{detectTotal || defaultCheckCount} done)…
          </p>
          <pre className="p-3 rounded bg-titan-gray-bg text-xs text-titan-gray-dark font-mono min-h-[6rem] max-h-48 overflow-y-auto whitespace-pre-wrap">
            {detectLog.length === 0
              ? 'Starting checks…'
              : detectLog.join('\n')}
          </pre>
        </div>
      )}

      {!loading && (
      <div className="max-w-2xl mx-auto bg-titan-white rounded-card shadow-card p-6 mb-6">
        {checks.map((p) => {
          const meta = FRIENDLY[p.name] ?? { label: p.name, install: '', manualSteps: [] };
          const isInstalling = !!installing[p.name];
          const result = installResult[p.name];
          const isExpanded = !!expanded[p.name];

          return (
            <div key={p.name} className="py-3 border-b border-titan-gray-light last:border-b-0">
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-base text-titan-gray-dark font-medium">{meta.label}</div>
                  {p.detected && p.version && (
                    <div className="text-xs text-titan-gray-mid mt-0.5">{p.version}</div>
                  )}
                </div>

                {isSatisfied(p) ? (
                  <span className="text-titan-success font-medium whitespace-nowrap">✓ Detected</span>
                ) : (
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    {wingetAvailable && (
                      <Button
                        size="sm"
                        onClick={() => void onInstall(p.name)}
                        disabled={isInstalling}
                      >
                        {isInstalling ? 'Installing…' : 'Install'}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setExpanded((e) => ({ ...e, [p.name]: !isExpanded }))}
                    >
                      {isExpanded ? 'Hide steps' : 'Show steps'}
                    </Button>
                    <span className="text-titan-danger font-medium whitespace-nowrap">
                      {p.detected && p.name === 'node' ? `✗ Node ${nodeMajor(p.version)} — need ${MIN_NODE_MAJOR}+` : '✗ Missing'}
                    </span>
                  </div>
                )}
              </div>

              {/* Install result message */}
              {result && (
                <div className={`mt-2 text-xs ${result.ok ? 'text-titan-success' : 'text-titan-danger'}`}>
                  {result.ok ? '✓ ' : '✗ '}
                  {result.message}
                </div>
              )}

              {/* Streamed install output (collapsed) */}
              {isInstalling && installLog[p.name] && (
                <pre className="mt-2 p-2 rounded bg-titan-gray-bg text-xs text-titan-gray-mid max-h-32 overflow-y-auto whitespace-pre-wrap">
                  {installLog[p.name].slice(-500)}
                </pre>
              )}

              {/* Manual instructions panel */}
              {isExpanded && (
                <div className="mt-3 p-3 rounded bg-titan-blue-soft/40 text-sm">
                  <ol className="list-decimal list-inside space-y-1 text-titan-gray-dark">
                    {meta.manualSteps.map((s, i) => <li key={i}>{s}</li>)}
                  </ol>
                  {meta.install && (
                    <button
                      onClick={() => void window.api.shell.openExternal(meta.install)}
                      className="mt-2 text-xs text-titan-blue-main hover:underline"
                    >
                      Open install page ↗
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      )}

      {needsRestartGlobal && (
        <div className="max-w-2xl mx-auto mb-4 p-3 rounded-card bg-titan-warning/10 ring-1 ring-titan-warning text-sm text-titan-gray-dark">
          <span className="font-semibold">⚠ Restart needed.</span> One or more installs added a PATH entry that this installer can't see until you reopen it. Close and reopen Titan, then return to this screen.
        </div>
      )}

      {missingCount > 0 && !loading && !needsRestartGlobal && (
        <p className="text-center text-sm text-titan-warning mb-4">
          ⚠ {missingCount} tool{missingCount === 1 ? '' : 's'} missing — click Install or open the steps.
        </p>
      )}

      <div className="flex justify-center gap-3">
        <Button variant="secondary" size="lg" onClick={runDetect} disabled={loading}>
          {loading ? 'Checking…' : 'Re-check'}
        </Button>
        <Button size="lg" onClick={() => setScreen(nextScreen())} disabled={loading}>
          {missingCount > 0 ? 'Continue anyway' : 'Continue'}
        </Button>
      </div>
    </div>
  );
}
