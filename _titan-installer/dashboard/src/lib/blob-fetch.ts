// Azure Blob JSONL fetcher — reads telemetry data from the Titan
// telemetry container via a read-only SAS URL.
//
// In development (localhost) all requests go through the Vite proxy at
// /api/blob to avoid CORS restrictions. In production the app hits Azure
// directly (CORS rule on the storage account allows the SWA origin).

import type { TelemetryEvent } from './types';

const CACHE   = new Map<string, { etag: string; events: TelemetryEvent[] }>();
const IS_DEV  = import.meta.env.DEV;

interface BlobItem {
  name: string;
  url:  string;
}

// Resolve fetch URL for a given blob name (or empty for the list request).
// Dev: proxy through /api/blob/<sub-path> — Node proxies to Azure, no CORS.
// Prod: direct Azure Blob URL with SAS query string appended.
// `marker` continues a truncated listing (see listBlobs below).
function resolveUrl(sasUrl: string, blobName?: string, marker?: string): string {
  if (IS_DEV) {
    // Individual blob: /api/blob/hash/date/file.jsonl (path-based, no query)
    if (blobName) return `/api/blob/${blobName}`;
    // List request: /api/blob?restype=container&comp=list&maxresults=1000[&marker=...]
    const qs = marker ? `&marker=${encodeURIComponent(marker)}` : '';
    return `/api/blob?restype=container&comp=list&maxresults=1000${qs}`;
  }
  if (blobName) {
    const base  = sasUrl.split('?')[0];
    const sasQs = sasUrl.split('?')[1] ?? '';
    return `${base}/${blobName}?${sasQs}`;
  }
  const u = new URL(sasUrl);
  u.searchParams.set('restype', 'container');
  u.searchParams.set('comp', 'list');
  u.searchParams.set('maxresults', '1000');
  if (marker) u.searchParams.set('marker', marker);
  return u.toString();
}

// Extract a single top-level XML element's text content by tag name, from
// within a bounded chunk of XML (not the whole document) — used below to
// keep <Name> extraction scoped to actual <Blob> elements.
function extractTag(xml: string, tag: string): string | null {
  const m = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml);
  return m ? m[1] : null;
}

// Azure Blob REST: list ALL blobs in the container via SAS, following
// <NextMarker> continuation tokens. Fixed in the 2.4.1 pre-ship audit:
// previously this made a single request capped at maxresults=1000 with no
// continuation handling, so once a container passed ~1000 blobs (one per
// upload run, reachable within weeks of a multi-user pilot) totals would
// silently stop growing with no error surfaced anywhere.
//
// Also scopes name extraction to <Blob>...</Blob> elements specifically
// (rather than a bare `<Name>` regex over the whole response) so a future
// delimiter-based (virtual-folder) listing that introduces <BlobPrefix>
// elements — which also contain a <Name> — can't produce phantom entries
// whose GET then 404s and (pre-fix) rejected the whole Promise.all.
export async function listBlobs(sasUrl: string): Promise<BlobItem[]> {
  const blobs: BlobItem[] = [];
  let marker: string | undefined;
  const MAX_PAGES = 50;   // guard: 50 * 1000 = 50k blobs is far beyond any realistic pilot size

  for (let page = 0; page < MAX_PAGES; page++) {
    const listUrl = resolveUrl(sasUrl, undefined, marker);
    const res = await fetch(listUrl);
    if (!res.ok) throw new Error(`List blobs HTTP ${res.status}`);
    const xml = await res.text();

    const blobBlockRegex = /<Blob>[\s\S]*?<\/Blob>/g;
    let bm: RegExpExecArray | null;
    while ((bm = blobBlockRegex.exec(xml)) !== null) {
      const name = extractTag(bm[0], 'Name');
      if (name) blobs.push({ name, url: resolveUrl(sasUrl, name) });
    }

    marker = extractTag(xml, 'NextMarker') || undefined;
    if (!marker) break;
  }
  return blobs;
}

// Fetch a single blob with ETag caching.
async function fetchBlob(item: BlobItem): Promise<TelemetryEvent[]> {
  const cached = CACHE.get(item.name);
  const headers: Record<string, string> = {};
  if (cached) headers['If-None-Match'] = cached.etag;

  const res = await fetch(item.url, { headers });
  if (res.status === 304 && cached) return cached.events;
  if (!res.ok) throw new Error(`GET ${item.name} HTTP ${res.status}`);

  const text  = await res.text();
  const etag  = res.headers.get('etag') ?? '';
  const events: TelemetryEvent[] = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { events.push(JSON.parse(t) as TelemetryEvent); } catch { /* skip malformed */ }
  }
  CACHE.set(item.name, { etag, events });
  return events;
}

export interface FetchAllEventsResult {
  events: TelemetryEvent[];
  totalBlobs: number;
  failedBlobs: number;
}

// Fetch all blobs and concatenate events. Throws only if the SAS URL is
// empty/malformed or the LIST call itself fails — that's a real
// configuration problem, not a partial-data situation.
//
// Fixed in the 2.4.1 pre-ship audit: individual blob GETs used to run under
// Promise.all, so ONE bad blob (a stray phantom entry from the old <Name>
// over-match, a transient 403/404, anything) rejected the whole batch and
// blanked the entire dashboard with a generic error — no partial data, no
// indication of which blob or how many. Promise.allSettled now lets
// successfully-fetched blobs still render; the caller gets a failure count
// to show as a non-fatal "N of M files could not be read" notice instead.
export async function fetchAllEvents(sasUrl: string): Promise<FetchAllEventsResult> {
  if (!sasUrl || !sasUrl.startsWith('https://')) {
    throw new Error('No valid read SAS URL configured. Set VITE_TELEMETRY_READ_SAS in .env');
  }

  const blobs = await listBlobs(sasUrl);
  // Sort ascending by name (path includes date) so events arrive chronologically.
  blobs.sort((a, b) => a.name.localeCompare(b.name));

  const results = await Promise.allSettled(blobs.map((b) => fetchBlob(b)));
  const allEvents: TelemetryEvent[] = [];
  let failedBlobs = 0;
  for (const r of results) {
    if (r.status === 'fulfilled') {
      allEvents.push(...r.value);
    } else {
      failedBlobs++;
    }
  }
  // Sort by ts ascending for aggregation correctness.
  allEvents.sort((a, b) => a.ts.localeCompare(b.ts));
  return { events: allEvents, totalBlobs: blobs.length, failedBlobs };
}
