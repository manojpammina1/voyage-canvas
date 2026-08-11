import { useEffect, useRef, useState } from 'react';
import Button from '../components/Button';
import { useWizard, type CloneStatus } from '../store/wizard-state';
import type { CloneRepoSpec } from '../global';

// Screen 7 — parallel git clone.
// Real wiring:
//   - "Start cloning" sends the selected repos + branches to the main
//     process (window.api.clone.start). Main returns one final result;
//     per-repo progress arrives as stream events on 'clone:event'.
//   - Each event updates the row's status via wizard-state.updateRepo.
//   - Failed repos get a per-row Retry button that goes back through the
//     same code path (clone.retry).

// Hand-rolled path-join to avoid pulling a path-browserify dependency.
// Windows-only — backslash separator, collapses runs of backslashes.
function joinPath(...parts: string[]): string {
  return parts.join('\\').replace(/\\+/g, '\\');
}

const statusLabel: Record<CloneStatus, { text: string; tone: string }> = {
  queued:  { text: 'Queued',     tone: 'text-titan-gray-mid'   },
  cloning: { text: 'Cloning…',   tone: 'text-titan-blue-main'  },
  done:    { text: '✓ Done',     tone: 'text-titan-success'    },
  failed:  { text: '✗ Failed',   tone: 'text-titan-danger'     }
};

// Per-repo branch-list state — keyed by repoName. Replaces the single
// shared `branchOptions` state that used to be fetched once against
// the configured repo and applied to every repo's dropdown regardless of
// which repo it actually belonged to.
interface RepoBranchState {
  options: string[];
  loading: boolean;
  error: string | null;
}

