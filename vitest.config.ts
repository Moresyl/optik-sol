import { defineConfig } from 'vitest/config';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solid({ hot: false, solid: { delegateEvents: false } })],
  test: {
    environment: 'happy-dom',
    include: ['packages/**/*.test.{ts,tsx}'],
    pool: 'threads',
    maxWorkers: 1,
    fileParallelism: false,
    isolate: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      // Measure every shipped package. Keeping only core here made an excellent core
      // score hide completely untested UI entry points from CI.
      include: ['packages/*/src/**/*.{ts,tsx}'],
      exclude: [
        'packages/**/*.test.{ts,tsx}',
        'packages/**/*.d.ts',
        'packages/core/src/index.ts',
        'packages/core/src/types.ts',
      ],
      thresholds: {
        // Whole product: prevent a well-tested core from masking UI regressions.
        statements: 80,
        branches: 75,
        functions: 80,
        lines: 85,
        // The framework-independent engine keeps its stricter established gate.
        'packages/core/src/**/*.ts': {
          statements: 90,
          branches: 80,
          functions: 90,
          lines: 90,
        },
      },
    },
  },
});
