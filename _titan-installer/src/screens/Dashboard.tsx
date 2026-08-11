import { useEffect, useState } from 'react';
import Button from '../components/Button';
import Card from '../components/Card';
import { useWizard } from '../store/wizard-state';
import type { ClaudeMode, CostSummary, ActiveProject, LastReviewData } from '../global';

// Screen 10 — post-install Dashboard.

// v2.1: PO mode is sunset — kept here (hidden) so it re-enables with a flag,
// consistent with the RolePicker hide-not-delete approach.
const ALL_MODES: { id: ClaudeMode; label: string; description: string; hidden?: boolean }[] = [
  { id: 'po-mode',     label: 'PO mode',       description: 'Stories, AC, backlog', hidden: true },
  { id: 'dev-mode',    label: 'Dev mode',      description: 'Write code, debug, tests' },
  { id: 'lead-review', label: 'Lead review',   description: 'Review offshore PRs' },
  { id: 'arch-mode',   label: 'Arch mode',     description: 'System design + deploy' },
  { id: 'grill-me',    label: 'Grill me',      description: 'Stress-test a plan' }
];
const MODES = ALL_MODES.filter((m) => !m.hidden || import.meta.env.VITE_TITAN_PO_ENABLED === '1');

const ALERT_COLOR: Record<CostSummary['alertLevel'], { bg: string; ring: string; emoji: string }> = {
  OK:        { bg: 'bg-titan-success/10',  ring: 'ring-titan-success',  emoji: '🟢' },
  INFO:      { bg: 'bg-titan-warning/10',  ring: 'ring-titan-warning',  emoji: '🟡' },
  WARNING:   { bg: 'bg-titan-warning/20',  ring: 'ring-titan-warning',  emoji: '🟠' },
  CRITICAL:  { bg: 'bg-titan-danger/10',   ring: 'ring-titan-danger',   emoji: '🔴' },
  HARD_STOP: { bg: 'bg-titan-danger/20',   ring: 'ring-titan-danger',   emoji: '🛑' },
  UNKNOWN:   { bg: 'bg-titan-gray-light',  ring: 'ring-titan-gray-mid', emoji: '○' }
};

const HEALTH_STYLE: Record<string, { bg: string; ring: string; text: string }> = {
  Green: { bg: 'bg-titan-success/10',  ring: 'ring-titan-success', text: 'text-titan-success' },
  Amber: { bg: 'bg-titan-warning/10',  ring: 'ring-titan-warning', text: 'text-titan-warning' },
  Red:   { bg: 'bg-titan-danger/10',   ring: 'ring-titan-danger',  text: 'text-titan-danger'  },
  None:  { bg: 'bg-titan-gray-light',  ring: 'ring-titan-gray-mid',text: 'text-titan-gray-mid'}
};

type RepoBranchUI = {
  repoName: string;
  current: string;
  branches: string[];
  filter: string;
  loading: boolean;
  switching: boolean;
  syncing: boolean;
  syncToast: string | null;
  log: string | null;
  dirtyPrompt: boolean;
  targetBranch: string;
};

type ConnState = 'ok' | 'missing' | 'expired';
type ConnStatus = {
  ado:       { state: ConnState; detail: string };
  atlassian: { state: ConnState; detail: string };
  figma:     { state: ConnState; detail: string };
  checkedAt: string;
};

const PILL_STYLE: Record<ConnState, { bg: string; ring: string; text: string; icon: string }> = {
  ok:      { bg: 'bg-titan-success/10', ring: 'ring-titan-success', text: 'text-titan-success', icon: '✓' },
  missing: { bg: 'bg-titan-gray-light', ring: 'ring-titan-gray-mid', text: 'text-titan-gray-mid', icon: '○' },
  expired: { bg: 'bg-titan-danger/10',  ring: 'ring-titan-danger',  text: 'text-titan-danger',  icon: '✗' }
};

const STATE_LABEL: Record<ConnState, string> = {
  ok: 'Connected',
  missing: 'Not configured',
  expired: 'Needs attention'
};

const defaultRepoUi = (repoName: string): RepoBranchUI => ({
  repoName, current: '', branches: [], filter: '',
  loading: false, switching: false, syncing: false, syncToast: null,
  log: null, dirtyPrompt: false, targetBranch: ''
});

