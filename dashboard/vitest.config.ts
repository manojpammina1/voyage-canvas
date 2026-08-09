import { defineConfig } from 'vitest/config';

// Vitest config for the Titan dashboard. Node environment is enough — the
// aggregation math under test is pure TypeScript (no DOM). Component rendering is
// verified separately via the production build + Playwright spot-check.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
