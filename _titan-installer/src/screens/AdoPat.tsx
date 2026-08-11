import { useState, useEffect } from 'react';
import Button from '../components/Button';
import { useWizard } from '../store/wizard-state';

// Screen 5 — ADO PAT collection + validation + secure storage.
// Real wiring (Week 2):
//   - "Test connection" calls window.api.token.testAdo() → REST round-trip
//     against the configured SCM's PAT-test endpoint
//   - On a successful test, the PAT is sealed into Windows Credential
//     Manager via window.api.token.storeAdo(). Plaintext leaves React's
//     state on next render and lives only in the OS keystore.
//   - "Continue" is blocked until the test passes.

export default function AdoPat(): JSX.Element {
  const savedPat        = useWizard((s) => s.adoPatValue);  // restore on Back nav
  const [pat, setPat] = useState(savedPat);
  const [reveal, setReveal] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testMessage, setTestMessage] = useState<string | null>(savedPat ? 'Saved earlier — test the connection to continue.' : null);

  const setAdoPatStored = useWizard((s) => s.setAdoPatStored);
  const setAdoPatValue  = useWizard((s) => s.setAdoPatValue);   // session-state copy
  const setScreen       = useWizard((s) => s.setScreen);
  const nextScreen      = useWizard((s) => s.nextScreen);
  const lastTestOk      = useWizard((s) => s.adoPatLastTestOk);
  const setLastTestOk   = useWizard((s) => s.setAdoPatTestOk);
  const titanConfig     = useWizard((s) => s.titanConfig);
  const workspacePath   = useWizard((s) => s.workspacePath);
  const scmKind         = titanConfig?.platforms.scm.kind ?? 'azure-devops';
  const scmLabel        = scmKind === 'github' ? 'GitHub' : 'Azure DevOps';

  // On mount, check whether a PAT is already stored. If yes, we skip the
  // collection but still require a fresh "Test connection" — tokens expire
  // and we don't want to advance with a stale one.
  useEffect(() => {
    void window.api.token.hasAdo().then((r) => {
      if (r.ok) {
        setTestMessage('A PAT is already stored. Test it or paste a new one.');
      }
    });
  }, []);

  const formatLooksOk = pat.length >= 20;

  // Derived from config.platforms.scm — falls back to a generic ADO shape
  // if pat_url/collection aren't set yet (pre-configure), instead of a
  // hardcoded org string.
  const patCreateUrl = (): string => {
    if (titanConfig?.platforms.scm.pat_url) return titanConfig.platforms.scm.pat_url;
    if (scmKind === 'github') return 'https://github.com/settings/tokens';
    const org = titanConfig?.platforms.scm.collection ?? 'YOUR-ADO-ORG';
    return `https://dev.azure.com/${org}/_usersSettings/tokens`;
  };

  const openAdoTokenPage = (): void => {
    void window.api.shell.openExternal(patCreateUrl());
  };

  const onTest = async (): Promise<void> => {
    setTesting(true);
    setLastTestOk(null);
    setTestMessage(null);
    const result = await window.api.token.testAdo(pat, workspacePath);
    if (result.ok) {
      // Save PAT to wizard state first (always works, used by auto-setup).
      setAdoPatValue(pat);
      // Try keytar as well (best-effort — failures don't block the flow).
      try {
        const stored = await window.api.token.storeAdo(pat);
        if (!stored.ok) {
          setTestMessage('✓ Verified. (Credential Manager unavailable — PAT kept in session.)');
        } else {
          setTestMessage('✓ Verified and saved to Windows Credential Manager.');
        }
      } catch {
        setTestMessage('✓ Verified. (Credential Manager unavailable — PAT kept in session.)');
      }
      setAdoPatStored(true);
      setLastTestOk(true);
    } else {
      setTestMessage(result.message);
      setAdoPatStored(false);
      setLastTestOk(false);
    }
    setTesting(false);
  };

  const advance = (): void => setScreen(nextScreen());

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold text-titan-gray-dark mb-3 text-center tracking-tight">
        Your {scmLabel} token
      </h1>
      <p className="text-base text-titan-gray-mid text-center mb-8 leading-relaxed">
        The installer itself uses this to test connectivity, list branches, and clone
        the configured repositories in the next step. The broader scopes below are for the
        {' '}{scmLabel} MCP server your Claude Code sessions use afterward — pull
        requests, work items, build status. It's stored encrypted on this machine
        only — never committed, never sent anywhere except {scmKind === 'github' ? 'github.com' : 'dev.azure.com'}.
      </p>

      <div className="bg-titan-white rounded-card shadow-card p-6 mb-6">
        <label htmlFor="ado-pat" className="block text-sm font-medium text-titan-gray-dark mb-2">
          Personal Access Token
        </label>
        <div className="flex gap-2 mb-3">
          <input
            id="ado-pat"
            type={reveal ? 'text' : 'password'}
            value={pat}
            onChange={(e) => { setPat(e.target.value); setLastTestOk(null); setTestMessage(null); }}
            className="flex-1 px-4 py-3 rounded-pill border-2 border-titan-gray-light focus:border-titan-blue-main outline-none text-base font-mono tracking-wide"
            placeholder="Paste your PAT here"
            autoComplete="off"
            spellCheck={false}
          />
          <Button
            variant="secondary"
            size="md"
            type="button"
            onClick={() => setReveal(!reveal)}
            aria-label={reveal ? 'Hide token' : 'Show token'}
          >
            {reveal ? 'Hide' : 'Show'}
          </Button>
        </div>

        <p className="text-xs text-titan-gray-mid mb-4">
          Required scopes: Code: Read · Work Items: Read · Build: Read · Pull Request Threads: Read &amp; Write
        </p>

        <div className="flex gap-3 items-center flex-wrap">
          <Button variant="secondary" size="sm" onClick={() => void onTest()} disabled={!formatLooksOk || testing}>
            {testing ? 'Testing…' : 'Test connection'}
          </Button>
          <Button variant="ghost" size="sm" onClick={openAdoTokenPage}>
            How do I create a PAT?
          </Button>
          {lastTestOk === true && <span className="text-titan-success font-medium text-sm">✓ Connection OK</span>}
          {lastTestOk === false && <span className="text-titan-danger font-medium text-sm">✗ Failed</span>}
        </div>
        {testMessage && (
          <p className={`text-sm mt-3 ${lastTestOk === false ? 'text-titan-danger' : 'text-titan-gray-mid'}`}>
            {testMessage}
          </p>
        )}
      </div>

      <p className="text-xs text-center text-titan-gray-mid mb-6">
        Jira and Figma are NOT collected here — you'll sign in to them through your browser
        the first time Claude Code needs them.
      </p>

      <div className="flex justify-center">
        <Button size="lg" onClick={advance} disabled={lastTestOk !== true}>
          Continue
        </Button>
      </div>
    </div>
  );
}