export default function Dashboard(): JSX.Element {
  const role          = useWizard((s) => s.role);
  const workspacePath = useWizard((s) => s.workspacePath);
  const repos         = useWizard((s) => s.repos);
  const titanConfig   = useWizard((s) => s.titanConfig);
  const setScreen     = useWizard((s) => s.setScreen);

  const [cost, setCost]           = useState<CostSummary | null>(null);
  const [project, setProject]     = useState<ActiveProject | null>(null);
  const [review, setReview]       = useState<LastReviewData | null>(null);
  const [launchingReview, setLR]  = useState(false);
  const [repoUi, setRepoUi]       = useState<Record<string, RepoBranchUI>>({});
  const [connStatus, setConnStatus] = useState<ConnStatus | null>(null);
  const [connChecking, setConnChecking] = useState(false);
  // ── Usage (telemetry) state ──────────────────────────────────────────
  const [usageSummary, setUsageSummary] = useState<Awaited<ReturnType<typeof window.api.telemetry.getSummary>> | null>(null);
  const [usageStatus, setUsageStatus] = useState<Awaited<ReturnType<typeof window.api.telemetry.getStatus>> | null>(null);
  const [sasInput, setSasInput] = useState('');
  const [sasRevealed, setSasRevealed] = useState(false);
  const [usageWorking, setUsageWorking] = useState(false);
  const [usageMsg, setUsageMsg] = useState<string | null>(null);
  const [costRollup, setCostRollup] = useState<Awaited<ReturnType<typeof window.api.cost.getRollup>> | null>(null);

  const joinPath = (...parts: string[]): string => parts.join('\\').replace(/\\+/g, '\\');
  const clonedRepos = repos.filter((r) => r.selected);


  useEffect(() => {
    let cancelled = false;
    const refresh = async (): Promise<void> => {
      const [c, p, r] = await Promise.all([
        window.api.framework.costSummary(workspacePath),
        window.api.framework.activeProject(workspacePath),
        window.api.framework.lastReview(workspacePath)
      ]);
      if (cancelled) return;
      setCost(c);
      setProject(p);
      if (r.ok && r.data) setReview(r.data);
    };
    void refresh();
    const interval = setInterval(() => { void refresh(); }, 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [workspacePath]);

  // Load branches for each cloned repo on first paint.
  useEffect(() => {
    for (const r of clonedRepos) {
      if (!repoUi[r.repoName]) void loadBranches(r.repoName);
    }
    // We only want this on mount/repos change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clonedRepos.length]);

  // Heartbeat — every 15s, re-poll current branch for each cloned repo so the
  // dashboard reflects any `git checkout` the user did in their terminal.
  // Lightweight — runs `git branch --show-current` locally, no network.
  useEffect(() => {
    const tick = async (): Promise<void> => {
      for (const r of clonedRepos) {
        try {
          const result = await window.api.repo.listBranches(joinPath(workspacePath, r.repoName));
          if (result.ok) {
            setRepoUi((s) => {
              const prev = s[r.repoName] ?? defaultRepoUi(r.repoName);
              if (prev.switching || prev.loading) return s;  // don't stomp in-flight ops
              if (prev.current === result.current && prev.branches.length === result.branches.length) return s;
              return { ...s, [r.repoName]: { ...prev, current: result.current, branches: result.branches } };
            });
          }
        } catch { /* ignore — next tick will retry */ }
      }
    };
    const interval = setInterval(() => { void tick(); }, 15_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clonedRepos.length, workspacePath]);

  // Probe ADO / Atlassian / Figma connection health.
  const refreshConn = async (): Promise<void> => {
    setConnChecking(true);
    try {
      const r = await window.api.status.checkAll(workspacePath);
      setConnStatus(r);
    } finally {
      setConnChecking(false);
    }
  };

  useEffect(() => {
    void refreshConn();
    const interval = setInterval(() => { void refreshConn(); }, 120_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspacePath]);

  // ── Usage telemetry — load summary + status on mount ────────────────
  const refreshUsage = async (): Promise<void> => {
    try {
      const [s, st, cr] = await Promise.all([
        window.api.telemetry.getSummary(workspacePath),
        window.api.telemetry.getStatus(workspacePath),
        window.api.cost.getRollup(workspacePath, ''),  // session id not available in renderer; aggregate omits this-session
      ]);
      setUsageSummary(s);
      setUsageStatus(st);
      setCostRollup(cr);
    } catch (err) {
      setUsageMsg(`Could not load usage data: ${(err as Error).message}`);
    }
  };

  useEffect(() => {
    void refreshUsage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspacePath]);

  const onToggleTelemetry = async (): Promise<void> => {
    if (!usageStatus) return;
    setUsageWorking(true);
    await window.api.telemetry.setEnabled(workspacePath, !usageStatus.enabled);
    await refreshUsage();
    setUsageWorking(false);
  };

  const onSaveSasUrl = async (): Promise<void> => {
    setUsageWorking(true);
    const r = await window.api.telemetry.setSasUrl(workspacePath, sasInput);
    setUsageMsg(r.message);
    if (r.ok) {
      setSasInput('');
      setSasRevealed(false);   // fall back to the saved-banner view
    }
    await refreshUsage();
    setUsageWorking(false);
  };

  const onUploadNow = async (): Promise<void> => {
    setUsageWorking(true);
    setUsageMsg(null);
    const r = await window.api.telemetry.uploadNow(workspacePath);
    if (r.ok) {
      setUsageMsg(`Uploaded ${r.filesUploaded} file(s), ${(r.bytesUploaded / 1024).toFixed(1)} KB`);
    } else {
      setUsageMsg(`Upload failed: ${r.lastError ?? 'unknown'}`);
    }
    await refreshUsage();
    setUsageWorking(false);
  };

  const onPurge = async (): Promise<void> => {
    if (!confirm('Delete all local telemetry files? This cannot be undone.')) return;
    setUsageWorking(true);
    const r = await window.api.telemetry.purgeLocal(workspacePath);
    setUsageMsg(`Deleted ${r.deleted} file(s)`);
    await refreshUsage();
    setUsageWorking(false);
  };

  const onLaunch = (mode: ClaudeMode): void => {
    void window.api.claude.launch(workspacePath, `/${mode}`);
  };

  // Load branch list for a single repo on demand (when its card mounts).
  const loadBranches = async (repoName: string): Promise<void> => {
    const repoPath = joinPath(workspacePath, repoName);
    setRepoUi((s) => ({
      ...s,
      [repoName]: { ...(s[repoName] ?? defaultRepoUi(repoName)), loading: true }
    }));
    const r = await window.api.repo.listBranches(repoPath);
    setRepoUi((s) => ({
      ...s,
      [repoName]: {
        ...(s[repoName] ?? defaultRepoUi(repoName)),
        loading: false,
        current: r.current,
        branches: r.ok ? r.branches : [],
        log: r.ok ? null : r.message
      }
    }));
  };

  const onSyncBranches = async (repoName: string): Promise<void> => {
    const repoPath = joinPath(workspacePath, repoName);
    setRepoUi((s) => ({
      ...s,
      [repoName]: { ...(s[repoName] ?? defaultRepoUi(repoName)), syncing: true, syncToast: null }
    }));
    const r = await window.api.repo.syncBranches(repoPath);
    setRepoUi((s) => ({
      ...s,
      [repoName]: {
        ...(s[repoName] ?? defaultRepoUi(repoName)),
        syncing: false,
        syncToast: r.ok ? `Sync complete — ${r.branchesAdded} branches visible` : `Sync failed: ${r.message}`,
      }
    }));
    if (r.ok) await loadBranches(repoName);
    // Auto-clear toast after 5s
    setTimeout(() => {
      setRepoUi((s) => {
        const prev = s[repoName];
        if (!prev) return s;
        return { ...s, [repoName]: { ...prev, syncToast: null } };
      });
    }, 5000);
  };

  const onCheckout = async (repoName: string, branch: string, stashIfDirty: boolean): Promise<void> => {
    const repoPath = joinPath(workspacePath, repoName);
    setRepoUi((s) => ({
      ...s,
      [repoName]: { ...(s[repoName] ?? defaultRepoUi(repoName)), switching: true, dirtyPrompt: false, log: null }
    }));
    const r = await window.api.repo.checkoutBranch(repoPath, branch, stashIfDirty);
    if (!r.ok && r.dirty && !stashIfDirty) {
      setRepoUi((s) => ({
        ...s,
        [repoName]: { ...(s[repoName] ?? defaultRepoUi(repoName)), switching: false, dirtyPrompt: true, targetBranch: branch, log: r.message }
      }));
      return;
    }
    setRepoUi((s) => ({
      ...s,
      [repoName]: { ...(s[repoName] ?? defaultRepoUi(repoName)), switching: false, dirtyPrompt: false, log: r.message }
    }));
    if (r.ok) await loadBranches(repoName);   // refresh "current" pointer
  };

  const onLaunchReview = async (): Promise<void> => {
    setLR(true);
    // Launch straight into the real command — /ops/framework-review, not
    // /framework-review (namespace mismatch was one reason this never
    // worked) — and pass it as the session's initial prompt instead of
    // opening a bare terminal and expecting the user to type it.
    await window.api.claude.launch(workspacePath, '/ops/framework-review');
    setTimeout(() => setLR(false), 3000);
  };

  const utilizationPct = cost?.utilization != null ? Math.round(cost.utilization * 100) : null;
  const alertStyle = cost ? ALERT_COLOR[cost.alertLevel] : ALERT_COLOR.UNKNOWN;
  const reviewHealth = review?.healthText ?? 'None';
  const healthStyle = HEALTH_STYLE[reviewHealth] ?? HEALTH_STYLE.None;

  return (
    <div className="min-h-screen bg-titan-gray-bg p-10">
      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <header className="flex items-center justify-between mb-10">
          <div className="flex items-center gap-3">
            <img src={titanConfig?.branding?.logo_path ?? '/assets/titan-mark.svg'} alt="" className="h-8 w-auto" />
            <span className="font-medium text-titan-gray-dark text-lg tracking-tight">
              {titanConfig?.branding?.product_name ?? titanConfig?.org.harness_brand ?? 'Titan'} Dashboard
            </span>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-sm text-titan-gray-mid">
              Role: <span className="font-medium text-titan-gray-dark capitalize">{role ?? 'none'}</span>
              <span className="mx-2">·</span>
              <code className="text-xs">{workspacePath}</code>
            </div>
            {(role === 'architect' || role === 'lead') && (
              <button
                type="button"
                title="Edit titan.config.json (org, repos, SCM/tracker kind, telemetry) without hand-editing JSON"
                onClick={() => setScreen('config-editor')}
                className="text-xs text-titan-gray-mid hover:text-titan-blue-main border border-titan-gray-light rounded-pill px-3 py-1.5 hover:border-titan-blue-main transition-colors"
              >
                Configure
              </button>
            )}
            {role === 'architect' && (
              <button
                type="button"
                title="Clear all saved data and restart the setup wizard (use after reinstalling Titan) — architect role only"
                onClick={() => {
                  if (!confirm('Start over? This clears all saved setup data and shows the install wizard again.\n\nYour codebase and credentials are NOT deleted — only the Titan app state is reset.')) return;
                  void window.api.app.resetWizard();
                }}
                className="text-xs text-titan-gray-mid hover:text-titan-danger border border-titan-gray-light rounded-pill px-3 py-1.5 hover:border-titan-danger transition-colors"
              >
                Start over
              </button>
            )}
          </div>
        </header>

        {/* Connection status pills — ADO · Atlassian · Figma.
            IMPORTANT (2.4.1 pre-ship audit): the Atlassian and Figma pills
            only probe REST/API-key credentials (JIRA_EMAIL+JIRA_API_TOKEN,
            a stored Figma PAT) — they are NOT the claude.ai Rovo/Figma OAuth
            connectors that Claude Code sessions actually use for Jira,
            Confluence, and Figma access. The installer has no way to check
            OAuth connector state (it lives inside claude.ai, not on this
            machine), so the labels now say "REST" explicitly instead of
            implying a green pill means Claude can reach Jira/Confluence —
            it previously did not, and a QA tester could see this pill green
            and still have no working /qa-mode Jira access. ADO is
            different and unchanged: its probe already checks the PAT AND
            whether the azure-devops MCP server actually loaded, which is
            the real signal for that one. */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-medium text-titan-gray-mid uppercase tracking-wider">
              Connections
            </span>
            <button
              type="button"
              onClick={() => void refreshConn()}
              disabled={connChecking}
              className="text-xs text-titan-blue-main hover:underline disabled:text-titan-gray-mid"
              title="Re-test all connections"
            >
              {connChecking ? 'Checking…' : 'Re-test'}
            </button>
            {connStatus && (
              <span className="text-xs text-titan-gray-mid ml-auto">
                Last checked: {new Date(connStatus.checkedAt).toLocaleTimeString()}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-3">
            {(['ado', 'atlassian', 'figma'] as const).map((key) => {
              const entry = connStatus?.[key];
              const state: ConnState = entry?.state ?? 'missing';
              const style = PILL_STYLE[state];
              const label = key === 'ado' ? 'Azure DevOps'
                          : key === 'atlassian' ? 'Atlassian REST (scripts)'
                          : 'Figma REST (scripts)';
              const tooltip = key === 'ado'
                ? (entry?.detail ?? 'Click to re-test')
                : `${entry?.detail ?? 'Click to re-test'} — this checks REST/API-key access only, not the claude.ai OAuth connector Claude sessions use. Authorize that separately in claude.ai → Settings → Connectors.`;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => void refreshConn()}
                  title={tooltip}
                  className={`flex items-center gap-2 px-4 py-2 rounded-pill ring-1 ${style.bg} ${style.ring} hover:opacity-80 transition-opacity`}
                >
                  <span className={`text-base ${style.text}`}>{style.icon}</span>
                  <span className="text-sm font-medium text-titan-gray-dark">{label}</span>
                  <span className={`text-xs ${style.text}`}>· {STATE_LABEL[state]}</span>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-titan-gray-mid mt-2">
            Jira, Confluence, and Figma access <strong>inside Claude Code</strong> use separate claude.ai OAuth connectors —
            authorize them in{' '}
            <button
              type="button"
              className="text-titan-blue-main hover:underline"
              onClick={() => void window.api.shell.openExternal('https://claude.ai/settings/connectors')}
            >
              claude.ai → Settings → Connectors
            </button>
            . These pills cannot check that state.
          </p>
        </div>

        {/* Top row: budget · project · workspace */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-10">
          <Card className={`${alertStyle.bg} ring-1 ${alertStyle.ring}`}>
            <div className="text-sm text-titan-gray-mid mb-1">Token spend this month</div>
            <div className="text-3xl font-bold text-titan-gray-dark mb-2">
              ${cost ? cost.totalUsd.toFixed(2) : '—'}
            </div>
            <div className="text-xs text-titan-gray-mid">
              {cost?.budgetUsd != null && utilizationPct != null
                ? `of $${cost.budgetUsd.toFixed(0)} · ${utilizationPct}% · ${alertStyle.emoji} ${cost.alertLevel}`
                : 'No budget set'}
            </div>
          </Card>

          <Card>
            <div className="text-sm text-titan-gray-mid mb-1">Active project</div>
            <div className="text-lg font-bold text-titan-gray-dark mb-1 truncate">
              {project?.projectId ?? 'None active'}
            </div>
            <div className="text-xs text-titan-gray-mid">
              {project?.projectId
                ? `Since ${project.activatedAt ? new Date(project.activatedAt).toLocaleDateString() : '—'}`
                : 'Run /ops/project-activate inside Claude'}
            </div>
          </Card>

          <Card>
            <div className="text-sm text-titan-gray-mid mb-1">Workspace</div>
            <div className="text-lg font-bold text-titan-gray-dark mb-1">
              {role === 'po' || role === 'manager' ? 'PO setup' : 'Full dev setup'}
            </div>
            <div className="text-xs text-titan-gray-mid">Repo health check coming in v1.1</div>
          </Card>
        </div>

        {/* ── Framework Review card ──────────────────────────────────────── */}
        <h2 className="text-xl font-bold text-titan-gray-dark mb-4 tracking-tight">
          Framework Health
        </h2>

        <div className={`rounded-card p-6 shadow-card ring-1 mb-10 flex items-start justify-between gap-6 ${healthStyle.bg} ${healthStyle.ring}`}>
          {/* Left — status */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-3xl" role="img" aria-label="health">
                {review ? review.healthEmoji : '○'}
              </span>
              <div>
                <div className={`text-lg font-bold ${healthStyle.text}`}>
                  {review ? `${review.healthText} — Quarterly review` : 'No review on file'}
                </div>
                <div className="text-xs text-titan-gray-mid mt-0.5">
                  {review
                    ? `Last: ${review.lastReviewDate}  ·  Next: ${review.nextReviewDate}`
                    : 'Run /ops/framework-review to audit the Titan framework'}
                </div>
              </div>
            </div>

            {/* Issue summary chips */}
            {review && (
              <div className="flex gap-3 flex-wrap">
                {review.p1Count > 0 && (
                  <span className="px-3 py-1 rounded-pill text-xs font-bold bg-titan-danger text-titan-white">
                    {review.p1Count} P1 — Fix now
                  </span>
                )}
                {review.p2Count > 0 && (
                  <span className="px-3 py-1 rounded-pill text-xs font-bold bg-titan-warning/30 text-titan-gray-dark">
                    {review.p2Count} P2 — This quarter
                  </span>
                )}
                {review.p1Count === 0 && review.p2Count === 0 && (
                  <span className="px-3 py-1 rounded-pill text-xs font-bold bg-titan-success/20 text-titan-success">
                    No blocking issues
                  </span>
                )}
                <span className="px-3 py-1 rounded-pill text-xs bg-titan-gray-light text-titan-gray-mid">
                  Report: {review.filename}
                </span>
              </div>
            )}

            {/* What happens when you click */}
            <p className="text-xs text-titan-gray-mid mt-3">
              {role === 'architect'
                ? <>Opens Claude Code and starts <code className="bg-titan-white px-1 rounded">/ops/framework-review</code> directly — skills, MCP, CLAUDE.md, install.py, Titan presets.</>
                : 'The framework review is run by the toolkit maintainer (super role). This card shows the result of the last run.'}
            </p>
          </div>

          {/* Right — CTA. framework-review.md scopes this to the toolkit
              maintainer (super role); the installer has no selectable
              "super" role, so architect — the closest real role, already
              used for Start Over — is the gate here. Other roles see the
              read-only summary above with no action. */}
          <div className="flex flex-col items-end gap-2 shrink-0">
            {role === 'architect' && (
              <Button
                size="lg"
                onClick={() => void onLaunchReview()}
                disabled={launchingReview}
                className="whitespace-nowrap"
              >
                {launchingReview ? 'Launching…' : '🔍 Run framework review'}
              </Button>
            )}
            {review && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void window.api.shell.openExternal(
                  `${workspacePath}\\.claude-projects\\framework-reviews\\${review.filename}`
                )}
              >
                View last report ↗
              </Button>
            )}
          </div>
        </div>

        {/* Repos & branch switcher — dev/lead/arch only (PO/manager have no cloned repos) */}
        {clonedRepos.length > 0 && (
          <div className="mb-10">
            <h2 className="text-xl font-bold text-titan-gray-dark mb-4 tracking-tight">
              Repositories &amp; branches
            </h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {clonedRepos.map((repo) => {
                const ui = repoUi[repo.repoName] ?? defaultRepoUi(repo.repoName);
                const filtered = ui.filter
                  ? ui.branches.filter((b) => b.toLowerCase().includes(ui.filter.toLowerCase()))
                  : ui.branches;
                const setField = (patch: Partial<RepoBranchUI>): void =>
                  setRepoUi((s) => ({ ...s, [repo.repoName]: { ...(s[repo.repoName] ?? defaultRepoUi(repo.repoName)), ...patch } }));
                return (
                  <Card key={repo.repoName}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-semibold text-titan-gray-dark truncate" title={repo.repoName}>{repo.repoName}</div>
                      <code className="text-xs text-titan-gray-mid truncate ml-2" title={ui.current}>
                        {ui.loading ? 'loading…' : (ui.current || '(unknown)')}
                      </code>
                    </div>
                    <input
                      type="text"
                      value={ui.filter}
                      onChange={(e) => setField({ filter: e.target.value })}
                      placeholder="Filter branches (release/, feature/, develop…)"
                      disabled={ui.switching || ui.loading}
                      className="w-full px-3 py-2 mb-2 rounded-pill border-2 border-titan-gray-light focus:border-titan-blue-main outline-none text-sm font-mono"
                    />
                    {ui.filter && filtered.length > 0 && (
                      <div className="max-h-40 overflow-y-auto bg-titan-gray-bg rounded-card border border-titan-gray-light mb-2">
                        {filtered.slice(0, 12).map((b) => (
                          <button
                            key={b}
                            type="button"
                            onClick={() => { setField({ filter: b }); void onCheckout(repo.repoName, b, false); }}
                            disabled={ui.switching || b === ui.current}
                            className={`block w-full text-left px-3 py-1.5 text-sm font-mono hover:bg-titan-blue-soft/40 ${b === ui.current ? 'text-titan-gray-mid' : 'text-titan-gray-dark'}`}
                          >
                            {b === ui.current ? '✓ ' : ''}{b}
                          </button>
                        ))}
                        {filtered.length > 12 && (
                          <div className="px-3 py-1 text-xs text-titan-gray-mid">…{filtered.length - 12} more — keep typing</div>
                        )}
                      </div>
                    )}
                    <div className="flex gap-2 items-center">
                      <Button variant="secondary" size="sm" onClick={() => void loadBranches(repo.repoName)} disabled={ui.loading || ui.switching || ui.syncing}>
                        {ui.loading ? 'Loading…' : 'Refresh'}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void onSyncBranches(repo.repoName)}
                        disabled={ui.syncing || ui.switching || ui.loading}
                        title="Pull all remote branch refs from origin so git checkout works for any branch"
                      >
                        <span className={`inline-block mr-1 ${ui.syncing ? 'animate-spin' : ''}`}>↻</span>
                        {ui.syncing ? 'Syncing…' : 'Sync'}
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => { if (ui.filter && ui.filter !== ui.current) void onCheckout(repo.repoName, ui.filter, false); }}
                        disabled={!ui.filter || ui.filter === ui.current || ui.switching || ui.loading || ui.syncing}
                      >
                        {ui.switching ? 'Switching…' : 'Checkout'}
                      </Button>
                      <span className="text-xs text-titan-gray-mid ml-auto">{ui.branches.length} branches</span>
                    </div>

                    {/* Sync result toast — auto-clears in 5s */}
                    {ui.syncToast && (
                      <div className={`mt-3 p-2 rounded-card text-xs ${
                        ui.syncToast.startsWith('Sync complete')
                          ? 'bg-titan-success/10 ring-1 ring-titan-success text-titan-success'
                          : 'bg-titan-danger/10 ring-1 ring-titan-danger text-titan-danger'
                      }`}>
                        <span className="font-medium">{ui.syncToast.startsWith('Sync complete') ? '✓' : '✗'}</span>{' '}
                        {ui.syncToast}
                      </div>
                    )}
                    {ui.dirtyPrompt && (
                      <div className="mt-3 p-3 rounded-card bg-titan-warning/10 ring-1 ring-titan-warning text-xs">
                        <p className="font-semibold text-titan-gray-dark mb-2">Uncommitted changes detected.</p>
                        <div className="flex gap-2">
                          <Button size="sm" variant="secondary" onClick={() => void onCheckout(repo.repoName, ui.targetBranch, true)}>
                            Stash &amp; switch
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setField({ dirtyPrompt: false, log: 'Cancelled.' })}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                    {ui.log && (
                      <pre className="mt-3 p-2 rounded bg-titan-gray-bg text-xs text-titan-gray-mid overflow-x-auto max-h-32 whitespace-pre-wrap">
                        {ui.log}
                      </pre>
                    )}
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {/* Cost breakdown */}
        {cost && cost.byModel.length > 0 && (
          <div className="mb-10">
            <h2 className="text-lg font-bold text-titan-gray-dark mb-3 tracking-tight">Spend by model</h2>
            <div className="bg-titan-white rounded-card shadow-card divide-y divide-titan-gray-light">
              {cost.byModel.map((m) => (
                <div key={m.model} className="px-5 py-3 flex items-center justify-between">
                  <code className="text-sm text-titan-gray-dark">{m.model}</code>
                  <div className="text-sm">
                    <span className="font-medium text-titan-gray-dark">${m.usd.toFixed(2)}</span>
                    <span className="text-titan-gray-mid ml-2">({Math.round(m.percent * 100)}%)</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Launch Claude Code */}
        <h2 className="text-xl font-bold text-titan-gray-dark mb-4 tracking-tight">Launch Claude Code</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {MODES.map((m) => (
            <Card key={m.id} clickable onClick={() => onLaunch(m.id)}>
              <div className="text-left">
                <h3 className="font-bold text-titan-gray-dark mb-1">{m.label}</h3>
                <p className="text-xs text-titan-gray-mid">{m.description}</p>
              </div>
            </Card>
          ))}
        </div>

        {/* ── Usage / Telemetry section ──────────────────────────────── */}
        <h2 className="text-xl font-bold text-titan-gray-dark mb-2 tracking-tight">
          Usage analytics
        </h2>
        <p className="text-sm text-titan-gray-mid mb-4">
          Metadata-only telemetry — no prompts, no responses, no file contents.
          Local-only by default. Opt in to upload to your org's central dashboard.
        </p>

        <div className="bg-titan-white rounded-card shadow-card p-6 mb-10">
          {!usageStatus ? (
            <div className="text-sm text-titan-gray-mid">Loading usage data…</div>
          ) : (
            <>
              {/* Top row — toggle + stats */}
              <div className="flex flex-wrap items-center justify-between gap-4 mb-5 pb-4 border-b border-titan-gray-light">
                <div>
                  <div className="text-sm font-medium text-titan-gray-dark">
                    Central upload: <span className={usageStatus.enabled ? 'text-titan-success' : 'text-titan-gray-mid'}>
                      {usageStatus.enabled ? 'ENABLED' : 'DISABLED'}
                    </span>
                  </div>
                  <div className="text-xs text-titan-gray-mid mt-0.5">
                    Anonymous user hash: <code className="font-mono">{usageStatus.userHash}</code>
                  </div>
                  {usageStatus.lastUploadAt && (
                    <div className="text-xs text-titan-gray-mid mt-0.5">
                      Last upload: {new Date(usageStatus.lastUploadAt).toLocaleString()} —
                      {usageStatus.lastUploadResult?.ok
                        ? ` ${usageStatus.lastUploadResult.filesUploaded} file(s) sent`
                        : ` failed: ${usageStatus.lastUploadResult?.lastError ?? 'unknown'}`}
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="secondary" size="sm"
                    onClick={() => void onToggleTelemetry()}
                    disabled={usageWorking}
                  >
                    {usageStatus.enabled ? 'Disable upload' : 'Enable upload'}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => void onUploadNow()}
                    disabled={usageWorking || !usageStatus.enabled || !usageStatus.hasSasUrl}
                    title={!usageStatus.hasSasUrl ? 'Add SAS URL first' : 'Upload now'}
                  >
                    Upload now
                  </Button>
                  <Button
                    variant="ghost" size="sm"
                    onClick={() => void onPurge()}
                    disabled={usageWorking}
                  >
                    Forget me
                  </Button>
                </div>
              </div>

              {/* SAS URL config — two states: (a) saved → banner + Clear,
                  (b) not saved → input field. The former third state (a
                  "default SAS baked in by the maintainer") is gone — it
                  required a SAS in pricing.json, which the uploader never
                  supports for security reasons (SAS lives only in
                  keytar/settings.local.json), so that branch could never
                  actually render. Removed in the 2.4.1 pre-ship audit. */}
              {/* Container-name check (2.4.1 fix): the dashboard's read SAS is
                  baked into its build separately from this write SAS, with no
                  runtime link between the two — a SAS for the wrong container
                  uploads successfully here and the dashboard never sees it,
                  silently. This can only warn against the ONE documented
                  canonical container name, not confirm a match with whatever
                  SAS the dashboard build actually has. */}
              {usageStatus.hasSasUrl && usageStatus.containerMismatch && (
                <div className="mb-3 p-3 rounded-card bg-titan-warning/10 ring-1 ring-titan-warning text-xs text-titan-gray-dark">
                  ⚠ Configured container is <code className="font-mono">{usageStatus.configuredContainer}</code>, but the
                  documented dashboard container is <code className="font-mono">{usageStatus.expectedContainer}</code>.
                  If this doesn't match what the dashboard actually reads from, uploads here will succeed but never
                  appear on the dashboard.
                </div>
              )}

              {/* Expiry is the failure this Dashboard could not previously
                  state: an expired SAS 403s on every scheduled upload, and the
                  only evidence was raw Azure XML inside lastUploadResult. */}
              {usageStatus.hasSasUrl && usageStatus.sasExpired && (
                <div className="mb-3 p-3 rounded-card bg-titan-danger/10 ring-1 ring-titan-danger text-xs text-titan-gray-dark">
                  ⚠ Your SAS URL expired on <code className="font-mono">{usageStatus.sasExpiresAt}</code>.
                  Uploads are failing and will keep failing until you paste a current URL below.
                  Ask your toolkit maintainer for a new one.
                </div>
              )}

              {usageStatus.hasSasUrl && !sasRevealed && (
                <div className="mb-5 pb-4 border-b border-titan-gray-light flex items-center justify-between">
                  <div className="text-sm text-titan-gray-mid">
                    <span className="text-titan-success">✓</span> SAS URL saved in settings.local.json — same value used by the scheduled upload task
                    {usageStatus.configuredContainer && (
                      <span className="ml-1 text-titan-gray-mid">(container: <code className="font-mono">{usageStatus.configuredContainer}</code>)</span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setSasRevealed(true)}>
                      Replace
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => void window.api.telemetry.setSasUrl(workspacePath, '').then(refreshUsage)}>
                      Clear
                    </Button>
                  </div>
                </div>
              )}

              {(!usageStatus.hasSasUrl || sasRevealed) && (
                <div className="mb-5 pb-4 border-b border-titan-gray-light">
                  <label className="block text-sm font-medium text-titan-gray-dark mb-2">
                    Azure Blob SAS URL
                  </label>
                  <div className="flex gap-2 mb-2">
                    <input
                      type="text"
                      value={sasInput}
                      onChange={(e) => setSasInput(e.target.value)}
                      placeholder="https://<account>.blob.core.windows.net/<container>?sv=..."
                      className="flex-1 px-3 py-2 rounded-pill border-2 border-titan-gray-light focus:border-titan-blue-main outline-none text-xs font-mono"
                    />
                    <Button size="sm" onClick={() => void onSaveSasUrl()} disabled={!sasInput || usageWorking}>
                      Save
                    </Button>
                    {usageStatus.hasSasUrl && (
                      <Button variant="ghost" size="sm" onClick={() => { setSasInput(''); setSasRevealed(false); }}>
                        Cancel
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-titan-gray-mid">
                    Stored encrypted in Windows Credential Manager.
                  </p>
                </div>
              )}

              {/* Cost rollup tiles — derived from _cost_estimate events */}
              {costRollup && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5 p-4 bg-titan-blue-soft/30 rounded-card">
                  <div>
                    <div className="text-xs text-titan-gray-mid uppercase tracking-wider">Today (est.)</div>
                    <div className="text-2xl font-bold text-titan-gray-dark">
                      ${costRollup.today.estMinUsd.toFixed(2)} – ${costRollup.today.estMaxUsd.toFixed(2)}
                    </div>
                    <div className="text-xs text-titan-gray-mid">{costRollup.today.estimates} prompts · {costRollup.today.redirects} redirected</div>
                  </div>
                  <div>
                    <div className="text-xs text-titan-gray-mid uppercase tracking-wider">Last 7 days (est.)</div>
                    <div className="text-2xl font-bold text-titan-gray-dark">
                      ${costRollup.last7Days.estMinUsd.toFixed(2)} – ${costRollup.last7Days.estMaxUsd.toFixed(2)}
                    </div>
                    <div className="text-xs text-titan-gray-mid">{costRollup.last7Days.estimates} prompts</div>
                  </div>
                  <div>
                    <div className="text-xs text-titan-gray-mid uppercase tracking-wider">Savings (7d est.)</div>
                    <div className="text-2xl font-bold text-titan-success">
                      ~${costRollup.last7Days.estimatedSavingsUsd.toFixed(2)}
                    </div>
                    <div className="text-xs text-titan-gray-mid">if routed to Copilot</div>
                  </div>
                  <div>
                    <div className="text-xs text-titan-gray-mid uppercase tracking-wider">Copilot redirects (7d)</div>
                    <div className="text-2xl font-bold text-titan-gray-dark">
                      {costRollup.last7Days.redirects}
                    </div>
                    <div className="text-xs text-titan-gray-mid">use /common/copilot to redirect</div>
                  </div>
                </div>
              )}

              {/* Stats grid */}
              {usageSummary && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
                  <div>
                    <div className="text-xs text-titan-gray-mid">Total events</div>
                    <div className="text-2xl font-bold text-titan-gray-dark">{usageSummary.totalEvents.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-xs text-titan-gray-mid">Sessions</div>
                    <div className="text-2xl font-bold text-titan-gray-dark">{usageSummary.sessions}</div>
                  </div>
                  <div>
                    <div className="text-xs text-titan-gray-mid">Pending upload</div>
                    <div className="text-2xl font-bold text-titan-gray-dark">{usageSummary.unUploadedFiles} file(s)</div>
                  </div>
                  <div>
                    <div className="text-xs text-titan-gray-mid">Date range</div>
                    <div className="text-sm font-bold text-titan-gray-dark">
                      {usageSummary.oldestUnUploadedDate ?? '—'}
                      {usageSummary.oldestUnUploadedDate !== usageSummary.newestUnUploadedDate && ` → ${usageSummary.newestUnUploadedDate}`}
                    </div>
                  </div>
                </div>
              )}

              {/* Top modes + top skills (top 5 each) */}
              {usageSummary && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <h3 className="text-sm font-semibold text-titan-gray-dark mb-2">Top modes</h3>
                    {Object.entries(usageSummary.byMode).sort((a,b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => {
                      const max = Math.max(...Object.values(usageSummary.byMode), 1);
                      const pct = (v / max) * 100;
                      return (
                        <div key={k} className="flex items-center gap-2 mb-1">
                          <code className="text-xs text-titan-gray-dark w-32 truncate">/{k}</code>
                          <div className="flex-1 h-3 bg-titan-gray-light rounded-pill overflow-hidden">
                            <div className="h-full bg-titan-blue-main" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs text-titan-gray-mid w-10 text-right">{v}</span>
                        </div>
                      );
                    })}
                    {Object.keys(usageSummary.byMode).length === 0 && (
                      <div className="text-xs text-titan-gray-mid">No mode activations yet.</div>
                    )}
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-titan-gray-dark mb-2">Top skills</h3>
                    {Object.entries(usageSummary.bySkill).sort((a,b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => {
                      const max = Math.max(...Object.values(usageSummary.bySkill), 1);
                      const pct = (v / max) * 100;
                      return (
                        <div key={k} className="flex items-center gap-2 mb-1">
                          <code className="text-xs text-titan-gray-dark w-32 truncate">{k}</code>
                          <div className="flex-1 h-3 bg-titan-gray-light rounded-pill overflow-hidden">
                            <div className="h-full bg-titan-blue-main" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs text-titan-gray-mid w-10 text-right">{v}</span>
                        </div>
                      );
                    })}
                    {Object.keys(usageSummary.bySkill).length === 0 && (
                      <div className="text-xs text-titan-gray-mid">No skill invocations yet.</div>
                    )}
                  </div>
                </div>
              )}

              {usageMsg && (
                <p className="text-xs text-titan-gray-mid mt-4 italic">{usageMsg}</p>
              )}
            </>
          )}
        </div>

        <div className="mt-10 text-center">
          <Button
            variant="ghost"
            onClick={() => {
              const scm = titanConfig?.platforms.scm;
              const url = scm?.kind === 'github'
                ? `https://github.com/${scm.collection ?? ''}`
                : `https://dev.azure.com/${scm?.collection ?? ''}`;
              void window.api.shell.openExternal(url);
            }}
          >
            {titanConfig?.platforms.scm.kind === 'github' ? 'Open GitHub' : 'Open ADO portal'}
          </Button>
          {titanConfig?.platforms.issue_tracker.kind === 'jira' && (
            <>
              <span className="mx-3 text-titan-gray-light">·</span>
              <Button variant="ghost" onClick={() => void window.api.shell.openExternal(`https://${titanConfig.platforms.issue_tracker.site ?? ''}`)}>
                Open Jira
              </Button>
            </>
          )}
        </div>

      </div>
    </div>
  );
}
