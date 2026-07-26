import { defineConfig } from 'vitest/config';

/**
 * Coverage thresholds are set to the project-wide global rule (80%) so that a
 * regression in test depth fails the run rather than quietly eroding.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      include: ['src/**/*.ts'],
      // The entrypoint is process wiring (listen, signal handlers); it is
      // exercised by running the service, not by unit tests.
      exclude: ['src/index.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
