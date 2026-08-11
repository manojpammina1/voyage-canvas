import { useState, useEffect } from 'react';
import Button from '../components/Button';
import { useWizard } from '../store/wizard-state';

// Screen 6 — Workspace location.
// Real wiring:
//   - "Browse…" invokes Electron's native folder picker via the main process
//     (dialog.showOpenDialog). The renderer can't open a native dialog
//     directly without going through IPC.
//   - On folder change, queries free disk space and warns when below the
//     ~4 GB estimate for cloning all 5 repos.

const ESTIMATED_NEEDED_GB = 3.5;

function formatGB(bytes: number): string {
  return (bytes / (1024 ** 3)).toFixed(1) + ' GB';
}

export default function WorkspaceLocation(): JSX.Element {
  const workspacePath = useWizard((s) => s.workspacePath);
  const setWorkspacePath = useWizard((s) => s.setWorkspacePath);
  const setScreen = useWizard((s) => s.setScreen);
  const nextScreen = useWizard((s) => s.nextScreen);

  const [free, setFree] = useState<number | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [spaceWarning, setSpaceWarning] = useState<string | null>(null);

  // Re-query disk space whenever the chosen path changes.
  useEffect(() => {
    let cancelled = false;
    void window.api.fs.freeSpace(workspacePath).then((r) => {
      if (cancelled || !r.ok || !r.data) return;
      setFree(r.data.freeBytes);
      setTotal(r.data.totalBytes);
      const freeGB = r.data.freeBytes / (1024 ** 3);
      if (freeGB < ESTIMATED_NEEDED_GB) {
        setSpaceWarning(`Only ${freeGB.toFixed(1)} GB free — Titan needs about ${ESTIMATED_NEEDED_GB} GB.`);
      } else {
        setSpaceWarning(null);
      }
    });
    return () => { cancelled = true; };
  }, [workspacePath]);

  const onBrowse = async (): Promise<void> => {
    const result = await window.api.dialog.pickFolder(workspacePath);
    if (result.ok && result.data) {
      setWorkspacePath(result.data.folderPath);
    }
  };

  const advance = (): void => setScreen(nextScreen());

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold text-titan-gray-dark mb-3 text-center tracking-tight">
        Where should we put your workspace?
      </h1>
      <p className="text-base text-titan-gray-mid text-center mb-8 leading-relaxed">
        Your repositories will be cloned here. You can change this later, but it's easiest
        to keep them all in one folder.
      </p>

      <div className="bg-titan-white rounded-card shadow-card p-6 mb-8">
        <div className="text-sm text-titan-gray-mid mb-2">Workspace folder</div>
        <div className="flex gap-3 items-center mb-4">
          <code className="flex-1 px-4 py-3 rounded-pill bg-titan-gray-bg text-sm font-mono text-titan-gray-dark border border-titan-gray-light truncate">
            {workspacePath}
          </code>
          <Button variant="secondary" size="sm" onClick={() => void onBrowse()}>
            Browse…
          </Button>
        </div>

        <div className="text-xs text-titan-gray-mid">
          {free != null && total != null ? (
            <>
              Free space: {formatGB(free)} of {formatGB(total)} ·
              Estimated needed: {ESTIMATED_NEEDED_GB} GB
            </>
          ) : (
            <>Reading disk space…</>
          )}
        </div>

        {spaceWarning && (
          <p className="text-sm text-titan-warning font-medium mt-3">
            ⚠ {spaceWarning}
          </p>
        )}
      </div>

      <div className="flex justify-center">
        <Button size="lg" onClick={advance}>
          Looks good — continue
        </Button>
      </div>
    </div>
  );
}
