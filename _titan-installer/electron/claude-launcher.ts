// Claude launcher — invokes Claude Code with a pre-selected initial prompt
// (a role mode like `/arch-mode`, or an exact skill command like
// `/ops/framework-review`).
//
// Fixed 2026-08 (2.4.1 pre-ship audit): earlier versions tried
// `claude --append-system-prompt "/<mode>"`, which the CLI doesn't accept as
// a flag, and fell back to opening a bare terminal + typing the mode
// manually — both command builders took `mode` but discarded it (`_mode`),
// so "Run framework review" only ever opened an empty terminal. The Claude
// Code CLI DOES accept an initial prompt as a positional argument
// (`claude "<prompt>"`, confirmed via `claude --help` — "Arguments: prompt
// Your prompt"), so we pass the slash command straight through instead of
// asking the user to type it.
//
// On Windows we open Windows Terminal (`wt.exe`) with a fresh tab in the
// workspace, then invoke `claude "<prompt>"` so the session starts already
// in the right mode / already running the right skill.

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';

// Kept for callers that want a typed set of role-mode strings (e.g. the
// Dashboard's per-role "launch Claude Code" buttons). NOT used to constrain
// what launchClaude() accepts — framework-review and other exact skill
// commands (`/ops/framework-review`) aren't "modes" and shouldn't be forced
// into this union. Duplicated in electron/preload.ts and src/global.d.ts —
// keep all three in sync (tracked for consolidation in the de-complication pass).
export type ClaudeMode =
  | 'po-mode'
  | 'dev-mode'
  | 'lead-review'
  | 'arch-mode'
  | 'grill-me'
  | 'qa-mode'
  | 'security-mode'
  | 'sre-mode'
  | 'designer-mode'
  | 'prodsupport-mode';

export interface LaunchResult {
  ok: boolean;
  message: string;
}

/** Launch Claude Code in a new terminal window, cd'd into the workspace,
 *  with `initialPrompt` (e.g. "/arch-mode" or "/ops/framework-review")
 *  passed as the CLI's positional prompt argument so the session starts
 *  already in the right mode / already running the right command.
 *  Detached so closing the installer doesn't kill the Claude session. */
export async function launchClaude(
  workspacePath: string,
  initialPrompt: string
): Promise<LaunchResult> {
  // Sanity: workspace must exist and be a directory.
  try {
    const stat = await fs.stat(workspacePath);
    if (!stat.isDirectory()) {
      return { ok: false, message: `Workspace path is not a directory: ${workspacePath}` };
    }
  } catch {
    return { ok: false, message: `Workspace not found: ${workspacePath}` };
  }

  // Try Windows Terminal first — best UX, handles ANSI colours cleanly.
  const wtAvailable = await commandExists('wt');
  const cmdToRun = wtAvailable
    ? buildWindowsTerminalCommand(workspacePath, initialPrompt)
    : buildCmdFallbackCommand(workspacePath, initialPrompt);

  try {
    const child = spawn(cmdToRun.cmd, cmdToRun.args, {
      cwd: workspacePath,
      detached: true,
      stdio: 'ignore',
      shell: false
    });
    child.unref();   // let it survive after we return
    return {
      ok: true,
      message: `Claude Code launched — starting with ${initialPrompt}.`
    };
  } catch (err) {
    return { ok: false, message: `Failed to launch terminal: ${(err as Error).message}` };
  }
}

/** Check if a command resolves via `where` on Windows. */
function commandExists(name: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const child = spawn('where', [name], { shell: false });
    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

function buildWindowsTerminalCommand(workspacePath: string, initialPrompt: string): { cmd: string; args: string[] } {
  // `wt new-tab -d <path> cmd /k claude "<prompt>"` opens a new Windows
  // Terminal tab in the workspace and runs `claude` with the slash command
  // pre-supplied, in a cmd shell that stays open (/k) after Claude exits.
  return {
    cmd: 'wt',
    args: ['new-tab', '-d', workspacePath, 'cmd', '/k', 'claude', initialPrompt]
  };
}

function buildCmdFallbackCommand(workspacePath: string, initialPrompt: string): { cmd: string; args: string[] } {
  // start /D <dir> cmd /k claude "<prompt>"  —  same effect with the legacy
  // cmd.exe. `/D <dir>` anchors the new window's cwd — the previous version
  // of this fallback dropped workspacePath entirely and relied on inheriting
  // the spawn cwd, which broke if that assumption ever changed.
  return {
    cmd: 'cmd',
    args: ['/c', 'start', 'cmd', '/D', workspacePath, '/k', 'claude', initialPrompt]
  };
}

/** Convenience for callers that want to know which terminal will be used. */
export async function detectAvailableTerminal(): Promise<'windows-terminal' | 'cmd' | 'none'> {
  if (await commandExists('wt')) return 'windows-terminal';
  if (await commandExists('cmd')) return 'cmd';
  return 'none';
}

/** Detect if Claude Code is installed (so the launcher button can be
 *  disabled with a useful hint when it isn't). */
export function isClaudeInstalled(): Promise<boolean> {
  return commandExists('claude');
}
