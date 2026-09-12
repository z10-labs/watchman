import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Route handlers and the Inngest wiring are covered by the spine test at
      // the function level; the thresholds guard the logic, not the plumbing.
      exclude: ['src/app/**', 'src/jobs/function.ts', 'src/runtime.ts', 'src/github/octokit-api.ts'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
