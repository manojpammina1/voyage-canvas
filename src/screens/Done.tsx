import { useEffect, useState } from 'react';
import Button from '../components/Button';
import Card from '../components/Card';
import { useWizard } from '../store/wizard-state';
import type { ClaudeMode } from '../global';

// Screen 9 — Done. Runs a post-install environment self-check ("doctor"),
// then three next-step cards. User picks one.

type DoctorReport = Awaited<ReturnType<typeof window.api.doctor.run>>;

const STATUS_ICON: Record<'pass' | 'warn' | 'fail', { icon: string; cls: string }> = {
  pass: { icon: '✓', cls: 'text-titan-success' },
  warn: { icon: '⚠', cls: 'text-titan-warning' },
  fail: { icon: '✗', cls: 'text-titan-danger' },
};

export default function Done(): JSX.Element {
  const role = useWizard((s) => s.role);
  const workspacePath = useWizard((s) => s.workspacePath);
  const setScreen = useWizard((s) => s.setScreen);
  const titanConfig = useWizard((s) => s.titanConfig);

  const [doctor, setDoctor] = useState<DoctorReport | null>(null);
  useEffect(() => {
    let cancelled = false;
    void window.api.doctor.run(workspacePath, role ?? undefined).then((r) => { if (!cancelled) setDoctor(r); });
    return () => { cancelled = true; };
  }, [workspacePath, role]);

  // Launch confirmation — surfaces the ACTUAL launcher behavior (opens a
  // terminal + runs `claude`; does not type the slash command for you, see
  // claude-launcher.ts) rather than letting the "Launches in /qa-mode" card
  // copy below imply something more automatic than what happens.
  const [launchMsg, setLaunchMsg] = useState<string | null>(null);

  // Default suggested mode per role.
  const suggestedMode: ClaudeMode = (() => {
    switch (role) {
      case 'po':
      case 'manager':    return 'po-mode';
      case 'lead':       return 'lead-review';
      case 'architect':  return 'arch-mode';
      case 'qa':         return 'qa-mode';
      case 'security':   return 'security-mode';
      case 'sre':        return 'sre-mode';
      case 'designer':   return 'designer-mode';
      case 'prodsupport':return 'prodsupport-mode';
      default:           return 'dev-mode';
    }
  })();

  const openClaude = (): void => {
    void window.api.claude.launch(workspacePath, suggestedMode).then((r) => setLaunchMsg(r.message ?? null));
  };

  const goDashboard = (): void => setScreen('dashboard');

  return (
    <div className="max-w-3xl mx-auto text-center">
      {/* Animated success burst — check + confetti rays */}
      <div className="relative w-24 h-24 mx-auto mb-6">
        {/* Confetti rays — radiate outward */}
        {[0, 45, 90, 135, 180, 225, 270, 315].map((deg, idx) => (
          <span
            key={deg}
            className="absolute top-1/2 left-1/2 w-1.5 h-3 rounded-full bg-titan-blue-main animate-confetti-rise"
            style={{
              transform: `translate(-50%, -50%) rotate(${deg}deg) translateY(-30px)`,
              animationDelay: `${0.2 + idx * 0.05}s`,
              backgroundColor: idx % 3 === 0 ? 'var(--titan-success, #1F8B4C)' : undefined,
            }}
          />
        ))}
        {/* Center success pop */}
        <div className="absolute inset-0 rounded-pill bg-titan-success/15 flex items-center justify-center">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
               className="w-14 h-14 text-titan-success animate-check-pop" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 13l4 4L19 7" />
          </svg>
        </div>
      </div>

      <h1 className="text-4xl font-bold text-titan-gray-dark mb-3 tracking-tight">
        You're ready!
      </h1>
      <p className="text-lg text-titan-gray-mid mb-8">
        Titan is set up. Here's what to do next.
      </p>

      {/* Environment self-check — surfaces Node/PAT/Jira/git issues HERE, not mid-session */}
      <div className="max-w-2xl mx-auto mb-10 text-left bg-titan-white rounded-card shadow-card p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-titan-gray-dark">Environment check</h3>
          {doctor
            ? <span className={`text-sm font-medium ${doctor.ok ? 'text-titan-success' : 'text-titan-danger'}`}>
                {doctor.ok ? '✓ All good' : '✗ Action needed'}
              </span>
            : <span className="text-sm text-titan-gray-mid">Checking…</span>}
        </div>
        {doctor ? (
          <div className="divide-y divide-titan-gray-light">
            {doctor.checks.map((c) => {
              const s = STATUS_ICON[c.status];
              return (
                <div key={c.id} className="py-2">
                  <div className="flex items-center gap-2">
                    <span className={`${s.cls} font-bold`}>{s.icon}</span>
                    <span className="text-sm font-medium text-titan-gray-dark flex-1">{c.label}</span>
                    <span className="text-xs text-titan-gray-mid text-right max-w-[55%] truncate" title={c.detail}>{c.detail}</span>
                  </div>
                  {c.status !== 'pass' && c.fix && (
                    <div className="text-xs text-titan-gray-mid mt-1 pl-6"><span className="font-medium">Fix:</span> {c.fix}</div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-sm text-titan-gray-mid py-2">Verifying Node, credentials, and repos…</div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-10">
        <Card clickable onClick={openClaude}>
          <div className="text-left">
            <div className="w-10 h-10 rounded-pill bg-titan-blue-soft text-titan-blue-main flex items-center justify-center font-bold mb-3">
              ▸
            </div>
            <h3 className="font-bold text-titan-gray-dark mb-2">Open Claude Code</h3>
            <p className="text-sm text-titan-gray-mid">
              {role === 'qa'
                ? <>Opens the Playwright repo — type <code className="text-xs">/qa-mode</code> to pull a Jira story and start writing test cases.</>
                : <>Opens your workspace — type <code className="text-xs">/{suggestedMode}</code> to activate your role.</>}
            </p>
          </div>
        </Card>

        <Card clickable onClick={goDashboard}>
          <div className="text-left">
            <div className="w-10 h-10 rounded-pill bg-titan-blue-soft text-titan-blue-main flex items-center justify-center font-bold mb-3">
              ◧
            </div>
            <h3 className="font-bold text-titan-gray-dark mb-2">Open the dashboard</h3>
            <p className="text-sm text-titan-gray-mid">
              See your budget, active project, and switch roles in one place.
            </p>
          </div>
        </Card>

        <Card clickable onClick={() => void window.api.shell.openExternal(`https://${titanConfig?.platforms.issue_tracker.site ?? 'atlassian.net'}/wiki`)}>
          <div className="text-left">
            <div className="w-10 h-10 rounded-pill bg-titan-blue-soft text-titan-blue-main flex items-center justify-center font-bold mb-3">
              ?
            </div>
            <h3 className="font-bold text-titan-gray-dark mb-2">Read the guide</h3>
            <p className="text-sm text-titan-gray-mid">
              Browse CLAUDE.md and the role playbook in Confluence.
            </p>
          </div>
        </Card>
      </div>

      {launchMsg && (
        <p className="text-sm text-titan-gray-mid mb-6 -mt-4">{launchMsg}</p>
      )}

      {role === 'qa' && (
        <p className="text-xs text-titan-gray-mid mb-6 max-w-xl mx-auto">
          First time running <code>/qa-mode</code> in a session: a browser sign-in prompt authorizes the Atlassian
          Rovo connector (Jira/Confluence access) — approve it once and it stays authorized for future sessions.
        </p>
      )}

      <Button variant="ghost" onClick={goDashboard}>
        Skip — take me to the dashboard
      </Button>
    </div>
  );
}
