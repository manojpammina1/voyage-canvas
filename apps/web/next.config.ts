import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const monorepoRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

const nextConfig: NextConfig = {
  outputFileTracingRoot: monorepoRoot,
  transpilePackages: [
    '@voyage/shared',
    '@voyage/commerce',
    '@voyage/content-adapter',
    '@voyage/orchestrator',
  ],
  serverExternalPackages: ['mongodb', 'ioredis'],
  webpack: (config) => {
    // Workspace packages use Node ESM `.js` specifiers pointing at `.ts` sources.
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};

export default nextConfig;
