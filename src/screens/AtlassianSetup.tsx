import { useEffect, useState } from 'react';
import Button from '../components/Button';
import { useWizard } from '../store/wizard-state';

// Atlassian Setup — OPTIONAL REST token for ALL roles.
//
// IMPORTANT: this token does NOT connect Jira/Confluence to Claude Code.
// Jira + Confluence access is the built-in **Atlassian Rovo connector**, which
// authenticates via OAuth (a browser sign-in the first time you use it in a
// session, or enable it in claude.ai → connector settings). That path needs no
// setup here and is NOT in .mcp.json — putting connectors in .mcp.json breaks
// all MCP loading (RCA 2026-07-06).
//
// The email + API token collected here are used ONLY by commerce-platform REST-based helper
// scripts and the post-install health check (doctor). They are optional — Skip
// is always available and Jira/Confluence still work via Rovo without them.

export default function AtlassianSetup(): JSX.Element {
  const role        = useWizard((s) => s.role);
  const setScreen   = useWizard((s) => s.setScreen);
  const nextScreen  = useWizard((s) => s.nextScreen);
  const setJiraEmail = useWizard((s) => s.setJiraEmail);
  const setJiraToken = useWizard((s) => s.setJiraToken);
  const titanConfig  = useWizard((s) => s.titanConfig);
  const workspacePath = useWizard((s) => s.workspacePath);
  const trackerConfigured = (titanConfig?.platforms.issue_tracker.kind ?? 'jira') !== 'none';
  // QA Tester's primary context source is Jira (pull story → write test
  // cases). Everyone else can Skip; QA cannot advance without a tested token.
  const isQa = role === 'qa';
  // Preserve user input across Back/Forward navigation — read from store on mount.
  const savedEmail = useWizard((s) => s.jiraEmail);
  const savedToken = useWizard((s) => s.jiraToken);

  const [email, setEmail]         = useState(savedEmail);
  const [token, setToken]         = useState(savedToken);
  const [reveal, setReveal]       = useState(false);
  const [testing, setTesting]     = useState(false);
  // If user previously tested+saved, surface that — they re-enter the screen "already connected"
  const [testOk, setTestOk]       = useState<boolean | null>(savedEmail && savedToken ? true : null);
  const [testMsg, setTestMsg]     = useState<string | null>(savedEmail && savedToken ? 'Saved earlier — re-test if anything changed.' : null);

  const emailLooksOk  = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const tokenLooksOk  = token.length >= 20;
  const canTest       = emailLooksOk && tokenLooksOk && !testing;

  // No issue tracker configured (platforms.issue_tracker.kind = "none") —
  // self-suppress and skip straight to the next screen rather than showing
  // a Jira-specific form nobody can use (§Phase 6 step 21).
  useEffect(() => {
    if (!trackerConfigured) setScreen(nextScreen());
    // Only re-check when trackerConfigured itself flips (config load resolves).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackerConfigured]);

  const openTokenPage = (): void => {
    void window.api.shell.openExternal(
      'https://id.atlassian.com/manage-profile/security/api-tokens'
    );
  };

  const onTest = async (): Promise<void> => {
    setTesting(true);
    setTestOk(null);
    setTestMsg(null);
    const result = await window.api.token.testJira(email, token, workspacePath);
    setTestOk(result.ok);
    // "Token valid" — this is a REST identity check, NOT proof the Rovo MCP
    // connector is connected (that's OAuth, authorized separately in-session).
    setTestMsg(result.ok ? 'Token valid for REST scripts + health check. (Jira/Confluence in Claude still use the Rovo connector — OAuth.)' : result.message);
    if (result.ok) {
      setJiraEmail(email);
      setJiraToken(token);
    }
    setTesting(false);
  };

  const advance = (): void => setScreen(nextScreen());

  if (!trackerConfigured) {
    return <div className="max-w-2xl mx-auto text-center text-titan-gray-mid">No issue tracker configured — skipping…</div>;
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold text-titan-gray-dark mb-3 text-center tracking-tight">
        {isQa ? 'Jira & Confluence — recommended for QA Tester' : 'Jira & Confluence — optional token'}
      </h1>
      <p className="text-base text-titan-gray-mid text-center mb-3 leading-relaxed">
        Claude Code connects to Jira &amp; Confluence through the built-in <strong>Atlassian Rovo</strong> connector,
        which signs you in via your browser (OAuth) the first time you use it in a session — or enable it under
        <em> claude.ai → connector settings</em>. <strong>That path needs no setup here</strong> —
        {isQa
          ? <> but you <strong>must still authorize it</strong> the first time you run <code>/qa-mode</code> in Claude Code
              (a browser sign-in prompt appears once). The token below is a separate, additional step.</>
          : ' that connector is what actually reaches Jira/Confluence.'}
      </p>
      {isQa ? (
        <p className="text-sm text-titan-gray-mid text-center mb-8 leading-relaxed">
          <strong>Recommended for QA Tester</strong> — <code>/qa-mode</code> pulls the Jira story via the Rovo
          connector (OAuth, above); this REST token only powers the post-install health check that confirms your
          Jira identity is reachable. It has no effect on whether <code>/qa-mode</code> can reach Jira, so it's{' '}
          <strong>optional, not required</strong> — authorizing the Rovo connector in Claude Code is what actually
          matters. You can Skip and set this up later from the Dashboard.
        </p>
      ) : (
        <p className="text-sm text-titan-gray-mid text-center mb-8 leading-relaxed">
          Add an Atlassian API token below <strong>only</strong> if you want commerce-platform REST-based helper scripts (and the
          post-install health check) to reach Jira. It does <strong>not</strong> connect the Rovo MCP connector — most people can
          <strong> Skip</strong>.
        </p>
      )}

      <div className="bg-titan-white rounded-card shadow-card p-6 mb-4">
        {/* Email */}
        <label htmlFor="jira-email" className="block text-sm font-medium text-titan-gray-dark mb-1">
          Atlassian email
        </label>
        <input
          id="jira-email"
          type="email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setTestOk(null); setTestMsg(null); }}
          className="w-full px-4 py-3 rounded-pill border-2 border-titan-gray-light focus:border-titan-blue-main outline-none text-base mb-4"
          placeholder={`you@${titanConfig?.org.email_domain ?? 'example.com'}`}
          autoComplete="email"
          spellCheck={false}
        />

        {/* API token */}
        <label htmlFor="jira-token" className="block text-sm font-medium text-titan-gray-dark mb-1">
          Atlassian API token
        </label>
        <div className="flex gap-2 mb-3">
          <input
            id="jira-token"
            type={reveal ? 'text' : 'password'}
            value={token}
            onChange={(e) => { setToken(e.target.value); setTestOk(null); setTestMsg(null); }}
            className="flex-1 px-4 py-3 rounded-pill border-2 border-titan-gray-light focus:border-titan-blue-main outline-none text-base font-mono tracking-wide"
            placeholder="Paste your Atlassian API token"
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
          Your token is stored only on this machine — encrypted in Windows Credential Manager.
          It is never committed to git or sent anywhere except Atlassian's own API.
        </p>

        <div className="flex gap-3 items-center flex-wrap">
          <Button variant="secondary" size="sm" onClick={() => void onTest()} disabled={!canTest}>
            {testing ? 'Testing…' : 'Test connection'}
          </Button>
          <Button variant="ghost" size="sm" onClick={openTokenPage}>
            How do I create a token?
          </Button>
          {testOk === true  && <span className="text-titan-success font-medium text-sm">✓ Token valid (REST)</span>}
          {testOk === false && <span className="text-titan-danger  font-medium text-sm">✗ Failed</span>}
        </div>

        {testMsg && (
          <p className={`text-sm mt-3 ${testOk === false ? 'text-titan-danger' : 'text-titan-gray-mid'}`}>
            {testMsg}
          </p>
        )}
      </div>

      {/* What the Rovo connector enables — framed around the OAuth connector,
          not this optional token, so users don't think the token is the path. */}
      <div className="bg-titan-blue-soft/40 rounded-card p-4 mb-6 text-sm text-titan-gray-dark">
        <p className="font-semibold mb-2">Once the Atlassian Rovo connector is authorized (browser sign-in on first use), you can ask Claude:</p>
        <ul className="list-disc list-inside space-y-1 text-titan-gray-mid">
          <li>"What user stories are in the current sprint?"</li>
          <li>"Summarise the flow described in Confluence page X"</li>
          <li>"Draft acceptance criteria for JIRA-1234"</li>
          <li>"Which tickets are blocked on the payment integration?"</li>
        </ul>
        <p className="text-xs text-titan-gray-mid mt-2">These work through the Rovo connector (OAuth) — the optional token above is not required for them.</p>
        <div className="mt-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void window.api.shell.openExternal('https://claude.ai/settings/connectors')}
          >
            Authorize Atlassian Rovo in claude.ai →
          </Button>
          <p className="text-xs text-titan-gray-mid mt-1">
            The installer can't check whether this is authorized — that state lives in claude.ai, not on this machine.
          </p>
        </div>
      </div>

      <div className="flex justify-center gap-3">
        <Button variant="secondary" size="lg" onClick={() => setScreen('onboarding')}>
          ← Back
        </Button>
        <Button size="lg" onClick={advance}>
          {testOk === true ? 'Continue' : 'Skip & Continue'}
        </Button>
      </div>
    </div>
  );
}
