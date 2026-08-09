import { useEffect, useState } from 'react';
import Button from '../components/Button';
import { useWizard } from '../store/wizard-state';

// Figma connector — dev / lead / architect only.
//
// On mount, checks Windows Credential Manager for a stored Figma PAT.
//   - If found: shows "Already connected" state with option to clear/update.
//   - If not found: shows input + Test connection.
//
// The Figma PAT is independent from the built-in claude.ai Figma OAuth
// connector. Both can coexist: OAuth handles in-Claude design context,
// PAT enables headless REST API access from custom skills/scripts.

export default function FigmaInfo(): JSX.Element {
  const setScreen  = useWizard((s) => s.setScreen);
  const nextScreen = useWizard((s) => s.nextScreen);

  const [checking, setChecking]     = useState(true);
  const [stored, setStored]         = useState(false);
  const [updating, setUpdating]     = useState(false);   // user clicked "Update token"
  const [pat, setPat]               = useState('');
  const [reveal, setReveal]         = useState(false);
  const [testing, setTesting]       = useState(false);
  const [testOk, setTestOk]         = useState<boolean | null>(null);
  const [testMsg, setTestMsg]       = useState<string | null>(null);

  // Detect stored Figma PAT on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await window.api.token.hasFigma();
        if (!cancelled) setStored(!!r.ok);
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const patLooksOk = pat.length >= 20;
  const canTest    = patLooksOk && !testing;

  const openTokenPage = (): void => {
    void window.api.shell.openExternal('https://www.figma.com/developers/api#access-tokens');
  };

  const onTest = async (): Promise<void> => {
    setTesting(true);
    setTestOk(null);
    setTestMsg(null);
    const result = await window.api.token.testFigma(pat);
    setTestOk(result.ok);
    setTestMsg(result.message);
    if (result.ok) {
      await window.api.token.storeFigma(pat);
      setStored(true);
    }
    setTesting(false);
  };

  const onClear = async (): Promise<void> => {
    await window.api.token.clearFigma();
    setStored(false);
    setUpdating(true);
    setPat('');
    setTestOk(null);
    setTestMsg(null);
  };

  const onUpdate = (): void => {
    setUpdating(true);
    setPat('');
    setTestOk(null);
    setTestMsg(null);
  };

  const advance = (): void => setScreen(nextScreen());

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold text-titan-gray-dark mb-3 text-center tracking-tight">
        Figma access (optional)
      </h1>
      <p className="text-base text-titan-gray-mid text-center mb-4 leading-relaxed">
        Claude Code already connects to Figma via OAuth automatically — a browser
        pop-up will sign you in the first time you reference a Figma file. That
        path needs no setup here.
      </p>
      <p className="text-sm text-titan-gray-mid text-center mb-6 leading-relaxed">
        Add a Figma Personal Access Token here only if you want headless / REST
        API access from custom skills outside Claude. Most devs can skip.
      </p>

      {checking ? (
        <div className="bg-titan-white rounded-card shadow-card p-6 mb-6 text-center text-titan-gray-mid">
          Checking for stored Figma token…
        </div>
      ) : stored && !updating ? (
        /* ── Already connected ─────────────────────────────────────────── */
        <div className="bg-titan-success/10 ring-1 ring-titan-success rounded-card p-6 mb-6">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-2xl">✓</span>
            <div>
              <div className="font-bold text-titan-gray-dark">Figma is already connected</div>
              <div className="text-xs text-titan-gray-mid">A Figma personal access token is stored in Windows Credential Manager.</div>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="secondary" size="sm" onClick={onUpdate}>Update token</Button>
            <Button variant="ghost" size="sm" onClick={() => void onClear()}>Clear token</Button>
          </div>
        </div>
      ) : (
        /* ── Not connected: collect token ──────────────────────────────── */
        <div className="bg-titan-white rounded-card shadow-card p-6 mb-4">
          <label htmlFor="figma-pat" className="block text-sm font-medium text-titan-gray-dark mb-1">
            Figma personal access token
          </label>
          <div className="flex gap-2 mb-3">
            <input
              id="figma-pat"
              type={reveal ? 'text' : 'password'}
              value={pat}
              onChange={(e) => { setPat(e.target.value); setTestOk(null); setTestMsg(null); }}
              className="flex-1 px-4 py-3 rounded-pill border-2 border-titan-gray-light focus:border-titan-blue-main outline-none text-base font-mono tracking-wide"
              placeholder="figd_… or figu_…"
              autoComplete="off"
              spellCheck={false}
            />
            <Button variant="secondary" size="md" type="button" onClick={() => setReveal(!reveal)}>
              {reveal ? 'Hide' : 'Show'}
            </Button>
          </div>
          <p className="text-xs text-titan-gray-mid mb-4">
            Token is stored only on this machine — encrypted in Windows Credential Manager.
            Required scopes: <code>file_read</code>. Generate at figma.com → Settings → Personal access tokens.
          </p>
          <div className="flex gap-3 items-center flex-wrap">
            <Button variant="secondary" size="sm" onClick={() => void onTest()} disabled={!canTest}>
              {testing ? 'Testing…' : 'Test & save'}
            </Button>
            <Button variant="ghost" size="sm" onClick={openTokenPage}>
              How do I create a Figma token?
            </Button>
            {testOk === true  && <span className="text-titan-success font-medium text-sm">✓ Saved</span>}
            {testOk === false && <span className="text-titan-danger  font-medium text-sm">✗ Failed</span>}
          </div>
          {testMsg && (
            <p className={`text-sm mt-3 ${testOk === false ? 'text-titan-danger' : 'text-titan-gray-mid'}`}>
              {testMsg}
            </p>
          )}
        </div>
      )}

      {/* What you can do with Figma access */}
      <div className="bg-titan-blue-soft/40 rounded-card p-4 mb-6 text-sm text-titan-gray-dark">
        <p className="font-semibold mb-2">Once connected, you can ask Claude things like:</p>
        <ul className="list-disc list-inside space-y-1 text-titan-gray-mid">
          <li>"Build this Figma component as a React + Tailwind component"</li>
          <li>"Extract the design tokens from this Figma library"</li>
          <li>"Does my implementation at LoginForm.tsx match the Figma spec?"</li>
          <li>"Generate a Figma diagram of the checkout flow from these specs"</li>
        </ul>
        <div className="mt-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void window.api.shell.openExternal('https://claude.ai/settings/connectors')}
          >
            Authorize Figma in claude.ai →
          </Button>
          <p className="text-xs text-titan-gray-mid mt-1">
            The installer can't check whether this is authorized — that state lives in claude.ai, not on this machine.
          </p>
        </div>
      </div>

      <div className="flex justify-center gap-3">
        <Button variant="secondary" size="lg" onClick={() => setScreen('atlassian-setup')}>
          ← Back
        </Button>
        {stored && !updating ? (
          <Button size="lg" onClick={advance}>Continue</Button>
        ) : testOk === true ? (
          <Button size="lg" onClick={advance}>Continue</Button>
        ) : (
          <Button size="lg" onClick={advance}>
            Skip & Continue
          </Button>
        )}
      </div>
    </div>
  );
}
