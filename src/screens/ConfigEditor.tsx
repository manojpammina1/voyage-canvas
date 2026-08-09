import { useEffect, useState } from 'react';
import Button from '../components/Button';
import Card from '../components/Card';
import { useWizard } from '../store/wizard-state';
import type { TitanConfigForRenderer, TitanConfigRepo } from '../global';

// Config editor — Phase 6 step 22 of the Titan extraction plan: a form over
// titan.config.schema.json so adopters never hand-edit JSON.
//
// Scope: NOT exhaustive against the schema. Prioritises the "9 keys you
// must fill before first deploy" from docs/ADOPTION.md (not yet written —
// see the Titan plan's Phase 7 item 25):
//   1. org.name              6. platforms.issue_tracker.kind
//   2. org.display_name      7. platforms.issue_tracker.site (if jira)
//   3. org.email_domain      8. telemetry.upload.kind
//   4. platforms.scm.kind    9. at least one repos[] entry
//   5. platforms.scm.collection
// Plus one contact (contacts.people), since "at least one contact" is
// called out explicitly in the plan even though it's a 10th field.
//
// Deferred (not in this screen — hand-edit titan.config.json, or wait for
// a future pass): contracts[], protected_paths[], governance.plugin_policy,
// environments, roles.definitions beyond hidden/default_mode, branding.*
// (branding is set once at build time, see assets/titan-mark.svg).

function emptyRepo(): TitanConfigRepo {
  return { id: '', dir: '', display: '', kind: 'generic' };
}

