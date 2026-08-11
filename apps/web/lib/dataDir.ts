import { join } from 'node:path';

/** Resolve monorepo data directory for server routes. */
export function resolveDataDir(): string {
  if (process.env.VOYAGE_DATA_DIR?.trim()) {
    return process.env.VOYAGE_DATA_DIR.trim();
  }
  return join(process.cwd(), '../../data');
}
