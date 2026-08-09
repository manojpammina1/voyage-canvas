// Token vault — wraps `keytar` to store the ADO PAT in Windows Credential
// Manager. The plaintext PAT lives in memory only briefly (during
// validation and during install.py spawn); at rest it's encrypted by the
// OS keystore, accessible only to the current Windows user.
//
// Service + account names are fixed strings — only one PAT per user.
// Future: if we ever support multiple ADO orgs, account becomes the org URL.

import * as keytar from 'keytar';

const SERVICE = 'Titan-Installer';
const ACCOUNT_ADO_PAT = 'ado-pat';
const ACCOUNT_FIGMA_PAT = 'figma-pat';

/** Store the ADO PAT. Overwrites any previous value for the same account. */
export async function setAdoPat(pat: string): Promise<void> {
  if (!pat || pat.length < 20) {
    throw new Error('Refusing to store an obviously-invalid PAT (< 20 chars).');
  }
  await keytar.setPassword(SERVICE, ACCOUNT_ADO_PAT, pat);
}

/** Read the stored ADO PAT, or null if none. */
export async function getAdoPat(): Promise<string | null> {
  return keytar.getPassword(SERVICE, ACCOUNT_ADO_PAT);
}

/** Delete the stored ADO PAT (e.g. user clicks "Sign out" from Dashboard). */
export async function clearAdoPat(): Promise<boolean> {
  return keytar.deletePassword(SERVICE, ACCOUNT_ADO_PAT);
}

/** True if a PAT is stored. Does NOT validate; only checks presence. */
export async function hasAdoPat(): Promise<boolean> {
  const v = await keytar.getPassword(SERVICE, ACCOUNT_ADO_PAT);
  return !!v && v.length >= 20;
}

/** Store the Figma PAT (separate account in the same Windows credential
 *  store). Used by dev/lead/architect roles when they want offline Figma
 *  REST API access. The built-in Claude Code Figma connector uses its own
 *  OAuth tokens — this PAT is a parallel auth path, not a replacement. */
export async function setFigmaPat(pat: string): Promise<void> {
  if (!pat || pat.length < 20) {
    throw new Error('Refusing to store an obviously-invalid Figma PAT (< 20 chars).');
  }
  await keytar.setPassword(SERVICE, ACCOUNT_FIGMA_PAT, pat);
}

export async function getFigmaPat(): Promise<string | null> {
  return keytar.getPassword(SERVICE, ACCOUNT_FIGMA_PAT);
}

export async function clearFigmaPat(): Promise<boolean> {
  return keytar.deletePassword(SERVICE, ACCOUNT_FIGMA_PAT);
}

export async function hasFigmaPat(): Promise<boolean> {
  const v = await keytar.getPassword(SERVICE, ACCOUNT_FIGMA_PAT);
  return !!v && v.length >= 20;
}

// ── Telemetry SAS URL (Azure Blob write endpoint) ──────────────────────────
// Stored in Windows Credential Manager so it's not in plain text in any
// .claude/ file. Only the toolkit maintainer distributes this URL.

const ACCOUNT_TELEMETRY_SAS = 'telemetry-sas-url';

// Anthropic API key vault functions removed in the 2.4.1 pre-ship audit
// (de-complication pass) — they existed only to back the PO Workspace chat
// (src/screens/PoWorkspace.tsx, electron/po-chat.ts), which is sunset and
// deleted. Not the same thing as the still-active /po-mode Claude Code
// skill (harness/commands/roles/po-mode.md) — that doesn't use this vault.

export async function setTelemetrySasUrl(url: string): Promise<void> {
  if (!url || !url.startsWith('https://') || !url.includes('?')) {
    throw new Error('SAS URL must start with https:// and contain a query string.');
  }
  await keytar.setPassword(SERVICE, ACCOUNT_TELEMETRY_SAS, url);
}

export async function getTelemetrySasUrl(): Promise<string | null> {
  return keytar.getPassword(SERVICE, ACCOUNT_TELEMETRY_SAS);
}

export async function clearTelemetrySasUrl(): Promise<boolean> {
  return keytar.deletePassword(SERVICE, ACCOUNT_TELEMETRY_SAS);
}

export async function hasTelemetrySasUrl(): Promise<boolean> {
  const v = await keytar.getPassword(SERVICE, ACCOUNT_TELEMETRY_SAS);
  return !!v && v.startsWith('https://');
}