export default function ConfigEditor(): JSX.Element {
  const titanConfig = useWizard((s) => s.titanConfig);
  const workspacePath = useWizard((s) => s.workspacePath);
  const setScreen = useWizard((s) => s.setScreen);

  const [draft, setDraft] = useState<TitanConfigForRenderer | null>(titanConfig);
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (titanConfig && !draft) setDraft(titanConfig);
    if (titanConfig?.contacts?.people) {
      const first = Object.values(titanConfig.contacts.people)[0];
      if (first) { setContactName(first.name); setContactEmail(first.email ?? ''); }
    }
    // Only seed once when the config first arrives — after that the form owns its own state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [titanConfig]);

  if (!draft) {
    return <div className="max-w-2xl mx-auto text-center text-titan-gray-mid">Loading configuration…</div>;
  }

  const update = (patch: Partial<TitanConfigForRenderer>): void => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
  };

  const updateRepo = (idx: number, patch: Partial<TitanConfigRepo>): void => {
    setDraft((d) => {
      if (!d) return d;
      const repos = d.repos.map((r, i) => (i === idx ? { ...r, ...patch } : r));
      return { ...d, repos };
    });
  };

  const addRepo = (): void => update({ repos: [...draft.repos, emptyRepo()] });
  const removeRepo = (idx: number): void => update({ repos: draft.repos.filter((_, i) => i !== idx) });

  const missingRequired =
    !draft.org.name.trim() ||
    !draft.org.display_name.trim() ||
    !draft.org.email_domain.trim() ||
    draft.repos.length === 0 ||
    draft.repos.some((r) => !r.id.trim() || !r.dir.trim()) ||
    (draft.platforms.scm.kind === 'azure-devops' && !draft.platforms.scm.collection?.trim()) ||
    (draft.platforms.issue_tracker.kind === 'jira' && !draft.platforms.issue_tracker.site?.trim());

  const onSave = async (): Promise<void> => {
    setSaving(true);
    setMessage(null);
    const contactId = contactName.trim() ? contactName.trim().toLowerCase().replace(/\s+/g, '-') : null;
    const patch: Partial<TitanConfigForRenderer> = {
      ...draft,
      configured: !missingRequired,
      contacts: contactId
        ? { people: { [contactId]: { name: contactName.trim(), email: contactEmail.trim() || undefined } } }
        : draft.contacts,
    };
    const result = await window.api.config.saveTitan(workspacePath, patch);
    setSaving(false);
    setMessage(result.ok ? '✓ Saved to .claude/titan.config.json' : `Save failed: ${result.message}`);
  };

  return (
    <div className="max-w-3xl mx-auto py-8">
      <h1 className="text-3xl font-bold text-titan-gray-dark mb-2 tracking-tight">Titan configuration</h1>
      <p className="text-base text-titan-gray-mid mb-6">
        The keys most installs need before first deploy. Everything else can be hand-edited in{' '}
        <code>.claude/titan.config.json</code> later — see docs/CONFIG-REFERENCE.md.
      </p>

      <Card className="mb-6">
        <h2 className="text-lg font-bold text-titan-gray-dark mb-4">Organisation</h2>
        <Field label="Org name" value={draft.org.name} onChange={(v) => update({ org: { ...draft.org, name: v } })} />
        <Field label="Display name" value={draft.org.display_name} onChange={(v) => update({ org: { ...draft.org, display_name: v } })} />
        <Field label="Email domain" value={draft.org.email_domain} placeholder="example.com" onChange={(v) => update({ org: { ...draft.org, email_domain: v } })} />
      </Card>

      <Card className="mb-6">
        <h2 className="text-lg font-bold text-titan-gray-dark mb-4">Primary contact</h2>
        <Field label="Name" value={contactName} onChange={setContactName} />
        <Field label="Email" value={contactEmail} onChange={setContactEmail} />
      </Card>

      <Card className="mb-6">
        <h2 className="text-lg font-bold text-titan-gray-dark mb-4">Source control</h2>
        <label className="block text-sm font-medium text-titan-gray-dark mb-1">Kind</label>
        <select
          className="w-full px-4 py-2 rounded-pill border-2 border-titan-gray-light mb-3"
          value={draft.platforms.scm.kind}
          onChange={(e) => update({ platforms: { ...draft.platforms, scm: { ...draft.platforms.scm, kind: e.target.value as 'azure-devops' | 'github' } } })}
        >
          <option value="azure-devops">Azure DevOps</option>
          <option value="github">GitHub</option>
        </select>
        <Field
          label={draft.platforms.scm.kind === 'github' ? 'GitHub org/owner' : 'ADO organisation'}
          value={draft.platforms.scm.collection ?? ''}
          onChange={(v) => update({ platforms: { ...draft.platforms, scm: { ...draft.platforms.scm, collection: v } } })}
        />
      </Card>

      <Card className="mb-6">
        <h2 className="text-lg font-bold text-titan-gray-dark mb-4">Issue tracker</h2>
        <label className="block text-sm font-medium text-titan-gray-dark mb-1">Kind</label>
        <select
          className="w-full px-4 py-2 rounded-pill border-2 border-titan-gray-light mb-3"
          value={draft.platforms.issue_tracker.kind}
          onChange={(e) => update({ platforms: { ...draft.platforms, issue_tracker: { ...draft.platforms.issue_tracker, kind: e.target.value as 'jira' | 'none' } } })}
        >
          <option value="jira">Jira</option>
          <option value="none">None</option>
        </select>
        {draft.platforms.issue_tracker.kind === 'jira' && (
          <Field
            label="Atlassian site"
            placeholder="myorg.atlassian.net"
            value={draft.platforms.issue_tracker.site ?? ''}
            onChange={(v) => update({ platforms: { ...draft.platforms, issue_tracker: { ...draft.platforms.issue_tracker, site: v } } })}
          />
        )}
      </Card>

      <Card className="mb-6">
        <h2 className="text-lg font-bold text-titan-gray-dark mb-4">Telemetry upload</h2>
        <select
          className="w-full px-4 py-2 rounded-pill border-2 border-titan-gray-light"
          value={draft.telemetry.upload.kind}
          onChange={(e) => update({ telemetry: { ...draft.telemetry, upload: { ...draft.telemetry.upload, kind: e.target.value as 'none' | 'azure-blob' } } })}
        >
          <option value="none">None (no egress — default)</option>
          <option value="azure-blob">Azure Blob (SAS URL, configured per-user in the wizard)</option>
        </select>
      </Card>

      <Card className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-titan-gray-dark">Repositories</h2>
          <Button variant="secondary" size="sm" onClick={addRepo}>+ Add repo</Button>
        </div>
        {draft.repos.length === 0 && <p className="text-sm text-titan-gray-mid mb-3">No repos yet — add at least one.</p>}
        {draft.repos.map((r, idx) => (
          <div key={idx} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 mb-2 items-center">
            <input className="px-3 py-2 rounded border border-titan-gray-light text-sm" placeholder="id" value={r.id}
                   onChange={(e) => updateRepo(idx, { id: e.target.value })} />
            <input className="px-3 py-2 rounded border border-titan-gray-light text-sm" placeholder="dir" value={r.dir}
                   onChange={(e) => updateRepo(idx, { dir: e.target.value })} />
            <input className="px-3 py-2 rounded border border-titan-gray-light text-sm" placeholder="display name" value={r.display}
                   onChange={(e) => updateRepo(idx, { display: e.target.value })} />
            <Button variant="ghost" size="sm" onClick={() => removeRepo(idx)} aria-label={`Remove repo ${idx}`}>✕</Button>
          </div>
        ))}
      </Card>

      {message && <p className="text-sm text-center mb-4 text-titan-gray-dark">{message}</p>}
      {missingRequired && (
        <p className="text-sm text-center mb-4 text-titan-warning">
          Some required fields are still empty — the config will save with <code>configured: false</code>.
        </p>
      )}

      <div className="flex justify-center gap-3">
        <Button variant="secondary" size="lg" onClick={() => setScreen('dashboard')}>← Back to Dashboard</Button>
        <Button size="lg" onClick={() => void onSave()} disabled={saving}>
          {saving ? 'Saving…' : 'Save configuration'}
        </Button>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }): JSX.Element {
  return (
    <div className="mb-3">
      <label className="block text-sm font-medium text-titan-gray-dark mb-1">{label}</label>
      <input
        className="w-full px-4 py-2 rounded-pill border-2 border-titan-gray-light focus:border-titan-blue-main outline-none text-sm"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
