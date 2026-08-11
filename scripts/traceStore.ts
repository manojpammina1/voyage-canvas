import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ExperienceTrace } from '../packages/orchestrator/src/observability.js';

const TRACE_DIR = join(process.cwd(), '.voyage', 'traces');
const TRACE_FILE = join(TRACE_DIR, 'latest.json');

export function persistLatestTrace(trace: ExperienceTrace): void {
  mkdirSync(TRACE_DIR, { recursive: true });
  writeFileSync(TRACE_FILE, JSON.stringify(trace, null, 2), 'utf8');
}

export function readLatestTrace(): ExperienceTrace | null {
  try {
    return JSON.parse(readFileSync(TRACE_FILE, 'utf8')) as ExperienceTrace;
  } catch {
    return null;
  }
}