export default function CloneRepos(): JSX.Element {
  const role = useWizard((s) => s.role);
  const repos = useWizard((s) => s.repos);
  const updateRepo = useWizard((s) => s.updateRepo);
  const workspacePath = useWizard((s) => s.workspacePath);
  const releaseBranch = useWizard((s) => s.releaseBranch);
  const setReleaseBranch = useWizard((s) => s.setReleaseBranch);
  const adoPatValue = useWizard((s) => s.adoPatValue);
  const setScreen = useWizard((s) => s.setScreen);
  const nextScreen = useWizard((s) => s.nextScreen);
  // QA clones only Playwright, which does NOT use release/RYYYY-NN naming —
  // it has its own branch list query skipped below, same reasoning as before.
  const isQa = role === 'qa';

  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [repoBranches, setRepoBranches] = useState<Record<string, RepoBranchState>>({});
  // Keep the unsubscribe function across renders so we can clean it up.
  const offRef = useRef<(() => void) | null>(null);

  // Subscribe to clone events on mount. The subscription is owned by this
  // screen; we unsubscribe on unmount so we don't double-handle when the
  // user returns to this screen after a retry round.
  useEffect(() => {
    offRef.current = window.api.clone.onEvent((evt) => {
      updateRepo(evt.repoName, { status: evt.status, message: evt.message });
    });
    return () => {
      offRef.current?.();
      offRef.current = null;
    };
  }, [updateRepo]);

  // Load each repo's OWN branch list on mount — fixed in the 2.4.1 pre-ship
  // audit. Previously this queried the configured repo once and applied that
  // single list (and, via setReleaseBranch, that single branch) to every
  // repo, so per-repo branches could never actually diverge even though
  // CloneRepoEntry.branch is a per-repo field. Skipped entirely for QA:
  // Playwright has its own branch ('main', set in DEFAULT_QA_REPOS) and was
  // never part of the release/RYYYY-NN naming scheme.
  useEffect(() => {
    if (isQa) return;
    let cancelled = false;
    (async () => {
      const results = await Promise.all(
        repos.map(async (r) => {
          setRepoBranches((s) => ({ ...s, [r.repoName]: { options: [], loading: true, error: null } }));
          try {
            const res = await window.api.ado.listReleaseBranches(r.repoName, adoPatValue, workspacePath);
            return { repoName: r.repoName, res };
          } catch (err) {
            return { repoName: r.repoName, res: { ok: false, branches: [], message: (err as Error).message } };
          }
        })
      );
      if (cancelled) return;
      setRepoBranches((s) => {
        const next = { ...s };
        for (const { repoName, res } of results) {
          next[repoName] = {
            options: res.ok ? res.branches : [],
            loading: false,
            error: res.ok ? null : (res.message || 'No branches returned — using default')
          };
        }
        return next;
      });
      // Snap each repo whose current branch isn't in its own list to that
      // repo's latest — per-repo, not the old single shared snap.
      for (const { repoName, res } of results) {
        if (res.ok && res.branches.length > 0) {
          const repo = repos.find((r) => r.repoName === repoName);
          if (repo && !res.branches.includes(repo.branch)) {
            updateRepo(repoName, { branch: res.branches[0] });
          }
        }
      }
    })();
    return () => { cancelled = true; };
    // repos/adoPatValue/updateRepo deliberately omitted — load once at mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buildCloneSpecs = (): CloneRepoSpec[] =>
    repos
      .filter((r) => r.selected)
      .map((r) => ({
        repoName: r.repoName,
        branch:   r.branch,
        targetPath: joinPath(workspacePath, r.repoName)
      }));

  const onStart = async (): Promise<void> => {
    if (buildCloneSpecs().length === 0) {
      // Nothing selected — skip straight to install.
      setFinished(true);
      return;
    }
    setRunning(true);
    setFinished(false);
    const result = await window.api.clone.start(buildCloneSpecs());
    setRunning(false);
    setFinished(true);
    // result.ok flags whole-batch success; individual failures already
    // surfaced via events, so we don't need to re-display them here.
    void result;
  };

  const onRetry = async (repoName: string): Promise<void> => {
    const repo = repos.find((r) => r.repoName === repoName);
    if (!repo) return;
    await window.api.clone.retry({
      repoName: repo.repoName,
      branch:   repo.branch,
      targetPath: joinPath(workspacePath, repo.repoName)
    });
  };

  const advance = (): void => setScreen(nextScreen());

  const anySelected = repos.some((r) => r.selected);
  const hasFailures = repos.filter((r) => r.selected).some((r) => r.status === 'failed');

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold text-titan-gray-dark mb-3 text-center tracking-tight">
        Repositories to clone
      </h1>
      <p className="text-base text-titan-gray-mid text-center mb-6 leading-relaxed">
        We'll clone these into <code className="text-xs">{workspacePath}</code> using your ADO token.
        {isQa
          ? ' The Playwright repo only — no AEM/Hybris source ever lands on this machine.'
          : " Uncheck any you don't need right now — you can clone them later from the dashboard."}
      </p>

      {/* "Apply to all" convenience control — most installs use the same
          release branch everywhere, so this bulk-sets every repo's branch
          in one action. It no longer OWNS each repo's branch, though: the
          per-row selector below can diverge from it afterward (fixed in the
          2.4.1 pre-ship audit — previously this control WAS the only branch
          selector and silently overwrote every repo on every change). */}
      {!isQa && (
        <div className="bg-titan-white rounded-card shadow-card mb-4 px-5 py-4 flex items-center gap-4">
          <label htmlFor="release-branch" className="text-sm font-medium text-titan-gray-dark whitespace-nowrap">
            Apply branch to all:
          </label>
          <input
            id="release-branch"
            type="text"
            value={releaseBranch}
            onChange={(e) => setReleaseBranch(e.target.value)}
            disabled={running}
            className="flex-1 px-4 py-2 rounded-pill border-2 border-titan-gray-light focus:border-titan-blue-main outline-none text-sm font-mono"
            placeholder="release/R2026-01"
          />
        </div>
      )}

      <div className="bg-titan-white rounded-card shadow-card mb-8 divide-y divide-titan-gray-light">
        {repos.map((r) => {
          const bs = repoBranches[r.repoName];
          return (
            <div key={r.repoName} className="flex items-center gap-4 px-5 py-4">
              <input
                type="checkbox"
                checked={r.selected}
                onChange={(e) => updateRepo(r.repoName, { selected: e.target.checked })}
                disabled={running}
                aria-label={`Clone ${r.repoName}`}
                className="w-5 h-5 accent-titan-blue-main"
              />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-titan-gray-dark truncate">{r.repoName}</div>
                {isQa || !bs || bs.options.length === 0 ? (
                  <input
                    type="text"
                    value={r.branch}
                    onChange={(e) => updateRepo(r.repoName, { branch: e.target.value })}
                    disabled={running}
                    aria-label={`Branch for ${r.repoName}`}
                    className="mt-1 text-xs font-mono px-2 py-1 rounded border border-titan-gray-light w-56"
                    placeholder={isQa ? 'main' : 'release/R2026-01'}
                  />
                ) : (
                  <select
                    value={r.branch}
                    onChange={(e) => updateRepo(r.repoName, { branch: e.target.value })}
                    disabled={running}
                    aria-label={`Branch for ${r.repoName}`}
                    className="mt-1 text-xs font-mono px-2 py-1 rounded border border-titan-gray-light w-56"
                  >
                    {!bs.options.includes(r.branch) && <option value={r.branch}>{r.branch}</option>}
                    {bs.options.map((b) => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                )}
                {!isQa && (
                  <div className="text-[11px] text-titan-gray-mid mt-0.5">
                    {bs?.loading ? 'Loading branches…' : bs?.error ? `Manual entry — ${bs.error}` : bs ? `${bs.options.length} branch(es) available` : ''}
                  </div>
                )}
                {r.message && r.status === 'failed' && (
                  <div className="text-xs text-titan-danger mt-1 truncate" title={r.message}>{r.message}</div>
                )}
              </div>
              <span className={`text-sm font-medium ${statusLabel[r.status].tone}`}>
                {statusLabel[r.status].text}
              </span>
              {r.status === 'failed' && !running && (
                <Button variant="secondary" size="sm" onClick={() => void onRetry(r.repoName)}>
                  Retry
                </Button>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex justify-center gap-3">
        {!finished && (
          <Button size="lg" onClick={() => void onStart()} disabled={running || !anySelected}>
            {running ? 'Cloning in progress…' : 'Start cloning'}
          </Button>
        )}
        {/* Cloning is never a prerequisite for the rest of setup — repos can be
            cloned later from the dashboard. Skipping has to stay available both
            before starting (no ADO access yet, wrong branch, slow link) and
            after failures, otherwise a repo that cannot clone blocks the whole
            install. */}
        {!running && (
          <Button variant="secondary" size="lg" onClick={advance}>
            Skip for now
          </Button>
        )}
        {finished && (
          <Button
            size="lg"
            onClick={advance}
            /* Was `hasFailures && !allFinishedOk` — but those two are mutually
               exclusive, so any failure disabled the very button offering to
               continue past it, dead-ending the installer. Only an in-flight
               clone should block advancing. */
            disabled={running}
          >
            {hasFailures ? 'Continue anyway' : 'Continue'}
          </Button>
        )}
      </div>
    </div>
  );
}
