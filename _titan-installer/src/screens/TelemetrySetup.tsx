import { useEffect, useState } from 'react';
import Button from '../components/Button';
import { useWizard } from '../store/wizard-state';

// Telemetry endpoint — REQUIRED (reaffirmed 2026-08-03: leadership wants
// central visibility into harness usage from every pilot install, full
// stop). SAS URL is provided by the toolkit maintainer via
// Confluence / Teams. User pastes once during install; we store via keytar
// on the next setup phase, never in any file on disk.
//
// Known rough edge, accepted deliberately: telemetrySasUrl is a secret,
// excluded on purpose from wizard-state.ts's persist `partialize` (see that
// file) — so if the app is closed or reloaded mid-wizard after pasting the
// SAS but before finishing, the value is gone and this screen blocks again
// until it's re-entered. That's a UX inconvenience (re-paste from
// Confluence/Teams), not a security issue — persisting a write-token secret
// to disk to avoid it would be the wrong trade. No skip path: every pilot
// user must upload to the central endpoint so the maintainer dashboard sees
// the full picture.

export default function TelemetrySetup(): JSX.Element {
  const setScreen           = useWizard((s) => s.setScreen);
  const nextScreen          = useWizard((s) => s.nextScreen);
  const setTelemetrySasUrl  = useWizard((s) => s.setTelemetrySasUrl);
  const currentSas          = useWizard((s) => s.telemetrySasUrl);
  const setDisplayName      = useWizard((s) => s.setDisplayName);
  const currentDisplayName  = useWizard((s) => s.displayName);

  const role                = useWizard((s) => s.role);
  const titanConfig         = useWizard((s) => s.titanConfig);
  // "none" is the default (§ Titan plan C.6 — ship with nothing enabled
  // implicitly). Screen self-suppresses instead of forcing a SAS URL every
  // adopter would have to paste in even when they never set up a sink.
  const sinkKind = titanConfig?.telemetry.upload.kind ?? 'none';

  const [sas, setSas]       = useState(currentSas);
  const [name, setName]     = useState(currentDisplayName);
  const [reveal, setReveal] = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifiedHash, setVerifiedHash] = useState<string | null>(null);

  // Self-suppress when no telemetry sink is configured — advance straight
  // through rather than blocking every install on a SAS URl nobody has.
  useEffect(() => {
    if (sinkKind === 'none') setScreen(nextScreen());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sinkKind]);

  const looksValid = (v: string): boolean =>
    v.startsWith('https://') &&
    v.includes('.blob.core.windows.net/') &&
    v.includes('?') &&
    v.includes('sig=');

  // Shape alone can't tell a good SAS from an expired or read-only one, and
  // both of those produce an install that 403s silently on every upload
  // forever. So the gate is a real write: we upload a registration event under
  // this user's real hashed id and only advance if Azure accepts it. No
  // override — a user who can't complete this would otherwise be invisible to
  // the dashboard, which is the exact failure this screen exists to prevent.
  const advance = async (): Promise<void> => {
    if (!looksValid(sas)) {
      setError('URL must look like https://<account>.blob.core.windows.net/<container>?sv=...&sig=...');
      return;
    }
    setError(null);
    setVerifying(true);
    setVerifiedHash(null);
    try {
      const res = await window.api.telemetry.verifySas(sas.trim(), role ?? 'developer');
      if (!res.ok) {
        setError(res.error ?? 'Could not verify the SAS URL.');
        return;
      }
      setVerifiedHash(res.userHash);
      setTelemetrySasUrl(sas.trim());
      setDisplayName(name.trim());
      setScreen(nextScreen());
    } catch (err) {
      setError(`Verification failed: ${(err as Error).message}`);
    } finally {
      setVerifying(false);
    }
  };

  if (sinkKind === 'none') {
    return <div className="max-w-2xl mx-auto text-center text-titan-gray-mid">No telemetry sink configured — skipping…</div>;
  }

  const brand = titanConfig?.branding?.product_name ?? titanConfig?.org.harness_brand ?? 'Titan';

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold text-titan-gray-dark mb-3 text-center tracking-tight">
        Usage telemetry
      </h1>
      <p className="text-base text-titan-gray-mid text-center mb-4 leading-relaxed">
        {brand} uploads anonymous usage metadata to a central dashboard so the
        toolkit maintainer can see how the harness is used and improve it over time.
      </p>
      <p className="text-sm text-titan-gray-mid text-center mb-8 leading-relaxed">
        Paste the Azure Blob SAS URL provided by your toolkit maintainer. The URL is
        stored only in Windows Credential Manager on this machine — never in a file.
      </p>

      <div className="bg-titan-white rounded-card shadow-card p-6 mb-4">
        <label htmlFor="tel-name" className="block text-sm font-medium text-titan-gray-dark mb-2">
          Display name <span className="font-normal text-titan-gray-mid">(optional)</span>
        </label>
        <input
          id="tel-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Jordan Smith"
          className="w-full px-4 py-3 rounded-pill border-2 border-titan-gray-light focus:border-titan-blue-main outline-none text-sm mb-2"
          autoComplete="off"
        />
        <p className="text-xs text-titan-gray-mid">
          Lets your toolkit maintainer's <strong>local</strong> dashboard show your name instead of a hash
          when they build their user map — it is <strong>never uploaded</strong> to the shared telemetry
          endpoint above. Saved only to <code>.claude/roster-entry.json</code> on this machine. Skip this
          if you'd rather stay hash-only.
        </p>
      </div>

      <div className="bg-titan-white rounded-card shadow-card p-6 mb-4">
        <label htmlFor="tel-sas" className="block text-sm font-medium text-titan-gray-dark mb-2">
          Azure Blob SAS URL — upload (write) token
        </label>
        <div className="flex gap-2 mb-3">
          <input
            id="tel-sas"
            type={reveal ? 'text' : 'password'}
            value={sas}
            onChange={(e) => { setSas(e.target.value); setError(null); }}
            placeholder="https://<account>.blob.core.windows.net/<container>?sv=...&sig=..."
            className="flex-1 px-4 py-3 rounded-pill border-2 border-titan-gray-light focus:border-titan-blue-main outline-none text-xs font-mono"
            autoComplete="off"
            spellCheck={false}
          />
          <Button variant="secondary" size="md" type="button" onClick={() => setReveal(!reveal)}>
            {reveal ? 'Hide' : 'Show'}
          </Button>
        </div>
        {error && <p className="text-sm text-titan-danger mb-3">{error}</p>}
        {verifiedHash && !error && (
          <p className="text-sm text-titan-gray-dark mb-3">
            ✓ Verified — a registration event was uploaded. Your ID is{' '}
            <code className="font-mono">{verifiedHash}</code>.
          </p>
        )}
        <p className="text-xs text-titan-gray-mid">
          This is the <strong>write (upload)</strong> token — permissions <code>Create + Write</code>.
          Every pilot user gets the same write URL (via Confluence / Teams from the maintainer).
          The <strong>read</strong> token is dashboard-only and is <strong>not</strong> distributed to developers.
          Your telemetry uploads to a stable per-user node: <code>&lt;container&gt;/&lt;your-hash&gt;/&lt;date&gt;/</code>.
        </p>
      </div>

      {/* Privacy summary */}
      <div className="bg-titan-blue-soft/40 rounded-card p-4 mb-6 text-sm text-titan-gray-dark">
        <p className="font-semibold mb-2">What gets uploaded:</p>
        <ul className="list-disc list-inside space-y-1 text-titan-gray-mid">
          <li>Tool name, role, timestamp, hashed user ID</li>
          <li>Top-2 path components of edited files (no full paths)</li>
          <li>Program name from Bash (e.g. <code>git</code>) — never the full command</li>
          <li>Skill / agent type invoked</li>
        </ul>
        <p className="font-semibold mb-2 mt-3">Never uploaded:</p>
        <ul className="list-disc list-inside space-y-1 text-titan-gray-mid">
          <li>Prompts, responses, file contents</li>
          <li>Customer data, PHI / PII, credentials</li>
        </ul>
      </div>

      <div className="flex justify-center gap-3">
        <Button variant="secondary" size="lg" onClick={() => setScreen('atlassian-setup')} disabled={verifying}>
          ← Back
        </Button>
        <Button size="lg" onClick={() => { void advance(); }} disabled={!looksValid(sas) || verifying}>
          {verifying ? 'Verifying…' : 'Verify & Continue'}
        </Button>
      </div>
      <p className="text-xs text-titan-gray-mid text-center mt-3">
        SAS URL is required. We upload a small registration event to confirm it works before
        continuing. Contact your toolkit maintainer if you don't have it or if
        verification fails.
      </p>
    </div>
  );
}
