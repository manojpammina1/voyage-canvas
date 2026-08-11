import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Resolve monorepo data/ via VOYAGE_DATA_DIR or walk-up from package root. */
export function resolveDataDir(fromUrl = import.meta.url): string {
  if (process.env.VOYAGE_DATA_DIR) {
    return resolve(process.env.VOYAGE_DATA_DIR);
  }

  let dir = dirname(fileURLToPath(fromUrl));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, 'data');
    const marker = join(dir, 'pnpm-workspace.yaml');
    if (existsSync(marker) && existsSync(candidate)) {
      return candidate;
    }
    dir = dirname(dir);
  }

  throw new Error(
    'Unable to resolve voyage data directory. Set VOYAGE_DATA_DIR or run from the monorepo.',
  );
}
